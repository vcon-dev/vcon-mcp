/**
 * Catalog guard and apply-script test for the strict pack.
 *
 *   node tests/tenant-isolation/catalog-guard.ts      (Node 22.18+; or npx tsx)
 *
 * On a throwaway PostgreSQL 17 with every migration and the synthetic
 * fixtures (see stack.ts and fixtures.ts):
 *
 *   1. The guard fails on the unmodified schema.
 *   2. apply.sh refuses while a tenant table holds a NULL tenant, and while a
 *      child's tenant differs from its parent's; the catalog is unchanged.
 *   3. --dry-run reports changes and leaves the catalog unchanged.
 *   4. apply.sh applies; the guard passes.
 *   5. A second run changes nothing: catalog snapshots (with each row's xmin)
 *      are identical.
 *   6. Upgrades that undo the pack (an RPC replaced with its NULL branch, the
 *      session fallback migration re-run, a policy, view, key, grant or NOT
 *      NULL reverted) make the guard fail; a re-run of the pack restores the
 *      strict state. Shapes the pack does not know fail loudly.
 *   7. Composite keys refuse a child under another tenant's parent in every
 *      child table, and carry a release from quarantine to every child.
 *
 * Exit 0 when every check passes.
 */
import { snapshot, diff, Report } from './checks.ts';
import {
  dataCut, FIXTURES, loadFixtures, QUARANTINE, rowId, TENANT_A, TENANT_B, tenantCounts, VCON_CHILDREN,
} from './fixtures.ts';
import { MIGRATIONS_DIR, startStack, type Stack } from './stack.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rep = new Report();

function guard(stack: Stack): { code: number; out: string } {
  return stack.runApplyScript(['--check']);
}

function applyPack(stack: Stack): { code: number; out: string; changes: number } {
  const r = stack.runApplyScript();
  return { ...r, changes: (r.out.match(/strict-pack: changed:/g) ?? []).length };
}

function sameCatalog(id: string, desc: string, before: string[], after: string[]): void {
  const d = diff(before, after);
  const n = d.removed.length + d.added.length;
  rep.check(id, desc, n === 0, n === 0 ? `${after.length} catalog lines identical`
    : `${n} lines differ: ${[...d.removed.map(x => `- ${x}`), ...d.added.map(x => `+ ${x}`)].slice(0, 6).join(' / ')}`);
}

/** Run SQL, expect failure with a SQLSTATE or message fragment. */
function expectSqlError(id: string, desc: string, stack: Stack, sql: string, fragment: string): void {
  const r = stack.trySql(sql);
  rep.check(id, desc, !r.ok && r.out.includes(fragment), r.ok ? 'succeeded' : r.out.trim().split('\n').find(l => l.includes('ERROR')) ?? r.out.trim());
}

const UPSTREAM_RPCS = [
  'search_vcons_keyword', 'search_vcons_semantic', 'search_vcons_hybrid', 'search_vcons_by_tags',
  'search_vcons_by_tags_and_date', 'search_vcons_by_tags_and_date_count', 'get_vcon_tags', 'vcon_has_tags',
  'vcon_uuids_for_dealer_filter', 'count_vcons_for_dealer_filter', 'count_vcons_tags_and_dealer',
  'aggregate_vcons_by_dealer_stats',
];

