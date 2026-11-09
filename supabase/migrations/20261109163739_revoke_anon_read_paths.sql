-- Close the read paths that step around row-level security for anon.
--
-- The tenant policies on the vCon tables admit `authenticated` only, so a
-- direct anon read of those tables returns no rows. These paths step around
-- those policies:
--
--   * vcons_legacy and vcon_field_usage are views. A view runs with its
--     owner's privileges unless told otherwise, so RLS was checked against the
--     owner (BYPASSRLS), not the caller.
--   * vcon_tags_mv is a materialized view, which cannot carry RLS.
--   * exec_sql, explain_query and the four health-metric RPCs are SECURITY
--     DEFINER, so they run as their owner. exec_sql returns any row, and
--     explain_query (with run_analyze) reports row counts.
--   * set_tenant_context and clear_tenant_context are SECURITY DEFINER and set
--     the session fallback that get_current_tenant_id() reads, on a pooled
--     connection that later requests reuse.
--
-- After this migration:
--
--   * PUBLIC, anon and authenticated can no longer execute exec_sql,
--     explain_query, set_tenant_context, clear_tenant_context,
--     get_connection_metrics, get_index_health, get_performance_metrics or
--     get_storage_efficiency. service_role keeps them.
--   * vcons_legacy and vcon_field_usage run with the caller's privileges, so
--     RLS applies to whoever reads them. Needs PostgreSQL 15 or later; on older
--     servers the views are left alone and anon is still refused by the table
--     revoke below.
--   * PUBLIC and anon lose vcon_tags_mv. authenticated keeps it, because
--     shipped search RPCs read it with the caller's privileges.
--   * anon holds no privilege on any table, view or materialized view in
--     public, and cannot execute any function in public. Functions that belong
--     to an extension installed in public (pgvector, pg_trgm) are left alone:
--     they read no data, and authenticated and service_role may reach their
--     operators only through the PUBLIC grant.
--   * Tables and functions that postgres creates in public later grant anon
--     nothing by default.
--
-- service_role is unaffected: it holds explicit grants and bypasses RLS. Where
-- authenticated or service_role could execute a function only through the
-- PUBLIC grant, an explicit grant replaces it before PUBLIC is revoked, so
-- neither role loses a function it could call before (other than the eight
-- above for authenticated).
--
-- Deployments that point the server at the anon key lose these routes. The
-- tables already returned no rows to anon, so use the service role key.
--
-- One gap a per-schema default cannot close: PostgreSQL's built-in default
-- grants EXECUTE on every new function to PUBLIC, and ALTER DEFAULT PRIVILEGES
-- ... IN SCHEMA can only add to that, not remove it. A later migration that
-- creates a new function (CREATE OR REPLACE of an existing one keeps its
-- grants) should end with:
--   REVOKE EXECUTE ON FUNCTION <name>(<args>) FROM PUBLIC, anon;
-- supabase/tests/anon_lockdown.sql fails if one is missed.
--
-- Applies to the public schema only. Per-group schemas created earlier with
-- scripts/bootstrap-schema.sh need the same revokes applied to that schema.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. SECURITY DEFINER functions: closed to PUBLIC, anon and authenticated.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn  text;
  sig regprocedure;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.exec_sql(text, jsonb)',
    'public.exec_sql(jsonb, text)',
    'public.explain_query(text, boolean)',
    'public.set_tenant_context(text)',
    'public.clear_tenant_context()',
    'public.get_connection_metrics()',
    'public.get_index_health()',
    'public.get_performance_metrics()',
    'public.get_storage_efficiency()'
  ] LOOP
    sig := to_regprocedure(fn);
    IF sig IS NULL THEN
      RAISE NOTICE 'revoke_anon_read_paths: % not present, skipped', fn;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Views run with the caller's privileges, so RLS applies to the caller.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v text;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE NOTICE 'revoke_anon_read_paths: security_invoker needs PostgreSQL 15, views left unchanged';
    RETURN;
  END IF;
  FOREACH v IN ARRAY ARRAY['vcons_legacy', 'vcon_field_usage'] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = v AND c.relkind = 'v') THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The tag materialized view cannot carry RLS: PUBLIC and anon lose it.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.vcon_tags_mv') IS NOT NULL THEN
    REVOKE ALL ON public.vcon_tags_mv FROM PUBLIC, anon;
    -- Explicit, so authenticated and service_role do not depend on the PUBLIC
    -- grant or on schema default privileges that a given database may lack.
    GRANT SELECT ON public.vcon_tags_mv TO authenticated, service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. anon loses every table and function in public.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    -- Keep what authenticated and service_role can already execute, then drop
    -- the PUBLIC grant that anon also inherited.
    IF has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO authenticated', r.sig);
    END IF;
    IF has_function_privilege('service_role', r.sig, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON ROUTINE %s TO service_role', r.sig);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;

-- Later objects. Changing postgres's defaults needs postgres or a member of it,
-- which is who runs Supabase migrations; anyone else gets a notice.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres')
     AND pg_has_role(current_user, 'postgres', 'MEMBER') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;
  ELSE
    RAISE NOTICE 'revoke_anon_read_paths: % cannot change default privileges for postgres, skipped', current_user;
  END IF;
END $$;
