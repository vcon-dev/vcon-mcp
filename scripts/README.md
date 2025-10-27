# Scripts

Utility scripts for managing vCons, embeddings, and database operations.

## Data Loading Scripts

### `load-vcons.ts` - Standard vCon Loader
Load standard vCon files from a directory into the database. Designed for vCon files that already conform to the current specification (0.3.0).

**Usage:**
```bash
# Load from default directory
npx tsx scripts/load-vcons.ts

# Load from specific directory
npx tsx scripts/load-vcons.ts /path/to/vcon/files
```

**Features:**
- Validates vCon structure before loading
- Skips vCons that already exist in database
- Provides detailed progress reporting
- Handles errors gracefully with detailed messages
- Sequential processing for reliability

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin operations

### `load-legacy-vcons.ts` - Legacy vCon Loader with Migration
Load and migrate legacy vCon files (pre-0.3.0 spec) to the current specification. Optimized for bulk loading with performance features.

**Usage:**
```bash
# Basic usage with defaults
npx tsx scripts/load-legacy-vcons.ts

# Load from specific directory with custom settings
npx tsx scripts/load-legacy-vcons.ts /path/to/vcons --batch-size=100 --concurrency=5

# Dry run to test migration without loading
npx tsx scripts/load-legacy-vcons.ts --dry-run

# Conservative settings for large datasets
npx tsx scripts/load-legacy-vcons.ts --batch-size=25 --concurrency=2 --retry-attempts=5
```

**Command Line Options:**
- `--batch-size=N` - Number of files per batch (default: 50)
- `--concurrency=N` - Number of concurrent batches (default: 3)
- `--retry-attempts=N` - Max retry attempts for failed files (default: 3)
- `--retry-delay=N` - Delay between retries in ms (default: 1000)
- `--dry-run` - Validate files but don't load into database

**Migration Features:**
- Automatic migration from legacy spec versions (0.0.1, 0.1.0, 0.2.0) to 0.3.0
- Encoding normalization (converts 'text' encoding to 'none' for plain text)
- Preserves all other vCon data unchanged

**Performance Features:**
- Redis-based UUID tracking for fast duplicate detection
- Falls back to temporary file if Redis unavailable
- Parallel processing with configurable concurrency
- Progress reporting with ETA calculations
- Retry logic with exponential backoff

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin operations
- `REDIS_URL` - Redis connection URL (optional, defaults to localhost:6379)

### `load-existing-uuids.ts` - UUID Preloader
Load existing vCon UUIDs from PostgreSQL into Redis for faster duplicate checking during bulk operations.

**Usage:**
```bash
# Load current month
npx tsx scripts/load-existing-uuids.ts

# Load October 2024
npx tsx scripts/load-existing-uuids.ts --month=10 --year=2024

# Load specific date range
npx tsx scripts/load-existing-uuids.ts --start-date=2024-10-01 --end-date=2024-10-31

# Dry run to see what would be loaded
npx tsx scripts/load-existing-uuids.ts --month=10 --dry-run
```

**Command Line Options:**
- `--dry-run` - Don't actually load into Redis
- `--batch-size=N` - Batch size for processing (default: 1000)
- `--start-date=YYYY-MM-DD` - Start date (ISO format)
- `--end-date=YYYY-MM-DD` - End date (ISO format)
- `--month=N` - Load specific month (1-12)
- `--year=YYYY` - Load specific year (default: current year)

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin operations
- `REDIS_URL` - Redis connection URL (optional, defaults to localhost:6379)

## Migration Workflow

### Recommended Migration Process

1. **Preload UUIDs (Optional but Recommended)**
   ```bash
   # Load existing UUIDs into Redis for faster duplicate checking
   npx tsx scripts/load-existing-uuids.ts --month=10 --year=2024
   ```

2. **Test Migration with Dry Run**
   ```bash
   # Test the migration process without actually loading data
   npx tsx scripts/load-legacy-vcons.ts /path/to/legacy/vcons --dry-run
   ```

3. **Run Migration with Conservative Settings**
   ```bash
   # Start with conservative settings for large datasets
   npx tsx scripts/load-legacy-vcons.ts /path/to/legacy/vcons \
     --batch-size=25 \
     --concurrency=2 \
     --retry-attempts=5 \
     --retry-delay=2000
   ```

4. **Scale Up for Performance**
   ```bash
   # Once stable, increase batch size and concurrency
   npx tsx scripts/load-legacy-vcons.ts /path/to/legacy/vcons \
     --batch-size=100 \
     --concurrency=5 \
     --retry-attempts=3
   ```

### Performance Tuning Guidelines

**Batch Size Recommendations:**
- **Small datasets (< 1,000 files)**: 50-100 files per batch
- **Medium datasets (1,000-10,000 files)**: 100-200 files per batch
- **Large datasets (> 10,000 files)**: 200-500 files per batch

**Concurrency Recommendations:**
- **Conservative**: 2-3 concurrent batches
- **Balanced**: 3-5 concurrent batches
- **Aggressive**: 5-10 concurrent batches (monitor system resources)