async function main(): Promise<number> {
  const stack = await startStack({ label: 'guard' });
  try {
    rep.section('setup');
    const n = stack.applyMigrations();
    rep.check('setup-chain', `every migration applied unmodified (${n} files)`, n === stack.migrationFiles().length, stack.versions());
    loadFixtures(stack);
    console.log(`rows by tenant: ${tenantCounts(stack)}`);

    // The functions as the migrations left them, to replay later as an upgrade would.
    const upstream = stack.sqlJson<Record<string, string>>(`
      SELECT json_object_agg(p.oid::regprocedure::text, pg_get_functiondef(p.oid))
        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (ARRAY[${UPSTREAM_RPCS.map(x => `'${x}'`).join(',')}])`) ?? {};
    rep.eq('setup-rpcs', 'the 12 search and tag RPCs the pack rewrites are present', UPSTREAM_RPCS.length, Object.keys(upstream).length);
    rep.eq('setup-writer-fns', 'the writer migrations\' service_role functions are present',
      'backfill_tenant_id_batch,backfill_vcon_tenant_ids,release_vcon_from_quarantine,vcon_tenant_stamp',
      stack.sql(`SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                 AND proname IN ('release_vcon_from_quarantine', 'backfill_tenant_id_batch', 'backfill_vcon_tenant_ids', 'vcon_tenant_stamp')`).trim());

    // ------------------------------------------------------------ 1
    rep.section('1. the guard fails on the unmodified schema');
    let g = guard(stack);
    const violations = Number(/catalog-guard: (\d+) violation/.exec(g.out)?.[1] ?? 0);
    rep.check('g-base-exit', 'apply.sh --check exits 4', g.code === 4, `exit ${g.code}, ${violations} violations`);
    for (const [id, frag] of [
      ['g-base-policy', 'policy vcons_tenant_isolation on public.vcons has a NULL branch'],
      ['g-base-fallback', 'get_current_tenant_id() reads a setting other than request.jwt.claims'],
      ['g-base-spoof', "with no claims and app.current_tenant_id set, the tenant is 't-guard-spoof'"],
      ['g-base-quarantine', 'a _quarantine claim gives tenant'],
      ['g-base-mv', 'holds a privilege on public.vcon_tags_mv'],
      ['g-base-rpc', 'search_vcons_keyword(text,timestamp with time zone,timestamp with time zone,jsonb,integer,text) treats the tenant in a NULL-tolerant way (IS NULL)'],
      ['g-base-truncate', 'anon or authenticated holds TRUNCATE, TRIGGER, REFERENCES or MAINTAIN on public.vcons'],
      ['g-base-insert', 'authenticated can insert into or update tenant table public.vcons'],
      ['g-base-write-rpc', 'save_vcon_batch(jsonb,jsonb,jsonb,jsonb,jsonb) is VOLATILE, so it may write'],
      ['g-base-view-write', 'authenticated can write through view public.vcons_legacy'],
      ['g-base-tagdate', 'search_vcons_by_tags_and_date(jsonb,timestamp with time zone,timestamp with time zone,integer,text) reads vcons without a tenant predicate'],
      ['g-base-key', 'parties has no key to vcons that includes tenant_id'],
      ['g-base-phkey', 'party_history has no key to dialog that includes tenant_id'],
      ['g-base-vkong', 'vkong.vcons has no tenant column and no row level security'],
      ['g-base-notnull', 'public.vcons.tenant_id allows NULL'],
    ] as const) {
      rep.check(id, `guard names: ${frag.slice(0, 70)}`, g.out.includes(frag));
    }

    // ------------------------------------------------------------ 2
    rep.section('2. apply.sh refuses while rows have no tenant');
    const s0 = snapshot(stack);
    let a = applyPack(stack);
    rep.check('refuse-null-exit', 'apply.sh exits 3 with NULL-tenant rows present', a.code === 3, `exit ${a.code}`);
    rep.check('refuse-null-names', 'the refusal names each table and count', /vcons has 2 row\(s\) with no tenant|vcons has 1 row\(s\) with no tenant/.test(a.out) && a.out.includes('party_history has'), a.out.split('\n').find(l => l.includes('refused'))?.slice(0, 160) ?? '');
    sameCatalog('refuse-null-unchanged', 'catalog unchanged after the refusal', s0, snapshot(stack));

    dataCut(stack);
    console.log(`after the cut: ${tenantCounts(stack)}`);
    // A child whose tenant differs from its vCon's: the composite key cannot hold it.
    stack.sql(`UPDATE parties SET tenant_id = '${TENANT_B}' WHERE id = '${rowId(FIXTURES.A, 'parties')}'`);
    const s1 = snapshot(stack);
    a = applyPack(stack);
    rep.check('refuse-mismatch-exit', 'apply.sh exits 3 when a child\'s tenant differs from its vCon\'s', a.code === 3 && a.out.includes("parties has 1 row(s) whose tenant differs"), `exit ${a.code}`);
    sameCatalog('refuse-mismatch-unchanged', 'catalog unchanged after the refusal', s1, snapshot(stack));
    stack.sql(`UPDATE parties SET tenant_id = '${TENANT_A}' WHERE id = '${rowId(FIXTURES.A, 'parties')}'`);
    stack.sql(`UPDATE dialog SET tenant_id = '' WHERE id = '${rowId(FIXTURES.B, 'dialog')}'`);
    a = applyPack(stack);
    rep.check('refuse-empty-exit', 'apply.sh exits 3 when a tenant_id is the empty string', a.code === 3 && a.out.includes('dialog has 1 row(s) with no tenant'), `exit ${a.code}`);
    stack.sql(`UPDATE dialog SET tenant_id = '${TENANT_B}' WHERE id = '${rowId(FIXTURES.B, 'dialog')}'`);

    // ------------------------------------------------------------ 3
    rep.section('3. --dry-run');
    const s2 = snapshot(stack);
    const dry = stack.runApplyScript(['--dry-run']);
    const dryChanges = (dry.out.match(/strict-pack: changed:/g) ?? []).length;
    rep.check('dry-exit', 'apply.sh --dry-run exits 0, guard passing inside the transaction', dry.code === 0 && dry.out.includes('catalog-guard: ok'), `exit ${dry.code}, ${dryChanges} changes reported`);
    sameCatalog('dry-unchanged', 'catalog unchanged after the dry run', s2, snapshot(stack));

    // ------------------------------------------------------------ 4
    rep.section('4. apply');
    a = applyPack(stack);
    rep.check('apply-exit', 'apply.sh exits 0', a.code === 0, `exit ${a.code}, ${a.changes} changes`);
    if (a.code !== 0) console.log(a.out);
    rep.eq('apply-changes', 'the apply makes the changes the dry run reported', dryChanges, a.changes);
    g = guard(stack);
    const guardChecks = /catalog-guard: ok, (\d+) checks passed/.exec(g.out)?.[1];
    rep.check('apply-guard', 'apply.sh --check passes', g.code === 0, guardChecks ? `${guardChecks} guard checks passed` : g.out.slice(-300));

    // apply.sh keeps the connection string out of its arguments.
    let u = stack.runApplyScript(['--check', 'postgresql://postgres@localhost/vcon_tenant']);
    rep.check('url-arg', 'apply.sh refuses a connection string given as an argument (exit 2)', u.code === 2 && u.out.includes('not as an argument'), `exit ${u.code}`);
    u = stack.runApplyScript(['--check'], { DATABASE_URL: 'postgresql://postgres:p%40ss%2Fword@localhost/vcon_tenant' });
    rep.check('url-password', 'apply.sh connects with a password URL in DATABASE_URL (password moved to PGPASSWORD)', u.code === 0, `exit ${u.code}`);
    stack.writeFile('/tmp/strict-url', 'postgresql://postgres@localhost/vcon_tenant\n');
    u = stack.runApplyScript(['--check', '--url-file', '/tmp/strict-url'], { DATABASE_URL: '' });
    rep.check('url-file', 'apply.sh reads the connection string from --url-file', u.code === 0, `exit ${u.code}`);

    // ------------------------------------------------------------ 5
    rep.section('5. a second run changes nothing');
    const s3 = snapshot(stack);
    a = applyPack(stack);
    rep.check('rerun-exit', 'apply.sh exits 0 and reports no change', a.code === 0 && a.changes === 0 && a.out.includes('nothing changed'), `exit ${a.code}, ${a.changes} changes`);
    sameCatalog('rerun-snapshot', 'catalog snapshot identical after the second run (xmin included)', s3, snapshot(stack));
    a = applyPack(stack);
    sameCatalog('rerun3-snapshot', 'and after a third run', s3, snapshot(stack));

    // ------------------------------------------------------------ 6
    rep.section('6. upgrades that undo the pack');
    const regress = (id: string, desc: string, sql: string, guardFragment: string, opts: { packFixes?: boolean; cleanup?: string } = {}) => {
      stack.sql(sql);
      const gr = guard(stack);
      rep.check(`${id}-guard`, `${desc}: guard fails`, gr.code === 4 && gr.out.includes(guardFragment),
        gr.code === 4 ? (gr.out.split('\n').find(l => l.includes(guardFragment))?.trim().slice(0, 150) ?? 'fragment missing') : `exit ${gr.code}`);
      const ap = applyPack(stack);
      if (opts.packFixes === false) {
        rep.check(`${id}-pack`, `${desc}: the pack does not guess, it fails at the guard and rolls back`, ap.code === 4, `exit ${ap.code}`);
        if (opts.cleanup) stack.sql(opts.cleanup);
        const ok = guard(stack);
        rep.check(`${id}-fixed`, `${desc}: guard passes once the change is removed`, ok.code === 0, `exit ${ok.code}`);
      } else {
        const ok = guard(stack);
        rep.check(`${id}-pack`, `${desc}: a re-run of the pack restores the strict state`, ap.code === 0 && ap.changes > 0 && ok.code === 0,
          `apply exit ${ap.code}, ${ap.changes} changes, guard exit ${ok.code}`);
      }
    };

    // The headline case: an upgrade CREATE OR REPLACEs a search RPC with its NULL branch.
    const kw = Object.keys(upstream).find(k => k.startsWith('search_vcons_keyword('))!;
    regress('up-rpc', 'search_vcons_keyword replaced by its upstream body', `${upstream[kw]};`,
      `${kw} treats the tenant in a NULL-tolerant way (IS NULL)`);
    regress('up-all-rpcs', 'all 12 RPCs replaced by their upstream bodies', Object.values(upstream).join(';\n') + ';',
      'reads vcons without a tenant predicate');
    regress('up-fallback-migration', 're-running migration 20251122175916 (session fallback)',
      readFileSync(join(MIGRATIONS_DIR, '20251122175916_update_get_current_tenant_id.sql'), 'utf8'),
      'get_current_tenant_id() reads a setting other than request.jwt.claims');
    regress('up-policy', 'a tenant policy recreated with its NULL branch',
      `DROP POLICY parties_tenant_isolation ON parties;
       CREATE POLICY parties_tenant_isolation ON parties FOR ALL TO authenticated
         USING (tenant_id IS NULL OR tenant_id = get_current_tenant_id()) WITH CHECK (tenant_id IS NULL OR tenant_id = get_current_tenant_id());`,
      'policy parties_tenant_isolation on public.parties has a NULL branch');
    regress('up-view', 'a view recreated without security_invoker', `ALTER VIEW vcons_legacy SET (security_invoker = false)`,
      'public.vcons_legacy runs as its owner');
    regress('up-mv', 'authenticated granted the tag materialized view again', `GRANT SELECT ON vcon_tags_mv TO authenticated`,
      'holds a privilege on public.vcon_tags_mv');
    regress('up-key', 'a single-column key to vcons recreated',
      `ALTER TABLE parties ADD CONSTRAINT parties_vcon_id_fkey FOREIGN KEY (vcon_id) REFERENCES vcons(uuid) ON DELETE CASCADE`,
      'parties_vcon_id_fkey on parties references vcons without tenant_id');
    regress('up-notnull', 'NOT NULL dropped from a tenant column', `ALTER TABLE groups ALTER COLUMN tenant_id DROP NOT NULL`,
      'public.groups.tenant_id allows NULL');
    regress('up-force', 'FORCE row level security turned off', `ALTER TABLE analysis NO FORCE ROW LEVEL SECURITY`,
      'public.analysis does not force row level security');
    regress('up-vkong', 'authenticated granted vkong.vcons again', `GRANT SELECT ON vkong.vcons TO authenticated`,
      'vkong.vcons has no tenant column and no row level security');
    regress('up-refresh', 'authenticated granted the tag refresh RPC again', `GRANT EXECUTE ON FUNCTION refresh_vcon_tags_mv() TO authenticated`,
      'refresh_vcon_tags_mv() reads vcon_tags_mv');
    regress('up-release', 'authenticated granted release_vcon_from_quarantine',
      `GRANT EXECUTE ON FUNCTION release_vcon_from_quarantine(uuid, text, text, jsonb, text) TO authenticated`,
      'release_vcon_from_quarantine(uuid,text,text,jsonb,text) is service_role only');
    regress('up-backfill', 'authenticated granted backfill_vcon_tenant_ids',
      `GRANT EXECUTE ON FUNCTION backfill_vcon_tenant_ids(integer, boolean) TO authenticated`,
      'backfill_vcon_tenant_ids(integer,boolean) is service_role only');
    regress('up-truncate', 'authenticated granted TRUNCATE, TRIGGER and MAINTAIN on vcons again',
      `GRANT TRUNCATE, TRIGGER, MAINTAIN ON vcons TO authenticated`,
      'anon or authenticated holds TRUNCATE, TRIGGER, REFERENCES or MAINTAIN on public.vcons');
    regress('up-references-public', 'PUBLIC granted REFERENCES on privacy_requests',
      `GRANT REFERENCES ON privacy_requests TO PUBLIC`,
      'anon or authenticated holds TRUNCATE, TRIGGER, REFERENCES or MAINTAIN on public.privacy_requests');
    regress('up-insert', 'authenticated granted INSERT and UPDATE on parties again',
      `GRANT INSERT, UPDATE ON parties TO authenticated`,
      'authenticated can insert into or update tenant table public.parties');
    regress('up-insert-column', 'authenticated granted UPDATE on one column of vcons',
      `GRANT UPDATE (subject) ON vcons TO authenticated`,
      'authenticated can insert into or update tenant table public.vcons');
    regress('up-view-write', 'authenticated granted INSERT through vcons_legacy',
      `GRANT INSERT ON vcons_legacy TO authenticated`,
      'authenticated can write through view public.vcons_legacy');
    regress('up-write-rpc', 'authenticated granted save_vcon_batch again',
      `GRANT EXECUTE ON FUNCTION save_vcon_batch(jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated`,
      'save_vcon_batch(jsonb,jsonb,jsonb,jsonb,jsonb) is VOLATILE, so it may write');
    regress('up-write-rpc2', 'authenticated granted remove_vcon_child_and_compact again',
      `GRANT EXECUTE ON FUNCTION remove_vcon_child_and_compact(text, uuid, integer) TO authenticated`,
      'remove_vcon_child_and_compact(text,uuid,integer) is VOLATILE, so it may write');
    stack.sql(`CREATE ROLE guard_probe_owner NOLOGIN; GRANT CREATE ON SCHEMA public TO guard_probe_owner; GRANT guard_probe_owner TO postgres;`);
    regress('up-scoped-owner', 'vcon_tags_scoped given another owner',
      `ALTER VIEW vcon_tags_scoped OWNER TO guard_probe_owner`,
      'public.vcon_tags_scoped is not owned by the owner of vcon_tags_mv');
    stack.sql(`REVOKE CREATE ON SCHEMA public FROM guard_probe_owner; DROP ROLE guard_probe_owner;`);
    regress('up-refresh-trigger', 'the conversation_start refresh trigger replaced as SECURITY INVOKER',
      `ALTER FUNCTION child_refresh_conversation_start() SECURITY INVOKER RESET search_path`,
      'child_refresh_conversation_start() runs as the caller');

    // NULL-tolerant spellings other than IS NULL. The pack does not rewrite
    // these; the guard has to stop them. The first is the review's case.
    const tolerantBodies: Array<[string, string, string]> = [
      ['not-distinct-or-coalesce', `v.tenant_id IS NOT DISTINCT FROM current_tenant OR coalesce(current_tenant, '') = ''`, 'IS [NOT] DISTINCT FROM'],
      ['not-distinct', `v.tenant_id IS NOT DISTINCT FROM current_tenant`, 'IS [NOT] DISTINCT FROM'],
      ['coalesce', `v.tenant_id = coalesce(current_tenant, v.tenant_id)`, 'COALESCE or NULLIF'],
      ['nullif', `nullif(current_tenant, '') IS NOT NULL AND v.tenant_id = current_tenant OR nullif(current_tenant, '') = v.tenant_id`, 'COALESCE or NULLIF'],
      ['empty-string', `v.tenant_id = current_tenant OR current_tenant = ''`, 'compared with an empty string'],
      ['claim-is-null', `v.tenant_id = get_current_tenant_id() OR get_current_tenant_id() IS NULL`, 'IS NULL'],
    ];
    for (const [name, predicate, spelling] of tolerantBodies) {
      const fn = `guard_probe_${name.replace(/-/g, '_')}`;
      regress(`up-tolerant-${name}`, `a reachable function with a NULL-tolerant predicate (${name})`,
        `CREATE FUNCTION public.${fn}() RETURNS SETOF uuid LANGUAGE plpgsql STABLE AS $f$
           DECLARE current_tenant text := get_current_tenant_id();
           BEGIN RETURN QUERY SELECT v.uuid FROM vcons v WHERE ${predicate}; END $f$;
         REVOKE EXECUTE ON FUNCTION public.${fn}() FROM PUBLIC, anon;
         GRANT EXECUTE ON FUNCTION public.${fn}() TO authenticated, service_role;`,
        `${fn}() treats the tenant in a NULL-tolerant way (${spelling})`,
        { packFixes: false, cleanup: `DROP FUNCTION public.${fn}()` });
    }
    // The same predicate in a function only service_role can execute is not a tenant path; the guard leaves it.
    stack.sql(`CREATE FUNCTION public.guard_probe_service() RETURNS SETOF uuid LANGUAGE plpgsql STABLE AS $f$
                 DECLARE current_tenant text := get_current_tenant_id();
                 BEGIN RETURN QUERY SELECT v.uuid FROM vcons v WHERE v.tenant_id IS NOT DISTINCT FROM current_tenant; END $f$;
               REVOKE EXECUTE ON FUNCTION public.guard_probe_service() FROM PUBLIC, anon, authenticated;
               GRANT EXECUTE ON FUNCTION public.guard_probe_service() TO service_role;`);
    rep.check('tolerant-service-only', 'the same predicate in a service_role-only function passes the guard', guard(stack).code === 0);
    stack.sql(`DROP FUNCTION public.guard_probe_service()`);

    stack.sql(`CREATE TABLE public.guard_probe_later (id int)`);
    rep.eq('later-table', 'a table postgres creates after the pack grants authenticated no TRUNCATE, TRIGGER, REFERENCES or MAINTAIN', 'f',
      stack.sql(`SELECT has_table_privilege('authenticated', 'public.guard_probe_later', 'TRUNCATE,TRIGGER,REFERENCES,MAINTAIN')`).trim());
    stack.sql(`DROP TABLE public.guard_probe_later`);

    regress('up-extra-policy', 'an extra permissive policy that admits every row',
      `CREATE POLICY open_read ON dialog FOR SELECT TO authenticated USING (true)`,
      'policy open_read on public.dialog is not the tenant filter', { packFixes: false, cleanup: 'DROP POLICY open_read ON dialog' });
    regress('up-definer', 'a SECURITY DEFINER function authenticated can execute',
      `CREATE FUNCTION public.guard_probe_definer() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER AS 'SELECT count(*) FROM vcons';
       REVOKE EXECUTE ON FUNCTION public.guard_probe_definer() FROM PUBLIC, anon;
       GRANT EXECUTE ON FUNCTION public.guard_probe_definer() TO authenticated;`,
      'guard_probe_definer() is SECURITY DEFINER', { packFixes: false, cleanup: 'DROP FUNCTION public.guard_probe_definer()' });
    regress('up-anon-fn', 'a new function left executable by PUBLIC (and so anon)',
      `CREATE FUNCTION public.guard_probe_public() RETURNS int LANGUAGE sql STABLE AS 'SELECT 1'`,
      'anon can execute guard_probe_public()', { packFixes: false, cleanup: 'DROP FUNCTION public.guard_probe_public()' });
    regress('up-matview', 'a new materialized view readable by authenticated',
      `CREATE MATERIALIZED VIEW public.guard_probe_mv AS SELECT uuid, tenant_id FROM vcons; GRANT SELECT ON public.guard_probe_mv TO authenticated;`,
      'holds a privilege on public.guard_probe_mv', { packFixes: false, cleanup: 'DROP MATERIALIZED VIEW public.guard_probe_mv' });
    regress('up-new-table', 'a new tenant table with no policy',
      `CREATE TABLE public.guard_probe_t (id int PRIMARY KEY, tenant_id text); GRANT SELECT ON public.guard_probe_t TO authenticated;`,
      'public.guard_probe_t has row level security off', { packFixes: false, cleanup: 'DROP TABLE public.guard_probe_t' });

    // Item 6 fails loudly on a NULL branch it cannot rewrite.
    const s4 = snapshot(stack);
    // Same function, NULL branch written in another order: the rewrite cannot place it.
    const hasTags = upstream[Object.keys(upstream).find(k => k.startsWith('vcon_has_tags('))!];
    const reordered = hasTags.replace(/\(current_tenant IS NULL OR (\w+)\.tenant_id IS NULL OR \1\.tenant_id = current_tenant\)/g,
      '($1.tenant_id = current_tenant OR current_tenant IS NULL)');
    rep.check('loud-setup', 'built a vcon_has_tags body with a reordered NULL branch', reordered !== hasTags);
    stack.sql(`${reordered};`);
    const s5 = snapshot(stack);
    a = applyPack(stack);
    rep.check('loud-rewrite-exit', 'an unrecognised NULL branch stops the pack (exit 1), naming the function',
      a.code === 1 && a.out.includes('vcon_has_tags(uuid,jsonb) still has a NULL tenant branch'), `exit ${a.code}`);
    sameCatalog('loud-rewrite-unchanged', 'catalog unchanged by the failed run', s5, snapshot(stack));
    stack.sql(`${upstream[Object.keys(upstream).find(k => k.startsWith('vcon_has_tags('))!]};`);
    a = applyPack(stack);
    rep.check('loud-rewrite-recover', 'with the upstream body back, the pack applies and the guard passes', a.code === 0 && guard(stack).code === 0, `exit ${a.code}`);
    void s4;

    // The tag-and-date predicate cannot be placed in an unknown body.
    stack.sql(`
      CREATE OR REPLACE FUNCTION public.search_vcons_by_tags_and_date_count(tag_filter jsonb DEFAULT '{}'::jsonb, vcon_created_after timestamptz DEFAULT NULL,
        vcon_created_before timestamptz DEFAULT NULL, date_field text DEFAULT 'created') RETURNS bigint LANGUAGE sql STABLE AS $f$
        SELECT count(*) FROM vcons v WHERE v.created_at >= coalesce(vcon_created_after, '-infinity') $f$;`);
    a = applyPack(stack);
    rep.check('loud-predicate-exit', 'a tag-and-date body of unknown form stops the pack, naming it',
      a.code === 1 && a.out.includes('cannot place the tenant predicate in search_vcons_by_tags_and_date_count'), `exit ${a.code}`);
    stack.sql(`${upstream[Object.keys(upstream).find(k => k.startsWith('search_vcons_by_tags_and_date_count('))!]};`);
    a = applyPack(stack);
    rep.check('loud-predicate-recover', 'with the upstream body back, the pack applies and the guard passes', a.code === 0 && guard(stack).code === 0, `exit ${a.code}`);

    const s6 = snapshot(stack);
    a = applyPack(stack);
    rep.check('final-rerun', 'after all of that, one more run changes nothing', a.code === 0 && a.changes === 0, `${a.changes} changes`);
    sameCatalog('final-snapshot', 'catalog snapshot identical', s6, snapshot(stack));

    // ------------------------------------------------------------ 7
    rep.section('7. composite keys, as postgres with the tenant triggers off');
    const b = FIXTURES.B;
    const children: Array<[string, string]> = [
      ['parties', `INSERT INTO parties (id, vcon_id, party_index, name, tenant_id) VALUES ('eeeeeeee-0001-4000-8000-000000000001', '${b.uuid}', 7, 'planted', '%T%')`],
      ['dialog', `INSERT INTO dialog (id, vcon_id, dialog_index, type, tenant_id) VALUES ('eeeeeeee-0002-4000-8000-000000000001', '${b.uuid}', 7, 'text', '%T%')`],
      ['attachments', `INSERT INTO attachments (id, vcon_id, attachment_index, purpose, tenant_id) VALUES ('eeeeeeee-0004-4000-8000-000000000001', '${b.uuid}', 7, 'note', '%T%')`],
      ['analysis', `INSERT INTO analysis (id, vcon_id, analysis_index, type, vendor, tenant_id) VALUES ('eeeeeeee-0003-4000-8000-000000000001', '${b.uuid}', 7, 'summary', 'test', '%T%')`],
      ['groups', `INSERT INTO groups (id, vcon_id, group_index, encoding, tenant_id) VALUES ('eeeeeeee-0005-4000-8000-000000000001', '${b.uuid}', 7, 'json', '%T%')`],
      ['vcon_embeddings', `INSERT INTO vcon_embeddings (id, vcon_id, content_type, content_reference, content_text, embedding, embedding_model, embedding_dimension, tenant_id)
         SELECT 'eeeeeeee-0007-4000-8000-000000000001', '${b.uuid}', 'planted', '7', 'planted', embedding, 'test-model', 384, '%T%' FROM vcon_embeddings LIMIT 1`],
      ['embedding_queue', `INSERT INTO embedding_queue (vcon_id, tenant_id) VALUES ('${b.uuid}', '%T%')`],
      ['s3_sync_tracking', `DELETE FROM s3_sync_tracking WHERE vcon_id = '${b.uuid}'; INSERT INTO s3_sync_tracking (vcon_id, vcon_uuid, s3_key, tenant_id) VALUES ('${b.uuid}', '${b.uuid}', 'planted', '%T%')`],
      ['party_history', `INSERT INTO party_history (id, dialog_id, party_index, time, event, tenant_id) VALUES ('eeeeeeee-0006-4000-8000-000000000001', '${rowId(b, 'dialog')}', 7, now(), 'join', '%T%')`],
    ];
    for (const [tbl, ins] of children) {
      const wrap = (tenant: string) => `BEGIN; ALTER TABLE ${tbl} DISABLE TRIGGER USER; ${ins.replace('%T%', tenant)}; ROLLBACK;`;
      expectSqlError(`key-${tbl}`, `${tbl}: a tenant A row under tenant B's ${tbl === 'party_history' ? 'dialog' : 'vCon'} is refused`, stack, wrap(TENANT_A), 'violates foreign key constraint');
      const ok = stack.trySql(wrap(TENANT_B));
      rep.check(`key-${tbl}-ok`, `${tbl}: the same row with tenant B is accepted (the key, not the row, refused it)`, ok.ok, ok.ok ? '' : ok.out.trim().slice(-200));
    }

    rep.section('7b. a tenant move cascades to every child');
    const q = FIXTURES.Q;
    const childCounts = (tenant: string) => stack.sql(`SELECT ${[...VCON_CHILDREN.map(t => `(SELECT count(*) FROM ${t} WHERE vcon_id = '${q.uuid}' AND tenant_id = '${tenant}')`),
      `(SELECT count(*) FROM party_history WHERE dialog_id = '${rowId(q, 'dialog')}' AND tenant_id = '${tenant}')`].join(' || \',\' || ')}`).trim();
    const before = childCounts(QUARANTINE);
    const moved = stack.trySql(`SELECT release_vcon_from_quarantine('${q.uuid}', '${TENANT_A}', 'test release', '{"check":"fixture"}', 'test')`);
    rep.check('move-ok', 'release_vcon_from_quarantine moves a vCon out of quarantine under the composite keys', moved.ok, moved.ok ? '' : moved.out.trim().slice(-200));
    rep.eq('move-log', 'and logs the release', '1', stack.sql(`SELECT count(*) FROM tenant_quarantine_releases WHERE vcon_uuid = '${q.uuid}' AND to_tenant = '${TENANT_A}'`).trim());
    rep.eq('move-children', 'every child row follows it (counts per child table, then party_history)', before, childCounts(TENANT_A));
    stack.sql(`UPDATE vcons SET tenant_id = '${QUARANTINE}' WHERE uuid = '${q.uuid}'`);
    rep.eq('move-back', 'and back', before, childCounts(QUARANTINE));
    expectSqlError('notnull-svc', 'service-level insert of a vCon with no tenant is refused', stack,
      `INSERT INTO vcons (id, uuid, vcon_version, tenant_id) VALUES ('eeeeeeee-0000-4000-8000-000000000009', 'eeeeeeee-0000-4000-8000-000000000009', '0.4.0', NULL)`,
      'violates not-null constraint');
    expectSqlError('empty-svc', 'service-level insert of a vCon with an empty tenant is refused', stack,
      `INSERT INTO vcons (id, uuid, vcon_version, tenant_id) VALUES ('eeeeeeee-0000-4000-8000-000000000009', 'eeeeeeee-0000-4000-8000-000000000009', '0.4.0', '')`,
      'vcons_tenant_id_not_empty');
  } finally {
    await stack.stop();
  }
  return rep.summary('catalog guard summary');
}

main().then(code => process.exit(code), e => { console.error(e); process.exit(2); });
