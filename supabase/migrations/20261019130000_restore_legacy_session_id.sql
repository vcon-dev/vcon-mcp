-- CON-1242: restore dialog.session_id values invented by the 2025-11 data migration.
--
-- 20251120150200_data_migration.sql converted every TEXT session_id to
-- {"local": <old text>, "remote": "nil"}. "nil" was never in the source data,
-- so those objects claim a remote session id nobody supplied. vcon-mcp now
-- accepts a legacy string session_id as-is (see SessionIdSchema), so put the
-- original value back as a JSON string.
--
-- Only rows still holding exactly the invented object are touched: a row whose
-- session_id was rewritten since (an update_dialog with a real SessionId, say)
-- no longer matches and is left alone. session_id_legacy is kept. Re-running
-- is a no-op, since restored rows no longer match.
--
-- Batched like the original conversion so large dialog tables don't hold one
-- long lock.

DO $$
DECLARE
  batch_size INTEGER := 1000;
  updated INTEGER;
  total INTEGER := 0;
BEGIN
  LOOP
    UPDATE dialog
    SET session_id = to_jsonb(session_id_legacy)
    WHERE id IN (
      SELECT id FROM dialog
      WHERE session_id_legacy IS NOT NULL
        AND session_id = jsonb_build_object('local', session_id_legacy, 'remote', 'nil')
      LIMIT batch_size
    );
    GET DIAGNOSTICS updated = ROW_COUNT;
    total := total + updated;
    EXIT WHEN updated = 0;
  END LOOP;

  RAISE NOTICE 'Restored % legacy session_id values', total;
END $$;