**Retry Configuration:**
- **Stable network**: 3 attempts, 1-2 second delay
- **Unstable network**: 5 attempts, 2-5 second delay
- **Rate-limited APIs**: 3 attempts, 5-10 second delay

**Redis Integration:**
- Use Redis for UUID tracking when processing large datasets
- Falls back to temporary file if Redis unavailable
- Preload existing UUIDs for better performance

## Embeddings

### `generate-embeddings-v2.ts`
Generate embeddings locally using OpenAI API. Processes subject lines, dialog text, and analysis with `encoding='none'`.

```bash
# Process 100 text units per batch with 2s delay
npx tsx scripts/generate-embeddings-v2.ts 100 2

# Process 200 per batch with 5s delay
npx tsx scripts/generate-embeddings-v2.ts 200 5
```

Features:
- Filters for text-based analysis (`encoding='none'`)
- Prioritizes encoding='none' content
- Token-aware batching
- Automatic retry with fallback to individual items
- Progress reporting

### `backfill-embeddings.sh`
Process all unembedded conversations in batches with rate limiting using the Supabase Edge Function.

```bash
# Default settings (500/batch, 2s delay)
./scripts/backfill-embeddings.sh

# Custom batch size and delay
./scripts/backfill-embeddings.sh [batch_size] [delay_seconds]
```

**Examples:**

```bash
# Conservative: 200 per batch, 5s delay
./scripts/backfill-embeddings.sh 200 5

# Aggressive: 500 per batch, 0.5s delay  
./scripts/backfill-embeddings.sh 500 0.5

# Very conservative: 100 per batch, 10s delay
./scripts/backfill-embeddings.sh 100 10
```

The script will:
- Loop until all text units are embedded
- Show progress for each batch
- Display total counts
- Stop automatically when complete

**Rate Limit Guidelines:**

OpenAI Tier 1 limits for `text-embedding-3-small`:
- 5,000 requests/minute
- 5,000,000 tokens/minute

Recommended settings by tier:
- **Tier 1**: `500 2` (500/batch, 2s delay) = ~15k items/min
- **Tier 2**: `500 1` (500/batch, 1s delay) = ~30k items/min  
- **Free tier**: `100 10` (100/batch, 10s delay) = ~600 items/min

### `check-embedding-coverage.sql`
Check which analysis encodings have embeddings and coverage statistics.

```bash
psql $DATABASE_URL -f scripts/check-embedding-coverage.sql
```

Shows:
- Analysis encoding distribution
- Embedding coverage by encoding type
- Count of embeddings for non-text encodings
- Sample of analysis types and encodings

### `cleanup-non-text-embeddings.sql`
Optionally remove embeddings for analysis with `encoding='base64url'` or `encoding='json'`.

```bash
# Review what would be deleted (safe, read-only)
psql $DATABASE_URL -f scripts/cleanup-non-text-embeddings.sql
```

**Warning:** This permanently deletes data. Review the preview queries first before uncommenting the DELETE statement.

### `test-semantic-search.ts`
Test semantic search functionality with sample queries.

```bash
npx tsx scripts/test-semantic-search.ts
```

## Testing

### `test-mcp-tools.ts`
Test MCP server tools and operations.

```bash
npx tsx scripts/test-mcp-tools.ts
```

### `test-server.ts`
Test basic MCP server connectivity.

```bash
npx tsx scripts/test-server.ts
```

## Environment Variables

All scripts require:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin operations
- `OPENAI_API_KEY` - (For embeddings) OpenAI API key

For local development with `supabase start`:
```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

See `.env.example` for a complete list.

## Troubleshooting

### Common Issues

**Database Connection Errors:**
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set correctly
- Check if Supabase service is running (for local development)
- Ensure service role key has sufficient permissions

**Redis Connection Issues:**
- Script will fall back to temporary file if Redis unavailable
- Check `REDIS_URL` environment variable
- Verify Redis server is running and accessible

**Memory Issues with Large Datasets:**
- Reduce `--batch-size` to process fewer files at once
- Reduce `--concurrency` to limit parallel processing
- Monitor system memory usage during processing

**Rate Limiting:**
- Increase `--retry-delay` between attempts
- Reduce `--concurrency` to limit concurrent requests
- Consider processing in smaller time windows

**Migration Failures:**
- Use `--dry-run` to test migration without loading data
- Check error logs for specific failure reasons
- Verify vCon files are valid JSON and have required fields

**Performance Issues:**
- Preload UUIDs with `load-existing-uuids.ts` for better duplicate detection
- Use Redis for UUID tracking instead of temporary files
- Adjust batch size and concurrency based on system resources

### Error Codes

- **Validation errors**: vCon structure doesn't match expected format
- **Duplicate key errors**: vCon already exists in database
- **Connection timeouts**: Network or database connectivity issues
- **Rate limit errors**: Too many requests to external services
- **Memory errors**: System running out of available memory

### Getting Help

1. Check the error messages in the console output
2. Review the error summary at the end of processing
3. Use `--dry-run` mode to test without making changes
4. Check environment variables and database connectivity
5. Review the migration workflow documentation above

