# pg_cron Setup Guide for S3 Sync Automation

This guide will help you set up automated S3 sync using PostgreSQL's `pg_cron` extension instead of Supabase Edge Function schedules.

## Overview

The pg_cron approach:
- Uses PostgreSQL's native cron functionality
- Calls your Edge Function via HTTP from the database
- More reliable and configurable than Edge Function schedules
- Provides better logging and monitoring

## Prerequisites

- Supabase project with pg_cron extension enabled (it usually is by default)
- Service Role Key from your Supabase project
- Migrations applied to your database

## Step-by-Step Setup

### Step 0: Apply Migrations

First, ensure all migrations are applied to your remote database:

```bash
cd /Users/thomashowe/Documents/GitHub/vcon-mcp
supabase db push
```

This applies the `20251110133000_setup_s3_sync_cron.sql` migration which:
- Enables pg_cron and pg_net extensions
- Creates the `call_sync_to_s3_edge_function()` function
- Attempts to schedule the initial cron job

### Step 1: Configure Database Settings

1. Open Supabase SQL Editor:
   - URL: https://supabase.com/dashboard/project/ijuooeoejxyjmoxrwgzg/sql/new

2. Get your Service Role Key:
   - Go to: Dashboard → Settings → API
   - Copy the `service_role` key (the secret one, not anon)

3. Run the SQL from `scripts/configure-pg-cron-step1.sql`:
   - Replace `YOUR_SERVICE_ROLE_KEY_HERE` with your actual service role key
   - Execute the script

### Step 2: Verify Extensions and Function

Run `scripts/configure-pg-cron-step2.sql` in the SQL Editor to verify:
- pg_cron extension is enabled
- pg_net extension is enabled
- The `call_sync_to_s3_edge_function()` exists

If the function doesn't exist, go back to Step 0.

### Step 3: Schedule the Cron Job

Run `scripts/configure-pg-cron-step3.sql` to:
- Unschedule any existing job
- Schedule a new job to run every 1 minute (for testing)
- Verify the job was created

The cron expression can be changed:
- `*/1 * * * *` - Every 1 minute (testing)
- `*/5 * * * *` - Every 5 minutes
- `*/15 * * * *` - Every 15 minutes (recommended for production)

### Step 4: Monitor Execution

Use `scripts/configure-pg-cron-step4-monitor.sql` to:
- View active cron jobs
- Check recent job runs
- See any failures and error messages

## Updating the Sync Function

When you update the Edge Function code (`supabase/functions/sync-to-s3/index.ts`), deploy it:

```bash
supabase functions deploy sync-to-s3
```

The cron job will automatically call the updated version.

## Updating the Schedule

To change how often the sync runs:

```sql
-- Unschedule existing job
SELECT cron.unschedule('sync-to-s3-job');

-- Schedule with new timing
SELECT cron.schedule(
  'sync-to-s3-job',
  '*/15 * * * *',  -- Change this cron expression
  'SELECT call_sync_to_s3_edge_function();'
);
```

## Troubleshooting

### Job not running

1. Check if job is active:
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'sync-to-s3-job';
   ```
   The `active` column should be `true`.

2. Check job run history:
   ```sql
   SELECT * FROM cron.job_run_details 
   ORDER BY start_time DESC LIMIT 10;
   ```

### Seeing "app.settings.supabase_url not set" errors

Re-run Step 1 configuration. The ALTER DATABASE commands may not have persisted.

### HTTP request failures

1. Verify your Service Role Key is correct
2. Check that the Edge Function is deployed:
   ```bash
   supabase functions list
   ```
3. Test the function manually in your browser or with curl

## Viewing Edge Function Logs

Even though cron triggers the function, you can still view logs:
1. Go to: Dashboard → Edge Functions → sync-to-s3
2. Click on "Logs" or "Invocations"
3. You should see regular calls with the new logging showing vCon IDs

## Benefits of pg_cron Approach

1. **More Reliable**: Runs from the database, not dependent on Edge Function infrastructure
2. **Better Monitoring**: Full access to cron job execution history
3. **More Control**: Easy to pause, update, or reschedule
4. **No Manual Dashboard Setup**: Everything is code and migrations
5. **Works with CI/CD**: Can be automated completely

## Files Reference

- `supabase/migrations/20251110133000_setup_s3_sync_cron.sql` - Initial setup migration
- `scripts/configure-pg-cron-step1.sql` - Database configuration
- `scripts/configure-pg-cron-step2.sql` - Verification queries
- `scripts/configure-pg-cron-step3.sql` - Schedule/update cron job
- `scripts/configure-pg-cron-step4-monitor.sql` - Monitoring queries
- `supabase/functions/sync-to-s3/index.ts` - The Edge Function being called
- `supabase/functions/sync-to-s3/cron.json` - ⚠️ Not used with pg_cron approach

