-- S3 Sync Tracking Table and Helper Functions
-- 
-- NOTE: This script duplicates the migration in supabase/migrations/20251110132000_s3_sync_tracking.sql
-- Only use this script if you need to manually apply the migration (e.g., in Supabase Dashboard SQL Editor)
-- For normal development, the migration will be applied automatically via Supabase CLI
--
-- Run this in Supabase Dashboard → SQL Editor if needed

-- Create sync tracking table
CREATE TABLE IF NOT EXISTS s3_sync_tracking (
  vcon_id UUID PRIMARY KEY REFERENCES vcons(id) ON DELETE CASCADE,
  vcon_uuid UUID NOT NULL,
  s3_key TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  embedding_model TEXT,
  embedding_dimension INTEGER,
  CONSTRAINT fk_vcon_uuid FOREIGN KEY (vcon_uuid) REFERENCES vcons(uuid) ON DELETE CASCADE
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_s3_sync_tracking_synced_at ON s3_sync_tracking(synced_at);
CREATE INDEX IF NOT EXISTS idx_s3_sync_tracking_vcon_uuid ON s3_sync_tracking(vcon_uuid);
CREATE INDEX IF NOT EXISTS idx_s3_sync_tracking_s3_key ON s3_sync_tracking(s3_key);

-- Function to get unsynced vCons (new or updated since last sync)
CREATE OR REPLACE FUNCTION get_unsynced_vcons(p_limit INTEGER DEFAULT 50)
RETURNS TABLE(
  vcon_id UUID,
  vcon_uuid UUID,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id AS vcon_id,
    v.uuid AS vcon_uuid,
    v.updated_at
  FROM vcons v
  LEFT JOIN s3_sync_tracking s ON s.vcon_id = v.id
  WHERE 
    -- New vCons (never synced)
    s.vcon_id IS NULL
    OR
    -- Updated vCons (updated after last sync)
    v.updated_at > COALESCE(s.synced_at, '1970-01-01'::timestamptz)
  ORDER BY v.updated_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_unsynced_vcons IS 'Returns vCons that need syncing to S3 (new or updated since last sync)';

-- Function to check if embeddings are complete for a vCon
CREATE OR REPLACE FUNCTION check_vcon_embeddings_complete(p_vcon_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_has_subject BOOLEAN;
  v_subject_embedded BOOLEAN;
  v_dialog_count INTEGER;
  v_dialog_embedded_count INTEGER;
  v_analysis_count INTEGER;
  v_analysis_embedded_count INTEGER;
BEGIN
  -- Check if vCon has subject and if it's embedded
  SELECT 
    (v.subject IS NOT NULL AND v.subject <> ''),
    EXISTS(
      SELECT 1 FROM vcon_embeddings e 
      WHERE e.vcon_id = p_vcon_id 
      AND e.content_type = 'subject' 
      AND e.content_reference IS NULL
    )
  INTO v_has_subject, v_subject_embedded
  FROM vcons v
  WHERE v.id = p_vcon_id;

  -- If subject exists but not embedded, return false
  IF v_has_subject AND NOT v_subject_embedded THEN
    RETURN FALSE;
  END IF;

  -- Check dialog embeddings
  SELECT 
    COUNT(*),
    COUNT(DISTINCT e.id)
  INTO v_dialog_count, v_dialog_embedded_count
  FROM dialog d
  LEFT JOIN vcon_embeddings e ON 
    e.vcon_id = d.vcon_id 
    AND e.content_type = 'dialog' 
    AND e.content_reference = d.dialog_index::text
  WHERE d.vcon_id = p_vcon_id
    AND d.body IS NOT NULL 
    AND d.body <> '';

  -- If any dialog entries are not embedded, return false
  IF v_dialog_count > 0 AND v_dialog_count != v_dialog_embedded_count THEN
    RETURN FALSE;
  END IF;

  -- Check analysis embeddings (only for encoding='none' or NULL)
  SELECT 
    COUNT(*),
    COUNT(DISTINCT e.id)
  INTO v_analysis_count, v_analysis_embedded_count
  FROM analysis a
  LEFT JOIN vcon_embeddings e ON 
    e.vcon_id = a.vcon_id 
    AND e.content_type = 'analysis' 
    AND e.content_reference = a.analysis_index::text
  WHERE a.vcon_id = p_vcon_id
    AND a.body IS NOT NULL 
    AND a.body <> ''
    AND (a.encoding = 'none' OR a.encoding IS NULL);

  -- If any analysis entries are not embedded, return false
  IF v_analysis_count > 0 AND v_analysis_count != v_analysis_embedded_count THEN
    RETURN FALSE;
  END IF;

  -- All embeddings are complete
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_vcon_embeddings_complete IS 'Checks if all expected embeddings exist for a vCon (subject, dialog, analysis with encoding=none)';

-- Function to get all embeddings for a vCon in structured format
CREATE OR REPLACE FUNCTION get_vcon_embeddings(p_vcon_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB := '{}'::jsonb;
  v_subject_embedding JSONB;
  v_dialog_embeddings JSONB;
  v_analysis_embeddings JSONB;
BEGIN
  -- Get subject embedding
  SELECT jsonb_build_object(
    'embedding', e.embedding,
    'model', e.embedding_model,
    'dimension', e.embedding_dimension
  )
  INTO v_subject_embedding
  FROM vcon_embeddings e
  WHERE e.vcon_id = p_vcon_id 
    AND e.content_type = 'subject' 
    AND e.content_reference IS NULL
  LIMIT 1;

  IF v_subject_embedding IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('subject', v_subject_embedding);
  END IF;

  -- Get dialog embeddings
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'index', e.content_reference::integer,
      'embedding', e.embedding,
      'model', e.embedding_model,
      'dimension', e.embedding_dimension
    ) ORDER BY e.content_reference::integer
  ), '[]'::jsonb)
  INTO v_dialog_embeddings
  FROM vcon_embeddings e
  WHERE e.vcon_id = p_vcon_id 
    AND e.content_type = 'dialog';

  IF v_dialog_embeddings IS NOT NULL AND jsonb_array_length(v_dialog_embeddings) > 0 THEN
    v_result := v_result || jsonb_build_object('dialog', v_dialog_embeddings);
  END IF;

  -- Get analysis embeddings
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'index', e.content_reference::integer,
      'embedding', e.embedding,
      'model', e.embedding_model,
      'dimension', e.embedding_dimension
    ) ORDER BY e.content_reference::integer
  ), '[]'::jsonb)
  INTO v_analysis_embeddings
  FROM vcon_embeddings e
  WHERE e.vcon_id = p_vcon_id 
    AND e.content_type = 'analysis';

  IF v_analysis_embeddings IS NOT NULL AND jsonb_array_length(v_analysis_embeddings) > 0 THEN
    v_result := v_result || jsonb_build_object('analysis', v_analysis_embeddings);
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_vcon_embeddings IS 'Returns all embeddings for a vCon in structured JSONB format';

