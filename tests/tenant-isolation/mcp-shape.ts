/**
 * MCP shape: tenant isolation through the tenant lane, as an MCP client sees it.
 *
 *   npx tsx tests/tenant-isolation/mcp-shape.ts              strict pack applied
 *   npx tsx tests/tenant-isolation/mcp-shape.ts --baseline   unmodified schema
 *
 * Needs Docker and `npm ci`: the lane and the MCP client come from this repo and node_modules.
 *
 * Starts the stack from stack.ts with the fixtures from fixtures.ts, serves PostgREST the way the
 * lane's own PostgREST runs (startRest('lane'): a login role in `authenticated` only, no anon
 * role, `public` only), puts a proxy in front that strips the /rest/v1 prefix supabase-js adds,
 * and runs the real server, src/index.ts, as a child process with TENANT_MODE=lane, no service
 * key and no anon key. Real MCP clients then call it over Streamable HTTP with tokens signed by
 * the stack's secret, and the lane reads through real supabase-js and real pgvector.
 *
 * Every check has an expectation for each mode. In strict mode a response to tenant A that holds
 * another fixture's marker fails, and a positive read must hold A's own marker, so an empty
 * response cannot pass. In baseline mode the same calls run against the schema the migrations
 * leave, and the checks marked `leak` assert that a known leak shows through the lane: proof the
 * test can fail. Baseline mode fails if it reproduces no leak at all.
 *
 * Exit 0 when every check passes.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { allDatabaseAnalyticsTools } from '../../src/tools/database-analytics.js';
import { allDatabaseSizeTools } from '../../src/tools/database-size-tools.js';
import { allDatabaseTools } from '../../src/tools/database-tools.js';
import { getExamplesTool, getSchemaTool } from '../../src/tools/schema-tools.js';
import { allTagTools } from '../../src/tools/tag-tools.js';
import { createFromTemplateTool } from '../../src/tools/templates.js';
import { allContractTools } from '../../src/tools/vcon-contract.js';
import { allTools } from '../../src/tools/vcon-crud.js';
import { Report } from './checks.ts';
import { EMBEDDING, FIXTURES, markersIn, prepareStack, QUARANTINE, rowId, TENANT_A, TENANT_B, VCON_CHILDREN } from './fixtures.ts';
import { ROOT, signJwt, type Stack } from './stack.ts';

const BASELINE = process.argv.includes('--baseline');
const MODE = BASELINE ? 'baseline' : 'strict';
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const rep = new Report();
let leaksSeen = 0;

/** The five tools the design gives the lane. Kept here, not imported, so the check does not trust the code it checks. */
const LANE_TOOLS = ['delete_vcon', 'get_vcon', 'search_vcons', 'search_vcons_content', 'search_vcons_semantic'];

const A = FIXTURES.A;
const A2 = FIXTURES.A2;
const B = FIXTURES.B;
const BN = FIXTURES.BN;
const N = FIXTURES.N;
const Q = FIXTURES.Q;
const RANGE = { start_date: '2026-10-01T00:00:00.000Z', end_date: '2026-12-01T00:00:00.000Z' };
const VECTOR: number[] = JSON.parse(EMBEDDING);

// ---------------------------------------------------------------- store proxy

interface StoreHit { method: string; path: string; auth: string | null; apikey: string | null }

/**
 * Forwards /rest/v1/* to PostgREST at its root, as the proxy in front of the lane's PostgREST
 * does. Records each request's method, path and credentials (in memory only, never printed), and
 * answers 404 to anything else, so a call the lane should never make (an edge function, say) shows.
 */
