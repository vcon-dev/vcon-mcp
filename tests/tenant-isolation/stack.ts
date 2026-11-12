/**
 * Throwaway database stack for the tenant isolation shapes.
 *
 * Starts two pinned containers on a private Docker network:
 *
 *   - PostgreSQL 17 with real pgvector, Supabase-shaped roles (anon,
 *     authenticated, service_role, authenticator, postgres) and Supabase's
 *     default privileges, then every file in supabase/migrations applied in
 *     order as `postgres`, unmodified.
 *   - PostgREST 16.2 at pool 4, verifying HS256 JWTs, exposing `public` and
 *     `vkong`, so a request takes the path it takes on a Supabase stack: JWT
 *     verified, SET LOCAL ROLE, request.jwt.claims.
 *
 * Nothing is written outside the containers. Only PostgREST is published, on
 * an ephemeral 127.0.0.1 port, so parallel runs and other local databases do
 * not collide. SQL goes through `docker exec ... psql` as a chosen role.
 *
 * Entry points for other shapes (an MCP-level test builds on these):
 *
 *   const stack = await startStack({ label: 'mcp' });
 *   await stack.applyMigrations();
 *   await loadFixtures(stack);            // ./fixtures.ts
 *   await stack.applyStrictPack();        // runs supabase/strict/apply.sh
 *   await stack.startRest();              // or startRest('lane'), see below
 *   stack.restUrl;                        // http://127.0.0.1:<port>
 *   stack.mint({ role: 'authenticated', tenant_id: TENANT_A });
 *   await stack.stop();
 *
 * startRest('lane') serves PostgREST the way the tenant lane's PostgREST is
 * meant to run: it logs in as `tenant_authenticator`, a member of
 * `authenticated` only, has no anon role, and exposes `public` only. A token
 * that claims service_role then fails at SET ROLE, and a request with no token
 * gets 401. startRest() (or 'supabase') is the stock Supabase shape. Calling
 * it with the other mode replaces the container; with the same mode it
 * restarts it, which also empties the connection pool. PostgREST serves at
 * the root; supabase-js appends /rest/v1, so a client test needs a proxy or a
 * fetch wrapper that strips it.
 *
 * KEEP=1 leaves the containers running and prints their names.
 */
import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
export const STRICT_DIR = join(ROOT, 'supabase', 'strict');

// Pinned. CI pulls the same tags.
export const PG_IMAGE = process.env.TENANT_PG_IMAGE ?? 'pgvector/pgvector:0.8.1-pg17';
export const PGRST_IMAGE = process.env.TENANT_PGRST_IMAGE ?? 'postgrest/postgrest:v16.2';

export const DB_NAME = 'vcon_tenant';

export type SqlRole = 'supabase_admin' | 'postgres';

export type RestMode = 'supabase' | 'lane';

export interface StackOptions {
  /** Short label used in container names. */
  label?: string;
  /** Schemas PostgREST exposes. */
  schemas?: string;
  /** PostgREST pool size. The design measured the session-variable leak at 4. */
  pool?: number;
}

export interface JwtClaims {
  role?: string;
  tenant_id?: unknown;
  sub?: string;
  exp?: number;
  [k: string]: unknown;
}

function docker(args: string[], input?: string): string {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`docker ${args.slice(0, 3).join(' ')} failed (${r.status}): ${(r.stderr || r.stdout || '').trim().slice(-2000)}`);
  }
  return r.stdout;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** HS256 JWT. `secret` defaults to the stack's; pass another to forge a bad signature. */
