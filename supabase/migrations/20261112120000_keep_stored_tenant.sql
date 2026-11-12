-- A stored tenant stays put, and only a staff function releases a vCon from
-- _quarantine.
--
-- 1. save_vcon_batch keeps a vCon's stored tenant on a re-post.
--    Before this, the vcons upsert set tenant_id = EXCLUDED.tenant_id, so a
--    service-key re-post with no tenant moved a stamped vCon to NULL, and a
--    re-post stamped for another tenant moved it there. The cascade trigger
--    (trg_cascade_tenant_id_update) then moved every child row with it. Now
--    the conflict branch writes COALESCE(stored, new):
--      stored NULL      -> takes the new value (unchanged: a re-post still
--                          repairs an unstamped vCon, CON-1177)
--      stored non-NULL  -> kept, whatever the re-post carries, _quarantine
--                          included
--    The re-post's content is still written. Child rows follow the stored
--    tenant through their BEFORE INSERT triggers, which take the parent's
--    value when it has one (20261020150000_child_tenant_id_keep_explicit.sql).
--    Every other column behaves as in 20261020130000_save_vcon_batch.sql.
--
-- 2. tenant_quarantine_releases, an append-only log, and
--    release_vcon_from_quarantine(), the one function that moves a vCon out of
--    _quarantine. It needs the target tenant, a reason, evidence (a non-empty
--    JSON object, e.g. what showed the number was in that tenant's inventory at
--    the time of the call) and who did it, and writes all of it to the log in
--    the same transaction as the move. service_role only.
--
-- TENANT_MODE=writer stores a vCon with a missing, malformed or conflicting
-- tenant stamp under _quarantine (src/config/tenant-stamp.ts). With
-- TENANT_MODE unset nothing writes _quarantine, so part 2 is inert.
--
-- Idempotent. Creates objects in public only; a per-group schema made by
-- scripts/bootstrap-schema.sh before this migration needs it applied there too.

SET client_min_messages TO WARNING;

