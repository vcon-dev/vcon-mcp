-- Strict pack: fail-closed row-level security for multi-tenant deployments.
--
-- Tier 2 of the tenant hardening. Tier 1 is migration
-- 20261109163739_revoke_anon_read_paths.sql, which every deployment gets.
-- This file is not a migration: `supabase db push` reads supabase/migrations
-- only, so nothing here applies unless an operator runs it. Run it through
-- supabase/strict/apply.sh, which wraps it and catalog_guard.sql in one
-- transaction. Re-run it after every upgrade: a migration can CREATE OR
-- REPLACE a search function and bring a NULL branch back.
--
-- What it changes (docs/guide/strict-tenant-pack.md has the long form). Items
-- 3 and 7, the SECURITY DEFINER and anon revokes, are in the tier 1 migration.
-- Needs PostgreSQL 15 or later.
--
--   0. Refuses, changing nothing, while any tenant table holds a row with no
--      tenant, or a child row whose tenant differs from its parent's.
--   1. One policy per tenant table, for `authenticated` only:
--      tenant_id = (SELECT get_current_tenant_id()), no NULL branch, for USING
--      and WITH CHECK. RLS is enabled and forced.
--  1b. Tenant roles read and delete, nothing else. `authenticated` keeps
--      SELECT and DELETE on the tenant tables and SELECT on views. PUBLIC,
--      anon and authenticated lose TRUNCATE, TRIGGER, REFERENCES and MAINTAIN
--      on every table and view, now and (by default privileges) later. They
--      execute no VOLATILE function, so no RPC that writes.
--  1c. The trigger that refreshes conversation_start after a dialog or
--      attachment delete runs as its owner, so a tenant's delete still works.
--   2. get_current_tenant_id() reads the signed JWT claim only. An empty
--      claim, a missing claim and `_quarantine` all mean no tenant. The
--      app.current_tenant_id session fallback is gone.
--   4. Every view runs as the caller (security_invoker), as tier 1 set for
--      the views that existed then.
--   5. vcon_tags_scoped: the tag view filtered to the caller's tenant.
--      `authenticated` reads it and loses vcon_tags_mv. Functions meant for
--      service_role only (exec_sql, the tag refresh, the tenant backfills,
--      release_vcon_from_quarantine and others) are taken back if granted.
--      Its owner is pinned to the materialized view's.
--   6. Search and tag RPCs: the NULL branches are removed and the tag joins
--      read vcon_tags_scoped. search_vcons_by_tags_and_date and its count gain
--      a tenant predicate. A function the rewrite cannot place aborts the run.
--   8. `authenticated` loses vkong.vcons, which has no tenant column. The
--      always-false embedding_queue policy, which granted nothing, is dropped.
--   9. tenant_id is NOT NULL and never empty on every tenant table. These hold
--      for service_role too.
--  10. Composite keys: every child references its parent by (id, tenant_id),
--      so a tenant cannot attach a row to another tenant's vCon.
--
-- Every step checks the catalog first and does nothing when its object is
-- already in the strict state, so a second run changes nothing. Each change
-- prints a NOTICE starting `strict-pack: changed:`.