-- Function to mark a vCon as synced
CREATE OR REPLACE FUNCTION mark_vcon_synced(
  p_vcon_id UUID,
  p_vcon_uuid UUID,
  p_s3_key TEXT,
  p_embedding_model TEXT DEFAULT NULL,
  p_embedding_dimension INTEGER DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO s3_sync_tracking (
    vcon_id,
    vcon_uuid,
    s3_key,
    synced_at,
    updated_at,
    embedding_model,
    embedding_dimension
  )
  VALUES (
    p_vcon_id,
    p_vcon_uuid,
    p_s3_key,
    now(),
    now(),
    p_embedding_model,
    p_embedding_dimension
  )
  ON CONFLICT (vcon_id) 
  DO UPDATE SET
    s3_key = EXCLUDED.s3_key,
    synced_at = now(),
    updated_at = now(),
    embedding_model = COALESCE(EXCLUDED.embedding_model, s3_sync_tracking.embedding_model),
    embedding_dimension = COALESCE(EXCLUDED.embedding_dimension, s3_sync_tracking.embedding_dimension);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mark_vcon_synced IS 'Marks a vCon as synced to S3, updating the tracking table';

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON s3_sync_tracking TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION get_unsynced_vcons(INTEGER) TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION check_vcon_embeddings_complete(UUID) TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION get_vcon_embeddings(UUID) TO service_role, authenticated, anon;
GRANT EXECUTE ON FUNCTION mark_vcon_synced(UUID, UUID, TEXT, TEXT, INTEGER) TO service_role, authenticated, anon;