-- ---------------------------------------------------------------------------
-- 1. save_vcon_batch: keep a stored tenant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION save_vcon_batch(
  p_vcons JSONB,
  p_parties JSONB DEFAULT '[]'::jsonb,
  p_dialog JSONB DEFAULT '[]'::jsonb,
  p_analysis JSONB DEFAULT '[]'::jsonb,
  p_attachments JSONB DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  spec RECORD;
  col_list TEXT;
  set_list TEXT;
BEGIN
  -- Parent first so child FKs resolve; children in the order the old path used.
  FOR spec IN
    SELECT * FROM (VALUES
      (1, 'vcons',       p_vcons,       'id'),
      (2, 'parties',     p_parties,     'vcon_id, party_index'),
      (3, 'dialog',      p_dialog,      'vcon_id, dialog_index'),
      (4, 'analysis',    p_analysis,    'vcon_id, analysis_index'),
      (5, 'attachments', p_attachments, 'vcon_id, attachment_index')
    ) AS s(ord, tbl, rows, conflict)
    ORDER BY ord
  LOOP
    CONTINUE WHEN spec.rows IS NULL OR jsonb_array_length(spec.rows) = 0;

    -- On vcons, a stored tenant wins over the re-post's. Children need no
    -- special case: their insert triggers already give them the parent's.
    SELECT string_agg(format('%I', k), ', ' ORDER BY k),
           string_agg(CASE WHEN spec.tbl = 'vcons' AND k = 'tenant_id'
                           THEN 'tenant_id = COALESCE(vcons.tenant_id, EXCLUDED.tenant_id)'
                           ELSE format('%I = EXCLUDED.%I', k, k) END,
                      ', ' ORDER BY k)
      INTO col_list, set_list
      FROM (SELECT DISTINCT jsonb_object_keys(r) AS k
              FROM jsonb_array_elements(spec.rows) AS r) AS keys;

    EXECUTE format(
      'INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%I, $1) '
      'ON CONFLICT (%s) DO UPDATE SET %s',
      spec.tbl, col_list, col_list, spec.tbl, spec.conflict, set_list
    ) USING spec.rows;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION save_vcon_batch(JSONB, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_vcon_batch(JSONB, JSONB, JSONB, JSONB, JSONB)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Release from _quarantine
-- ---------------------------------------------------------------------------

-- No foreign key to vcons: the record of a release outlives the vCon.
CREATE TABLE IF NOT EXISTS tenant_quarantine_releases (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vcon_uuid   UUID NOT NULL,
  from_tenant TEXT NOT NULL,
  to_tenant   TEXT NOT NULL,
  reason      TEXT NOT NULL CHECK (btrim(reason) <> ''),
  evidence    JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object' AND evidence <> '{}'::jsonb),
  released_by TEXT NOT NULL CHECK (btrim(released_by) <> ''),
  released_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_quarantine_releases_vcon_uuid
  ON tenant_quarantine_releases (vcon_uuid);

COMMENT ON TABLE tenant_quarantine_releases IS
  'Append-only log of vCons moved out of _quarantine by release_vcon_from_quarantine()';

-- No policy, so only roles with BYPASSRLS (service_role, postgres) read it.
ALTER TABLE tenant_quarantine_releases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON tenant_quarantine_releases FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON tenant_quarantine_releases TO service_role;

CREATE OR REPLACE FUNCTION tenant_quarantine_releases_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'tenant_quarantine_releases is append-only'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE EXECUTE ON FUNCTION tenant_quarantine_releases_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tenant_quarantine_releases_append_only ON tenant_quarantine_releases;
CREATE TRIGGER trg_tenant_quarantine_releases_append_only
  BEFORE UPDATE OR DELETE ON tenant_quarantine_releases
  FOR EACH ROW EXECUTE FUNCTION tenant_quarantine_releases_append_only();

DROP TRIGGER IF EXISTS trg_tenant_quarantine_releases_no_truncate ON tenant_quarantine_releases;
CREATE TRIGGER trg_tenant_quarantine_releases_no_truncate
  BEFORE TRUNCATE ON tenant_quarantine_releases
  FOR EACH STATEMENT EXECUTE FUNCTION tenant_quarantine_releases_append_only();

-- Moves one vCon from _quarantine to p_tenant_id and logs why. The cascade
-- trigger on vcons moves every child row (parties, dialog, attachments,
-- analysis, groups, party_history, vcon_embeddings, embedding_queue,
-- s3_sync_tracking). Moving the tags attachment bumps its updated_at, so
-- refresh_vcon_tags_mv_if_stale() picks up the new tenant. Returns the log id.
CREATE OR REPLACE FUNCTION release_vcon_from_quarantine(
  p_vcon_uuid   UUID,
  p_tenant_id   TEXT,
  p_reason      TEXT,
  p_evidence    JSONB,
  p_released_by TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_id     UUID;
  v_tenant TEXT;
  v_log_id BIGINT;
BEGIN
  IF p_tenant_id IS NULL OR p_tenant_id !~ '^t-[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'tenant id must be t- and 16 lowercase hex digits'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' OR p_evidence = '{}'::jsonb THEN
    RAISE EXCEPTION 'evidence must be a non-empty JSON object' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_released_by IS NULL OR btrim(p_released_by) = '' THEN
    RAISE EXCEPTION 'released_by is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT id, tenant_id INTO v_id, v_tenant
    FROM vcons WHERE uuid = p_vcon_uuid
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vCon % not found', p_vcon_uuid USING ERRCODE = 'no_data_found';
  END IF;
  IF v_tenant IS DISTINCT FROM '_quarantine' THEN
    RAISE EXCEPTION 'vCon % is not in _quarantine', p_vcon_uuid
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE vcons SET tenant_id = p_tenant_id WHERE id = v_id;

  INSERT INTO tenant_quarantine_releases (vcon_uuid, from_tenant, to_tenant, reason, evidence, released_by)
  VALUES (p_vcon_uuid, v_tenant, p_tenant_id, btrim(p_reason), p_evidence, btrim(p_released_by))
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION release_vcon_from_quarantine(UUID, TEXT, TEXT, JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_vcon_from_quarantine(UUID, TEXT, TEXT, JSONB, TEXT) TO service_role;
