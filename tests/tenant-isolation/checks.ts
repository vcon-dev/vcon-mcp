/**
 * Check counting, REST calls and catalog snapshots shared by the shapes.
 */
import type { Stack } from './stack.ts';

export class Report {
  pass = 0;
  fail = 0;
  notes = 0;
  failures: string[] = [];

  section(title: string): void {
    console.log(`\n=== ${title} ===`);
  }

  /** One assertion. `detail` is shown on both outcomes. */
  check(id: string, desc: string, ok: boolean, detail = ''): boolean {
    const line = `${id} ${desc}${detail ? ` | ${detail}` : ''}`;
    if (ok) {
      this.pass++;
      console.log(`PASS ${line}`);
    } else {
      this.fail++;
      this.failures.push(line);
      console.log(`FAIL ${line}`);
    }
    return ok;
  }

  eq(id: string, desc: string, expected: unknown, actual: unknown): boolean {
    const e = JSON.stringify(expected);
    const a = JSON.stringify(actual);
    return this.check(id, desc, e === a, e === a ? `got ${a}` : `expected ${e} got ${a}`);
  }

  /** Recorded, not counted: behaviour another change owns. */
  note(id: string, desc: string, detail: string): void {
    this.notes++;
    console.log(`NOTE ${id} ${desc} | ${detail}`);
  }

  summary(title: string): number {
    console.log(`\n=== ${title} ===`);
    console.log(`passed: ${this.pass}  failed: ${this.fail}  notes: ${this.notes}`);
    for (const f of this.failures) console.log(`  FAILED ${f}`);
    return this.fail === 0 ? 0 : 1;
  }
}

export interface Res {
  status: number;
  body: string;
  json: any;
  headers: Headers;
}

export interface ApiOpts {
  token?: string;
  body?: unknown;
  /** Accept-Profile / Content-Profile, for a schema other than public. */
  profile?: string;
  prefer?: string;
  accept?: string;
}

/** One PostgREST request. Never throws on an HTTP status. */
export async function api(stack: Stack, method: string, path: string, opts: ApiOpts = {}): Promise<Res> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.profile) {
    headers['Accept-Profile'] = opts.profile;
    headers['Content-Profile'] = opts.profile;
  }
  if (opts.prefer) headers.Prefer = opts.prefer;
  if (opts.accept) headers.Accept = opts.accept;
  const r = await fetch(`${stack.restUrl}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const body = await r.text();
  let json: any = null;
  try { json = body ? JSON.parse(body) : null; } catch { /* not JSON */ }
  return { status: r.status, body, json, headers: r.headers };
}

/** Short form of a response for a log line. */
export function brief(r: Res): string {
  const msg = r.json && typeof r.json === 'object' && !Array.isArray(r.json) && r.json.code
    ? ` ${r.json.code} ${String(r.json.message ?? '').slice(0, 90)}` : '';
  const rows = Array.isArray(r.json) ? ` rows=${r.json.length}` : '';
  return `HTTP ${r.status}${rows}${msg}`;
}

/**
 * Catalog state of the schemas the pack touches, one line per object. It
 * includes each row's xmin, so it changes when any catalog row is rewritten,
 * even with identical values: an equal snapshot means nothing was changed.
 */
export const SNAPSHOT_SQL = String.raw`
WITH s AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public', 'vkong'))
SELECT coalesce(json_agg(line ORDER BY line), '[]') FROM (
  SELECT format('rel %s.%s kind=%s oid=%s xmin=%s node=%s rls=%s force=%s acl=%s opts=%s',
           s.nspname, c.relname, c.relkind, c.oid, c.xmin, c.relfilenode, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.reloptions) AS line
    FROM pg_class c JOIN s ON s.oid = c.relnamespace
  UNION ALL
  SELECT format('col %s.%s xmin=%s notnull=%s type=%s', a.attrelid::regclass, a.attname, a.xmin, a.attnotnull, format_type(a.atttypid, a.atttypmod))
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN s ON s.oid = c.relnamespace
   WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm')
  UNION ALL
  SELECT format('con %s %s oid=%s xmin=%s valid=%s %s', con.conrelid::regclass, con.conname, con.oid, con.xmin, con.convalidated, pg_get_constraintdef(con.oid))
    FROM pg_constraint con JOIN s ON s.oid = con.connamespace
  UNION ALL
  SELECT format('pol %s %s oid=%s xmin=%s cmd=%s perm=%s roles=%s using=%s check=%s', p.polrelid::regclass, p.polname, p.oid, p.xmin,
           p.polcmd, p.polpermissive, p.polroles, pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid))
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN s ON s.oid = c.relnamespace
  UNION ALL
  SELECT format('fn %s oid=%s xmin=%s secdef=%s acl=%s cfg=%s src=%s', p.oid::regprocedure, p.oid, p.xmin, p.prosecdef, p.proacl, p.proconfig, md5(p.prosrc))
    FROM pg_proc p JOIN s ON s.oid = p.pronamespace
  UNION ALL
  SELECT format('view %s def=%s', c.oid::regclass, md5(pg_get_viewdef(c.oid)))
    FROM pg_class c JOIN s ON s.oid = c.relnamespace WHERE c.relkind IN ('v', 'm')
  UNION ALL
  SELECT format('trg %s %s oid=%s xmin=%s enabled=%s', t.tgrelid::regclass, t.tgname, t.oid, t.xmin, t.tgenabled)
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN s ON s.oid = c.relnamespace
  UNION ALL
  SELECT format('defacl %s %s %s xmin=%s %s', d.defaclrole::regrole, d.defaclnamespace, d.defaclobjtype, d.xmin, d.defaclacl)
    FROM pg_default_acl d
  UNION ALL
  SELECT format('comment %s %s %s', d.classoid::regclass, d.objoid, md5(d.description))
    FROM pg_description d
   WHERE d.classoid IN ('pg_proc'::regclass, 'pg_class'::regclass, 'pg_policy'::regclass, 'pg_constraint'::regclass)
     AND (d.objoid IN (SELECT p.oid FROM pg_proc p JOIN s ON s.oid = p.pronamespace)
          OR d.objoid IN (SELECT c.oid FROM pg_class c JOIN s ON s.oid = c.relnamespace))
) x`;

export function snapshot(stack: Stack): string[] {
  return stack.sqlJson<string[]>(SNAPSHOT_SQL, 'supabase_admin') ?? [];
}

/** Lines only in a, lines only in b. */
export function diff(a: string[], b: string[]): { removed: string[]; added: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return { removed: a.filter(x => !sb.has(x)), added: b.filter(x => !sa.has(x)) };
}
