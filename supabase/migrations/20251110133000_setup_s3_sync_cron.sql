-- Setup pg_cron to schedule S3 sync Edge Function
-- This migration enables pg_cron and schedules the sync-to-s3 Edge Function to run every 5 minutes

-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP requests (Supabase supports this)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Function to call the sync-to-s3 Edge Function
-- Note: Replace <your-project-ref> with your actual Supabase project reference
-- The Edge Function URL format is: https://<project-ref>.supabase.co/functions/v1/sync-to-s3
CREATE OR REPLACE FUNCTION call_sync_to_s3_edge_function()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_supabase_url TEXT;
  v_function_url TEXT;
  v_response_id BIGINT;
BEGIN
  -- Get Supabase URL from current_setting or use default pattern
  -- In production, you'll need to set this via: ALTER DATABASE postgres SET supabase.url = 'https://your-project.supabase.co';
  -- Or use the actual URL directly
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  
  -- If not set, construct from current database (this is a fallback - should be set explicitly)
  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    -- Try to extract from connection info or use a placeholder
    -- In production, you MUST set this via: ALTER DATABASE postgres SET app.settings.supabase_url = 'https://your-project.supabase.co';
    RAISE WARNING 'app.settings.supabase_url not set. Please set it using: ALTER DATABASE postgres SET app.settings.supabase_url = ''https://your-project.supabase.co'';';
    RETURN;
  END IF;
  
  -- Construct Edge Function URL
  v_function_url := v_supabase_url || '/functions/v1/sync-to-s3?limit=50';
  
  -- Make HTTP request using pg_net
  SELECT net.http_post(
    url := v_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  ) INTO v_response_id;
  
  -- Log the request (optional)
  RAISE NOTICE 'Scheduled sync-to-s3 Edge Function call. Request ID: %', v_response_id;
END;
$$;

COMMENT ON FUNCTION call_sync_to_s3_edge_function IS 'Calls the sync-to-s3 Edge Function to sync vCons to S3. Requires app.settings.supabase_url and app.settings.service_role_key to be set.';

-- Schedule the cron job to run every 5 minutes
-- Note: This will fail if pg_cron is not available or if the settings are not configured
-- You may need to configure this via Supabase Dashboard instead if pg_cron is restricted
DO $$
BEGIN
  -- Check if pg_cron is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule any existing job with the same name
    PERFORM cron.unschedule('sync-to-s3-job') WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'sync-to-s3-job'
    );
    
    -- Schedule the job to run every 5 minutes
    PERFORM cron.schedule(
      'sync-to-s3-job',
      '*/5 * * * *', -- Every 5 minutes
      'SELECT call_sync_to_s3_edge_function();'
    );
    
    RAISE NOTICE 'Cron job "sync-to-s3-job" scheduled to run every 5 minutes';
  ELSE
    RAISE WARNING 'pg_cron extension is not available. Please schedule the Edge Function via Supabase Dashboard → Edge Functions → Schedules';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Failed to schedule cron job: %. Please configure via Supabase Dashboard → Edge Functions → Schedules', SQLERRM;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION call_sync_to_s3_edge_function() TO service_role;

-- Instructions for manual setup if pg_cron is not available:
-- 1. Go to Supabase Dashboard → Edge Functions → Schedules
-- 2. Create a new schedule:
--    - Name: sync-to-s3
--    - Schedule: */5 * * * * (every 5 minutes)
--    - Function: sync-to-s3
--    - Method: GET
--    - Query params: limit=50

COMMENT ON EXTENSION pg_cron IS 'Enables scheduled jobs. If pg_cron is restricted, use Supabase Dashboard to schedule Edge Functions instead.';

