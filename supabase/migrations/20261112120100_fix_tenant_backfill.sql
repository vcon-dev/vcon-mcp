-- Fixes for the two tenant backfills. Applied migrations are left as they are.
--
-- 1. backfill_tenant_id_batch('s3_sync_tracking', n) failed with
--    "column s3.id does not exist": s3_sync_tracking is keyed by vcon_id
--    (20251110132000_s3_sync_tracking.sql). That branch now matches on
--    vcon_id. The other eight branches are unchanged. The function is an
--    operator tool (scripts/backfill-tenant-ids.ts runs it with the service
--    key), so it is now service_role only.
--
-- 2. 20251202180000_backfill_tenant_ids.sql step 1 read only attachments with
--    type = 'tenant', so a purpose-only stamp (the vCon 0.4.0 form) was
--    missed, and cast every such body with ::jsonb, so one non-JSON body
--    aborted the whole migration. That one-shot UPDATE stays as it ran. Its
--    corrected form is a function, called by an operator, so applying this
--    migration changes no stored tenant:
--
--      vcon_tenant_stamp(vcon_id, p_strict)
--        The vCon's tenant from its tenant attachments (purpose or type =
--        'tenant'), or NULL when there is none, one is unreadable or two
--        disagree. A body that is not JSON counts as unreadable instead of
--        raising. p_strict = true is the TENANT_MODE=writer rule
--        (src/config/tenant-stamp.ts): the id must be a string, t- and 16
--        lowercase hex digits. p_strict = false takes any non-empty string or
--        number, as the old migration did.
--
--      backfill_vcon_tenant_ids(p_batch_size, p_writer_rule)
--        Sets tenant_id on up to p_batch_size vCons whose tenant_id IS NULL,
--        and returns how many it set; call it until it returns 0. Never
--        changes a non-NULL tenant. The cascade trigger moves each vCon's
--        children with it.
--        p_writer_rule = false: a vCon whose stamp resolves (non-strict) gets
--          it; the rest stay NULL.
--        p_writer_rule = true: a vCon whose stamp resolves (strict) gets it;
--          every other NULL vCon goes to _quarantine, as a writer would have
--          stored it.
--
-- Both are service_role only. Idempotent. Creates objects in public only.

SET client_min_messages TO WARNING;

