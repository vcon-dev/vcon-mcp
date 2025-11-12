# Scripts

This directory contains utility scripts for managing vCon data, database migrations, backups, and testing.

## Quick Reference

**Most Common Tasks:**
- **Load vCons from S3:** `npx tsx scripts/load-legacy-vcons.ts --hours=168` (last 7 days)
- **Check database status:** `npx tsx scripts/check-vcons.ts`
- **Backup from remote:** `./scripts/backup-remote-cli.sh` or `npx tsx scripts/backup-from-remote.ts`
- **Backfill embeddings:** `./scripts/backfill-embeddings.sh`
- **Enable RLS:** `npx tsx scripts/migrate-to-rls.ts`

**All 26 scripts are documented below.** No orphaned or deprecated scripts found.

## Table of Contents

- [Loading Scripts](#loading-scripts)
- [Backup Scripts](#backup-scripts)
- [Migration Scripts](#migration-scripts)
- [Backfill Scripts](#backfill-scripts)
- [Test Scripts](#test-scripts)
- [SQL Utility Scripts](#sql-utility-scripts)
- [Other Utilities](#other-utilities)

## Loading Scripts

### `load-vcons.ts`

Simple script for loading standard vCon files (spec 0.3.0) from a local directory. Processes files sequentially with validation.

**When to use:** Quick loading of a small number of standard vCon files from a local directory.

**Usage:**
```bash
npx tsx scripts/load-vcons.ts <directory_path>
```

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin operations

**Example:**
```bash
npx tsx scripts/load-vcons.ts /path/to/vcon/files
```

### `load-legacy-vcons.ts` ⭐ **Recommended**

Advanced script for loading vCon files from S3 or local directory. Handles both legacy spec versions (0.0.1, 0.1.0, 0.2.0) and current spec (0.3.0) with automatic migration. Supports parallel processing, Redis UUID tracking, retry logic, continuous sync mode, and RLS tenant management.

**When to use:** 
- Loading large datasets
- Loading from S3 bucket
- Loading legacy vCons that need migration
- Need parallel processing for performance
- Want continuous sync mode

**Usage:**
```bash
# Load from S3 (default - last 24 hours)
npx tsx scripts/load-legacy-vcons.ts

# Load from local directory
npx tsx scripts/load-legacy-vcons.ts /path/to/vcons

# Load with custom settings
npx tsx scripts/load-legacy-vcons.ts /path/to/vcons --batch-size=100 --concurrency=5

# Continuous sync mode
npx tsx scripts/load-legacy-vcons.ts --sync
```

**Options:**
- `--batch-size=N` - Files per batch (default: 50)
- `--concurrency=N` - Concurrent batches (default: 3)
- `--retry-attempts=N` - Max retries (default: 3)
- `--retry-delay=N` - Delay between retries in ms (default: 1000)
- `--dry-run` - Validate without loading
- `--hours=N` - For S3: hours to look back (default: 24)
- `--prefix=PREFIX` - For S3: filter by prefix
- `--sync` - Enable continuous sync mode
- `--sync-interval=N` - Minutes between sync checks (default: 5)

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key
- `REDIS_URL` - Redis connection URL (optional, for UUID tracking)
- `VCON_S3_BUCKET` - S3 bucket name (for S3 mode)
- `VCON_S3_PREFIX` - S3 prefix/folder path (optional)
- `AWS_REGION` - AWS region (default: us-east-1)
- AWS credentials (auto-detected from environment, credentials file, or IAM roles)

**RLS / Multi-Tenant Environment Variables:**
- `RLS_ENABLED` - Enable Row Level Security (set to 'true' to enable)
- `TENANT_ATTACHMENT_TYPE` - Attachment type containing tenant info (default: 'tenant')
- `TENANT_JSON_PATH` - JSON path to tenant ID in attachment (default: 'id')
  - Example: 'id' for `body.id`, 'tenant.id' for `body.tenant.id`

**RLS Features:**
- Automatically extracts `tenant_id` from vCon attachments during load
- Automatically backfills `tenant_id` after loading if attachments exist in database
- Reports statistics on tenant assignment in summary
- Warns about vCons loaded without tenant_id (accessible to all tenants)
- Tenant ID is extracted using the same logic as `VConQueries.createVCon()`

**Comparison with `load-vcons.ts`:**
- `load-vcons.ts`: Simple, sequential, local only, good for small batches
- `load-legacy-vcons.ts`: Advanced, parallel, S3 support, migration, better for large datasets

### `load-existing-uuids.ts`

Loads existing vCon UUIDs from PostgreSQL into Redis for faster duplicate checking during bulk imports.

**Usage:**
```bash
# Load current month
npx tsx scripts/load-existing-uuids.ts

# Load specific month
npx tsx scripts/load-existing-uuids.ts --month=10 --year=2024

# Load date range
npx tsx scripts/load-existing-uuids.ts --start-date=2024-10-01 --end-date=2024-10-31

# Dry run
npx tsx scripts/load-existing-uuids.ts --month=10 --dry-run
```

**Options:**
- `--dry-run` - Don't load into Redis
- `--batch-size=N` - Batch size (default: 1000)
- `--start-date=YYYY-MM-DD` - Start date
- `--end-date=YYYY-MM-DD` - End date
- `--month=N` - Month number (1-12)
- `--year=YYYY` - Year

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `REDIS_URL` - Redis connection URL (default: redis://localhost:6379)

## Backup Scripts

### `backup-from-remote.ts`

TypeScript script that exports all vCons from a remote Supabase database and imports them into a local database. Provides detailed progress reporting and error handling.

**When to use:** When you need programmatic control, detailed error reporting, or want to customize the backup process.

**Usage:**
```bash
LOCAL_SUPABASE_URL=http://127.0.0.1:54321 \
LOCAL_SUPABASE_KEY=your_local_key \
REMOTE_SUPABASE_URL=https://your-project.supabase.co \
REMOTE_SUPABASE_KEY=your_remote_key \
npx tsx scripts/backup-from-remote.ts
```

**Options:**
- `CLEAR_LOCAL=true` - Clear local database before import
- `EXPORT_BATCH_SIZE=N` - Batch size for export (default: 100)
- `IMPORT_BATCH_SIZE=N` - Batch size for import (default: 100)

**Environment Variables:**
- `LOCAL_SUPABASE_URL` - Local Supabase URL (default: http://127.0.0.1:54321)
- `LOCAL_SUPABASE_KEY` - Local Supabase key (or use SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY)
- `REMOTE_SUPABASE_URL` - Remote Supabase URL
- `REMOTE_SUPABASE_KEY` - Remote Supabase service role key

### `backup-remote-cli.sh`

Bash script that uses Supabase CLI's built-in `db dump` command to backup remote database. Faster and more reliable for full database backups.

**When to use:** When you want a quick, simple backup using Supabase CLI tools.

**Usage:**
```bash
# Link your project first
supabase link --project-ref your-project-ref

# Run backup
./scripts/backup-remote-cli.sh
```

**Requirements:**
- Supabase CLI installed and linked to your project
- Output saved to `./backups/backup_YYYYMMDD_HHMMSS.sql`

**Comparison with `backup-from-remote.ts`:**
- `backup-remote-cli.sh`: Uses Supabase CLI, faster, simpler, full database dump
- `backup-from-remote.ts`: Programmatic, vCon-specific, more control, detailed reporting

### `restore-backup.sh`

Restores a SQL backup file to the local Supabase database.

**Usage:**
```bash
./scripts/restore-backup.sh ./backups/backup_20251112_120000.sql
```

**Requirements:**
- Local Supabase running (`supabase start`)
- PostgreSQL client tools

## Migration Scripts

### `migrate-to-rls.ts`

Migrates database to enable Row Level Security (RLS) for multi-tenant support. Adds `tenant_id` column and RLS policies.

**Usage:**
```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your_key \
RLS_ENABLED=true \
TENANT_ATTACHMENT_TYPE=tenant \
TENANT_JSON_PATH=id \
npx tsx scripts/migrate-to-rls.ts
```

**Options:**
- `--dry-run` - Show what would be done without making changes
- `--skip-rls` - Skip enabling RLS (only populate tenant_id)

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key
- `RLS_ENABLED` - Enable RLS (true/false)
- `TENANT_ATTACHMENT_TYPE` - Attachment type containing tenant info
- `TENANT_JSON_PATH` - JSON path to tenant ID in attachment

### `migrate-tags-encoding.ts`

One-time migration script to fix tags attachment encoding. Updates all tags attachments to use `encoding='json'` since the body contains JSON-stringified arrays.

**When to use:** After loading vCons with tags attachments that have incorrect encoding (e.g., `encoding='none'` instead of `encoding='json'`).

**Usage:**
```bash
npx tsx scripts/migrate-tags-encoding.ts
```

**What it does:**
- Finds all attachments with `type='tags'`
- Analyzes current encoding state
- Updates attachments to use `encoding='json'` if body contains valid JSON
- Provides detailed statistics on the migration

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key

### `migrate-to-remote.ts`

Migrates all vCons from local database to remote Supabase project. Exports from local, clears remote, and imports all vCons.

**When to use:** When you want to push your local development data to a remote/production database.

**Usage:**
```bash
LOCAL_SUPABASE_URL=http://127.0.0.1:54321 \
LOCAL_SUPABASE_KEY=your_local_key \
REMOTE_SUPABASE_URL=https://your-project.supabase.co \
REMOTE_SUPABASE_KEY=your_remote_key \
npx tsx scripts/migrate-to-remote.ts
```

**Options:**
- `EXPORT_BATCH_SIZE=N` - Batch size for export (default: 100)
- `IMPORT_BATCH_SIZE=N` - Batch size for import (default: 100)

**Environment Variables:**
- `LOCAL_SUPABASE_URL` - Local Supabase URL (default: http://127.0.0.1:54321)
- `LOCAL_SUPABASE_KEY` - Local Supabase service role key
- `REMOTE_SUPABASE_URL` - Remote Supabase URL
- `REMOTE_SUPABASE_KEY` - Remote Supabase service role key

**Warning:** This script clears all existing data in the remote database before importing.

### `sync-remote-schema.ts`

Synchronizes schema information from remote Supabase database to local. Queries remote database to get schema information and migration history.

**When to use:** When you need to inspect or compare the remote database schema with local.

**Usage:**
```bash
REMOTE_SUPABASE_URL=https://your-project.supabase.co \
REMOTE_SUPABASE_SERVICE_ROLE_KEY=your_key \
npx tsx scripts/sync-remote-schema.ts
```

**Environment Variables:**
- `REMOTE_SUPABASE_URL` - Remote Supabase URL
- `REMOTE_SUPABASE_SERVICE_ROLE_KEY` - Remote service role key

### `pull-remote-migrations.ts`

Pulls missing migrations from remote Supabase database and creates local migration files. Useful when remote has migrations that don't exist locally.

**When to use:** When you need to sync migration files from a remote database that has migrations not in your local repository.

**Usage:**
```bash
REMOTE_SUPABASE_URL=https://your-project.supabase.co \
REMOTE_SUPABASE_SERVICE_ROLE_KEY=your_key \
npx tsx scripts/pull-remote-migrations.ts
```

**Environment Variables:**
- `REMOTE_SUPABASE_URL` - Remote Supabase URL (default: from SUPABASE_URL)
- `REMOTE_SUPABASE_SERVICE_ROLE_KEY` - Remote service role key (or use SUPABASE_SERVICE_ROLE_KEY)

**What it does:**
- Queries remote database for migration history
- Compares with local migration files
- Downloads and creates local migration files for missing migrations
- Saves migrations to `supabase/migrations/` directory

## Backfill Scripts

### `backfill-s3-sync.sh`

Repeatedly calls the sync-to-s3 Edge Function to process all vCons from the past N days in batches.

**Usage:**
```bash
# Set required environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export SUPABASE_API_KEY="your-api-key"  # or SUPABASE_ANON_KEY

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

**Environment Variables:**
- `SUPABASE_URL` - Required: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Required: Your service role key
- `SUPABASE_API_KEY` or `SUPABASE_ANON_KEY` - Required: Your API key

**Requirements:**
- `curl` (usually pre-installed)
- `jq` (optional, for better output parsing): `brew install jq` or `apt-get install jq`

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

### `backfill-embeddings.sh`

Continuously calls the embed-vcons function until all text units are embedded.

**Usage:**
```bash
# Set required environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"

# Run with defaults (batch size 500, delay 2s)
./scripts/backfill-embeddings.sh

# Custom batch size and delay
./scripts/backfill-embeddings.sh 1000 5
```

**Parameters:**
1. `batch_size` - Items per batch (default: 500)
2. `delay_seconds` - Delay between batches (default: 2)

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL (default: http://127.0.0.1:54321)
- `SUPABASE_ANON_KEY` - Required: Your anon key

## Test Scripts

### `test-database-tools.ts`

Tests database inspection and performance tools. Demonstrates database shape, stats, and query analysis.

**Usage:**
```bash
npx tsx scripts/test-database-tools.ts
```

### `test-mcp-tools.ts`

Tests MCP tools functionality.

**Usage:**
```bash
npx tsx scripts/test-mcp-tools.ts
```

### `test-server.ts`

Verifies the MCP server is running and responds to queries.

**Usage:**
```bash
npx tsx scripts/test-server.ts
```

### `test-search-tools.ts`

Tests keyword, semantic, and hybrid search functionality.

**Usage:**
```bash
npx tsx scripts/test-search-tools.ts
```

### `test-semantic-search.ts`

Tests semantic search specifically.

**Usage:**
```bash
npx tsx scripts/test-semantic-search.ts
```

### `test-tags.ts`

Tests tag functionality.

**Usage:**
```bash
npx tsx scripts/test-tags.ts
```

### `verify-search-by-tags.ts`

Verifies search by tags functionality.

**Usage:**
```bash
npx tsx scripts/verify-search-by-tags.ts
```

## SQL Utility Scripts

### `apply-s3-sync-migration.sql`

⚠️ **Note:** This script duplicates the migration in `supabase/migrations/20251110132000_s3_sync_tracking.sql`. Only use this script if you need to manually apply the migration (e.g., in Supabase Dashboard SQL Editor). For normal development, the migration will be applied automatically via Supabase CLI.

One-time migration script for S3 sync functionality. Creates the `s3_sync_tracking` table and helper functions needed for S3 synchronization.

**When to use:** Only if you need to manually apply the migration outside of the normal migration process.

**Usage:**
```bash
# Via psql
psql $DATABASE_URL -f scripts/apply-s3-sync-migration.sql

# Or copy/paste into Supabase Dashboard SQL Editor
```

### `backfill-s3-sync.sql`

SQL script for backfilling S3 sync data.

**Usage:**
```bash
psql -f scripts/backfill-s3-sync.sql
```

### `check-embedding-coverage.sql`

Checks which vCons have embeddings and which don't.

**Usage:**
```bash
psql -f scripts/check-embedding-coverage.sql
```

### `cleanup-non-text-embeddings.sql`

Cleans up embeddings for non-text content.

**Usage:**
```bash
psql -f scripts/cleanup-non-text-embeddings.sql
```

## Other Utilities

### `check-vcons.ts`

Checks vCon loading status. Verifies how many vCons are in the database and shows recent activity.

**Usage:**
```bash
npx tsx scripts/check-vcons.ts
```

### `generate-embeddings-v2.ts`

Generates embeddings for vCons using OpenAI's text-embedding-3-small model (384 dimensions). Processes subject, dialog, and analysis content that doesn't have embeddings yet.

**When to use:** For local development or one-time backfilling of embeddings. For production, use the `embed-vcons` Edge Function or `backfill-embeddings.sh` instead.

**Usage:**
```bash
npx tsx scripts/generate-embeddings-v2.ts
```

**What it does:**
- Finds vCons with missing embeddings (subject, dialog, analysis)
- Filters analysis to only process `encoding='none'` or NULL (text content)
- Generates embeddings using OpenAI API
- Inserts embeddings into `vcon_embeddings` table
- Processes in batches with progress reporting

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL (default: http://127.0.0.1:54321)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key
- `OPENAI_API_KEY` - Required: OpenAI API key for embeddings

**Note:** This script processes all missing embeddings. For large datasets, consider using the Edge Function with backfill mode instead.

## Environment Variables Summary

Most scripts require these common environment variables:

- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin operations
- `SUPABASE_ANON_KEY` - Anonymous key for client operations
- `SUPABASE_API_KEY` - API key (alternative to anon key)
- `REDIS_URL` - Redis connection URL (optional, for UUID tracking)

Scripts that use S3 also require:
- `VCON_S3_BUCKET` - S3 bucket name
- `VCON_S3_PREFIX` - S3 prefix/folder path (optional)
- `AWS_REGION` - AWS region (default: us-east-1)
- AWS credentials (auto-detected from environment, credentials file, or IAM roles)

## Script Status

### Active / Recommended Scripts
- ⭐ `load-legacy-vcons.ts` - **Primary loader** - handles both legacy and current vCons, S3 support, RLS management
- ✅ `backup-from-remote.ts` - Active backup solution
- ✅ `backup-remote-cli.sh` - Active backup solution (CLI-based)
- ✅ `migrate-to-rls.ts` - Active RLS migration tool
- ✅ `check-vcons.ts` - Active status checker
- ✅ `backfill-s3-sync.sh` - Active S3 sync backfill
- ✅ `backfill-embeddings.sh` - Active embedding backfill

### Utility Scripts
- 🔧 `load-vcons.ts` - Simple loader for small batches (use `load-legacy-vcons.ts` for most cases)
- 🔧 `load-existing-uuids.ts` - Utility for UUID pre-loading
- 🔧 `migrate-tags-encoding.ts` - One-time migration utility
- 🔧 `migrate-to-remote.ts` - Data migration utility
- 🔧 `sync-remote-schema.ts` - Schema inspection utility
- 🔧 `pull-remote-migrations.ts` - Migration sync utility
- 🔧 `generate-embeddings-v2.ts` - Local embedding generation (use Edge Function for production)

### Test Scripts
- 🧪 All `test-*.ts` and `verify-*.ts` scripts are for development and debugging

### SQL Utility Scripts
- 📄 `apply-s3-sync-migration.sql` - Manual migration (duplicate of migration file)
- 📄 `backfill-s3-sync.sql` - SQL utility for S3 backfill
- 📄 `check-embedding-coverage.sql` - Analysis query
- 📄 `cleanup-non-text-embeddings.sql` - Cleanup utility

## Notes

- All TypeScript scripts use `tsx` for execution
- Bash scripts require appropriate permissions (`chmod +x`)
- SQL scripts should be run with appropriate database credentials
- Test scripts are for development and debugging
- Backup scripts create files in `./backups/` directory (gitignored)
- Temporary files like `temp_loaded_uuids.json` are gitignored
- Scripts prefixed with "legacy" in the name (like `load-legacy-vcons.ts`) actually handle both legacy and current vCons - the name refers to legacy spec migration capability, not that the script itself is legacy
