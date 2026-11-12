/**
 * REST shape: tenant isolation as PostgREST serves it, request by request.
 *
 *   node tests/tenant-isolation/rest-shape.ts              strict pack applied
 *   node tests/tenant-isolation/rest-shape.ts --baseline   unmodified schema
 *
 * (Node 22.18 or later runs the TypeScript directly; `npx tsx` works on older
 * Node.) Needs Docker. See stack.ts for the stack and fixtures.ts for the
 * tenants and canaries.
 *
 * Every check has an expected outcome for each mode. In strict mode a
 * response to tenant A that contains another fixture's marker fails, and a
 * positive read must contain A's own marker, so an empty response cannot pass.
 * In baseline mode the same requests run against the schema the migrations
 * leave, and the checks marked `leak` assert that the known leaks still
 * appear: proof that the harness can see one.
 *
 * Covered: the ten tenant tables by read, insert, upsert, update and delete;
 * the search and tag RPCs, including those behind the five lane tools
 * (search_vcons with ids_only, metadata and a tags filter, search_vcons_content,
 * search_vcons_semantic, get_vcon, delete_vcon); both views; the tag
 * materialized view and its scoped view; exec_sql and explain_query; the
 * session-variable spoof at pool 4; composite keys; no, null, empty and
 * quarantine claims, expired, wrong signature, alg none, a role claim
 * PostgREST may not assume, anon; service_role reads, searches and re-posts.
 *
 * Exit 0 when every check passes.
 */
import { api, brief, Report, type Res } from './checks.ts';
import {
  EMBEDDING, FIXTURES, markersIn, prepareStack, QUARANTINE, rowId, TENANT_A, TENANT_B, TENANT_TABLES, VCON_CHILDREN,
  type Fixture,
} from './fixtures.ts';
import { signJwt, type Stack } from './stack.ts';

const BASELINE = process.argv.includes('--baseline');
const MODE = BASELINE ? 'baseline' : 'strict';
const rep = new Report();
let stack: Stack;
let leaksSeen = 0;

/**
 * isolated  2xx, the viewer's own marker present, no foreign marker
 * none      2xx, no foreign marker
 * empty     2xx, no rows (or null, false, 0), no marker at all
 * denied    401 or 403, no foreign marker
 * refused   any error status, no foreign marker
 * leak      a foreign marker is present (baseline: the known leak)
 * ok        2xx
 */
type Exp = 'isolated' | 'none' | 'empty' | 'denied' | 'refused' | 'leak' | 'ok';
type Viewer = 'A' | 'B';

function seen(body: string, viewer: Viewer): { own: boolean; foreign: string[] } {
  const m = markersIn(body);
  if (viewer === 'A') return { own: m.has('A*'), foreign: [...m].filter(k => k !== 'A*').sort() };
  return { own: m.has('B'), foreign: [...m].filter(k => k !== 'B' && k !== 'BN').map(k => (k === 'A*' ? 'A' : k)).sort() };
}

function isEmptyBody(r: Res): boolean {
  const j = r.json;
  return j === null || j === false || j === 0 || (Array.isArray(j) && j.length === 0);
}

function meets(r: Res, exp: Exp, viewer: Viewer): boolean {
  const s = seen(r.body, viewer);
  const ok2 = r.status >= 200 && r.status < 300;
  switch (exp) {
    case 'isolated': return ok2 && s.own && s.foreign.length === 0;
    case 'none': return ok2 && s.foreign.length === 0;
    case 'empty': return ok2 && s.foreign.length === 0 && !s.own && isEmptyBody(r);
    case 'denied': return (r.status === 401 || r.status === 403) && s.foreign.length === 0;
    case 'refused': return r.status >= 400 && s.foreign.length === 0;
    case 'leak': return s.foreign.length > 0;
    case 'ok': return ok2;
  }
}

/** Assert a response against [strict, baseline] expectations. */
function expect(id: string, desc: string, r: Res, exp: [Exp, Exp], viewer: Viewer = 'A'): boolean {
  const e = BASELINE ? exp[1] : exp[0];
  const s = seen(r.body, viewer);
  const detail = `want ${e}; ${brief(r)} own=${s.own ? 'yes' : 'no'} foreign=[${s.foreign.join(',')}]`;
  const ok = rep.check(`${MODE}-${id}`, desc, meets(r, e, viewer), detail);
  if (ok && e === 'leak') leaksSeen++;
  return ok;
}

/** Assert a value against [strict, baseline] expectations, e.g. a count. */
function expectValue(id: string, desc: string, actual: unknown, exp: [unknown, unknown], leakInBaseline = false): void {
  const e = BASELINE ? exp[1] : exp[0];
  const ok = rep.check(`${MODE}-${id}`, desc, JSON.stringify(actual) === JSON.stringify(e), `want ${JSON.stringify(e)} got ${JSON.stringify(actual)}`);
  if (ok && BASELINE && leakInBaseline) leaksSeen++;
}