SET LOCAL lock_timeout = '10s';
SET LOCAL client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- 0. Preflight. Refuse rather than hide rows.
-- ---------------------------------------------------------------------------
DO $strict$
DECLARE
  tenant_tables constant text[] := ARRAY['vcons', 'parties', 'dialog', 'attachments', 'analysis', 'groups',
    'party_history', 'vcon_embeddings', 'embedding_queue', 's3_sync_tracking'];
  vcon_children constant text[] := ARRAY['parties', 'dialog', 'attachments', 'analysis', 'groups',
    'vcon_embeddings', 'embedding_queue', 's3_sync_tracking'];
  problems text[] := '{}';
  t text;
  n bigint;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'strict-pack: refused: PostgreSQL 15 or later is required (views need security_invoker)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'strict-pack: refused: role authenticated does not exist; this is not a Supabase-shaped database';
  END IF;

  FOREACH t IN ARRAY tenant_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || t)
                   AND attname = 'tenant_id' AND NOT attisdropped) THEN
      problems := problems || format('public.%s.tenant_id is missing', t);
    END IF;
  END LOOP;
  IF to_regclass('public.vcon_tags_mv') IS NULL THEN
    problems := problems || 'public.vcon_tags_mv is missing'::text;
  END IF;
  IF to_regprocedure('public.exec_sql(text, jsonb)') IS NOT NULL
     AND has_function_privilege('authenticated', 'public.exec_sql(text, jsonb)', 'EXECUTE') THEN
    problems := problems || 'tier 1 is not applied (authenticated can execute exec_sql); apply migration 20261109163739_revoke_anon_read_paths.sql first'::text;
  END IF;
  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'strict-pack: refused: the schema is older than this pack expects: %. Apply the migrations first.',
      array_to_string(problems, '; ');
  END IF;

  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL OR tenant_id = %L', t, '') INTO n;
    IF n > 0 THEN
      problems := problems || format('%s has %s row(s) with no tenant', t, n);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY vcon_children LOOP
    EXECUTE format('SELECT count(*) FROM public.%I c JOIN public.vcons v ON v.uuid = c.vcon_id
                    WHERE c.tenant_id IS DISTINCT FROM v.tenant_id', t) INTO n;
    IF n > 0 THEN
      problems := problems || format('%s has %s row(s) whose tenant differs from their vCon''s', t, n);
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.party_history h JOIN public.dialog d ON d.id = h.dialog_id
   WHERE h.tenant_id IS DISTINCT FROM d.tenant_id;
  IF n > 0 THEN
    problems := problems || format('party_history has %s row(s) whose tenant differs from their dialog''s', n);
  END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'strict-pack: refused: %. Nothing was changed. Assign every row a tenant (or `_quarantine`) and give each child its parent''s tenant, then run the pack again.',
      array_to_string(problems, '; ');
  END IF;
END $strict$;

-- ---------------------------------------------------------------------------
-- 2. Tenant from the signed claim only.
-- ---------------------------------------------------------------------------
DO $strict$
DECLARE
  want constant text := $body$
  SELECT nullif(nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id', ''), '_quarantine')
$body$;
  note constant text := 'Tenant of the current request, from the signed JWT claim tenant_id only. No claim, an empty claim and _quarantine all return NULL, which matches no row. Set by supabase/strict/strict_pack.sql.';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = to_regprocedure('public.get_current_tenant_id()')
       AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
       AND p.prosrc = want AND NOT p.prosecdef AND p.provolatile = 's' AND p.proconfig IS NULL
       AND p.prorettype = 'text'::regtype)
  THEN
    EXECUTE format('CREATE OR REPLACE FUNCTION public.get_current_tenant_id() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER AS %L', want);
    RAISE NOTICE 'strict-pack: changed: get_current_tenant_id() reads the JWT claim only';
  END IF;
  IF obj_description('public.get_current_tenant_id()'::regprocedure, 'pg_proc') IS DISTINCT FROM note THEN
    EXECUTE format('COMMENT ON FUNCTION public.get_current_tenant_id() IS %L', note);
    RAISE NOTICE 'strict-pack: changed: comment on get_current_tenant_id()';
  END IF;
END $strict$;

-- ---------------------------------------------------------------------------
-- 1. One fail-closed policy per tenant table.
-- ---------------------------------------------------------------------------
DO $strict$
DECLARE
  tenant_tables constant text[] := ARRAY['vcons', 'parties', 'dialog', 'attachments', 'analysis', 'groups',
    'party_history', 'vcon_embeddings', 'embedding_queue', 's3_sync_tracking'];
  -- pg_get_expr output for tenant_id = (SELECT get_current_tenant_id())
  strict_expr constant text := '^\(tenant_id = \( SELECT (public\.)?get_current_tenant_id\(\) AS get_current_tenant_id\)\)$';
  t text;
  rel regclass;
  pol text;
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    rel := ('public.' || quote_ident(t))::regclass;
    pol := t || '_tenant_isolation';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
       WHERE p.polrelid = rel AND p.polname = pol AND p.polcmd = '*' AND p.polpermissive
         AND p.polroles = ARRAY['authenticated'::regrole::oid]
         AND pg_get_expr(p.polqual, p.polrelid) ~ strict_expr
         AND pg_get_expr(p.polwithcheck, p.polrelid) ~ strict_expr)
    THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
      EXECUTE format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO authenticated
                        USING (tenant_id = (SELECT public.get_current_tenant_id()))
                        WITH CHECK (tenant_id = (SELECT public.get_current_tenant_id()))', pol, t);
      RAISE NOTICE 'strict-pack: changed: policy %.% has no NULL branch', t, pol;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = rel) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      RAISE NOTICE 'strict-pack: changed: % row level security enabled', t;
    END IF;
    -- FORCE binds the table owner too. postgres and service_role have
    -- BYPASSRLS, which beats it; it is here so an owner without that
    -- attribute is still bound.
    IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = rel) THEN
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
      RAISE NOTICE 'strict-pack: changed: % row level security forced', t;
    END IF;
  END LOOP;
