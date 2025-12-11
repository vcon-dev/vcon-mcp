-- Backfill S3 Sync for vCons from the past few days
-- This script helps you sync vCons that were created/updated in a specific time window

-- Option 1: Get vCons from the past N days (regardless of sync status)
-- This function is used by the Edge Function when since_days parameter is provided
CREATE OR REPLACE FUNCTION get_vcons_since_days(p_days INTEGER DEFAULT 7)
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
  WHERE v.updated_at >= NOW() - (p_days || ' days')::INTERVAL
  ORDER BY v.updated_at ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_vcons_since_days IS 'Returns all vCons updated in the past N days, regardless of sync status. Used for backfilling.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_vcons_since_days(INTEGER) TO service_role, authenticated, anon;

-- Option 2: Reset sync tracking for vCons from a specific date range
-- This will mark them as unsynced so they'll be picked up on the next sync
-- Replace the dates with your desired range
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Delete sync tracking for vCons updated in the past 7 days
  DELETE FROM s3_sync_tracking
  WHERE vcon_id IN (
    SELECT id FROM vcons 
    WHERE updated_at >= NOW() - INTERVAL '7 days'
  );
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Reset sync tracking for % vCons from the past 7 days', v_count;
END;
$$;

-- Option 3: View vCons that need syncing from the past N days
-- Run this to see what would be synced
SELECT 
  v.id,
  v.uuid,
  v.updated_at,
  s.synced_at,
  CASE 
    WHEN s.vcon_id IS NULL THEN 'Never synced'
    WHEN v.updated_at > s.synced_at THEN 'Updated since last sync'
    ELSE 'Up to date'
  END as sync_status
FROM vcons v
LEFT JOIN s3_sync_tracking s ON s.vcon_id = v.id
WHERE v.updated_at >= NOW() - INTERVAL '7 days'
ORDER BY v.updated_at DESC;

