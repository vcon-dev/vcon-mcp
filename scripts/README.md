# Scripts

## S3 Sync Backfill

### `backfill-s3-sync.sh`

Repeatedly calls the sync-to-s3 Edge Function to process all vCons from the past N days in batches.

**Usage:**
```bash
# Set your service role key
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Backfill last 7 days (default)
./scripts/backfill-s3-sync.sh

# Backfill last 3 days
./scripts/backfill-s3-sync.sh 3

# Backfill with custom batch size (50) and delay (5 seconds)
./scripts/backfill-s3-sync.sh 7 50 5

# Backfill last 30 days with large batches
./scripts/backfill-s3-sync.sh 30 100 1
```

**Parameters:**
1. `days` - Number of days to go back (default: 7)
2. `batch_size` - Number of vCons per batch (default: 50)
3. `delay` - Seconds to wait between batches (default: 2)

**Example Output:**
```
Starting S3 sync backfill...
  Days to backfill: 7
  Batch size: 50
  Delay between batches: 2s

[Batch 1] Syncing up to 50 vCons from the past 7 days...
  ✓ Synced: 50 | Embedded: 12 | Errors: 0 | Total processed: 50
  Waiting 2s before next batch...
[Batch 2] Syncing up to 50 vCons from the past 7 days...
  ✓ Synced: 50 | Embedded: 8 | Errors: 0 | Total processed: 50
  Waiting 2s before next batch...
[Batch 3] Syncing up to 50 vCons from the past 7 days...
  ✓ Synced: 23 | Embedded: 5 | Errors: 0 | Total processed: 23
✓ All vCons processed (processed 23 < batch size 50)

═══════════════════════════════════════
Backfill Complete!
═══════════════════════════════════════
  Total batches: 3
  Total synced: 123
  Total embedded: 25
  Total errors: 0
```

**Requirements:**
- `curl` (usually pre-installed)
- `jq` (optional, for better output parsing): `brew install jq` or `apt-get install jq`
- `SUPABASE_SERVICE_ROLE_KEY` environment variable

**Environment Variables:**
- `SUPABASE_SERVICE_ROLE_KEY` - Required: Your Supabase service role key
- `SUPABASE_URL` - Optional: Defaults to your linked project
- `SUPABASE_API_KEY` - Optional: Defaults to anon key