async function startProxy(target: () => string) {
  const hits: StoreHit[] = [];
  const stray: string[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const url = req.url ?? '/';
    if (url !== '/rest/v1' && !url.startsWith('/rest/v1/')) {
      stray.push(`${req.method} ${url.split('?')[0]}`);
      res.writeHead(404).end();
      return;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || ['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding'].includes(k)) continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    const method = req.method ?? 'GET';
    hits.push({ method, path: url.slice('/rest/v1'.length).split('?')[0], auth: headers.authorization ?? null, apikey: headers.apikey ?? null });
    try {
      const body = chunks.length && !['GET', 'HEAD'].includes(method) ? Buffer.concat(chunks) : undefined;
      const r = await fetch(`${target()}${url.slice('/rest/v1'.length) || '/'}`, { method, headers, body });
      const out: Record<string, string> = {};
      r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out[k] = v; });
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, out);
      res.end(method === 'HEAD' ? undefined : buf);
    } catch {
      res.writeHead(502).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as net.AddressInfo;
  return { url: `http://127.0.0.1:${port}`, hits, stray, close: () => new Promise<void>((r) => server.close(() => r())) };
}

// ---------------------------------------------------------------- the lane process

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

function laneEnv(storeUrl: string, port: number, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ENV_FILE: join(ROOT, 'tests', 'tenant-isolation', 'no-such-env-file'),
    TENANT_MODE: 'lane',
    MCP_TRANSPORT: 'http',
    MCP_HTTP_STATELESS: 'true',
    MCP_HTTP_HOST: '127.0.0.1',
    MCP_HTTP_PORT: String(port),
    SUPABASE_URL: storeUrl,
    ...extra,
  };
}

interface Lane { url: string; child: ChildProcess; output: () => string; stop: () => Promise<void> }

/** Runs src/index.ts as a lane. Resolves once it listens, or rejects with its output if it exits. */
async function startLane(storeUrl: string): Promise<Lane> {
  const port = await freePort();
  const child = spawn(process.execPath, [TSX, 'src/index.ts'], { cwd: ROOT, env: laneEnv(storeUrl, port), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout!.on('data', (d) => { out += d; });
  child.stderr!.on('data', (d) => { out += d; });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`lane did not start:\n${out}`)), 60_000);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`lane exited ${code}:\n${out}`)); });
    const poll = setInterval(() => {
      if (out.includes('Tenant lane started')) { clearInterval(poll); clearTimeout(timer); resolve(); }
    }, 100);
  });
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    child,
    output: () => out,
    stop: () => new Promise<void>((r) => { if (child.exitCode !== null) return r(); child.once('exit', () => r()); child.kill('SIGTERM'); }),
  };
}

/** Runs src/index.ts as a lane with `extra` env and expects it to refuse to start. */
function refusedStart(storeUrl: string, extra: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  return new Promise(async (resolve) => {
    const child = spawn(process.execPath, [TSX, 'src/index.ts'], { cwd: ROOT, env: laneEnv(storeUrl, await freePort(), extra), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, output: out }); });
  });
}

// ---------------------------------------------------------------- MCP calls

interface Out {
  ok: boolean;
  /** The tool result text, or the error message. */
  text: string;
  json: any;
  /** JSON-RPC error code, when the call failed with one. */
  code?: number;
}

const clients = new Map<string, Promise<Client | Error>>();

/** One connected MCP client per token, or the error connecting gave (a 401 from the lane, say). */
function clientFor(lane: Lane, token: string): Promise<Client | Error> {
  let c = clients.get(token);
  if (!c) {
    c = (async () => {
      const client = new Client({ name: 'mcp-shape', version: '0' });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(lane.url), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }));
        return client;
      } catch (e) {
        return e instanceof Error ? e : new Error(String(e));
      }
    })();
    clients.set(token, c);
  }
  return c;
}

async function call(lane: Lane, token: string, name: string, args: Record<string, unknown>): Promise<Out> {
  const client = await clientFor(lane, token);
  if (client instanceof Error) return { ok: false, text: client.message, json: null };
  try {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { type: string; text?: string }[]).map((p) => p.text ?? '').join('');
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: !r.isError, text, json };
  } catch (e: any) {
    return { ok: false, text: String(e?.message ?? e), json: null, code: typeof e?.code === 'number' ? e.code : undefined };
  }
}

// ---------------------------------------------------------------- expectations