END $strict$;

-- ---------------------------------------------------------------------------
-- 4. Views run as the caller, so row level security applies to the caller.
--    Tier 1 set this on the two views that existed; an upgrade can recreate a
--    view without it, so the pack re-asserts it on every view but its own.
-- ---------------------------------------------------------------------------
DO $strict$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS v
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'vkong') AND c.relkind = 'v'
       AND NOT (n.nspname = 'public' AND c.relname = 'vcon_tags_scoped')
       AND coalesce((SELECT lower(option_value) FROM pg_options_to_table(c.reloptions)
                      WHERE option_name = 'security_invoker'), 'false') NOT IN ('true', 'on', '1', 'yes')
     ORDER BY 1::text
  LOOP
    EXECUTE format('ALTER VIEW %s SET (security_invoker = true)', r.v);
    RAISE NOTICE 'strict-pack: changed: view % runs as the caller', r.v;
  END LOOP;
END $strict$;

-- ---------------------------------------------------------------------------
-- 1b. Table privileges: tenant roles read and delete their rows, nothing else.
--     Row level security does not govern TRUNCATE, and TRIGGER, REFERENCES and
--     MAINTAIN (LOCK, VACUUM, REFRESH) act on a table without reading a row, so
--     PUBLIC, anon and authenticated lose all four on every relation in public
--     and vkong, and on tables postgres creates there later. On the tenant
--     tables authenticated also loses INSERT and UPDATE: a tenant's one write
--     is delete_vcon, and an insert told a tenant whether another tenant's
--     uuid existed and let it claim a uuid before the writer stored it. Views
--     keep SELECT only.
-- ---------------------------------------------------------------------------
DO $strict$
DECLARE
  tenant_tables constant text[] := ARRAY['vcons', 'parties', 'dialog', 'attachments', 'analysis', 'groups',
    'party_history', 'vcon_embeddings', 'embedding_queue', 's3_sync_tracking'];
  noread constant text[] := ARRAY['TRUNCATE', 'TRIGGER', 'REFERENCES']
    || CASE WHEN current_setting('server_version_num')::int >= 170000 THEN ARRAY['MAINTAIN'] ELSE '{}'::text[] END;
  roles constant oid[] := ARRAY[0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid];
  r record;
  t text;
  rel regclass;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS rel
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'vkong') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = ANY (roles) AND a.privilege_type = ANY (noread))
     ORDER BY 1::text
  LOOP
    EXECUTE format('REVOKE %s ON %s FROM PUBLIC, anon, authenticated', array_to_string(noread, ', '), r.rel);
    RAISE NOTICE 'strict-pack: changed: PUBLIC, anon and authenticated lose % on %', array_to_string(noread, ', '), r.rel;
  END LOOP;

  FOREACH t IN ARRAY tenant_tables LOOP
    rel := ('public.' || quote_ident(t))::regclass;
    IF has_any_column_privilege('authenticated', rel, 'INSERT,UPDATE') OR has_any_column_privilege('anon', rel, 'INSERT,UPDATE') THEN
      EXECUTE format('REVOKE INSERT, UPDATE ON public.%I FROM PUBLIC, anon, authenticated', t);
      RAISE NOTICE 'strict-pack: changed: authenticated cannot insert into or update %', t;
    END IF;
    IF NOT has_table_privilege('authenticated', rel, 'SELECT') OR NOT has_table_privilege('authenticated', rel, 'DELETE') THEN
      EXECUTE format('GRANT SELECT, DELETE ON public.%I TO authenticated', t);
      RAISE NOTICE 'strict-pack: changed: authenticated reads and deletes its own rows of %', t;
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.oid::regclass AS rel
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'vkong') AND c.relkind = 'v'
       AND (has_any_column_privilege('authenticated', c.oid, 'INSERT,UPDATE') OR has_table_privilege('authenticated', c.oid, 'DELETE')
            OR has_any_column_privilege('anon', c.oid, 'INSERT,UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'))
     ORDER BY 1::text
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %s FROM PUBLIC, anon, authenticated', r.rel);
    RAISE NOTICE 'strict-pack: changed: view % is read-only for authenticated', r.rel;
  END LOOP;

  -- Tables postgres creates in public later. Changing postgres's defaults
  -- needs postgres or a member of it, which is who runs Supabase migrations.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres')
     AND EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a
                  WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace
                    AND d.defaclobjtype = 'r' AND a.grantee = ANY (roles) AND a.privilege_type = ANY (noread)) THEN
    IF pg_has_role(current_user, 'postgres', 'MEMBER') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE %s ON TABLES FROM PUBLIC, anon, authenticated',
        array_to_string(noread, ', '));
      RAISE NOTICE 'strict-pack: changed: tables postgres creates in public later grant no %', array_to_string(noread, ', ');
    ELSE
      RAISE NOTICE 'strict-pack: % cannot change default privileges for postgres; new tables will need the pack re-run', current_user;
    END IF;
  END IF;