/** A check that only the strict pack makes meaningful; skipped in the baseline run. */
function strictOnly(id: string, desc: string, r: Res, exp: Exp): void {
  if (!BASELINE) expect(id, desc, r, [exp, exp]);
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
function rowState(table: string, pkCol: string, pk: string | number): string {
  return stack.sql(`SELECT coalesce((SELECT row_to_json(t)::text FROM ${table} t WHERE ${pkCol} = ${q(String(pk))}), 'absent')`, { role: 'postgres' }).trim();
}
function tenantOf(table: string, pkCol: string, pk: string | number): string {
  return stack.sql(`SELECT coalesce((SELECT coalesce(tenant_id, 'NULL') FROM ${table} WHERE ${pkCol} = ${q(String(pk))}), 'absent')`).trim();
}

// ---------------------------------------------------------------- tables
const PK: Record<string, string> = {
  vcons: 'uuid', parties: 'id', dialog: 'id', attachments: 'id', analysis: 'id', groups: 'id',
  party_history: 'id', vcon_embeddings: 'id', embedding_queue: 'id', s3_sync_tracking: 'vcon_id',
};

/** The primary key value of a fixture's row in a table. */
function pkOf(f: Fixture, table: string): string {
  if (table === 'vcons' || table === 's3_sync_tracking') return f.uuid;
  if (table === 'embedding_queue') return stack.sql(`SELECT min(id) FROM embedding_queue WHERE vcon_id = '${f.uuid}'`).trim();
  return rowId(f, table);
}

/** One harmless column per table, changed by the upsert checks. */
const TOUCH: Record<string, Record<string, unknown>> = {
  vcons: { subject: 'zqhijack' }, parties: { name: 'zqhijack' }, dialog: { body: 'zqhijack' }, attachments: { body: 'zqhijack' },
  analysis: { body: 'zqhijack' }, groups: { body: '{"zq":"hijack"}' }, party_history: { event: 'drop' },
  vcon_embeddings: { content_text: 'zqhijack' }, embedding_queue: { created_at: '2026-11-02T00:00:00+00:00' }, s3_sync_tracking: { s3_key: 'zqhijack' },
};

let seq = 0;
/** A fresh uuid with a fixture's prefix, so a leaked row is still recognisable. */
function freshId(prefix: string): string {
  seq++;
  return `${prefix}-00ff-4000-8000-${seq.toString(16).padStart(12, '0')}`;
}

/** A body for inserting into `table` under the given parent. */
function rowBody(table: string, o: { vcon: string; dialog?: string; tenant: string | null; id: string; idx: number }): Record<string, unknown> {
  const t = { tenant_id: o.tenant };
  switch (table) {
    case 'vcons': return { id: o.id, uuid: o.id, vcon_version: '0.4.0', subject: 'zqwrite subject', ...t };
    case 'parties': return { id: o.id, vcon_id: o.vcon, party_index: o.idx, name: 'zqwrite party', ...t };
    case 'dialog': return { id: o.id, vcon_id: o.vcon, dialog_index: o.idx, type: 'text', body: 'zqwrite', encoding: 'none', ...t };
    case 'attachments': return { id: o.id, vcon_id: o.vcon, attachment_index: o.idx, purpose: 'note', body: 'zqwrite', encoding: 'none', ...t };
    case 'analysis': return { id: o.id, vcon_id: o.vcon, analysis_index: o.idx, type: 'summary', vendor: 'test', body: 'zqwrite', encoding: 'none', ...t };
    case 'groups': return { id: o.id, vcon_id: o.vcon, group_index: o.idx, body: '{}', encoding: 'json', ...t };
    case 'party_history': return { id: o.id, dialog_id: o.dialog, party_index: o.idx, time: '2026-11-01T00:00:00Z', event: 'join', ...t };
    case 'vcon_embeddings': return { id: o.id, vcon_id: o.vcon, content_type: 'zqwrite', content_reference: o.id, content_text: 'zqwrite', embedding: EMBEDDING, embedding_model: 'test-model', embedding_dimension: 384, ...t };
    case 'embedding_queue': return { vcon_id: o.vcon, ...t };
    case 's3_sync_tracking': return { vcon_id: o.vcon, vcon_uuid: o.vcon, s3_key: 'zqwrite', ...t };
  }
  throw new Error(table);
}

/**
 * A fresh row no tenant owns: tenant NULL on the unmodified schema, the
 * `_quarantine` tenant under the strict pack (where NULL cannot exist).
 * Written as postgres. Returns its primary key.
 */
function freshOrphan(table: string): string {
  const parent = BASELINE ? FIXTURES.N : FIXTURES.Q;
  const tenant = BASELINE ? 'NULL' : q(QUARANTINE);
  const id = freshId(parent.prefix);
  if (table === 'vcons') {
    stack.sql(`INSERT INTO vcons (id, uuid, vcon_version, subject, tenant_id) VALUES ('${id}', '${id}', '0.4.0', 'orphan ${parent.canary}', ${tenant})`);
    return id;
  }
  if (table === 's3_sync_tracking') {
    stack.sql(`INSERT INTO vcons (id, uuid, vcon_version, subject, tenant_id) VALUES ('${id}', '${id}', '0.4.0', 'orphan ${parent.canary}', ${tenant});
               DELETE FROM embedding_queue WHERE vcon_id = '${id}';
               INSERT INTO s3_sync_tracking (vcon_id, vcon_uuid, s3_key, tenant_id) VALUES ('${id}', '${id}', '${parent.canary}', ${tenant})`);
    return id;
  }
  if (table === 'embedding_queue') {
    return stack.sql(`INSERT INTO embedding_queue (vcon_id, tenant_id) VALUES ('${parent.uuid}', ${tenant}) RETURNING id`).trim().split('\n')[0];
  }
  const body = rowBody(table, { vcon: parent.uuid, dialog: rowId(parent, 'dialog'), tenant: null, id, idx: 100 + seq });
  const cols = Object.keys(body).filter(k => k !== 'tenant_id');
  const vals = cols.map(k => (k === 'embedding' ? q(String(body[k])) : typeof body[k] === 'number' ? String(body[k]) : q(String(body[k]))));
  stack.sql(`INSERT INTO ${table} (${cols.join(', ')}, tenant_id) VALUES (${vals.join(', ')}, ${tenant})`);
  // The child triggers stamp the parent's tenant; put the intended one back.
  stack.sql(`UPDATE ${table} SET tenant_id = ${tenant} WHERE id = '${id}'`);
  return id;
}

// ---------------------------------------------------------------- tokens
function tokens() {
  const now = Math.floor(Date.now() / 1000);
  const mint = (c: Record<string, unknown>) => stack.mint(c);
  const head = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ role: 'authenticated', tenant_id: TENANT_A, exp: now + 600 })).toString('base64url');
  return {
    A: mint({ role: 'authenticated', tenant_id: TENANT_A, sub: 'user-a' }),
    B: mint({ role: 'authenticated', tenant_id: TENANT_B, sub: 'user-b' }),
    noClaim: mint({ role: 'authenticated', sub: 'user-x' }),
    nullClaim: mint({ role: 'authenticated', tenant_id: null }),
    emptyClaim: mint({ role: 'authenticated', tenant_id: '' }),
    quarantine: mint({ role: 'authenticated', tenant_id: QUARANTINE }),
    expired: signJwt({ role: 'authenticated', tenant_id: TENANT_A, exp: now - 60 }, stack.jwtSecret),
    wrongSig: signJwt({ role: 'authenticated', tenant_id: TENANT_A, exp: now + 600 }, 'f'.repeat(64)),
    algNone: `${head}.${body}.`,
    rolePostgres: mint({ role: 'postgres', tenant_id: TENANT_A }),
    anonKey: mint({ role: 'anon' }),
    svc: mint({ role: 'service_role' }),
    svcA: mint({ role: 'service_role', tenant_id: TENANT_A }),
  };
}

const A = FIXTURES.A;
const B = FIXTURES.B;
const BN = FIXTURES.BN;
const N = FIXTURES.N;
const Qf = FIXTURES.Q;
/** The fixture that stands for "no tenant": NULL on the unmodified schema, quarantine after the cut. */
const NONE = () => (BASELINE ? N : Qf);