export function signJwt(claims: JwtClaims, secret: string): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = b64url(createHmac('sha256', secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class Stack {
  readonly id: string;
  readonly network: string;
  readonly pgName: string;
  readonly restName: string;
  readonly jwtSecret: string;
  /** Per-run credentials for the throwaway containers; nothing else uses them. */
  private readonly adminCredential = randomBytes(16).toString('hex');
  private readonly authenticatorCredential = randomBytes(16).toString('hex');
  readonly schemas: string;
  readonly pool: number;
  restUrl = '';
  private started = false;
  private restMode: RestMode | null = null;

  constructor(opts: StackOptions = {}) {
    const label = (opts.label ?? 'shape').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'shape';
    this.id = `vcon-tenant-${label}-${process.pid}-${randomBytes(3).toString('hex')}`;
    this.network = this.id;
    this.pgName = `${this.id}-pg`;
    this.restName = `${this.id}-rest`;
    this.jwtSecret = randomBytes(32).toString('hex');
    this.schemas = opts.schemas ?? 'public,vkong';
    this.pool = opts.pool ?? 4;
  }

  /** Start PostgreSQL and create the Supabase-shaped roles and schemas. */
  async start(): Promise<void> {
    docker(['network', 'create', this.network]);
    this.started = true;
    docker([
      'run', '-d', '--name', this.pgName, '--network', this.network,
      '--tmpfs', '/var/lib/postgresql/data:rw',
      '-e', 'POSTGRES_USER=supabase_admin', '-e', `POSTGRES_PASSWORD=${this.adminCredential}`, '-e', `POSTGRES_DB=${DB_NAME}`,
      PG_IMAGE,
      '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off', '-c', 'max_connections=60',
    ]);
    for (let i = 0; i < 120; i++) {
      const r = spawnSync('docker', ['exec', this.pgName, 'pg_isready', '-U', 'supabase_admin', '-d', DB_NAME, '-h', '127.0.0.1'], { encoding: 'utf8' });
      // The entrypoint restarts the server once after init; wait for the final one.
      if (r.status === 0) {
        const up = spawnSync('docker', ['exec', this.pgName, 'psql', '-X', '-At', '-U', 'supabase_admin', '-d', DB_NAME, '-h', '127.0.0.1', '-c', 'select 1'], { encoding: 'utf8' });
        if (up.status === 0 && up.stdout.trim() === '1') break;
      }
      if (i === 119) throw new Error('PostgreSQL did not become ready');
      await sleep(250);
    }
    this.sql(BOOTSTRAP_SQL.replaceAll('%AUTHENTICATOR_PASSWORD%', this.authenticatorCredential), { role: 'supabase_admin' });
  }

  /**
   * Run SQL through psql in the database container. Returns stdout
   * (unaligned, tab-separated, no headers). Throws on the first error.
   */
  sql(text: string, opts: { role?: SqlRole; quiet?: boolean } = {}): string {
    const role = opts.role ?? 'postgres';
    return docker(
      ['exec', '-i', '-e', 'PGOPTIONS=-c client_min_messages=warning', this.pgName,
        'psql', '-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', DB_NAME],
      text,
    );
  }

  /** Run a query that returns one JSON value (e.g. `SELECT json_agg(...)`). */
  sqlJson<T = unknown>(query: string, role: SqlRole = 'postgres'): T {
    const out = this.sql(query, { role }).trim();
    return (out === '' ? null : JSON.parse(out)) as T;
  }

  /** Like sql(), but reports failure instead of throwing. */
  trySql(text: string, role: SqlRole = 'postgres'): { ok: boolean; out: string } {
    const r = spawnSync('docker',
      ['exec', '-i', '-e', 'PGOPTIONS=-c client_min_messages=warning', this.pgName,
        'psql', '-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', DB_NAME],
      { input: text, encoding: 'utf8' });
    return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
  }

  /** Every migration file, in order. */
  migrationFiles(): string[] {
    return readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  }

  /** Apply migrations as `postgres`, unmodified. `until` stops before that file. */
  applyMigrations(opts: { until?: string } = {}): number {
    let n = 0;
    for (const f of this.migrationFiles()) {
      if (opts.until && f >= opts.until) break;
      const r = spawnSync('docker',
        ['exec', '-i', '-e', 'PGOPTIONS=-c client_min_messages=warning', this.pgName,
          'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', DB_NAME, '-f', '-'],
        { input: readFileSync(join(MIGRATIONS_DIR, f), 'utf8'), encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`migration ${f} failed: ${(r.stderr || r.stdout).trim().slice(-1500)}`);
      n++;
    }
    return n;
  }

  /**
   * Run supabase/strict/apply.sh inside the database container, so the test
   * exercises the script operators run. Returns its exit code and output.
   */
  runApplyScript(args: string[] = []): { code: number; out: string } {
    docker(['exec', this.pgName, 'rm', '-rf', '/strict']);
    docker(['cp', STRICT_DIR, `${this.pgName}:/strict`]);
    const r = spawnSync('docker',
      ['exec', this.pgName, 'bash', '/strict/apply.sh', ...args, `postgresql://postgres@localhost/${DB_NAME}`],
      { encoding: 'utf8' });
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  }

  /** Apply the strict pack and throw unless it succeeds. */
  applyStrictPack(): string {
    const r = this.runApplyScript();
    if (r.code !== 0) throw new Error(`strict pack failed (exit ${r.code}):\n${r.out}`);
    return r.out;
  }

  /** Start (or restart) PostgREST. A restart also empties its connection pool. */
  async startRest(mode: RestMode = 'supabase'): Promise<void> {
    if (this.restMode === mode) {
      docker(['restart', '-t', '2', this.restName]);
    } else {
      if (this.restMode) docker(['rm', '-f', this.restName]);
      const lane = mode === 'lane';
      const login = lane ? 'tenant_authenticator' : 'authenticator';
      docker([
        'run', '-d', '--name', this.restName, '--network', this.network,
        '-p', '127.0.0.1::3000', '-p', '127.0.0.1::3001',
        '-e', `PGRST_DB_URI=postgres://${login}:${this.authenticatorCredential}@${this.pgName}:5432/${DB_NAME}`,
        '-e', `PGRST_DB_SCHEMAS=${lane ? 'public' : this.schemas}`,
        ...(lane ? [] : ['-e', 'PGRST_DB_ANON_ROLE=anon']),
        '-e', 'PGRST_DB_EXTRA_SEARCH_PATH=public,extensions',
        '-e', 'PGRST_DB_MAX_ROWS=1000',
        '-e', `PGRST_DB_POOL=${this.pool}`,
        '-e', `PGRST_JWT_SECRET=${this.jwtSecret}`,
        '-e', 'PGRST_SERVER_PORT=3000',
        '-e', 'PGRST_ADMIN_SERVER_PORT=3001',
        PGRST_IMAGE,
      ]);
      this.restMode = mode;
    }
    const port = (p: number) => docker(['port', this.restName, `${p}/tcp`]).trim().split('\n')[0].split(':').pop();
    this.restUrl = `http://127.0.0.1:${port(3000)}`;
    const admin = `http://127.0.0.1:${port(3001)}`;
    for (let i = 0; i < 120; i++) {
      try {
        const r = await fetch(`${admin}/ready`);
        if (r.status === 200) return;
      } catch { /* not up yet */ }
      await sleep(250);
    }
    throw new Error(`PostgREST did not become ready:\n${docker(['logs', '--tail', '20', this.restName])}`);
  }

  /** Sign a JWT with this stack's secret. `exp` defaults to two hours out. */
  mint(claims: JwtClaims): string {
    return signJwt({ exp: Math.floor(Date.now() / 1000) + 7200, ...claims }, this.jwtSecret);
  }

  versions(): string {
    const pg = this.sql('select version()', { role: 'supabase_admin' }).trim().split(' on ')[0];
    const vec = this.sql("select extversion from pg_extension where extname = 'vector'", { role: 'supabase_admin' }).trim();
    return `${pg}, pgvector ${vec}, ${PGRST_IMAGE}, pool ${this.pool}`;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    if (process.env.KEEP === '1') {
      console.log(`KEEP=1: containers ${this.pgName} and ${this.restName} left running on network ${this.network}`);
      return;
    }
    spawnSync('docker', ['rm', '-f', '-v', this.restName, this.pgName], { encoding: 'utf8' });
    spawnSync('docker', ['network', 'rm', this.network], { encoding: 'utf8' });
    this.started = false;
  }
}

/**
 * Start a stack and register cleanup on exit and on Ctrl-C.
 */
export async function startStack(opts: StackOptions = {}): Promise<Stack> {
  const stack = new Stack(opts);
  const onSignal = () => { void stack.stop().finally(() => process.exit(130)); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    await stack.start();
  } catch (e) {
    await stack.stop();
    throw e;
  }
  return stack;
}

/**
 * Roles, schemas, extensions and default privileges as a Supabase project has
 * them, before any vcon-mcp migration runs. Runs as the bootstrap superuser.
 */
const BOOTSTRAP_SQL = String.raw`
CREATE ROLE postgres LOGIN CREATEROLE CREATEDB BYPASSRLS;
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '%AUTHENTICATOR_PASSWORD%';
GRANT anon, authenticated, service_role TO authenticator;
-- The tenant lane's PostgREST login: authenticated only, so a service_role claim fails.
CREATE ROLE tenant_authenticator LOGIN NOINHERIT PASSWORD '%AUTHENTICATOR_PASSWORD%';
GRANT authenticated TO tenant_authenticator;
GRANT anon, authenticated, service_role TO postgres;
ALTER DATABASE vcon_tenant OWNER TO postgres;
ALTER SCHEMA public OWNER TO postgres;
CREATE SCHEMA extensions AUTHORIZATION postgres;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION vector WITH SCHEMA extensions;
ALTER ROLE postgres IN DATABASE vcon_tenant SET search_path = "$user", public, extensions;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, postgres;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
`;