END $strict$;

-- ---------------------------------------------------------------------------
-- 1c. Deleting a dialog or attachment row refreshes its vCon's
--     conversation_start through a statement trigger that runs as the caller
--     and updates vcons. Tenant roles no longer update anything, so a tenant's
--     delete_vcon would fail in that trigger. It runs as its owner instead,
--     with search_path pinned to public, pg_temp; the owner must have
--     BYPASSRLS (postgres has it on Supabase). It recomputes only
--     the vCons whose rows the caller has just changed, which row level
--     security already limited. A trigger needs no EXECUTE grant to fire, so
--     tenant roles lose that.
-- ---------------------------------------------------------------------------
DO $strict$
DECLARE
  fn regprocedure := to_regprocedure('public.child_refresh_conversation_start()');
  table_owner regrole := (SELECT relowner::regrole FROM pg_class WHERE oid = 'public.vcons'::regclass);
BEGIN
  IF fn IS NULL THEN
    RETURN;
  END IF;
  -- Its owner must bypass row level security, or the refresh it runs as that
  -- owner is bound by the tenant policies. Hand it to the owner of vcons.
  IF NOT (SELECT r.rolbypassrls OR r.rolsuper FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.oid = fn) THEN
    IF NOT (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE oid = table_owner) THEN
      RAISE EXCEPTION 'strict-pack: refused: child_refresh_conversation_start() must be owned by a role with BYPASSRLS, and the owner of vcons (%) has none', table_owner;
    END IF;
    EXECUTE format('ALTER FUNCTION public.child_refresh_conversation_start() OWNER TO %s', table_owner);
    RAISE NOTICE 'strict-pack: changed: child_refresh_conversation_start() owned by %, which bypasses row level security', table_owner;
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = fn)
     OR (SELECT proconfig FROM pg_proc WHERE oid = fn) IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    ALTER FUNCTION public.child_refresh_conversation_start() SECURITY DEFINER SET search_path = public, pg_temp;
    RAISE NOTICE 'strict-pack: changed: child_refresh_conversation_start() runs as its owner';
  END IF;
  IF has_function_privilege('authenticated', fn, 'EXECUTE') OR has_function_privilege('anon', fn, 'EXECUTE') THEN
    REVOKE EXECUTE ON FUNCTION public.child_refresh_conversation_start() FROM PUBLIC, anon, authenticated;
    RAISE NOTICE 'strict-pack: changed: anon and authenticated cannot execute child_refresh_conversation_start() directly';
  END IF;