-- ---------------------------------------------------------------------------
-- 1. backfill_tenant_id_batch
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION backfill_tenant_id_batch(
  p_table_name text,
  p_batch_size int
) RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_count bigint;
BEGIN
  -- 1. PARTIES
  IF p_table_name = 'parties' THEN
    WITH batch AS (
      SELECT p.id, v.tenant_id
      FROM parties p
      JOIN vcons v ON p.vcon_id = v.id
      WHERE p.tenant_id IS DISTINCT FROM v.tenant_id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE parties p
    SET tenant_id = batch.tenant_id
    FROM batch
    WHERE p.id = batch.id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 2. DIALOG
  ELSIF p_table_name = 'dialog' THEN
    WITH batch AS (
      SELECT d.id, v.tenant_id
      FROM dialog d
      JOIN vcons v ON d.vcon_id = v.id
      WHERE d.tenant_id IS DISTINCT FROM v.tenant_id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE dialog d
    SET tenant_id = batch.tenant_id
    FROM batch
    WHERE d.id = batch.id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 3. ATTACHMENTS
  ELSIF p_table_name = 'attachments' THEN
    WITH batch AS (
      SELECT a.id, v.tenant_id
      FROM attachments a
      JOIN vcons v ON a.vcon_id = v.id
      WHERE a.tenant_id IS DISTINCT FROM v.tenant_id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE attachments a
    SET tenant_id = batch.tenant_id
    FROM batch
    WHERE a.id = batch.id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 4. ANALYSIS
  ELSIF p_table_name = 'analysis' THEN
    WITH batch AS (
      SELECT a.id, v.tenant_id
      FROM analysis a
      JOIN vcons v ON a.vcon_id = v.id
      WHERE a.tenant_id IS DISTINCT FROM v.tenant_id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE analysis a
    SET tenant_id = batch.tenant_id
    FROM batch
    WHERE a.id = batch.id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 5. GROUPS
  ELSIF p_table_name = 'groups' THEN
    WITH batch AS (
      SELECT g.id, v.tenant_id
      FROM groups g
      JOIN vcons v ON g.vcon_id = v.id
      WHERE g.tenant_id IS DISTINCT FROM v.tenant_id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE groups g
    SET tenant_id = batch.tenant_id
    FROM batch
    WHERE g.id = batch.id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 6. PARTY_HISTORY
  ELSIF p_table_name = 'party_history' THEN
    WITH batch AS (
      SELECT ph.id, v.tenant_id
      FROM party_history ph
      JOIN dialog d ON ph.dialog_id = d.id
      JOIN vcons v ON d.vcon_id = v.id
      WHERE ph.tenant_id IS DISTINCT FROM v.tenant_id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE party_history ph
    SET tenant_id = batch.tenant_id
    FROM batch
    WHERE ph.id = batch.id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 7. VCON_EMBEDDINGS
  ELSIF p_table_name = 'vcon_embeddings' THEN
    WITH batch AS (
      SELECT e.id, v.tenant_id
      FROM vcon_embeddings e
      JOIN vcons v ON e.vcon_id = v.id
      WHERE e.tenant_id IS DISTINCT FROM v.tenant_id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE vcon_embeddings e
    SET tenant_id = batch.tenant_id
    FROM batch
    WHERE e.id = batch.id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 8. EMBEDDING_QUEUE
  ELSIF p_table_name = 'embedding_queue' THEN
    WITH batch AS (
      SELECT eq.id, v.tenant_id
      FROM embedding_queue eq
      JOIN vcons v ON eq.vcon_id = v.id
      WHERE eq.tenant_id IS DISTINCT FROM v.tenant_id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE embedding_queue eq
    SET tenant_id = batch.tenant_id
    FROM batch
    WHERE eq.id = batch.id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 9. S3_SYNC_TRACKING: keyed by vcon_id, there is no id column.
  ELSIF p_table_name = 's3_sync_tracking' THEN
    WITH batch AS (
      SELECT s3.vcon_id, v.tenant_id
      FROM s3_sync_tracking s3
      JOIN vcons v ON s3.vcon_id = v.id
      WHERE s3.tenant_id IS DISTINCT FROM v.tenant_id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE s3_sync_tracking s3
    SET tenant_id = batch.tenant_id
    FROM batch
    WHERE s3.vcon_id = batch.vcon_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'Unknown table name: %', p_table_name;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION backfill_tenant_id_batch(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION backfill_tenant_id_batch(text, int) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. vcon_tenant_stamp and backfill_vcon_tenant_ids
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION vcon_tenant_stamp(p_vcon_id uuid, p_strict boolean DEFAULT true)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r       record;
  v_body  jsonb;
  v_val   jsonb;
  v_tid   text;
  v_found text;
BEGIN
  FOR r IN
    SELECT a.body, a.encoding
      FROM attachments a
     WHERE a.vcon_id = p_vcon_id
       AND (a.purpose = 'tenant' OR a.type = 'tenant')
     ORDER BY a.attachment_index
  LOOP
    IF r.body IS NULL OR r.body = '' OR r.encoding = 'base64url' THEN
      RETURN NULL;
    END IF;
    BEGIN
      v_body := r.body::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN NULL;
    END;
    IF jsonb_typeof(v_body) <> 'object' THEN
      RETURN NULL;
    END IF;

    v_val := v_body -> 'id';
    IF v_val IS NULL THEN
      RETURN NULL;
    ELSIF jsonb_typeof(v_val) = 'string' OR (NOT p_strict AND jsonb_typeof(v_val) = 'number') THEN
      v_tid := v_val #>> '{}';
    ELSE
      RETURN NULL;
    END IF;

    IF v_tid = '' OR v_tid = '_quarantine' THEN
      RETURN NULL;
    END IF;
    IF p_strict AND v_tid !~ '^t-[0-9a-f]{16}$' THEN
      RETURN NULL;
    END IF;
    IF v_found IS NOT NULL AND v_found <> v_tid THEN
      RETURN NULL;
    END IF;
    v_found := v_tid;
  END LOOP;

  RETURN v_found;
END;
$$;

REVOKE EXECUTE ON FUNCTION vcon_tenant_stamp(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vcon_tenant_stamp(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION backfill_vcon_tenant_ids(
  p_batch_size int DEFAULT 1000,
  p_writer_rule boolean DEFAULT false
) RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_count bigint;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    RAISE EXCEPTION 'p_batch_size must be at least 1' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_writer_rule THEN
    WITH batch AS (
      SELECT v.id, coalesce(vcon_tenant_stamp(v.id, true), '_quarantine') AS tenant_id
        FROM vcons v
       WHERE v.tenant_id IS NULL
       LIMIT p_batch_size
       FOR UPDATE SKIP LOCKED
    )
    UPDATE vcons v
       SET tenant_id = batch.tenant_id
      FROM batch
     WHERE v.id = batch.id;
  ELSE
    WITH candidates AS (
      SELECT v.id, vcon_tenant_stamp(v.id, false) AS tenant_id
        FROM vcons v
       WHERE v.tenant_id IS NULL
         AND EXISTS (SELECT 1 FROM attachments a
                      WHERE a.vcon_id = v.id AND (a.purpose = 'tenant' OR a.type = 'tenant'))
    ),
    batch AS (
      SELECT v.id, c.tenant_id
        FROM candidates c
        JOIN vcons v ON v.id = c.id
       WHERE c.tenant_id IS NOT NULL
       LIMIT p_batch_size
       FOR UPDATE OF v SKIP LOCKED
    )
    UPDATE vcons v
       SET tenant_id = batch.tenant_id
      FROM batch
     WHERE v.id = batch.id;
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION backfill_vcon_tenant_ids(int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION backfill_vcon_tenant_ids(int, boolean) TO service_role;