/**
 * isolated      the call worked, A's own marker is there, no other marker
 * empty         the call worked and found nothing: no marker of anyone, no results, count 0
 * notfound      the call failed with "not found", no marker
 * unauthorized  the lane (HTTP 401) or the store (an "unauthorized" tool error) refused the token
 * unavailable   the call failed saying the semantic path needs an embedding provider
 * refused       the call failed with JSON-RPC -32601
 * deleted       delete_vcon reported success, no marker other than the uuid sent
 * leak          another fixture's marker is in the answer (baseline: the known leak)
 */
type Exp = 'isolated' | 'empty' | 'notfound' | 'unauthorized' | 'unavailable' | 'refused' | 'deleted' | 'leak';

/** Markers in an answer, ignoring the values the caller sent (a not-found message echoes the uuid). */
function scan(o: Out, args: Record<string, unknown>): { own: boolean; foreign: string[] } {
  let text = o.text;
  for (const v of Object.values(args)) if (typeof v === 'string' && v.length > 8) text = text.split(v).join('<sent>');
  const m = markersIn(text);
  return { own: m.has('A*'), foreign: [...m].filter((k) => k !== 'A*').sort() };
}

function foundNothing(o: Out): boolean {
  const j = o.json;
  if (!j || typeof j !== 'object') return false;
  const results = Array.isArray(j.results) ? j.results : [];
  return results.length === 0 && (j.total_count === undefined || j.total_count === 0);
}

function meets(o: Out, exp: Exp, s: { own: boolean; foreign: string[] }): boolean {
  const clean = s.foreign.length === 0;
  switch (exp) {
    case 'isolated': return o.ok && s.own && clean;
    case 'empty': return o.ok && !s.own && clean && foundNothing(o);
    case 'notfound': return !o.ok && /not found/i.test(o.text) && !s.own && clean;
    case 'unauthorized': return !o.ok && /\b401\b|unauthori[sz]ed/i.test(o.text) && !s.own && clean;
    case 'unavailable': return !o.ok && /EMBEDDING_PROVIDER/.test(o.text) && clean;
    case 'refused': return !o.ok && o.code === -32601 && clean;
    case 'deleted': return o.ok && o.json?.success === true && clean;
    case 'leak': return !clean;
  }
}

function brief(o: Out): string {
  const j = o.json;
  const shape = j && typeof j === 'object'
    ? ` results=${Array.isArray(j.results) ? j.results.length : '-'}${j.total_count !== undefined ? ` total=${j.total_count}` : ''}`
    : '';
  return `${o.ok ? 'ok' : `error${o.code !== undefined ? ` ${o.code}` : ''}: ${o.text.replace(/\s+/g, ' ').slice(0, 90)}`}${shape}`;
}

/** Call a tool as `token` and assert against [strict, baseline]. */
async function expectCall(lane: Lane, id: string, desc: string, token: string, name: string, args: Record<string, unknown>, exp: [Exp, Exp],
  extra?: (o: Out) => [boolean, string]): Promise<Out> {
  const o = await call(lane, token, name, args);
  const e = BASELINE ? exp[1] : exp[0];
  const s = scan(o, args);
  let ok = meets(o, e, s);
  let more = '';
  if (ok && extra && e !== 'leak') [ok, more] = extra(o);
  const passed = rep.check(`${MODE}-${id}`, desc, ok, `want ${e}; ${brief(o)} own=${s.own ? 'yes' : 'no'} foreign=[${s.foreign.join(',')}]${more ? `; ${more}` : ''}`);
  if (passed && e === 'leak') leaksSeen++;
  return o;
}

/** A count in the answer must be exactly `n` (A's own vCons). Baseline counts more: that is a leak too. */
const totalIs = (n: number) => (o: Out): [boolean, string] => [o.json?.total_count === n, `total_count want ${n} got ${o.json?.total_count}`];

function expectValue(id: string, desc: string, actual: unknown, exp: [unknown, unknown], leakInBaseline = false): void {
  const e = BASELINE ? exp[1] : exp[0];
  const ok = rep.check(`${MODE}-${id}`, desc, JSON.stringify(actual) === JSON.stringify(e), `want ${JSON.stringify(e)} got ${JSON.stringify(actual)}`);
  if (ok && BASELINE && leakInBaseline) leaksSeen++;
}

// ---------------------------------------------------------------- the run