END $strict$;

-- ---------------------------------------------------------------------------
-- 5. A tenant-filtered view over the tag materialized view, which cannot
--    carry RLS. It runs as its owner, so it can read vcon_tags_mv, and filters
--    to the caller's tenant. security_barrier keeps caller predicates from
--    running ahead of the tenant filter.
-- ---------------------------------------------------------------------------
DO $strict$
DECLARE
  -- pg_get_viewdef output with whitespace collapsed and schema and table
  -- qualifiers removed, so the check holds whatever the search_path.
  scoped_def constant text := 'SELECT tenant_id, vcon_id, tags, tag_updated_at, tag_created_at FROM vcon_tags_mv WHERE (tenant_id = ( SELECT get_current_tenant_id() AS get_current_tenant_id));';
  rel regclass := to_regclass('public.vcon_tags_scoped');
BEGIN
  IF rel IS NULL
     OR (SELECT relkind FROM pg_class WHERE oid = rel) <> 'v'
     OR btrim(regexp_replace(regexp_replace(pg_get_viewdef(rel), '\s+', ' ', 'g'), '(public|vcon_tags_mv)\.', '', 'g')) <> scoped_def
     OR coalesce((SELECT lower(option_value) FROM pg_class c, pg_options_to_table(c.reloptions)
                   WHERE c.oid = rel AND option_name = 'security_barrier'), 'false') NOT IN ('true', 'on', '1', 'yes')
  THEN
    IF rel IS NOT NULL THEN
      EXECUTE 'DROP VIEW public.vcon_tags_scoped';
    END IF;
    CREATE VIEW public.vcon_tags_scoped WITH (security_barrier = true) AS
      SELECT tenant_id, vcon_id, tags, tag_updated_at, tag_created_at
        FROM public.vcon_tags_mv
       WHERE tenant_id = (SELECT public.get_current_tenant_id());
    COMMENT ON VIEW public.vcon_tags_scoped IS
      'vcon_tags_mv rows of the caller''s tenant only. Runs as its owner on purpose; the catalog guard checks its filter. Set by supabase/strict/strict_pack.sql.';
    RAISE NOTICE 'strict-pack: changed: view vcon_tags_scoped created';
  END IF;
  -- It reads vcon_tags_mv with its owner's privileges, so its owner is pinned
  -- to the materialized view's.
  IF (SELECT relowner FROM pg_class WHERE oid = 'public.vcon_tags_scoped'::regclass)
     <> (SELECT relowner FROM pg_class WHERE oid = 'public.vcon_tags_mv'::regclass) THEN
    EXECUTE format('ALTER VIEW public.vcon_tags_scoped OWNER TO %s',
      (SELECT relowner::regrole FROM pg_class WHERE oid = 'public.vcon_tags_mv'::regclass));
    RAISE NOTICE 'strict-pack: changed: vcon_tags_scoped owned by the owner of vcon_tags_mv';
  END IF;
END $strict$;

-- Grants: tenant roles read the scoped view only. service_role keeps the
-- materialized view, which the writer refreshes and reads.
DO $strict$
DECLARE
  rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['public.vcon_tags_mv', 'public.vcon_tags_scoped'] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
                WHERE c.oid = rel::regclass
                  AND a.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
                  AND NOT (rel = 'public.vcon_tags_scoped' AND a.grantee = 'authenticated'::regrole::oid AND a.privilege_type = 'SELECT')) THEN
      EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon, authenticated', rel);
      RAISE NOTICE 'strict-pack: changed: PUBLIC, anon and authenticated lose % (beyond SELECT on the scoped view)', rel;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.vcon_tags_scoped', 'SELECT') THEN
    GRANT SELECT ON public.vcon_tags_scoped TO authenticated;
    RAISE NOTICE 'strict-pack: changed: authenticated reads vcon_tags_scoped';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.vcon_tags_scoped', 'SELECT') THEN
    GRANT SELECT ON public.vcon_tags_scoped TO service_role;
    RAISE NOTICE 'strict-pack: changed: service_role reads vcon_tags_scoped';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.vcon_tags_mv', 'SELECT') THEN
    GRANT SELECT ON public.vcon_tags_mv TO service_role;
    RAISE NOTICE 'strict-pack: changed: service_role reads vcon_tags_mv';
  END IF;