async function main(): Promise<number> {
  const prep = await prepareStack({ label: BASELINE ? 'baseline' : 'rest', strict: !BASELINE });
  stack = prep.stack;
  try {
    rep.section(`setup (${MODE})`);
    rep.check(`${MODE}-setup-chain`, `every migration applied unmodified (${prep.migrations} files)`, prep.migrations === stack.migrationFiles().length, stack.versions());
    if (!BASELINE) {
      rep.check(`${MODE}-setup-refused`, 'apply.sh refused while fixtures held NULL-tenant rows (exit 3)', prep.refused?.code === 3, `exit ${prep.refused?.code}`);
      rep.check(`${MODE}-setup-applied`, 'after the data cut, apply.sh applied the pack and the guard passed', /catalog-guard: ok/.test(prep.applied ?? ''),
        (prep.applied ?? '').trim().split('\n').slice(-1)[0]);
    }
    const T = tokens();
    let r0: Res;

    // ------------------------------------------------------------ tables, read
    rep.section('tables: read');
    for (const t of TENANT_TABLES) {
      expect(`read-${t}`, `A GET /${t}`, await api(stack, 'GET', `/${t}?select=*`, { token: T.A }), ['isolated', 'leak']);
    }
    for (const t of ['vcons', 'dialog', 'attachments'] as const) {
      expect(`read-b-${t}`, `B GET /${t} sees B and not A`, await api(stack, 'GET', `/${t}?select=*`, { token: T.B }), ['isolated', 'leak'], 'B');
    }
    expect('read-a-filter-b', 'A GET /vcons?tenant_id=eq.<B>', await api(stack, 'GET', `/vcons?select=*&tenant_id=eq.${TENANT_B}`, { token: T.A }), ['empty', 'empty']);
    expect('read-a-uuid-b', 'A GET /vcons?uuid=eq.<B uuid>', await api(stack, 'GET', `/vcons?select=*&uuid=eq.${B.uuid}`, { token: T.A }), ['empty', 'empty']);
    expect('read-a-child-bn', "A GET /parties?vcon_id=eq.<B's vCon with NULL children>", await api(stack, 'GET', `/parties?select=*&vcon_id=eq.${BN.uuid}`, { token: T.A }), ['empty', 'leak']);
    expect('read-a-embed-bn', "A GET /vcon_embeddings?vcon_id=eq.<B's vCon with NULL children>", await api(stack, 'GET', `/vcon_embeddings?select=*&vcon_id=eq.${BN.uuid}`, { token: T.A }), ['empty', 'leak']);

    // ------------------------------------------------------------ claims
    rep.section('claims and roles');
    const claimCases: Array<[string, string, [Exp, Exp]]> = [
      ['no-claim', T.noClaim, ['empty', 'leak']],
      ['null-claim', T.nullClaim, ['empty', 'leak']],
      ['empty-claim', T.emptyClaim, ['empty', 'leak']],
      ['quarantine-claim', T.quarantine, ['empty', 'leak']],
    ];
    for (const [name, tok, exp] of claimCases) {
      for (const t of ['vcons', 'parties', 'dialog', 'analysis', 'attachments'] as const) {
        expect(`${name}-${t}`, `authenticated, ${name.replace('-', ' ')}, GET /${t}`, await api(stack, 'GET', `/${t}?select=*`, { token: tok }), exp);
      }
      expect(`${name}-kw`, `authenticated, ${name.replace('-', ' ')}, keyword search`, await api(stack, 'POST', '/rpc/search_vcons_keyword', { token: tok, body: { query_text: 'zebra' } }), exp);
    }
    const rejectCases: Array<[string, string | undefined, Exp]> = [
      ['expired', T.expired, 'denied'], ['wrong-signature', T.wrongSig, 'denied'], ['alg-none', T.algNone, 'denied'],
      ['anon', undefined, 'denied'], ['anon-key', T.anonKey, 'denied'], ['role-postgres', T.rolePostgres, 'refused'],
    ];
    for (const [name, tok, exp] of rejectCases) {
      for (const t of ['vcons', 'parties', 'vcon_embeddings'] as const) {
        expect(`${name}-${t}`, `${name} GET /${t}`, await api(stack, 'GET', `/${t}?select=*`, { token: tok }), [exp, exp]);
      }
      expect(`${name}-kw`, `${name} keyword search`, await api(stack, 'POST', '/rpc/search_vcons_keyword', { token: tok, body: { query_text: 'zebra' } }), [exp, exp]);
    }

    // ------------------------------------------------------------ views
    rep.section('views and the tag materialized view');
    expect('view-legacy', 'A GET /vcons_legacy', await api(stack, 'GET', '/vcons_legacy?select=*', { token: T.A }), ['isolated', 'leak']);
    expect('view-usage', 'A GET /vcon_field_usage', await api(stack, 'GET', '/vcon_field_usage?select=*', { token: T.A }), ['isolated', 'leak']);
    expect('view-legacy-noclaim', 'no claim GET /vcons_legacy', await api(stack, 'GET', '/vcons_legacy?select=*', { token: T.noClaim }), ['empty', 'leak']);
    expect('view-legacy-anon', 'anon GET /vcons_legacy', await api(stack, 'GET', '/vcons_legacy?select=*'), ['denied', 'denied']);
    expect('mv-read', 'A GET /vcon_tags_mv', await api(stack, 'GET', '/vcon_tags_mv?select=*', { token: T.A }), ['denied', 'leak']);
    expect('mv-read-anon', 'anon GET /vcon_tags_mv', await api(stack, 'GET', '/vcon_tags_mv?select=*'), ['denied', 'denied']);
    expect('mv-scoped', 'A GET /vcon_tags_scoped', await api(stack, 'GET', '/vcon_tags_scoped?select=*', { token: T.A }), ['isolated', 'refused']);
    expect('mv-scoped-b', 'B GET /vcon_tags_scoped', await api(stack, 'GET', '/vcon_tags_scoped?select=*', { token: T.B }), ['isolated', 'refused'], 'B');
    expect('mv-scoped-noclaim', 'no claim GET /vcon_tags_scoped', await api(stack, 'GET', '/vcon_tags_scoped?select=*', { token: T.noClaim }), ['empty', 'refused']);
    expect('mv-scoped-quarantine', 'quarantine claim GET /vcon_tags_scoped', await api(stack, 'GET', '/vcon_tags_scoped?select=*', { token: T.quarantine }), ['empty', 'refused']);
    expect('mv-scoped-anon', 'anon GET /vcon_tags_scoped', await api(stack, 'GET', '/vcon_tags_scoped?select=*'), ['denied', 'refused']);
    expect('mv-refresh', 'A POST /rpc/refresh_vcon_tags_mv', await api(stack, 'POST', '/rpc/refresh_vcon_tags_mv', { token: T.A, body: {} }), ['denied', 'ok']);
    expect('mv-refresh-stale', 'A POST /rpc/refresh_vcon_tags_mv_if_stale (the lane gets 403; the writer refreshes)', await api(stack, 'POST', '/rpc/refresh_vcon_tags_mv_if_stale', { token: T.A, body: {} }), ['denied', 'denied']);
    expect('vkong', 'A GET vkong /vcons (no tenant column)', await api(stack, 'GET', '/vcons?select=*', { token: T.A, profile: 'vkong' }), ['denied', 'leak']);
    expect('vkong-anon', 'anon GET vkong /vcons', await api(stack, 'GET', '/vcons?select=*', { profile: 'vkong' }), ['denied', 'denied']);

    // ------------------------------------------------------------ definer paths
    rep.section('exec_sql and explain_query');
    const execQ = { q: 'select uuid, tenant_id, subject from vcons', params: {} };
    const explainQ = { q: `select * from vcons where tenant_id = '${TENANT_B}'`, run_analyze: true };
    for (const [name, tok] of [['A', T.A], ['no-claim', T.noClaim], ['anon', undefined]] as const) {
      expect(`exec-${name}`, `${name} POST /rpc/exec_sql`, await api(stack, 'POST', '/rpc/exec_sql', { token: tok, body: execQ }), ['denied', 'denied']);
      expect(`explain-${name}`, `${name} POST /rpc/explain_query (run_analyze on B's rows)`, await api(stack, 'POST', '/rpc/explain_query', { token: tok, body: explainQ }), ['denied', 'denied']);
    }
    expect('stats-A', 'A POST /rpc/get_storage_efficiency', await api(stack, 'POST', '/rpc/get_storage_efficiency', { token: T.A, body: {} }), ['denied', 'denied']);

    // ------------------------------------------------------------ search RPCs
    rep.section('search and tag RPCs');
    const rpc = (fn: string, body: unknown, token = T.A) => api(stack, 'POST', `/rpc/${fn}`, { token, body });
    const tags = { team: 'sales' };
    expect('kw', 'keyword "zebra" (every fixture has it)', await rpc('search_vcons_keyword', { query_text: 'zebra' }), ['isolated', 'leak']);
    expect('kw-tags', 'keyword with tag_filter', await rpc('search_vcons_keyword', { query_text: 'zebra', tag_filter: tags }), ['isolated', 'leak']);
    expect('kw-conv', 'keyword, date_field conversation', await rpc('search_vcons_keyword', { query_text: 'zebra', date_field: 'conversation' }), ['isolated', 'leak']);
    expect('kw-b-canary', "keyword for B's canary", await rpc('search_vcons_keyword', { query_text: B.canary }), ['empty', 'empty']);
    // The keyword RPC joins each child to its vCon, which A cannot see, so B's NULL children stay hidden here.
    expect('kw-bn-canary', "keyword for the canary in B's NULL children", await rpc('search_vcons_keyword', { query_text: BN.canary }), ['empty', 'empty']);
    expect('kw-n-canary', "keyword for the no-tenant canary", await rpc('search_vcons_keyword', { query_text: N.canary }), ['empty', 'leak']);
    expect('kw-q-canary', "keyword for the quarantine canary", await rpc('search_vcons_keyword', { query_text: Qf.canary }), ['empty', 'empty']);
    const sem = { query_embedding: EMBEDDING, match_threshold: 0.5, match_count: 50 };
    expect('sem', 'semantic, the shared embedding', await rpc('search_vcons_semantic', sem), ['isolated', 'leak']);
    expect('sem-tags', 'semantic with tag_filter', await rpc('search_vcons_semantic', { ...sem, tag_filter: tags }), ['isolated', 'leak']);
    expect('hybrid', 'hybrid, keyword and embedding', await rpc('search_vcons_hybrid', { keyword_query: 'zebra', query_embedding: EMBEDDING }), ['isolated', 'leak']);
    expect('by-tags', 'search_vcons_by_tags', await rpc('search_vcons_by_tags', { tag_filter: tags }), ['isolated', 'leak']);
    expect('tags-date', 'search_vcons_by_tags_and_date, tags', await rpc('search_vcons_by_tags_and_date', { tag_filter: tags, max_results: 100 }), ['isolated', 'leak']);
    expect('tags-date-empty', 'search_vcons_by_tags_and_date, no tags (date-only path)', await rpc('search_vcons_by_tags_and_date', { tag_filter: {}, vcon_created_after: '2026-01-01T00:00:00Z' }), ['isolated', 'leak']);
    expect('tags-date-conv', 'search_vcons_by_tags_and_date, date_field conversation', await rpc('search_vcons_by_tags_and_date', { tag_filter: tags, date_field: 'conversation' }), ['isolated', 'leak']);
    const ownCount = 2; // A and A2
    expectValue('tags-date-count', 'search_vcons_by_tags_and_date_count, tags', (await rpc('search_vcons_by_tags_and_date_count', { tag_filter: tags })).json, [ownCount, ownCount + 1], true);
    expectValue('tags-date-count-empty', 'search_vcons_by_tags_and_date_count, no tags', (await rpc('search_vcons_by_tags_and_date_count', { tag_filter: {} })).json, [ownCount, ownCount + 1], true);
    expect('vcon-tags-own', 'get_vcon_tags(A)', await rpc('get_vcon_tags', { p_vcon_uuid: A.uuid }), ['isolated', 'isolated']);
    expect('vcon-tags-b', 'get_vcon_tags(B)', await rpc('get_vcon_tags', { p_vcon_uuid: B.uuid }), ['empty', 'empty']);
    expect('vcon-tags-none', 'get_vcon_tags(no-tenant vCon)', await rpc('get_vcon_tags', { p_vcon_uuid: N.uuid }), ['empty', 'leak']);
    expectValue('has-tags-none', 'vcon_has_tags(no-tenant vCon)', (await rpc('vcon_has_tags', { p_vcon_uuid: N.uuid, tag_filter: tags })).json, [false, true], true);
    expectValue('has-tags-b', 'vcon_has_tags(B)', (await rpc('vcon_has_tags', { p_vcon_uuid: B.uuid, tag_filter: tags })).json, [false, false]);
    expect('dealer-uuids', 'vcon_uuids_for_dealer_filter', await rpc('vcon_uuids_for_dealer_filter', { p_name_ilike: 'motors' }), ['isolated', 'leak']);
    expectValue('dealer-count', 'count_vcons_for_dealer_filter', (await rpc('count_vcons_for_dealer_filter', { p_name_ilike: 'motors' })).json, [ownCount, ownCount + 1], true);
    expectValue('dealer-tags-count', 'count_vcons_tags_and_dealer', (await rpc('count_vcons_tags_and_dealer', { tag_filter: tags, p_name_ilike: 'motors' })).json, [ownCount, ownCount + 1], true);
    expect('dealer-agg', 'aggregate_vcons_by_dealer_stats', await rpc('aggregate_vcons_by_dealer_stats', { tag_filter: tags }), ['isolated', 'leak']);
    // get_vcon_embeddings returns vectors, not text, so the canary cannot show: test for the subject entry.
    // It is VOLATILE, so under the pack a tenant cannot call it at all.
    for (const [id, f, want] of [['own', A, true], ['none', N, true], ['bn', BN, true], ['b', B, false]] as const) {
      const er = await rpc('get_vcon_embeddings', { p_vcon_id: f.uuid });
      if (BASELINE) {
        expectValue(`embeddings-${id}`, `get_vcon_embeddings(${f.key}) returns a subject embedding`, !!er.json?.subject, [want, want], id === 'none' || id === 'bn');
      } else {
        expect(`embeddings-${id}`, `get_vcon_embeddings(${f.key}): a volatile function, refused`, er, ['denied', 'denied']);
      }
    }
    expect('kw-b', 'B: keyword "zebra" sees B and not A', await rpc('search_vcons_keyword', { query_text: 'zebra' }, T.B), ['isolated', 'leak'], 'B');
    expect('tags-date-b', 'B: search_vcons_by_tags_and_date sees B and not A', await rpc('search_vcons_by_tags_and_date', { tag_filter: tags }, T.B), ['isolated', 'leak'], 'B');

    // ------------------------------------------------------------ lane tools
    rep.section('the five lane tools, as their queries reach PostgREST');
    // search_vcons, no tags (ids_only and metadata page the same query, then get_vcon per uuid)
    const page = await api(stack, 'GET', '/vcons?select=uuid,id&order=created_at.desc,uuid.desc&offset=0&limit=10', { token: T.A });
    expect('lane-search-page', 'search_vcons page', page, ['isolated', 'leak']);
    const head = await fetch(`${stack.restUrl}/vcons?select=*`, { method: 'HEAD', headers: { Authorization: `Bearer ${T.A}`, Prefer: 'count=exact' } });
    expectValue('lane-search-count', 'search_vcons total (exact count)', head.headers.get('content-range')?.split('/')[1], [String(ownCount), String(ownCount + 1)], true);
    // search_vcons with a tags filter
    expect('lane-search-tags', 'search_vcons tags: refresh is refused, the search still runs', await rpc('refresh_vcon_tags_mv_if_stale', {}), ['denied', 'denied']);
    expect('lane-search-tags-rpc', 'search_vcons tags: search_vcons_by_tags_and_date', await rpc('search_vcons_by_tags_and_date', { tag_filter: tags, vcon_created_after: null, vcon_created_before: null, max_results: 10, date_field: 'created' }), ['isolated', 'leak']);
    // get_vcon
    const single = 'application/vnd.pgrst.object+json';
    expect('lane-get-own', 'get_vcon(A) parent', await api(stack, 'GET', `/vcons?select=*&uuid=eq.${A.uuid}`, { token: T.A, accept: single }), ['isolated', 'isolated']);
    for (const t of ['parties', 'dialog', 'analysis', 'attachments'] as const) {
      expect(`lane-get-own-${t}`, `get_vcon(A) ${t}`, await api(stack, 'GET', `/${t}?select=*&vcon_id=eq.${A.uuid}&order=${t === 'parties' ? 'party' : t === 'dialog' ? 'dialog' : t === 'analysis' ? 'analysis' : 'attachment'}_index`, { token: T.A }), ['isolated', 'isolated']);
    }
    expect('lane-get-b', "get_vcon(B's uuid) is not found", await api(stack, 'GET', `/vcons?select=*&uuid=eq.${B.uuid}`, { token: T.A, accept: single }), ['refused', 'refused']);
    expect('lane-get-none', 'get_vcon(no-tenant uuid)', await api(stack, 'GET', `/vcons?select=*&uuid=eq.${N.uuid}`, { token: T.A, accept: single }), ['refused', 'leak']);
    for (const t of ['parties', 'dialog', 'analysis', 'attachments'] as const) {
      expect(`lane-get-bn-${t}`, `get_vcon children of B's vCon with NULL children: ${t}`, await api(stack, 'GET', `/${t}?select=*&vcon_id=eq.${BN.uuid}`, { token: T.A }), ['empty', 'leak']);
    }
    // search_vcons_content and search_vcons_semantic are the keyword and semantic RPCs above.

    // ------------------------------------------------------------ spoof
    rep.section('session-variable spoof at pool 4');
    expect('spoof-auth', 'A POST /rpc/set_tenant_context', await rpc('set_tenant_context', { p_tenant_id: TENANT_B }), ['denied', 'denied']);
    // service_role keeps set_tenant_context (tier 1). It persists on the pooled
    // connection, and the old get_current_tenant_id() fell back to it.
    const setters = await Promise.all(Array.from({ length: 16 }, () => rpc('set_tenant_context', { p_tenant_id: TENANT_B }, T.svc)));
    rep.check(`${MODE}-spoof-set`, 'service_role set_tenant_context(B) on every pool connection', setters.every(r => r.status < 300), setters.map(r => r.status).join(','));
    const reads = await Promise.all(Array.from({ length: 24 }, () => api(stack, 'GET', '/vcons?select=uuid,tenant_id', { token: T.noClaim })));
    const tainted = reads.filter(r => seen(r.body, 'A').foreign.includes('B')).length;
    expectValue('spoof-noclaim', 'no-claim reads after the spoof that returned B rows (of 24)', BASELINE ? tainted > 0 : tainted, [0, true], true);
    const readsA = await Promise.all(Array.from({ length: 8 }, () => api(stack, 'GET', '/vcons?select=uuid,tenant_id', { token: T.A })));
    rep.check(`${MODE}-spoof-A`, 'A reads after the spoof contain no B row', readsA.every(r => !seen(r.body, 'A').foreign.includes('B')), readsA.map(brief).slice(0, 2).join('; '));
    const emptyAfter = await Promise.all(Array.from({ length: 8 }, () => api(stack, 'GET', '/vcons?select=uuid,tenant_id', { token: T.emptyClaim })));
    rep.check(`${MODE}-spoof-empty`, 'empty-claim reads after the spoof contain no B row', emptyAfter.every(r => !seen(r.body, 'A').foreign.includes('B')), '');
    await stack.startRest(); // fresh pool for what follows

    // ------------------------------------------------------------ service_role
    rep.section('service_role');
    const svcRead = await api(stack, 'GET', '/vcons?select=uuid,tenant_id', { token: T.svc });
    const svcSeen = markersIn(svcRead.body);
    rep.check(`${MODE}-svc-read`, 'service_role reads every tenant on direct reads (by design; it carries no tenant traffic)', svcSeen.has('A*') && svcSeen.has('B'), brief(svcRead));
    expect('svc-kw', 'service_role keyword search with no claim', await rpc('search_vcons_keyword', { query_text: 'zebra' }, T.svc), ['empty', 'leak']);
    expect('svc-kw-A', 'service_role keyword search with claim A', await rpc('search_vcons_keyword', { query_text: 'zebra' }, T.svcA), ['isolated', 'leak']);
    expect('svc-tags-date', 'service_role search_vcons_by_tags_and_date with no claim', await rpc('search_vcons_by_tags_and_date', { tag_filter: tags }, T.svc), ['empty', 'leak']);
    expect('svc-tags-date-A', 'service_role search_vcons_by_tags_and_date with claim A (no predicate before the pack)', await rpc('search_vcons_by_tags_and_date', { tag_filter: tags }, T.svcA), ['isolated', 'leak']);
    expect('svc-tags-date-empty-A', 'service_role search_vcons_by_tags_and_date, no tags, claim A', await rpc('search_vcons_by_tags_and_date', { tag_filter: {} }, T.svcA), ['isolated', 'leak']);
    expectValue('svc-tags-count-A', 'service_role search_vcons_by_tags_and_date_count with claim A', (await rpc('search_vcons_by_tags_and_date_count', { tag_filter: tags }, T.svcA)).json, [ownCount, 6], true);

    // The child triggers stamp the parent's tenant (four keep an explicit one, five
    // overwrite). The writer relies on them for children sent without a tenant.
    const parentW = freshId('aaaaaaaa');
    const parentDialog = freshId('aaaaaaaa');
    stack.sql(`INSERT INTO vcons (id, uuid, vcon_version, subject, tenant_id) VALUES ('${parentW}', '${parentW}', '0.4.0', 'trigger watch', '${TENANT_A}')`);
    for (const t of [...VCON_CHILDREN, 'party_history'] as string[]) {
      if (t === 'embedding_queue') {
        expectValue('trigger-embedding_queue', 'the vCon insert queued an embedding row with its tenant',
          stack.sql(`SELECT string_agg(coalesce(tenant_id, 'NULL'), ',') FROM embedding_queue WHERE vcon_id = '${parentW}'`).trim(), [TENANT_A, TENANT_A]);
        continue;
      }
      const id = t === 'dialog' ? parentDialog : freshId('aaaaaaaa');
      const body = rowBody(t, { vcon: parentW, dialog: parentDialog, tenant: null, id, idx: 0 });
      delete body.tenant_id;
      r0 = await api(stack, 'POST', `/${t}`, { token: T.svc, body, prefer: 'return=minimal' });
      expectValue(`trigger-${t}`, `service_role inserts a ${t} row with no tenant: it takes its ${t === 'party_history' ? 'dialog' : 'vCon'}'s (${brief(r0)})`,
        tenantOf(t, PK[t], t === 's3_sync_tracking' ? parentW : id), [TENANT_A, TENANT_A]);
    }
    stack.sql(`DELETE FROM vcons WHERE uuid = '${parentW}'`);

    // ------------------------------------------------------------ writes
    rep.section('tables: write, upsert, update, delete');
    // Under the pack a tenant reads and deletes; it writes nothing, its own rows included.
    const own = freshId('aaaaaaaa');
    const ownDialog = freshId('aaaaaaaa');
    let r = await api(stack, 'POST', '/vcons', { token: T.A, body: rowBody('vcons', { vcon: own, tenant: TENANT_A, id: own, idx: 0 }), prefer: 'return=representation' });
    expect('write-own-vcons', 'A inserts its own vCon', r, ['denied', 'isolated']);
    if (!BASELINE) stack.sql(`INSERT INTO vcons (id, uuid, vcon_version, subject, tenant_id) VALUES ('${own}', '${own}', '0.4.0', 'zqwrite subject', '${TENANT_A}')`);
    for (const t of VCON_CHILDREN) {
      if (t === 'embedding_queue') continue; // the vCon insert already queued one
      const id = t === 'dialog' ? ownDialog : freshId('aaaaaaaa');
      r = await api(stack, 'POST', `/${t}`, { token: T.A, body: rowBody(t, { vcon: own, tenant: TENANT_A, id, idx: 0 }), prefer: 'return=representation' });
      expect(`write-own-${t}`, `A inserts its own ${t} row`, r, ['denied', 'isolated']);
    }
    r = await api(stack, 'POST', '/party_history', { token: T.A, body: rowBody('party_history', { vcon: own, dialog: ownDialog, tenant: TENANT_A, id: freshId('aaaaaaaa'), idx: 0 }), prefer: 'return=representation' });
    expect('write-own-party_history', 'A inserts its own party_history row', r, ['denied', 'isolated']);
    r = await api(stack, 'PATCH', `/vcons?uuid=eq.${own}`, { token: T.A, body: { subject: 'zqwrite renamed' }, prefer: 'return=representation' });
    expect('write-update-own', 'A updates its own vCon', r, ['denied', 'isolated']);
    const viaView = freshId('aaaaaaaa');
    r = await api(stack, 'POST', '/vcons_legacy', { token: T.A, body: { id: viaView, uuid: viaView, vcon_version: '0.4.0', subject: 'zqwrite view' } });
    expectValue('write-view', `A inserts through the vcons_legacy view, leaving a vCon with no tenant (${brief(r)})`,
      r.status < 300 ? `written, tenant ${tenantOf('vcons', 'uuid', viaView)}` : 'refused', ['refused', 'written, tenant NULL'], true);
    stack.sql(`DELETE FROM vcons WHERE uuid = '${viaView}'`);
    r = await api(stack, 'POST', '/vcons', { token: T.A, body: rowBody('vcons', { vcon: '', tenant: null, id: freshId('aaaaaaaa'), idx: 0 }), prefer: 'return=representation' });
    expectValue('write-null-vcon', 'A inserts a vCon with no tenant (before the pack, every tenant reads it)', r.status < 300 ? 'written' : 'refused', ['refused', 'written'], true);
    r = await api(stack, 'POST', '/vcons', { token: T.A, body: rowBody('vcons', { vcon: '', tenant: TENANT_B, id: freshId('aaaaaaaa'), idx: 0 }) });
    expect('write-b-vcon', 'A inserts a vCon stamped with tenant B', r, ['denied', 'denied']);
    r = await api(stack, 'POST', '/vcons', { token: T.A, body: { ...rowBody('vcons', { vcon: '', tenant: null, id: freshId('aaaaaaaa'), idx: 0 }), tenant_id: undefined } });
    expectValue('write-omit-vcon', 'A inserts a vCon with tenant_id omitted', r.status < 300 ? 'written' : 'refused', ['refused', 'written'], true);
    r = await api(stack, 'PATCH', `/vcons?uuid=eq.${own}`, { token: T.A, body: { tenant_id: TENANT_B }, prefer: 'return=representation' });
    expect('write-move-own-to-b', 'A moves its own vCon to tenant B', r, ['denied', 'denied']);

    // A child under B's vCon (composite key), and under the no-tenant vCon.
    // s3_sync_tracking is keyed by vcon_id: clear B's row so the plant reaches the foreign key.
    stack.sql(`DELETE FROM s3_sync_tracking WHERE vcon_id = '${B.uuid}'`);
    for (const t of [...VCON_CHILDREN, 'party_history'] as string[]) {
      const id = freshId('eeeeeeee');
      const body = rowBody(t, { vcon: B.uuid, dialog: rowId(B, 'dialog'), tenant: TENANT_A, id, idx: 99 });
      r = await api(stack, 'POST', `/${t}`, { token: T.A, body, prefer: 'return=minimal' });
      const where = t === 'embedding_queue' ? `vcon_id = '${B.uuid}' AND tenant_id IS DISTINCT FROM '${TENANT_B}'`
        : t === 's3_sync_tracking' ? `vcon_id = '${B.uuid}'` : `id = '${id}'`;
      const planted = Number(stack.sql(`SELECT count(*) FROM ${t} WHERE ${where}`).trim());
      expectValue(`plant-${t}`, `A plants a ${t} row under B's ${t === 'party_history' ? 'dialog' : 'vCon'}`,
        planted > 0 ? `planted (HTTP ${r.status})` : 'refused', ['refused', `planted (HTTP ${r.status})`], true);
      stack.sql(`DELETE FROM ${t} WHERE ${where}`);
    }
    stack.sql(`INSERT INTO s3_sync_tracking (vcon_id, vcon_uuid, s3_key, synced_at, updated_at, tenant_id)
               VALUES ('${B.uuid}', '${B.uuid}', '${B.canary}.json', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', '${TENANT_B}')`);
    // The probe: the same error for B's uuid as for a uuid nobody holds.
    const probeB = await api(stack, 'POST', '/parties', { token: T.A, body: rowBody('parties', { vcon: B.uuid, tenant: TENANT_A, id: freshId('eeeeeeee'), idx: 98 }) });
    const probeNone = await api(stack, 'POST', '/parties', { token: T.A, body: rowBody('parties', { vcon: freshId('eeeeeeee'), tenant: TENANT_A, id: freshId('eeeeeeee'), idx: 98 }) });
    stack.sql(`DELETE FROM parties WHERE party_index = 98`);
    expectValue('probe', "a child insert answers the same for B's uuid as for an unknown uuid",
      `${probeB.status} ${probeB.json?.code}` === `${probeNone.status} ${probeNone.json?.code}` ? 'same' : `differs (${probeB.status} ${probeB.json?.code} vs ${probeNone.status} ${probeNone.json?.code})`,
      ['same', `differs (${probeB.status} ${probeB.json?.code} vs ${probeNone.status} ${probeNone.json?.code})`], true);
    // A vCon insert with B's uuid against one with a fresh uuid: a duplicate-key
    // error told A that B's uuid exists. Under the pack both are refused alike.
    const fresh = freshId('aaaaaaaa');
    const dupB = await api(stack, 'POST', '/vcons', { token: T.A, body: rowBody('vcons', { vcon: '', tenant: TENANT_A, id: B.uuid, idx: 0 }) });
    const dupFresh = await api(stack, 'POST', '/vcons', { token: T.A, body: rowBody('vcons', { vcon: '', tenant: TENANT_A, id: fresh, idx: 0 }) });
    const sig = (x: Res) => `${x.status} ${x.json?.code ?? ''}`.trim();
    expectValue('probe-unique', "a vCon insert answers the same for B's uuid as for a fresh one",
      sig(dupB) === sig(dupFresh) ? 'same' : 'differs', ['same', 'differs'], true);
    stack.sql(`DELETE FROM vcons WHERE uuid = '${fresh}'`);
    // The squat: A stores a uuid first; the writer's later post for B keeps A's tenant (a stored tenant wins).
    const squat = freshId('aaaaaaaa');
    r = await api(stack, 'POST', '/vcons', { token: T.A, body: rowBody('vcons', { vcon: '', tenant: TENANT_A, id: squat, idx: 0 }) });
    await rpc('save_vcon_batch', {
      p_vcons: [{ id: squat, uuid: squat, vcon_version: '0.4.0', subject: `zebra ${B.canary} squatted`, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', tenant_id: TENANT_B }],
    }, T.svc);
    expectValue('squat', `A claims a uuid before the writer stores B's vCon under it (A's insert: ${brief(r)}); the vCon belongs to`,
      tenantOf('vcons', 'uuid', squat), [TENANT_B, TENANT_A], true);
    stack.sql(`DELETE FROM vcons WHERE uuid = '${squat}'`);
    const n0 = NONE();
    r = await api(stack, 'POST', '/parties', { token: T.A, body: rowBody('parties', { vcon: n0.uuid, tenant: null, id: freshId('eeeeeeee'), idx: 97 }), prefer: 'return=minimal' });
    const attached = Number(stack.sql(`SELECT count(*) FROM parties WHERE party_index = 97`).trim());
    expectValue('attach-none', 'A attaches a party to the no-tenant vCon', attached > 0 ? 'attached' : 'refused', ['refused', 'attached'], true);
    stack.sql(`DELETE FROM parties WHERE party_index = 97`);

    // Upsert, update and delete aimed at B's rows: refused or matching nothing, B unchanged.
    for (const t of TENANT_TABLES) {
      const pkCol = PK[t];
      const pk = pkOf(B, t);
      const before = rowState(t, pkCol, pk);
      const body = { ...rowBody(t, { vcon: B.uuid, dialog: rowId(B, 'dialog'), tenant: TENANT_A, id: pk, idx: 0 }), [pkCol]: t === 'embedding_queue' ? Number(pk) : pk };
      r = await api(stack, 'POST', `/${t}?on_conflict=${pkCol}`, { token: T.A, body, prefer: 'resolution=merge-duplicates,return=representation' });
      rep.check(`${MODE}-upsert-b-${t}`, `A upserts over B's ${t} row: refused, row unchanged`, r.status >= 400 && rowState(t, pkCol, pk) === before && seen(r.body, 'A').foreign.length === 0, brief(r));
      r = await api(stack, 'PATCH', `/${t}?${pkCol}=eq.${pk}`, { token: T.A, body: { tenant_id: TENANT_A }, prefer: 'return=representation' });
      rep.check(`${MODE}-patch-b-${t}`, `A updates B's ${t} row: ${BASELINE ? 'no row matched' : 'refused'}, row unchanged`,
        (BASELINE ? r.status < 300 && isEmptyBody(r) : r.status === 403) && rowState(t, pkCol, pk) === before, brief(r));
      r = await api(stack, 'DELETE', `/${t}?${pkCol}=eq.${pk}`, { token: T.A, prefer: 'return=representation' });
      rep.check(`${MODE}-delete-b-${t}`, `A deletes B's ${t} row: no row matched, row still there`, r.status < 300 && isEmptyBody(r) && rowState(t, pkCol, pk) === before, brief(r));
    }
    r = await api(stack, 'DELETE', `/attachments?tenant_id=eq.${TENANT_B}`, { token: T.A, prefer: 'return=representation' });
    expect('delete-b-bulk', "A deletes every attachment filtered to tenant B", r, ['empty', 'empty']);

    // The same three aimed at a row no tenant owns (NULL before the pack, quarantine after).
    for (const t of TENANT_TABLES) {
      const pkCol = PK[t];
      for (const op of ['upsert', 'patch', 'delete'] as const) {
        const pk = freshOrphan(t);
        const before = rowState(t, pkCol, pk);
        if (op === 'upsert') {
          // The stored row, claimed for A, with one harmless column changed so a
          // write shows even where a child trigger puts the parent's tenant back.
          const stored = JSON.parse(before) as Record<string, unknown>;
          for (const k of Object.keys(stored)) if (k.endsWith('_tsvector')) delete stored[k];
          const body = { ...stored, tenant_id: TENANT_A, ...TOUCH[t] };
          r = await api(stack, 'POST', `/${t}?on_conflict=${pkCol}`, { token: T.A, body, prefer: 'resolution=merge-duplicates,return=representation' });
        } else if (op === 'patch') {
          r = await api(stack, 'PATCH', `/${t}?${pkCol}=eq.${pk}`, { token: T.A, body: { tenant_id: TENANT_A }, prefer: 'return=representation' });
        } else {
          r = await api(stack, 'DELETE', `/${t}?${pkCol}=eq.${pk}`, { token: T.A, prefer: 'return=representation' });
        }
        const after = rowState(t, pkCol, pk);
        const outcome = after === before ? 'unchanged' : after === 'absent' ? 'deleted' : 'changed';
        expectValue(`${op}-none-${t}`, `A ${op}s a ${t} row no tenant owns (${brief(r)})`, outcome,
          ['unchanged', op === 'delete' ? 'deleted' : 'changed'], true);
      }
    }

    // ------------------------------------------------------------ RPC writes
    rep.section('RPC writes');
    const batch = (u: string, tenant: string | null, subject: string) => ({
      p_vcons: [{ id: u, uuid: u, vcon_version: '0.4.0', subject, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', tenant_id: tenant }],
    });
    let before = rowState('vcons', 'uuid', B.uuid);
    r = await rpc('save_vcon_batch', batch(B.uuid, TENANT_A, 'zqhijack'));
    rep.check(`${MODE}-batch-b`, "A save_vcon_batch over B's vCon: refused, unchanged", r.status >= 400 && rowState('vcons', 'uuid', B.uuid) === before, brief(r));
    const batchB = r;
    const batchFresh = await rpc('save_vcon_batch', batch(freshId('aaaaaaaa'), TENANT_A, 'zqwrite batch'));
    expectValue('batch-oracle', "save_vcon_batch answers the same for B's id as for a fresh id",
      sig(batchB) === sig(batchFresh) ? 'same' : `differs (${sig(batchB)} vs ${sig(batchFresh)})`,
      ['same', `differs (${sig(batchB)} vs ${sig(batchFresh)})`], true);
    // Every VOLATILE function, the kind that may write, is closed to tenants.
    const writeRpcs: Array<[string, unknown]> = [
      ['save_vcon_batch', batch(freshId('aaaaaaaa'), TENANT_A, 'zqwrite')],
      ['remove_vcon_child_and_compact', { p_table: 'attachments', p_vcon_id: A.uuid, p_index: 0 }],
      ['mark_vcon_synced', { p_vcon_id: A.uuid, p_vcon_uuid: A.uuid, p_s3_key: 'zqwrite' }],
      ['recompute_vcon_conversation_start', { p_schema: 'public', p_vcon_ids: [A.uuid] }],
      ['backfill_search_vector_batch', { p_table_name: 'dialog', p_batch_size: 10 }],
      ['get_unsynced_vcons', { p_limit: 10 }],
      ['check_vcon_embeddings_complete', { p_vcon_id: A.uuid }],
    ];
    for (const [fn, args] of writeRpcs) {
      strictOnly(`volatile-${fn}`, `A POST /rpc/${fn} (VOLATILE)`, await rpc(fn, args), 'denied');
    }
    const orphan = freshOrphan('vcons');
    const orphanBefore = tenantOf('vcons', 'uuid', orphan);
    r = await rpc('save_vcon_batch', batch(orphan, TENANT_A, 'zqhijack'));
    expectValue('batch-none', 'A save_vcon_batch over a vCon no tenant owns', tenantOf('vcons', 'uuid', orphan) === orphanBefore ? 'unchanged' : 'taken',
      ['unchanged', 'taken'], true);
    before = rowState('attachments', 'id', rowId(B, 'attachments'));
    r = await rpc('remove_vcon_child_and_compact', { p_table: 'attachments', p_vcon_id: B.uuid, p_index: 0 });
    rep.check(`${MODE}-compact-b`, "A remove_vcon_child_and_compact on B's attachment: B unchanged", rowState('attachments', 'id', rowId(B, 'attachments')) === before, brief(r));
    before = rowState('analysis', 'id', rowId(BN, 'analysis'));
    r = await rpc('remove_vcon_child_and_compact', { p_table: 'analysis', p_vcon_id: BN.uuid, p_index: 0 });
    expectValue('compact-bn', "A remove_vcon_child_and_compact on the analysis of B's vCon with NULL children",
      rowState('analysis', 'id', rowId(BN, 'analysis')) === before ? 'unchanged' : 'removed', ['unchanged', 'removed'], true);

    // service_role re-posts through save_vcon_batch, which keeps a stored tenant
    // (migration 20261112120000_keep_stored_tenant.sql).
    const w = freshId('aaaaaaaa');
    const childCount = (u: string, tenant: string) => stack.sql(`SELECT ${VCON_CHILDREN.map(t =>
      `(SELECT count(*) FROM ${t} WHERE vcon_id = '${u}' AND tenant_id = '${tenant}')`).join(' + ')}`).trim();
    r = await rpc('save_vcon_batch', {
      ...batch(w, TENANT_A, 'zebra repost'),
      p_parties: [{ vcon_id: w, party_index: 0, name: 'zebra repost party', tenant_id: TENANT_A }],
    }, T.svc);
    rep.check(`${MODE}-repost-setup`, 'service_role writes a tenant A vCon with a party', r.status < 300, brief(r));
    const childrenA = childCount(w, TENANT_A);
    r = await rpc('save_vcon_batch', batch(w, null, 'zebra repost'), T.svc);
    expectValue('repost-null', `service_role re-post with tenant_id null: the vCon keeps tenant A (${brief(r)})`,
      `${tenantOf('vcons', 'uuid', w)} ${r.status < 300 ? 'written' : 'refused'}`, [`${TENANT_A} refused`, `${TENANT_A} written`]);
    // Under the strict pack NOT NULL is checked before the conflict branch, so a
    // re-post whose vCon row has no tenant fails as a whole; the writer always stamps one.
    const noTenantKey = batch(w, null, 'zebra repost');
    delete (noTenantKey.p_vcons[0] as Record<string, unknown>).tenant_id;
    r = await rpc('save_vcon_batch', noTenantKey, T.svc);
    expectValue('repost-omitted', `service_role re-post with tenant_id left out: the vCon keeps tenant A (${brief(r)})`,
      `${tenantOf('vcons', 'uuid', w)} ${r.status < 300 ? 'written' : 'refused'}`, [`${TENANT_A} refused`, `${TENANT_A} written`]);
    r = await rpc('save_vcon_batch', batch(w, TENANT_B, 'zebra repost'), T.svc);
    expectValue('repost-other', `service_role re-post stamped for tenant B: the vCon keeps tenant A (${brief(r)})`, tenantOf('vcons', 'uuid', w), [TENANT_A, TENANT_A]);
    r = await rpc('save_vcon_batch', batch(w, QUARANTINE, 'zebra repost'), T.svc);
    expectValue('repost-quarantine', `service_role re-post stamped _quarantine: the vCon keeps tenant A (${brief(r)})`, tenantOf('vcons', 'uuid', w), [TENANT_A, TENANT_A]);
    expectValue('repost-children', 'and its children stay with tenant A', childCount(w, TENANT_A), [childrenA, childrenA]);
    stack.sql(`DELETE FROM vcons WHERE uuid = '${w}'`);
    const quarantined = freshId('aaaaaaaa');
    stack.sql(`INSERT INTO vcons (id, uuid, vcon_version, subject, tenant_id) VALUES ('${quarantined}', '${quarantined}', '0.4.0', 'held', '${QUARANTINE}')`);
    r = await rpc('save_vcon_batch', batch(quarantined, TENANT_A, 'zebra repost'), T.svc);
    expectValue('repost-no-release', `a re-post stamped for tenant A does not take a vCon out of quarantine (${brief(r)})`, tenantOf('vcons', 'uuid', quarantined), [QUARANTINE, QUARANTINE]);
    stack.sql(`DELETE FROM vcons WHERE uuid = '${quarantined}'`);

    // ------------------------------------------------------------ writer functions
    rep.section('service_role only: quarantine release and tenant backfills');
    const releaseArgs = (u: string) => ({ p_vcon_uuid: u, p_tenant_id: TENANT_A, p_reason: 'test release', p_evidence: { check: 'fixture' }, p_released_by: 'test' });
    const writerOnly: Array<[string, unknown]> = [
      ['release_vcon_from_quarantine', releaseArgs(Qf.uuid)],
      ['backfill_tenant_id_batch', { p_table_name: 'parties', p_batch_size: 10 }],
      ['backfill_vcon_tenant_ids', { p_batch_size: 10, p_writer_rule: false }],
      ['vcon_tenant_stamp', { p_vcon_id: Qf.uuid, p_strict: true }],
    ];
    for (const [fn, args] of writerOnly) {
      expect(`writer-fn-${fn}`, `A POST /rpc/${fn}`, await rpc(fn, args), ['denied', 'denied']);
      expect(`writer-fn-${fn}-anon`, `anon POST /rpc/${fn}`, await api(stack, 'POST', `/rpc/${fn}`, { body: args }), ['denied', 'denied']);
    }
    expectValue('writer-fn-quarantine-kept', "after those calls the quarantined vCon is still in quarantine", tenantOf('vcons', 'uuid', Qf.uuid), [QUARANTINE, QUARANTINE]);
    expect('writer-log', 'A GET /tenant_quarantine_releases', await api(stack, 'GET', '/tenant_quarantine_releases?select=*', { token: T.A }), ['denied', 'denied']);
    // The release moves a vCon and every child; under the strict pack the composite keys carry it.
    const held = freshId('aaaaaaaa');
    const heldDialog = freshId('aaaaaaaa');
    stack.sql(`
      INSERT INTO vcons (id, uuid, vcon_version, subject, tenant_id) VALUES ('${held}', '${held}', '0.4.0', 'zebra held', '${QUARANTINE}');
      INSERT INTO parties (id, vcon_id, party_index, name, tenant_id) VALUES ('${freshId('aaaaaaaa')}', '${held}', 0, 'held caller', '${QUARANTINE}');
      INSERT INTO dialog (id, vcon_id, dialog_index, type, body, encoding, tenant_id) VALUES ('${heldDialog}', '${held}', 0, 'text', 'zebra held', 'none', '${QUARANTINE}');
      INSERT INTO party_history (id, dialog_id, party_index, time, event, tenant_id) VALUES ('${freshId('aaaaaaaa')}', '${heldDialog}', 0, now(), 'join', '${QUARANTINE}');`);
    expect('release-before', 'A cannot read a quarantined vCon', await api(stack, 'GET', `/vcons?select=*&uuid=eq.${held}`, { token: T.A }), ['empty', 'empty']);
    r = await rpc('release_vcon_from_quarantine', releaseArgs(held), T.svc);
    rep.check(`${MODE}-release-svc`, 'service_role releases it to tenant A, logging the release', r.status < 300 && Number(r.json) > 0, brief(r));
    expectValue('release-children', 'the vCon and its party, dialog, party_history and embedding_queue rows are all tenant A',
      stack.sql(`SELECT (SELECT count(*) FROM vcons WHERE uuid = '${held}' AND tenant_id = '${TENANT_A}') || ',' || ${childCount(held, TENANT_A)} || ',' ||
                        (SELECT count(*) FROM party_history WHERE dialog_id = '${heldDialog}' AND tenant_id = '${TENANT_A}')`).trim(), ['1,3,1', '1,3,1']);
    expect('release-after', 'A reads the released vCon', await api(stack, 'GET', `/vcons?select=*&uuid=eq.${held}`, { token: T.A }), ['isolated', 'isolated']);
    stack.sql(`DELETE FROM vcons WHERE uuid = '${held}'`);

    // ------------------------------------------------------------ TRUNCATE
    // Row level security does not govern TRUNCATE. A session that can SET ROLE
    // authenticated (a PostgREST login, for one) could empty every tenant's rows.
    rep.section('TRUNCATE and TRIGGER as authenticated (SQL, rolled back)');
    for (const t of [...TENANT_TABLES, 'privacy_requests', 'migration_reports'] as string[]) {
      const tr = stack.trySql(`BEGIN; SET LOCAL ROLE authenticated; TRUNCATE ${t} CASCADE; ROLLBACK;`);
      expectValue(`truncate-${t}`, `SET ROLE authenticated; TRUNCATE ${t}`, tr.ok ? 'emptied' : (tr.out.includes('permission denied') ? 'refused' : tr.out.trim().slice(-120)),
        ['refused', 'emptied'], true);
    }
    const trg = stack.trySql(`BEGIN; SET LOCAL ROLE authenticated;
      CREATE TRIGGER zq_probe BEFORE INSERT ON vcons FOR EACH ROW EXECUTE FUNCTION enqueue_embedding(); ROLLBACK;`);
    expectValue('trigger-vcons', 'SET ROLE authenticated; CREATE TRIGGER on vcons', trg.ok ? 'created' : (trg.out.includes('permission denied') ? 'refused' : trg.out.trim().slice(-120)),
      ['refused', 'created'], true);
    expectValue('rows-intact', 'every fixture vCon is still there', stack.sql(`SELECT count(*) FROM vcons WHERE uuid IN (${Object.values(FIXTURES).map(f => `'${f.uuid}'`).join(',')})`).trim(), ['6', '6']);

    // ------------------------------------------------------------ delete_vcon
    rep.section('delete_vcon');
    const a2 = FIXTURES.A2;
    r = await api(stack, 'DELETE', `/vcons?uuid=eq.${B.uuid}`, { token: T.A, prefer: 'return=representation' });
    rep.check(`${MODE}-lane-delete-b`, "delete_vcon(B's uuid) matches nothing, B still there", r.status < 300 && isEmptyBody(r) && tenantOf('vcons', 'uuid', B.uuid) === TENANT_B, brief(r));
    r = await api(stack, 'DELETE', `/vcons?uuid=eq.${a2.uuid}`, { token: T.A, prefer: 'return=representation' });
    expect('lane-delete-own', 'delete_vcon(own uuid) deletes one vCon', r, ['isolated', 'isolated']);
    const left = stack.sql(`SELECT ${[...VCON_CHILDREN.map(t => `(SELECT count(*) FROM ${t} WHERE vcon_id = '${a2.uuid}')`),
      `(SELECT count(*) FROM party_history WHERE dialog_id = '${rowId(a2, 'dialog')}')`].join(' + ')}`).trim();
    expectValue('lane-delete-cascade', 'and every child row of it, in all nine child tables', left, ['0', '0']);
    expectValue('lane-delete-others', "B's and the no-tenant vCons are untouched", stack.sql(`SELECT count(*) FROM vcons WHERE uuid IN ('${B.uuid}', '${BN.uuid}', '${NONE().uuid}')`).trim(), ['3', '3']);

    // ------------------------------------------------------------ lane PostgREST
    // The lane's own PostgREST logs in as a member of authenticated only, with no anon role.
    rep.section("PostgREST as the tenant lane's (authenticated only, no anon role)");
    await stack.startRest('lane');
    expect('lanerest-A', 'A GET /vcons', await api(stack, 'GET', '/vcons?select=*', { token: T.A }), ['isolated', 'leak']);
    expect('lanerest-A-kw', 'A keyword search', await rpc('search_vcons_keyword', { query_text: 'zebra' }), ['isolated', 'leak']);
    expect('lanerest-svc', 'a service_role token fails at SET ROLE', await api(stack, 'GET', '/vcons?select=*', { token: T.svc }), ['refused', 'refused']);
    expect('lanerest-anon', 'no token gets nothing', await api(stack, 'GET', '/vcons?select=*'), ['denied', 'denied']);
    expect('lanerest-anon-key', 'an anon-role token fails at SET ROLE', await api(stack, 'GET', '/vcons?select=*', { token: T.anonKey }), ['refused', 'refused']);
    expect('lanerest-vkong', 'the vkong schema is not served', await api(stack, 'GET', '/vcons?select=*', { token: T.A, profile: 'vkong' }), ['refused', 'refused']);
  } finally {
    await stack.stop();
  }
  if (BASELINE) console.log(`\nbaseline: ${leaksSeen} known leaks reproduced`);
  return rep.summary(`REST shape summary (${MODE})`);
}

main().then(code => process.exit(code), e => { console.error(e); process.exit(2); });
