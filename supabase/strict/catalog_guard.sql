-- Catalog guard for the strict pack.
--
-- Reads the catalog and fails, listing every violation, when the database is
-- not in the strict state. apply.sh runs it at the end of the pack's
-- transaction, so a pack that leaves a gap rolls back; `apply.sh --check` runs
-- it alone after an upgrade. It changes nothing: the only writes are
-- transaction-local settings, restored before it ends.
--
-- Scope is the schemas vcon-mcp creates: public and vkong. Checks:
--
--   tables     every table with a tenant_id column has RLS enabled and
--              forced, tenant_id NOT NULL and never empty, at least one
--              policy, and every permissive policy for anon, authenticated
--              or PUBLIC is exactly tenant_id = (SELECT get_current_tenant_id())
--              with no NULL branch. A table without tenant_id that anon or
--              authenticated can reach must have RLS and no policy that
--              admits a row.
--   keys       every foreign key between two tenant tables includes
--              tenant_id on both sides, and each child of vcons and dialog
--              has one.
--   privileges anon and authenticated hold no TRUNCATE, TRIGGER, REFERENCES or
--              MAINTAIN on any table or view (row level security does not
--              govern them), no INSERT or UPDATE on a tenant table, and only
--              SELECT on a view.
--   rpcs       no function anon or authenticated can execute is SECURITY
--              DEFINER or VOLATILE (the only kind that may write), reads
--              vcon_tags_mv, reads a session setting other than the JWT
--              claims, or treats the tenant in a NULL-tolerant way: IS NULL,
--              IS [NOT] DISTINCT FROM, COALESCE or NULLIF around it, or a
--              comparison with ''. The tag-and-date search functions carry a
--              tenant predicate. Functions meant for service_role only
--              (exec_sql, the tag refresh, the tenant backfills,
--              release_vcon_from_quarantine, ...) stay that way.
--              child_refresh_conversation_start() runs as its owner, so a
--              tenant's delete can refresh conversation_start: SECURITY
--              DEFINER, search_path exactly public, pg_temp, an owner with
--              BYPASSRLS, and no EXECUTE for anon or authenticated.
--   views      every view runs as the caller (security_invoker), except
--              vcon_tags_scoped, which must be exactly the tenant filter,
--              a security barrier, and owned by the owner of vcon_tags_mv.
--   matviews   anon and authenticated hold no privilege on any.
--   anon       anon holds no privilege on any table or function.
--   tenant id  get_current_tenant_id() reads the signed claim only: no claim,
--              an empty claim, `_quarantine` and a session setting all give NULL.
--
-- What it cannot see: the function-body checks are text patterns on the
-- functions tenant roles can execute. They miss a tenant test written without
-- those spellings (`OR true`, `length(current_tenant) = 0`, a tenant held in a
-- variable whose name lacks "tenant"), a predicate that is simply missing, and
-- SQL assembled at run time from pieces. For an `authenticated` caller the
-- policies still bind, since these functions run as the caller; what a body
-- test protects is a service_role caller that passes a tenant claim. Trigger
-- functions are not scanned (they cannot be called directly), nor are
-- functions only service_role can execute.
DO $guard$
DECLARE
  schemas constant text[] := ARRAY['public', 'vkong'];
  tenant_tables constant text[] := ARRAY['vcons', 'parties', 'dialog', 'attachments', 'analysis', 'groups',
    'party_history', 'vcon_embeddings', 'embedding_queue', 's3_sync_tracking'];
  strict_expr constant text := '^\(tenant_id = \( SELECT (public\.)?get_current_tenant_id\(\) AS get_current_tenant_id\)\)$';
  scoped_def constant text := 'SELECT tenant_id, vcon_id, tags, tag_updated_at, tag_created_at FROM vcon_tags_mv WHERE (tenant_id = ( SELECT get_current_tenant_id() AS get_current_tenant_id));';
  -- An identifier containing "tenant", optionally called: current_tenant, v.tenant_id, get_current_tenant_id().
  tid constant text := '\w*tenant\w*(\s*\(\s*\))?';
  tolerant text;
  roles constant oid[] := ARRAY[0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid];
  service_only constant text[] := ARRAY['exec_sql', 'explain_query', 'set_tenant_context', 'clear_tenant_context',
    'get_connection_metrics', 'get_index_health', 'get_performance_metrics', 'get_storage_efficiency',
    'refresh_vcon_tags_mv', 'refresh_vcon_tags_mv_if_stale', 'backfill_tenant_id_batch', 'backfill_vcon_tenant_ids',
    'vcon_tenant_stamp', 'release_vcon_from_quarantine'];
  v text[] := '{}';
  checks int := 0;
  r record;
  t text;
  saved_claims text := current_setting('request.jwt.claims', true);
  saved_app text := current_setting('app.current_tenant_id', true);
  got text;
  -- MAINTAIN (REFRESH, VACUUM, ...) is a table privilege from PostgreSQL 17.
  mv_privs constant text := 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    || CASE WHEN current_setting('server_version_num')::int >= 170000 THEN ',MAINTAIN' ELSE '' END;
  noread constant text := 'TRUNCATE,TRIGGER,REFERENCES'
    || CASE WHEN current_setting('server_version_num')::int >= 170000 THEN ',MAINTAIN' ELSE '' END;