END $strict$;

-- Functions tenant roles may execute. None of the service-only list: tier 1
-- and the writer migrations limit these to service_role (SQL as the owner, the
-- session fallback, the health metrics, the tag refresh, the tenant backfills,
-- the release from quarantine), and a later GRANT would reopen one. And no
-- VOLATILE function, the only kind PostgreSQL lets write: save_vcon_batch,
-- remove_vcon_child_and_compact and the like. The search and tag RPCs are
-- STABLE and stay. Trigger functions are never called directly; left alone.
DO $strict$
DECLARE
  service_only constant text[] := ARRAY['exec_sql', 'explain_query', 'set_tenant_context', 'clear_tenant_context',
    'get_connection_metrics', 'get_index_health', 'get_performance_metrics', 'get_storage_efficiency',
    'refresh_vcon_tags_mv', 'refresh_vcon_tags_mv_if_stale', 'backfill_tenant_id_batch', 'backfill_vcon_tenant_ids',
    'vcon_tenant_stamp', 'release_vcon_from_quarantine'];
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname = ANY (service_only) AS svc
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
       AND (p.proname = ANY (service_only)
            OR (p.provolatile = 'v' AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)))
       AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))
     ORDER BY 1::text
  LOOP
    IF has_function_privilege('service_role', r.sig, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role', r.sig);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC, anon, authenticated', r.sig);
    RAISE NOTICE 'strict-pack: changed: anon and authenticated cannot execute % (%)', r.sig,
      CASE WHEN r.svc THEN 'service_role only' ELSE 'volatile: it may write' END;
  END LOOP;
END $strict$;

-- ---------------------------------------------------------------------------
-- 6. RPC bodies: drop the NULL branches and read the scoped tag view.
-- ---------------------------------------------------------------------------
DO $strict$
DECLARE
  r record;
  def text;
  newdef text;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.prokind = 'f'
       AND p.proname NOT LIKE 'refresh\_vcon\_tags\_mv%'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
       AND (p.prosrc ~* 'current_tenant\s+IS\s+NULL' OR p.prosrc ~ '\mvcon_tags_mv\M')
     ORDER BY 2::text
  LOOP
    def := pg_get_functiondef(r.oid);
    newdef := regexp_replace(def,
      '\(current_tenant\s+IS\s+NULL\s+OR\s+(\w+)\.tenant_id\s+IS\s+NULL\s+OR\s+\1\.tenant_id\s*=\s*current_tenant\)',
      '(\1.tenant_id = current_tenant)', 'gi');
    newdef := regexp_replace(newdef, '\mvcon_tags_mv\M', 'vcon_tags_scoped', 'g');
    IF newdef ~* 'current_tenant\s+IS\s+NULL' OR newdef ~* '\mtenant_id\s+IS\s+NULL' THEN
      RAISE EXCEPTION 'strict-pack: % still has a NULL tenant branch after the rewrite: its form is not one this pack recognises. Nothing was changed. Fix the function or extend item 6 of supabase/strict/strict_pack.sql.', r.sig;
    END IF;
    IF newdef = def THEN
      RAISE EXCEPTION 'strict-pack: % was selected for the rewrite but nothing in it matched. Nothing was changed.', r.sig;
    END IF;
    EXECUTE newdef;
    n := n + 1;
    RAISE NOTICE 'strict-pack: changed: % rewritten (no NULL branch, scoped tag view)', r.sig;
  END LOOP;
