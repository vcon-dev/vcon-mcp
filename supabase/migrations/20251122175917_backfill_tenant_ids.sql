-- Backfill tenant_id logic moved to external script to avoid timeouts
-- This migration creates a helper function to perform batched updates via RPC
-- The actual backfill is driven by scripts/backfill-tenant-ids.ts

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

  -- 9. S3_SYNC_TRACKING
  ELSIF p_table_name = 's3_sync_tracking' THEN
    WITH batch AS (
      SELECT s3.id, v.tenant_id
      FROM s3_sync_tracking s3
      JOIN vcons v ON s3.vcon_id = v.id
      WHERE s3.tenant_id IS DISTINCT FROM v.tenant_id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE s3_sync_tracking s3
    SET tenant_id = batch.tenant_id
    FROM batch
    WHERE s3.id = batch.id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSE
    RAISE EXCEPTION 'Unknown table name: %', p_table_name;
  END IF;

  RETURN v_count;
END;
$$;