BEGIN
  -- ---------------------------------------------------------------- tables
  FOREACH t IN ARRAY tenant_tables LOOP
    checks := checks + 1;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || t) AND attname = 'tenant_id' AND NOT attisdropped) THEN
      v := v || format('tables: public.%s has no tenant_id column', t);
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.oid, n.nspname || '.' || c.relname AS name, c.relrowsecurity, c.relforcerowsecurity, a.attnotnull, a.attnum
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE n.nspname = ANY (schemas) AND c.relkind IN ('r', 'p')
     ORDER BY 2
  LOOP
    checks := checks + 6;
    IF NOT r.relrowsecurity THEN v := v || format('tables: %s has row level security off', r.name); END IF;
    IF NOT r.relforcerowsecurity THEN v := v || format('tables: %s does not force row level security', r.name); END IF;
    IF NOT r.attnotnull THEN v := v || format('tables: %s.tenant_id allows NULL', r.name); END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = r.oid AND contype = 'c' AND convalidated
                   AND conkey = ARRAY[r.attnum] AND pg_get_constraintdef(oid) = 'CHECK ((tenant_id <> ''''::text))') THEN
      v := v || format('tables: %s.tenant_id may be empty', r.name);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = r.oid) THEN
      v := v || format('tables: %s has no policy', r.name);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = r.oid AND p.polpermissive
                   AND p.polroles && roles AND p.polcmd IN ('*', 'r')) THEN
      v := v || format('tables: %s has no permissive policy for authenticated', r.name);
    END IF;
  END LOOP;

  FOR r IN
    SELECT n.nspname || '.' || c.relname AS name, p.polname, p.polpermissive,
           pg_get_expr(p.polqual, p.polrelid) AS qual, pg_get_expr(p.polwithcheck, p.polrelid) AS wcheck,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS tenant
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY (schemas) AND p.polroles && roles
     ORDER BY 1, 2
  LOOP
    checks := checks + 1;
    IF coalesce(r.qual, '') ~* 'IS\s+NULL' OR coalesce(r.wcheck, '') ~* 'IS\s+NULL' THEN
      v := v || format('tables: policy %s on %s has a NULL branch: USING %s WITH CHECK %s', r.polname, r.name, r.qual, r.wcheck);
    ELSIF coalesce(r.qual, '') ~* 'current_setting' OR coalesce(r.wcheck, '') ~* 'current_setting' THEN
      v := v || format('tables: policy %s on %s reads a setting directly', r.polname, r.name);
    ELSIF r.polpermissive AND r.tenant
          AND NOT ((r.qual IS NULL OR r.qual ~ strict_expr) AND (r.wcheck IS NULL OR r.wcheck ~ strict_expr)
                   AND (r.qual IS NOT NULL OR r.wcheck IS NOT NULL)) THEN
      v := v || format('tables: policy %s on %s is not the tenant filter: USING %s WITH CHECK %s', r.polname, r.name, r.qual, r.wcheck);
    ELSIF r.polpermissive AND NOT r.tenant AND NOT (coalesce(r.qual, 'false') = 'false' AND coalesce(r.wcheck, 'false') = 'false') THEN
      v := v || format('tables: policy %s on %s (no tenant column) admits rows: USING %s', r.polname, r.name, r.qual);
    END IF;
  END LOOP;

  FOR r IN
    SELECT n.nspname || '.' || c.relname AS name, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY (schemas) AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
       AND (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
            OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))
       AND has_schema_privilege('authenticated', n.oid, 'USAGE')
     ORDER BY 1
  LOOP
    checks := checks + 1;
    IF NOT r.relrowsecurity THEN
      v := v || format('tables: %s has no tenant column and no row level security, and authenticated or anon can reach it', r.name);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------- keys
  FOR r IN
    SELECT con.conname, con.conrelid::regclass AS child, con.confrelid::regclass AS parent,
           con.conkey @> ARRAY[ca.attnum] AS child_has, con.confkey @> ARRAY[pa.attnum] AS parent_has
      FROM pg_constraint con
      JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attname = 'tenant_id' AND NOT ca.attisdropped
      JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attname = 'tenant_id' AND NOT pa.attisdropped
     WHERE con.contype = 'f' AND con.connamespace = ANY (SELECT oid FROM pg_namespace WHERE nspname = ANY (schemas))
     ORDER BY 2::text, 1
  LOOP
    checks := checks + 1;
    IF NOT (r.child_has AND r.parent_has) THEN
      v := v || format('keys: %s on %s references %s without tenant_id, so a row can hang off another tenant''s parent', r.conname, r.child, r.parent);
    END IF;
  END LOOP;

  FOR r IN
    SELECT x.child, x.parent FROM (VALUES
      ('parties', 'vcons'), ('dialog', 'vcons'), ('attachments', 'vcons'), ('analysis', 'vcons'), ('groups', 'vcons'),
      ('vcon_embeddings', 'vcons'), ('embedding_queue', 'vcons'), ('s3_sync_tracking', 'vcons'), ('party_history', 'dialog')) AS x(child, parent)
     WHERE to_regclass('public.' || x.child) IS NOT NULL
  LOOP
    checks := checks + 1;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint con
       WHERE con.contype = 'f' AND con.conrelid = ('public.' || r.child)::regclass AND con.confrelid = ('public.' || r.parent)::regclass
         AND con.convalidated
         AND con.conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = con.conrelid AND attname = 'tenant_id')]
         AND con.confkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = con.confrelid AND attname = 'tenant_id')]) THEN
      v := v || format('keys: %s has no key to %s that includes tenant_id', r.child, r.parent);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------- privileges
  FOR r IN
    SELECT n.nspname || '.' || c.relname AS name, c.oid, c.relkind,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS tenant
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY (schemas) AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     ORDER BY 1
  LOOP
    checks := checks + 3;
    IF has_table_privilege('authenticated', r.oid, noread) OR has_table_privilege('anon', r.oid, noread) THEN
      v := v || format('privileges: anon or authenticated holds TRUNCATE, TRIGGER, REFERENCES or MAINTAIN on %s, which row level security does not govern', r.name);
    END IF;
    IF r.tenant AND r.relkind IN ('r', 'p')
       AND (has_any_column_privilege('authenticated', r.oid, 'INSERT,UPDATE') OR has_any_column_privilege('anon', r.oid, 'INSERT,UPDATE')) THEN
      v := v || format('privileges: authenticated can insert into or update tenant table %s; tenant roles read and delete only', r.name);
    END IF;
    IF r.relkind = 'v' AND (has_any_column_privilege('authenticated', r.oid, 'INSERT,UPDATE') OR has_table_privilege('authenticated', r.oid, 'DELETE')) THEN
      v := v || format('privileges: authenticated can write through view %s', r.name);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------- rpcs
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.prosecdef, p.prosrc, p.proname, p.provolatile,
           p.prorettype IN ('trigger'::regtype, 'event_trigger'::regtype) AS is_trigger,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = ANY (schemas)
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     ORDER BY 1::text
  LOOP
    checks := checks + 6;
    IF r.prosecdef THEN
      v := v || format('rpcs: %s is SECURITY DEFINER and anon or authenticated can execute it', r.sig);
    END IF;
    IF r.anon_x THEN
      v := v || format('rpcs: anon can execute %s', r.sig);
    END IF;
    IF NOT r.is_trigger AND r.provolatile = 'v' THEN
      v := v || format('rpcs: %s is VOLATILE, so it may write, and authenticated or anon can execute it', r.sig);
    END IF;
    -- get_current_tenant_id() is checked by behaviour below.
    IF NOT r.is_trigger AND r.proname <> 'get_current_tenant_id' THEN
      tolerant := CASE
        WHEN r.prosrc ~* (tid || '\s*\)?\s+IS\s+NULL') THEN 'IS NULL'
        WHEN r.prosrc ~* (tid || '\s*\)?\s+IS\s+(NOT\s+)?DISTINCT\s+FROM')
          OR r.prosrc ~* ('IS\s+(NOT\s+)?DISTINCT\s+FROM\s+\(?\s*(\w+\.)?' || tid) THEN 'IS [NOT] DISTINCT FROM'
        WHEN r.prosrc ~* '\m(coalesce|nullif)\s*\((\([^()]*\)|[^()])*tenant' THEN 'COALESCE or NULLIF'
        WHEN r.prosrc ~* (tid || '\s*\)?\s*(=|<>|!=)\s*''''')
          OR r.prosrc ~* ('''''\s*(=|<>|!=)\s*\(?\s*(\w+\.)?' || tid) THEN 'compared with an empty string'
      END;
      IF tolerant IS NOT NULL THEN
        v := v || format('rpcs: %s treats the tenant in a NULL-tolerant way (%s), which can admit rows with no tenant or a caller with no claim', r.sig, tolerant);
      END IF;
    END IF;
    IF NOT r.is_trigger AND r.prosrc ~ '\mvcon_tags_mv\M' THEN
      v := v || format('rpcs: %s reads vcon_tags_mv, which has no row level security; read vcon_tags_scoped', r.sig);
    END IF;
    IF r.prosrc ~* 'app\.current_tenant_id' OR (r.prosrc ~* 'current_setting' AND r.prosrc !~* 'request\.jwt\.claims') THEN
      v := v || format('rpcs: %s reads a session setting other than the JWT claims', r.sig);
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY (service_only)
     ORDER BY 1::text
  LOOP
    checks := checks + 1;
    IF has_function_privilege('anon', r.sig, 'EXECUTE') OR has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      v := v || format('rpcs: %s is service_role only, but anon or authenticated can execute it', r.sig);
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.prosrc
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('search_vcons_by_tags_and_date', 'search_vcons_by_tags_and_date_count')
  LOOP
    checks := checks + 1;
    IF regexp_count(r.prosrc, 'v\.tenant_id = \(SELECT (public\.)?get_current_tenant_id\(\)\)')
       <> regexp_count(r.prosrc, '\mFROM\s+vcons\s+v\M') THEN
      v := v || format('rpcs: %s reads vcons without a tenant predicate', r.sig);
    END IF;
  END LOOP;

  -- Tenant roles cannot update vcons, so the conversation_start refresh that a
  -- dialog or attachment delete fires has to run as its owner.
  IF to_regprocedure('public.child_refresh_conversation_start()') IS NOT NULL THEN
    checks := checks + 4;
    SELECT p.prosecdef, p.proconfig, p.proowner::regrole AS owner, (rr.rolbypassrls OR rr.rolsuper) AS bypass,
           has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE') AS reachable
      INTO r
      FROM pg_proc p JOIN pg_roles rr ON rr.oid = p.proowner
     WHERE p.oid = 'public.child_refresh_conversation_start()'::regprocedure;
    IF NOT r.prosecdef THEN
      v := v || 'rpcs: child_refresh_conversation_start() runs as the caller, so a tenant delete of a vCon, dialog or attachment fails; re-run the pack'::text;
    END IF;
    IF r.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
      v := v || format('rpcs: child_refresh_conversation_start() runs as its owner, so its search_path must be exactly public, pg_temp; it has %s',
        coalesce(array_to_string(r.proconfig, '; '), 'none'));
    END IF;
    IF NOT r.bypass THEN
      v := v || format('rpcs: child_refresh_conversation_start() is owned by %s, which has no BYPASSRLS, so the refresh it runs is bound by the tenant policies', r.owner);
    END IF;
    IF r.reachable THEN
      v := v || 'rpcs: anon or authenticated can execute child_refresh_conversation_start(), a SECURITY DEFINER function; a trigger needs no grant'::text;
    END IF;
  END IF;

  -- ---------------------------------------------------------------- views
  FOR r IN
    SELECT c.oid, n.nspname || '.' || c.relname AS name, c.relname,
           coalesce((SELECT lower(option_value) FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false')
             IN ('true', 'on', '1', 'yes') AS invoker,
           coalesce((SELECT lower(option_value) FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_barrier'), 'false')
             IN ('true', 'on', '1', 'yes') AS barrier,
           has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel,
           c.relowner IS DISTINCT FROM (SELECT m.relowner FROM pg_class m WHERE m.oid = to_regclass('public.vcon_tags_mv')) AS other_owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY (schemas) AND c.relkind = 'v'
     ORDER BY 2
  LOOP
    checks := checks + 1;
    IF r.name = 'public.vcon_tags_scoped' THEN
      IF btrim(regexp_replace(regexp_replace(pg_get_viewdef(r.oid), '\s+', ' ', 'g'), '(public|vcon_tags_mv)\.', '', 'g')) <> scoped_def THEN
        v := v || 'views: public.vcon_tags_scoped is not exactly the tenant filter over vcon_tags_mv'::text;
      END IF;
      IF NOT r.barrier OR r.invoker THEN
        v := v || 'views: public.vcon_tags_scoped must be a security barrier that runs as its owner'::text;
      END IF;
      IF r.anon_sel THEN
        v := v || 'views: anon can read public.vcon_tags_scoped'::text;
      END IF;
      IF r.other_owner THEN
        v := v || 'views: public.vcon_tags_scoped is not owned by the owner of vcon_tags_mv'::text;
      END IF;
    ELSIF NOT r.invoker THEN
      v := v || format('views: %s runs as its owner (no security_invoker), so row level security is checked against the owner', r.name);
    END IF;
  END LOOP;

  -- ---------------------------------------------------------------- matviews
  FOR r IN
    SELECT n.nspname || '.' || c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY (schemas) AND c.relkind = 'm'
       AND (has_table_privilege('anon', c.oid, mv_privs) OR has_table_privilege('authenticated', c.oid, mv_privs))
  LOOP
    v := v || format('matviews: anon or authenticated holds a privilege on %s, which cannot carry row level security', r.name);
  END LOOP;
  checks := checks + 1;

  -- ---------------------------------------------------------------- anon
  FOR r IN
    SELECT n.nspname || '.' || c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY (schemas) AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
  LOOP
    v := v || format('anon: anon can read or write %s', r.name);
  END LOOP;
  checks := checks + 1;

  -- ---------------------------------------------------------------- tenant id
  checks := checks + 7;
  IF to_regprocedure('public.get_current_tenant_id()') IS NULL THEN
    v := v || 'tenant id: get_current_tenant_id() is missing'::text;
  ELSE
    SELECT p.prosecdef, p.prosrc INTO r FROM pg_proc p WHERE p.oid = 'public.get_current_tenant_id()'::regprocedure;
    IF r.prosecdef THEN
      v := v || 'tenant id: get_current_tenant_id() is SECURITY DEFINER'::text;
    END IF;
    IF r.prosrc ~* 'app\.current_tenant_id' OR regexp_count(r.prosrc, 'current_setting') <> regexp_count(r.prosrc, 'current_setting\(''request\.jwt\.claims''') THEN
      v := v || 'tenant id: get_current_tenant_id() reads a setting other than request.jwt.claims (session-variable fallback)'::text;
    END IF;

    PERFORM set_config('app.current_tenant_id', 't-guard-spoof', true);
    PERFORM set_config('request.jwt.claims', '', true);
    got := public.get_current_tenant_id();
    IF got IS NOT NULL THEN v := v || format('tenant id: with no claims and app.current_tenant_id set, the tenant is %L', got); END IF;
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    got := public.get_current_tenant_id();
    IF got IS NOT NULL THEN v := v || format('tenant id: a token with no tenant_id claim gives tenant %L', got); END IF;
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated","tenant_id":""}', true);
    got := public.get_current_tenant_id();
    IF got IS NOT NULL THEN v := v || format('tenant id: an empty tenant_id claim gives tenant %L', got); END IF;
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated","tenant_id":"_quarantine"}', true);
    got := public.get_current_tenant_id();
    IF got IS NOT NULL THEN v := v || format('tenant id: a _quarantine claim gives tenant %L; no token may read quarantine', got); END IF;
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated","tenant_id":"t-guard-check"}', true);
    got := public.get_current_tenant_id();
    IF got IS DISTINCT FROM 't-guard-check' THEN v := v || format('tenant id: a tenant_id claim of t-guard-check gives %L', got); END IF;
  END IF;
  PERFORM set_config('request.jwt.claims', coalesce(saved_claims, ''), true);
  PERFORM set_config('app.current_tenant_id', coalesce(saved_app, ''), true);

  IF cardinality(v) > 0 THEN
    RAISE EXCEPTION 'catalog-guard: % violation(s) in % checks:%', cardinality(v), checks,
      E'\n  - ' || array_to_string(v, E'\n  - ');
  END IF;
  RAISE NOTICE 'catalog-guard: ok, % checks passed', checks;
END $guard$;