END $strict$;

-- search_vcons_by_tags_and_date and its count read vcons with no tenant
-- predicate. RLS covers `authenticated`; the predicate also binds callers that
-- bypass RLS, so service_role gets rows only with a tenant claim, as the
-- keyword search already does.
DO $strict$
DECLARE
  r record;
  def text;
  newdef text;
  n_from int;
  n_pred int;
  n_slot int;
  pred constant text := 'v.tenant_id = (SELECT public.get_current_tenant_id())';
  slot constant text := '(FROM vcons v\s+LEFT JOIN vcon_tags_scoped ta ON ta\.vcon_id = v\.id\s+WHERE )';
  found int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname IN ('search_vcons_by_tags_and_date', 'search_vcons_by_tags_and_date_count')
     ORDER BY 2::text
  LOOP
    found := found + 1;
    def := pg_get_functiondef(r.oid);
    n_from := regexp_count(def, '\mFROM\s+vcons\s+v\M');
    n_pred := regexp_count(def, 'v\.tenant_id = \(SELECT (public\.)?get_current_tenant_id\(\)\)');
    CONTINUE WHEN n_from > 0 AND n_pred = n_from;
    n_slot := regexp_count(def, slot);
    IF n_from = 0 OR n_pred <> 0 OR n_slot <> n_from THEN
      RAISE EXCEPTION 'strict-pack: cannot place the tenant predicate in %: % read(s) of vcons, % with the predicate, % in the expected form. Nothing was changed. Update supabase/strict/strict_pack.sql for the new body.',
        r.sig, n_from, n_pred, n_slot;
    END IF;
    newdef := regexp_replace(def, slot, '\1' || pred || E'\n    AND ', 'g');
    EXECUTE newdef;
    RAISE NOTICE 'strict-pack: changed: % carries a tenant predicate', r.sig;
  END LOOP;
  IF found = 0 THEN
    RAISE NOTICE 'strict-pack: search_vcons_by_tags_and_date is not in this schema; no predicate to add';
  END IF;
END $strict$;

-- ---------------------------------------------------------------------------
-- 8. vkong.vcons has no tenant column and no RLS. The false policy on
--    embedding_queue was ORed with the tenant policy and never blocked a row.
-- ---------------------------------------------------------------------------
DO $strict$
BEGIN
  IF to_regclass('vkong.vcons') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'vkong.vcons'::regclass
                  AND a.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)) THEN
    REVOKE ALL ON vkong.vcons FROM PUBLIC, anon, authenticated;
    RAISE NOTICE 'strict-pack: changed: PUBLIC, anon and authenticated lose vkong.vcons';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.embedding_queue'::regclass
             AND polname = 'no_user_access_embedding_queue') THEN
    DROP POLICY no_user_access_embedding_queue ON public.embedding_queue;
    RAISE NOTICE 'strict-pack: changed: policy no_user_access_embedding_queue dropped';
  END IF;
END $strict$;