async function main(): Promise<number> {
  const prep = await prepareStack({ label: BASELINE ? 'mcpbase' : 'mcp', strict: !BASELINE });
  const stack: Stack = prep.stack;
  let proxy: Awaited<ReturnType<typeof startProxy>> | null = null;
  let lane: Lane | null = null;
  try {
    rep.section(`setup (${MODE})`);
    rep.check(`${MODE}-setup-chain`, `every migration applied unmodified (${prep.migrations} files)`, prep.migrations === stack.migrationFiles().length, stack.versions());
    if (!BASELINE) rep.check(`${MODE}-setup-pack`, 'the strict pack applied and the catalog guard passed', /catalog-guard: ok/.test(prep.applied ?? ''));
    await stack.startRest('lane');
    proxy = await startProxy(() => stack.restUrl);
    lane = await startLane(proxy.url);
    rep.check(`${MODE}-setup-lane`, 'the server started as a lane with no store key, behind a /rest/v1-stripping proxy', true, lane.url);

    const now = Math.floor(Date.now() / 1000);
    const T = {
      A: stack.mint({ role: 'authenticated', tenant_id: TENANT_A, sub: 'user-a' }),
      B: stack.mint({ role: 'authenticated', tenant_id: TENANT_B, sub: 'user-b' }),
      quarantine: stack.mint({ role: 'authenticated', tenant_id: QUARANTINE, sub: 'user-q' }),
      noClaim: stack.mint({ role: 'authenticated', sub: 'user-x' }),
      wrongSig: signJwt({ role: 'authenticated', tenant_id: TENANT_A, sub: 'user-a', exp: now + 600 }, 'f'.repeat(64)),
      serviceRole: stack.mint({ role: 'service_role', sub: 'svc' }),
      serviceRoleA: stack.mint({ role: 'service_role', tenant_id: TENANT_A, sub: 'svc' }),
      expired: signJwt({ role: 'authenticated', tenant_id: TENANT_A, sub: 'user-a', exp: now - 60 }, stack.jwtSecret),
    };

    // ------------------------------------------------------------ tools, resources, prompts
    rep.section('what the lane serves');
    const a = await clientFor(lane, T.A);
    if (a instanceof Error) throw a;
    const listed = (await a.listTools()).tools.map((t) => t.name).sort();
    expectValue('tools-list', 'tools/list lists exactly the five lane tools', listed, [LANE_TOOLS, LANE_TOOLS]);
    const every = [...new Set([...allTools, ...allContractTools, createFromTemplateTool, getSchemaTool, getExamplesTool,
      ...allDatabaseTools, ...allDatabaseAnalyticsTools, ...allDatabaseSizeTools, ...allTagTools].map((t: { name: string }) => t.name))];
    const others = every.filter((n) => !LANE_TOOLS.includes(n));
    const hitsBefore = proxy.hits.length;
    let refusedAll = true;
    const notRefused: string[] = [];
    for (const name of [...others, 'not_a_tool']) {
      const o = await call(lane, T.A, name, { uuid: A.uuid, vcon_uuid: A.uuid, query: 'zebra', tags: { team: 'sales' } });
      if (!(o.code === -32601 && !o.ok)) { refusedAll = false; notRefused.push(name); }
    }
    rep.check(`${MODE}-tools-refused`, `every other tool (${others.length}) and an unknown name answer -32601`, refusedAll, notRefused.join(','));
    expectValue('tools-refused-store', 'and none of them reached the store', proxy.hits.length - hitsBefore, [0, 0]);
    for (const [label, fn] of [
      ['resources/list', () => a.listResources()],
      ['resources/read', () => a.readResource({ uri: `vcon://v1/vcons/${A.uuid}` })],
      ['prompts/list', () => a.listPrompts()],
    ] as const) {
      const code = await (fn as () => Promise<unknown>)().then(() => 'answered', (e: any) => e?.code);
      expectValue(`refused-${label.replace('/', '-')}`, `${label} is refused`, code, [-32601, -32601]);
    }

    // ------------------------------------------------------------ tenant A through the five tools
    rep.section('tenant A through the five tools');
    await expectCall(lane, 'get-own', 'get_vcon(A)', T.A, 'get_vcon', { uuid: A.uuid }, ['isolated', 'isolated']);
    await expectCall(lane, 'get-b', "get_vcon(B's uuid) is not found", T.A, 'get_vcon', { uuid: B.uuid }, ['notfound', 'notfound']);
    await expectCall(lane, 'get-bn', "get_vcon(B's vCon whose children had no tenant)", T.A, 'get_vcon', { uuid: BN.uuid }, ['notfound', 'notfound']);
    await expectCall(lane, 'get-none', 'get_vcon(the vCon with no tenant)', T.A, 'get_vcon', { uuid: N.uuid }, ['notfound', 'leak']);
    await expectCall(lane, 'get-quarantine', 'get_vcon(the quarantined vCon)', T.A, 'get_vcon', { uuid: Q.uuid }, ['notfound', 'notfound']);
    const bOwn = await call(lane, T.B, 'get_vcon', { uuid: B.uuid });
    rep.check(`${MODE}-get-b-as-b`, "B's own token reads B's vCon (so A's not-found is the tenant filter, not a broken read)",
      bOwn.ok && bOwn.text.includes(B.canary) && !markersIn(bOwn.text).has('A*'), brief(bOwn));

    await expectCall(lane, 'search-ids-count', 'search_vcons ids_only with a count and dates', T.A, 'search_vcons',
      { ...RANGE, limit: 10, response_format: 'ids_only', include_count: true }, ['isolated', 'leak'], totalIs(2));
    await expectCall(lane, 'search-ids-count-nodates', 'search_vcons ids_only with a count, no dates', T.A, 'search_vcons',
      { limit: 10, response_format: 'ids_only', include_count: true }, ['isolated', 'leak'], totalIs(2));
    await expectCall(lane, 'search-metadata', 'search_vcons metadata with dates', T.A, 'search_vcons',
      { ...RANGE, limit: 50, response_format: 'metadata' }, ['isolated', 'leak']);
    await expectCall(lane, 'search-tags', 'search_vcons ids_only with a tags filter and a count', T.A, 'search_vcons',
      { ...RANGE, limit: 10, response_format: 'ids_only', include_count: true, tags: { team: 'sales' } }, ['isolated', 'leak'], totalIs(2));
    await expectCall(lane, 'search-subject', 'search_vcons ids_only with a subject filter and a count', T.A, 'search_vcons',
      { ...RANGE, limit: 10, response_format: 'ids_only', include_count: true, subject: 'zebra' }, ['isolated', 'leak'], totalIs(2));
    await expectCall(lane, 'search-b-tag', "search_vcons with B's own tag value", T.A, 'search_vcons',
      { limit: 10, response_format: 'ids_only', include_count: true, tags: { fixture: B.canary } }, ['empty', 'empty']);

    await expectCall(lane, 'content-own', "search_vcons_content for A's canary", T.A, 'search_vcons_content',
      { query: A.canary, ...RANGE, limit: 10, response_format: 'ids_only' }, ['isolated', 'isolated']);
    await expectCall(lane, 'content-b', "search_vcons_content for B's canary", T.A, 'search_vcons_content',
      { query: B.canary, ...RANGE, limit: 10, response_format: 'ids_only' }, ['empty', 'empty']);
    await expectCall(lane, 'content-bn', "search_vcons_content for the canary in B's tenantless children", T.A, 'search_vcons_content',
      { query: BN.canary, limit: 10, response_format: 'ids_only' }, ['empty', 'empty']);
    await expectCall(lane, 'content-none', 'search_vcons_content for the no-tenant canary', T.A, 'search_vcons_content',
      { query: N.canary, limit: 10, response_format: 'ids_only' }, ['empty', 'leak']);
    await expectCall(lane, 'content-quarantine', 'search_vcons_content for the quarantine canary', T.A, 'search_vcons_content',
      { query: Q.canary, limit: 10, response_format: 'ids_only' }, ['empty', 'empty']);
    await expectCall(lane, 'content-all', 'search_vcons_content "zebra" (in every fixture), snippets', T.A, 'search_vcons_content',
      { query: 'zebra', limit: 50 }, ['isolated', 'leak']);

    await expectCall(lane, 'semantic-ids', 'search_vcons_semantic with a precomputed embedding, ids_only (every fixture has the same vector)', T.A,
      'search_vcons_semantic', { embedding: VECTOR, threshold: 0.5, limit: 50, response_format: 'ids_only' }, ['isolated', 'leak']);
    await expectCall(lane, 'semantic-metadata', 'search_vcons_semantic with a precomputed embedding, metadata (content text)', T.A,
      'search_vcons_semantic', { embedding: VECTOR, threshold: 0.5, limit: 50, response_format: 'metadata' }, ['isolated', 'leak']);
    await expectCall(lane, 'semantic-tags', 'search_vcons_semantic with a precomputed embedding and a tags filter', T.A,
      'search_vcons_semantic', { embedding: VECTOR, threshold: 0.5, limit: 50, response_format: 'ids_only', tags: { team: 'sales' } }, ['isolated', 'leak']);
    const before = proxy.hits.length;
    await expectCall(lane, 'semantic-text', 'search_vcons_semantic with query text and no embedding provider is unavailable', T.A,
      'search_vcons_semantic', { query: B.canary, limit: 10, response_format: 'ids_only' }, ['unavailable', 'unavailable']);
    expectValue('semantic-text-store', 'and it made no store call', proxy.hits.length - before, [0, 0]);

    // ------------------------------------------------------------ tokens that must read nothing
    rep.section('tokens that must read nothing');
    const reads: Array<[string, string, Record<string, unknown>]> = [
      ['get', 'get_vcon', { uuid: A.uuid }],
      ['search', 'search_vcons', { limit: 10, response_format: 'ids_only', include_count: true }],
      ['content', 'search_vcons_content', { query: 'zebra', limit: 50, response_format: 'ids_only' }],
      ['semantic', 'search_vcons_semantic', { embedding: VECTOR, threshold: 0.5, limit: 50, response_format: 'ids_only' }],
      ['delete', 'delete_vcon', { uuid: A.uuid }],
    ];
    // [label, token, expectation for get/delete, expectation for the searches], each as [strict, baseline]
    const cases: Array<[string, string, [Exp, Exp], [Exp, Exp]]> = [
      ['quarantine claim', T.quarantine, ['notfound', 'notfound'], ['empty', 'leak']],
      ['no tenant claim', T.noClaim, ['unauthorized', 'unauthorized'], ['unauthorized', 'unauthorized']],
      ['wrong signature', T.wrongSig, ['unauthorized', 'unauthorized'], ['unauthorized', 'unauthorized']],
      ['service_role claim', T.serviceRole, ['unauthorized', 'unauthorized'], ['unauthorized', 'unauthorized']],
      ['service_role claim with tenant A', T.serviceRoleA, ['unauthorized', 'unauthorized'], ['unauthorized', 'unauthorized']],
      ['expired', T.expired, ['unauthorized', 'unauthorized'], ['unauthorized', 'unauthorized']],
    ];
    for (const [label, token, single, search] of cases) {
      for (const [key, name, args] of reads) {
        const exp = key === 'get' || key === 'delete' ? single : search;
        await expectCall(lane, `token-${label.replace(/\W+/g, '-')}-${key}`, `${label}: ${name}`, token, name, args, exp);
      }
    }
    expectValue('token-a-survives', "A's vCon survives every delete_vcon made with those tokens", stack.sql(`SELECT count(*) FROM vcons WHERE uuid = '${A.uuid}'`).trim(), ['1', '1']);

    // ------------------------------------------------------------ delete_vcon
    rep.section('delete_vcon');
    await expectCall(lane, 'delete-b', "delete_vcon(B's uuid) is not found", T.A, 'delete_vcon', { uuid: B.uuid }, ['notfound', 'notfound']);
    expectValue('delete-b-survives', "B's vCon and its children survive", stack.sql(`SELECT (SELECT count(*) FROM vcons WHERE uuid = '${B.uuid}') || ',' || (SELECT count(*) FROM parties WHERE vcon_id = '${B.uuid}')`).trim(), ['1,1', '1,1']);
    const none = await call(lane, T.A, 'delete_vcon', { uuid: N.uuid });
    const noneLeft = stack.sql(`SELECT count(*) FROM vcons WHERE uuid = '${N.uuid}'`).trim();
    expectValue('delete-none', `delete_vcon(the vCon with no tenant) (${brief(none)})`, noneLeft === '1' && !none.ok ? 'not found, kept' : `deleted=${noneLeft === '0'}`,
      ['not found, kept', 'deleted=true'], true);
    await expectCall(lane, 'delete-own', "delete_vcon(A's second vCon)", T.A, 'delete_vcon', { uuid: A2.uuid }, ['deleted', 'deleted']);
    const left = stack.sql(`SELECT ${[
      `(SELECT count(*) FROM vcons WHERE uuid = '${A2.uuid}')`,
      ...VCON_CHILDREN.map((t) => `(SELECT count(*) FROM ${t} WHERE vcon_id = '${A2.uuid}')`),
      `(SELECT count(*) FROM party_history WHERE dialog_id = '${rowId(A2, 'dialog')}')`,
    ].join(' + ')}`).trim();
    expectValue('delete-own-cascade', 'the vCon and every child row of it are gone, in all ten tables', left, ['0', '0']);
    expectValue('delete-own-others', "A's other vCon and B's vCons are untouched",
      stack.sql(`SELECT count(*) FROM vcons WHERE uuid IN ('${A.uuid}', '${B.uuid}', '${BN.uuid}')`).trim(), ['3', '3']);

    // ------------------------------------------------------------ what reached the store
    rep.section('what reached the store');
    const sent = new Set(Object.values(T));
    const badCred = proxy.hits.filter((h) => !h.auth || !h.auth.startsWith('Bearer ') || !sent.has(h.auth.slice(7)) || h.apikey !== h.auth.slice(7));
    rep.check(`${MODE}-store-credential`, `every store request (${proxy.hits.length}) carried a caller's token, as both Authorization and apikey`,
      proxy.hits.length > 0 && badCred.length === 0, `${badCred.length} without`);
    const reachedStore = new Set(proxy.hits.map((h) => h.auth?.slice(7)));
    rep.check(`${MODE}-store-refused-tokens`, 'the tokens the lane itself refuses never reached the store',
      ![T.noClaim, T.serviceRole, T.serviceRoleA].some((t) => reachedStore.has(t)), '');
    rep.check(`${MODE}-store-paths`, 'the lane called nothing but /rest/v1 (no edge function, no other path)', proxy.stray.length === 0, proxy.stray.join(', '));
    const logs = lane.output();
    rep.check(`${MODE}-logs`, 'the lane logged no token', ![...sent].some((t) => t.split('.').some((part) => part.length > 16 && logs.includes(part))), '');
    rep.check(`${MODE}-logs-tenant`, "the lane logged the token's tenant", logs.includes(TENANT_A), '');

    // ------------------------------------------------------------ start
    rep.section('start');
    for (const [label, env] of [
      ['a service key', { SUPABASE_SERVICE_ROLE_KEY: 'placeholder' }],
      ['an anon key', { SUPABASE_ANON_KEY: 'placeholder' }],
    ] as const) {
      const r = await refusedStart(proxy.url, env);
      rep.check(`${MODE}-start-${label.replace(/\W+/g, '-')}`, `the lane refuses to start with ${label}`,
        r.code === 1 && /cannot start/.test(r.output) && !r.output.includes('Tenant lane started'), `exit ${r.code}`);
    }
  } finally {
    for (const c of clients.values()) { const client = await c; if (!(client instanceof Error)) await client.close().catch(() => {}); }
    await lane?.stop();
    await proxy?.close();
    await stack.stop();
  }
  if (BASELINE) {
    console.log(`\nbaseline: ${leaksSeen} known leaks reproduced through the lane`);
    rep.check('baseline-leaks', 'the unmodified schema leaks through the lane (so this test can fail)', leaksSeen > 0, `${leaksSeen} leaks`);
  }
  return rep.summary(`MCP shape summary (${MODE})`);
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
