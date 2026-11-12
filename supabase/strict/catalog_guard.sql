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
--   rpcs       no function anon or authenticated can execute is SECURITY
--              DEFINER, tests a tenant for NULL, reads vcon_tags_mv or reads
--              the app.current_tenant_id session setting. The tag-and-date
--              search functions carry a tenant predicate.
--   views      every view runs as the caller (security_invoker), except
--              vcon_tags_scoped, which must be exactly the tenant filter.
--   matviews   anon and authenticated hold no privilege on any.
--   anon       anon holds no privilege on any table or function.
--   tenant id  get_current_tenant_id() reads the signed claim only: no claim,
--              an empty claim, `_quarantine` and a session setting all give NULL.
DO $guard$
DECLARE
  schemas constant text[] := ARRAY['public', 'vkong'];
  tenant_tables constant text[] := ARRAY['vcons', 'parties', 'dialog', 'attachments', 'analysis', 'groups',
    'party_history', 'vcon_embeddings', 'embedding_queue', 's3_sync_tracking'];
  strict_expr constant text := '^\(tenant_id = \( SELECT (public\.)?get_current_tenant_id\(\) AS get_current_tenant_id\)\)$';
  scoped_def constant text := 'SELECT tenant_id, vcon_id, tags, tag_updated_at, tag_created_at FROM vcon_tags_mv WHERE (tenant_id = ( SELECT get_current_tenant_id() AS get_current_tenant_id));';
  null_branch constant text := '(current_tenant|tenant_id|get_current_tenant_id\(\))\s+IS\s+NULL';
  roles constant oid[] := ARRAY[0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid];
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

  -- ---------------------------------------------------------------- rpcs
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.prosecdef, p.prosrc, p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = ANY (schemas)
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     ORDER BY 1::text
  LOOP
    checks := checks + 5;
    IF r.prosecdef THEN
      v := v || format('rpcs: %s is SECURITY DEFINER and anon or authenticated can execute it', r.sig);
    END IF;
    IF r.anon_x THEN
      v := v || format('rpcs: anon can execute %s', r.sig);
    END IF;
    IF r.prosrc ~* null_branch THEN
      v := v || format('rpcs: %s tests a tenant for NULL, which admits rows with no tenant', r.sig);
    END IF;
    IF r.prosrc ~ '\mvcon_tags_mv\M' THEN
      v := v || format('rpcs: %s reads vcon_tags_mv, which has no row level security; read vcon_tags_scoped', r.sig);
    END IF;
    IF r.prosrc ~* 'app\.current_tenant_id' OR (r.prosrc ~* 'current_setting' AND r.prosrc !~* 'request\.jwt\.claims') THEN
      v := v || format('rpcs: %s reads a session setting other than the JWT claims', r.sig);
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

  -- ---------------------------------------------------------------- views
  FOR r IN
    SELECT c.oid, n.nspname || '.' || c.relname AS name, c.relname,
           coalesce((SELECT lower(option_value) FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_invoker'), 'false')
             IN ('true', 'on', '1', 'yes') AS invoker,
           coalesce((SELECT lower(option_value) FROM pg_options_to_table(c.reloptions) WHERE option_name = 'security_barrier'), 'false')
             IN ('true', 'on', '1', 'yes') AS barrier,
           has_table_privilege('anon', c.oid, 'SELECT') AS anon_sel
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY (schemas) AND c.relkind = 'v'
     ORDER BY 2
  LOOP
    checks := checks + 1;
    IF r.name = 'public.vcon_tags_scoped' THEN
      IF btrim(regexp_replace(regexp_replace(pg_get_viewdef(r.oid), '\s+', ' ', 'g'), '(public|vcon_tags_mv)\.', '', 'g')) <> scoped_def
         OR NOT r.barrier OR r.invoker OR r.anon_sel THEN
        v := v || 'views: public.vcon_tags_scoped is not exactly the tenant filter over vcon_tags_mv, is not a security barrier, or anon can read it';
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