-- ---------------------------------------------------------------------------
-- 9. Backstops that hold even for service_role.
-- ---------------------------------------------------------------------------
DO $strict$
DECLARE
  tenant_tables constant text[] := ARRAY['vcons', 'parties', 'dialog', 'attachments', 'analysis', 'groups',
    'party_history', 'vcon_embeddings', 'embedding_queue', 's3_sync_tracking'];
  t text;
  rel regclass;
  con text;
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    rel := ('public.' || quote_ident(t))::regclass;
    IF NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid = rel AND attname = 'tenant_id') THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET NOT NULL', t);
      RAISE NOTICE 'strict-pack: changed: %.tenant_id NOT NULL', t;
    END IF;
    con := t || '_tenant_id_not_empty';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = rel AND conname = con AND contype = 'c'
                   AND convalidated AND pg_get_constraintdef(oid) = 'CHECK ((tenant_id <> ''''::text))') THEN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = rel AND conname = con) THEN
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, con);
      END IF;
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (tenant_id <> %L)', t, con, '');
      RAISE NOTICE 'strict-pack: changed: %.tenant_id never empty', t;
    END IF;
  END LOOP;
END $strict$;

-- ---------------------------------------------------------------------------
-- 10. Composite keys. A child row names its parent and its tenant together,
--     so a row of tenant A cannot hang off tenant B's vCon, an insert cannot
--     probe for another tenant's uuid, and a foreign child cannot block a
--     write by occupying an index. ON UPDATE CASCADE carries a tenant move
--     (out of quarantine, say) to every child.
-- ---------------------------------------------------------------------------
DO $strict$
DECLARE
  -- child table, its key column, parent table, parent key column
  links constant text[][] := ARRAY[
    ARRAY['parties', 'vcon_id', 'vcons', 'uuid'],
    ARRAY['dialog', 'vcon_id', 'vcons', 'uuid'],
    ARRAY['attachments', 'vcon_id', 'vcons', 'uuid'],
    ARRAY['analysis', 'vcon_id', 'vcons', 'uuid'],
    ARRAY['groups', 'vcon_id', 'vcons', 'uuid'],
    ARRAY['vcon_embeddings', 'vcon_id', 'vcons', 'uuid'],
    ARRAY['embedding_queue', 'vcon_id', 'vcons', 'uuid'],
    ARRAY['s3_sync_tracking', 'vcon_id', 'vcons', 'uuid'],
    ARRAY['party_history', 'dialog_id', 'dialog', 'id']];
  parent_keys constant text[][] := ARRAY[
    ARRAY['vcons', 'uuid', 'vcons_uuid_tenant_key'],
    ARRAY['dialog', 'id', 'dialog_id_tenant_key']];
  i int;
  child text; ckey text; parent text; pkey text; fk text; want text;
  c record;
BEGIN
  FOR i IN 1 .. array_length(parent_keys, 1) LOOP
    parent := parent_keys[i][1]; pkey := parent_keys[i][2]; fk := parent_keys[i][3];
    want := format('UNIQUE (%s, tenant_id)', pkey);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || parent)::regclass
                   AND conname = fk AND pg_get_constraintdef(oid) = want) THEN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || parent)::regclass AND conname = fk) THEN
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', parent, fk);
      END IF;
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (%I, tenant_id)', parent, fk, pkey);
      RAISE NOTICE 'strict-pack: changed: % unique (%, tenant_id)', parent, pkey;
    END IF;
  END LOOP;

  FOR i IN 1 .. array_length(links, 1) LOOP
    child := links[i][1]; ckey := links[i][2]; parent := links[i][3]; pkey := links[i][4];
    fk := child || '_' || CASE parent WHEN 'vcons' THEN 'vcon' ELSE parent END || '_tenant_fkey';
    want := format('FOREIGN KEY (%s, tenant_id) REFERENCES %s(%s, tenant_id) ON UPDATE CASCADE ON DELETE CASCADE', ckey, parent, pkey);
    -- Any other key from this child to the parent that leaves tenant_id out is
    -- implied by the composite one, and keeping it would let a later upgrade
    -- recreate the gap unnoticed. Drop it.
    FOR c IN
      SELECT conname FROM pg_constraint
       WHERE conrelid = ('public.' || child)::regclass AND contype = 'f'
         AND confrelid = ('public.' || parent)::regclass AND conname <> fk
         AND NOT (conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = ('public.' || child)::regclass AND attname = 'tenant_id')])
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', child, c.conname);
      RAISE NOTICE 'strict-pack: changed: % dropped %, replaced by %', child, c.conname, fk;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || child)::regclass
                   AND conname = fk AND convalidated
                   AND regexp_replace(pg_get_constraintdef(oid), 'public\.', '', 'g') = want) THEN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || child)::regclass AND conname = fk) THEN
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', child, fk);
      END IF;
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I, tenant_id) REFERENCES public.%I (%I, tenant_id) ON UPDATE CASCADE ON DELETE CASCADE',
        child, fk, ckey, parent, pkey);
      RAISE NOTICE 'strict-pack: changed: % references % by (%, tenant_id)', child, parent, pkey;
    END IF;
  END LOOP;
END $strict$;
