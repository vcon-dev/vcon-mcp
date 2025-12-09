# Scripts

Utility scripts for managing vCon data, database operations, and testing.

## Quick Reference

```bash
# Full sync: load vCons from S3 + generate embeddings + refresh tags
npm run sync

# Run sync continuously (every 5 minutes)
npm run sync:continuous

# Load vCons only (from S3, last 24 hours by default)
npm run sync:vcons
npm run sync:vcons -- --hours=48        # last 48 hours
npm run sync:vcons -- --hours=168       # last 7 days
npm run sync:vcons -- /path/to/vcons    # from local directory

# Generate embeddings continuously
npm run sync:embeddings

# Refresh tags materialized view only
npm run sync:tags

# Check database status
npm run db:status

# Check embedding coverage
npm run embeddings:check
```

## Sync Commands

| Command | Description |
|---------|-------------|
| `npm run sync` | Full sync: vCons + embeddings + tags (one-time) |
| `npm run sync:continuous` | Full sync running continuously every 5 min |
| `npm run sync:vcons` | Load vCons from S3 or local directory |
| `npm run sync:embeddings` | Generate embeddings for vCons without them |
| `npm run sync:tags` | Refresh tags materialized view |

### Customizing Sync

All scripts accept command-line arguments after `--`:

```bash
# Load last 7 days of vCons
npm run sync:vcons -- --hours=168

# Load from local directory
npm run sync:vcons -- /path/to/vcons

# Full sync with custom settings
npm run sync -- --hours=48 --embedding-limit=200

# Sync vCons only, skip embeddings and tags
npm run sync -- --no-embeddings --no-tags
```

### Environment Variables

```bash
# Required
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key

# For S3 loading (AWS credentials auto-detected)
VCON_S3_BUCKET=your-bucket-name
VCON_S3_PREFIX=optional/prefix/    # optional

# For embeddings
OPENAI_API_KEY=sk-...              # or HF_API_TOKEN

# For faster duplicate checking (optional)
REDIS_URL=redis://localhost:6379
```

## Database Commands

| Command | Description |
|---------|-------------|
| `npm run db:status` | Comprehensive database status |
| `npm run db:check` | Quick vCon count |
| `npm run db:analyze` | Daily count analysis (find gaps) |
| `npm run db:backup` | Backup from remote to local |
| `npm run db:restore` | Restore from backup file |

## Test Commands

| Command | Description |
|---------|-------------|
| `npm run test:db` | Test database tools |
| `npm run test:mcp` | Test MCP tools |
| `npm run test:search` | Test search functionality |
| `npm run test:tags` | Test tag system |
| `npm run test:tenant` | Test tenant isolation (RLS) |

## Individual Scripts

### Primary Scripts

| Script | Description |
|--------|-------------|
| `sync-all.ts` | Unified sync: vCons + embeddings + tags |
| `load-legacy-vcons.ts` | Load vCons from S3 or local directory |
| `embed-vcons.ts` | Generate embeddings for vCons |
| `check-db-status.ts` | Database status with table counts |
| `check-daily-counts.ts` | Identify data gaps by day |

### Migration Scripts

| Script | Description |
|--------|-------------|
| `migrate-to-rls.ts` | Enable Row Level Security |
| `migrate-to-remote.ts` | Push local data to remote DB |
| `migrate-tags-encoding.ts` | Fix tags attachment encoding |
| `backfill-tenant-ids.ts` | Backfill tenant_id column |

### Utility Scripts

| Script | Description |
|--------|-------------|
| `backup-from-remote.ts` | Backup remote DB |
| `backup-remote-cli.sh` | Backup using Supabase CLI |
| `restore-backup.sh` | Restore from SQL backup |
| `analyze-search-indexes.ts` | Analyze search index usage |

## Script Details

### sync-all.ts

The primary sync script. Runs three steps in sequence:
1. Load vCons from S3 (using `load-legacy-vcons.ts`)
2. Generate embeddings (using `embed-vcons.ts`)
3. Refresh tags materialized view

```bash
# All options
npx tsx scripts/sync-all.ts \
  --hours=24 \           # Hours to look back (default: 24)
  --batch-size=50 \      # vCons per batch
  --concurrency=3 \      # Parallel batches
  --embedding-limit=100 \ # Embeddings per batch
  --no-vcons \           # Skip vCon loading
  --no-embeddings \      # Skip embedding generation
  --no-tags \            # Skip tags refresh
  --sync \               # Run continuously
  --sync-interval=5 \    # Minutes between cycles
  --dry-run              # Validate only
```

### load-legacy-vcons.ts

Loads vCons from S3 or local directory. Handles legacy spec migration.

```bash
# From S3 (default if VCON_S3_BUCKET is set)
npx tsx scripts/load-legacy-vcons.ts --hours=24

# From local directory
npx tsx scripts/load-legacy-vcons.ts /path/to/vcons

# With continuous sync
npx tsx scripts/load-legacy-vcons.ts --sync --sync-interval=10
```

### embed-vcons.ts

Generates 384-dimensional embeddings using OpenAI or Hugging Face.

```bash
# Process 100 units (default)
npx tsx scripts/embed-vcons.ts

# Process 500 units with OpenAI
npx tsx scripts/embed-vcons.ts --limit=500 --provider=openai

# Run continuously until done
npx tsx scripts/embed-vcons.ts --continuous --delay=2

# Backfill oldest first
npx tsx scripts/embed-vcons.ts --continuous --oldest-first
```

## Archived Scripts

One-time fix scripts and deprecated sync scripts are in `archive/scripts/`.
See `archive/scripts/README.md` for details.
