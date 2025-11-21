-- ======================================================================
-- Ensure required extensions exist
-- ======================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ======================================================================
-- Create the sync-to-S3 function
-- This function calls your Edge Function using pg_net
-- Secrets come from the Edge Function environment, NOT Postgres GUCs
-- ======================================================================

CREATE OR REPLACE FUNCTION call_sync_to_s3_edge_function()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response jsonb;
BEGIN
  response := (
    SELECT net.http_post(
      url := 'https://ijuooeoejxyjmoxrwgzg.supabase.co/functions/v1/sync-to-s3?limit=125',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := '{}'::jsonb
    )::jsonb
  );

  RAISE LOG 'S3 sync triggered: %', response;
END;
$$;

-- ======================================================================
-- Remove existing cron job if present
-- ======================================================================
SELECT cron.unschedule('sync-to-s3-job')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-to-s3-job'
);

-- ======================================================================
-- Schedule cron job (every 15 minutes)
-- ======================================================================
SELECT cron.schedule(
  'sync-to-s3-job',
  '*/15 * * * *',
  'SELECT call_sync_to_s3_edge_function();'
);
