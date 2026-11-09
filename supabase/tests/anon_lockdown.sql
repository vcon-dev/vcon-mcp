-- Verification for migration 20261109163739_revoke_anon_read_paths.sql:
-- anon reaches no table, view, materialized view or function in public, the
-- SECURITY DEFINER helpers are closed to authenticated, and service_role keeps
-- what the server calls.
--
-- Run against a database where the migration chain has been applied, as a
-- role that can SET ROLE to anon, authenticated and service_role (postgres on
-- Supabase):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/anon_lockdown.sql
--
-- Read-only: everything runs in one transaction that is rolled back. Any
-- failure raises an exception naming the check. A function added by a later
-- migration without REVOKE EXECUTE ... FROM PUBLIC, anon fails check 2.
-- scripts/test-anon-lockdown.sh repeats these checks through PostgREST.

\set ON_ERROR_STOP on

BEGIN;

\o /dev/null

-- Runs p_sql as p_role and fails unless the database refuses it.
CREATE FUNCTION pg_temp.expect_denied(p_role text, p_sql text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  refused boolean := false;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    refused := true;
  END;
  RESET ROLE;
  IF NOT refused THEN
    RAISE EXCEPTION 'anon_lockdown check failed [%]: % was allowed to run: %', p_label, p_role, p_sql;
  END IF;
END;
$$;

-- Runs p_sql as p_role and fails if the database refuses it.
CREATE FUNCTION pg_temp.expect_allowed(p_role text, p_sql text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  err text;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    err := SQLERRM;
  END;
  RESET ROLE;
  IF err IS NOT NULL THEN
    RAISE EXCEPTION 'anon_lockdown check failed [%]: % was refused: % (%)', p_label, p_role, p_sql, err;
  END IF;
END;
$$;

DO $$
DECLARE
  bad text;
BEGIN
  -- 1. anon holds no privilege on any relation in public.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'anon_lockdown check failed [1 anon relations]: anon still holds privileges on %', bad;
  END IF;

  -- 2. anon can execute no function in public, other than extension members.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'anon_lockdown check failed [2 anon functions]: anon can execute % (add REVOKE EXECUTE ... FROM PUBLIC, anon)', bad;
  END IF;

  -- 3. The SECURITY DEFINER helpers: closed to authenticated, open to service_role.
  SELECT string_agg(f, ', ') INTO bad
  FROM unnest(ARRAY[
    'public.exec_sql(text, jsonb)', 'public.exec_sql(jsonb, text)', 'public.explain_query(text, boolean)',
    'public.set_tenant_context(text)', 'public.clear_tenant_context()', 'public.get_connection_metrics()',
    'public.get_index_health()', 'public.get_performance_metrics()', 'public.get_storage_efficiency()'
  ]) AS f
  WHERE to_regprocedure(f) IS NOT NULL
    AND (has_function_privilege('authenticated', to_regprocedure(f), 'EXECUTE')
         OR NOT has_function_privilege('service_role', to_regprocedure(f), 'EXECUTE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'anon_lockdown check failed [3 definer helpers]: wrong grants on %', bad;
  END IF;

  -- 4. No PUBLIC grant on the tag materialized view.
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
             WHERE c.oid = to_regclass('public.vcon_tags_mv') AND a.grantee = 0) THEN
    RAISE EXCEPTION 'anon_lockdown check failed [4 vcon_tags_mv]: PUBLIC still holds a grant';
  END IF;

  -- 5. Both views run with the caller's privileges (PostgreSQL 15 and later).
  IF current_setting('server_version_num')::int >= 150000 THEN
    SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('vcons_legacy', 'vcon_field_usage') AND c.relkind = 'v'
      AND NOT coalesce(c.reloptions @> ARRAY['security_invoker=true'], false);
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION 'anon_lockdown check failed [5 views]: % not security_invoker', bad;
    END IF;
  END IF;

  -- 6. service_role and authenticated keep the RPCs the server calls.
  SELECT string_agg(r || ' for ' || who, ', ') INTO bad
  FROM unnest(ARRAY[
    'save_vcon_batch', 'remove_vcon_child_and_compact', 'search_vcons_keyword', 'search_vcons_semantic',
    'search_vcons_hybrid', 'search_vcons_by_tags', 'search_vcons_by_tags_and_date',
    'search_vcons_by_tags_and_date_count', 'vcon_uuids_for_dealer_filter', 'count_vcons_for_dealer_filter',
    'count_vcons_tags_and_dealer', 'aggregate_vcons_by_dealer_stats', 'get_current_tenant_id'
  ]) AS r
  CROSS JOIN unnest(ARRAY['authenticated', 'service_role']) AS who
  WHERE EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = r)
    AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = r
                      AND has_function_privilege(who, p.oid, 'EXECUTE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'anon_lockdown check failed [6 server RPCs]: no executable overload of %', bad;
  END IF;

  IF to_regprocedure('public.refresh_vcon_tags_mv_if_stale()') IS NOT NULL
     AND NOT has_function_privilege('service_role', 'public.refresh_vcon_tags_mv_if_stale()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon_lockdown check failed [6 server RPCs]: service_role cannot refresh vcon_tags_mv';
  END IF;
END $$;

-- 7. The same paths, exercised.
SELECT pg_temp.expect_denied('anon', 'SELECT * FROM public.vcons_legacy LIMIT 1', '7 anon vcons_legacy');
SELECT pg_temp.expect_denied('anon', 'SELECT * FROM public.vcon_field_usage LIMIT 1', '7 anon vcon_field_usage');
SELECT pg_temp.expect_denied('anon', 'SELECT * FROM public.vcon_tags_mv LIMIT 1', '7 anon vcon_tags_mv');
SELECT pg_temp.expect_denied('anon', 'SELECT * FROM public.vcons LIMIT 1', '7 anon vcons');
SELECT pg_temp.expect_denied('anon', $q$SELECT public.exec_sql('select 1 as x', '{}'::jsonb)$q$, '7 anon exec_sql');
SELECT pg_temp.expect_denied('anon', $q$SELECT public.explain_query('select 1', false)$q$, '7 anon explain_query');
SELECT pg_temp.expect_denied('anon', $q$SELECT public.set_tenant_context('x')$q$, '7 anon set_tenant_context');
SELECT pg_temp.expect_denied('authenticated', $q$SELECT public.exec_sql('select 1 as x', '{}'::jsonb)$q$, '7 authenticated exec_sql');
SELECT pg_temp.expect_denied('authenticated', $q$SELECT public.explain_query('select 1', false)$q$, '7 authenticated explain_query');
SELECT pg_temp.expect_denied('authenticated', $q$SELECT public.set_tenant_context('x')$q$, '7 authenticated set_tenant_context');

SELECT pg_temp.expect_allowed('service_role', 'SELECT * FROM public.vcons LIMIT 1', '7 service_role vcons');
SELECT pg_temp.expect_allowed('service_role', 'SELECT * FROM public.vcons_legacy LIMIT 1', '7 service_role vcons_legacy');
SELECT pg_temp.expect_allowed('service_role', 'SELECT * FROM public.vcon_field_usage LIMIT 1', '7 service_role vcon_field_usage');
SELECT pg_temp.expect_allowed('service_role', 'SELECT * FROM public.vcon_tags_mv LIMIT 1', '7 service_role vcon_tags_mv');
SELECT pg_temp.expect_allowed('service_role', $q$SELECT public.exec_sql('select 1 as x', '{}'::jsonb)$q$, '7 service_role exec_sql');
SELECT pg_temp.expect_allowed('service_role', $q$SELECT public.explain_query('select 1', false)$q$, '7 service_role explain_query');
SELECT pg_temp.expect_allowed('service_role', 'SELECT public.get_storage_efficiency()', '7 service_role get_storage_efficiency');
SELECT pg_temp.expect_allowed('authenticated', 'SELECT * FROM public.vcons LIMIT 1', '7 authenticated vcons');
SELECT pg_temp.expect_allowed('authenticated', 'SELECT * FROM public.vcon_tags_mv LIMIT 1', '7 authenticated vcon_tags_mv');

\o
\echo 'anon_lockdown: all checks passed'

ROLLBACK;
