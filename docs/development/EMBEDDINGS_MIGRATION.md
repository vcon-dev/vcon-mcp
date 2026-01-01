# Embeddings Migration to npm Tool

## Overview

The embeddings functionality has been migrated from a Supabase Edge Function to a standalone npm tool. This provides better local development experience, easier debugging, and more control over the embedding generation process.

## What Changed

### Before (Edge Function)
- Embeddings were generated using a Supabase Edge Function
- Required deployment to Supabase
- Called via HTTP endpoints
- Required SUPABASE_ANON_KEY for authentication

### After (npm Tool)
- Embeddings generated using a local TypeScript script
- Runs directly in your development environment
- Uses Supabase client library directly
- Uses SUPABASE_SERVICE_ROLE_KEY (already in .env)

## npm Commands

```bash
# Recommended: continuous embedding generation
npm run sync:embeddings

# Full sync (vCons + embeddings + tags)
npm run sync

# Check embedding coverage
npm run embeddings:check
```

For more control, use the script directly:

```bash
npx tsx scripts/embed-vcons.ts --limit=500 --provider=openai
npx tsx scripts/embed-vcons.ts --continuous --delay=2
npx tsx scripts/embed-vcons.ts --mode=embed --vcon-id=<uuid>
```

## Benefits

1. **Easier Development** - No deployment needed, runs locally
2. **Better Debugging** - Full Node.js stack traces and console output
3. **Environment Management** - Automatically loads .env file
4. **Cost Effective** - No Edge Function invocation costs
5. **More Control** - Can run via cron, scripts, or manually

## Usage Examples

### Quick Start

```bash
# Full sync: load vCons + generate embeddings + refresh tags
npm run sync

# Or step by step:
npm run sync:vcons -- /path/to/vcons    # Load vCons
npm run sync:embeddings                  # Generate embeddings
```

### Continuous Sync (Production)

```bash
# Run sync continuously (every 5 minutes)
npm run sync:continuous
```

### Single vCon Embedding

```bash
npx tsx scripts/embed-vcons.ts --mode=embed --vcon-id=abc123...
```

### Force Specific Provider

```bash
# Use Hugging Face instead of OpenAI
npx tsx scripts/embed-vcons.ts --provider=hf
```

## Environment Variables

The tool requires these environment variables (typically in `.env`):

```bash
# Supabase connection
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Embedding provider (choose one)
# Option 1: OpenAI
OPENAI_API_KEY=sk-...          # For OpenAI text-embedding-3-small

# Option 2: Azure OpenAI
AZURE_OPENAI_EMBEDDING_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_EMBEDDING_API_KEY=your-azure-api-key

# Option 3: Hugging Face
HF_API_TOKEN=hf_...             # For Hugging Face sentence-transformers
```

## Scheduling

### Option 1: System Cron

```bash
# Edit crontab
crontab -e

# Run every 5 minutes
*/5 * * * * cd /path/to/vcon-mcp && /usr/bin/npm run embeddings:generate -- --limit=200 >> /var/log/embeddings.log 2>&1
```

### Option 2: Process Manager (systemd, supervisor, etc.)

Create a service that runs the backfill script periodically.

### Option 3: Manual After Bulk Imports

```bash
# Load data
npm run sync:vcons -- --hours=24

# Generate embeddings
npm run sync:embeddings
```

## Migration Notes

### If You Were Using the Edge Function

1. The Edge Function (`supabase/functions/embed-vcons/index.ts`) is still available if needed
2. Update any scheduled jobs or webhooks to use the npm tool instead
3. Remove SUPABASE_ANON_KEY from your workflow (not needed anymore)
4. The npm tool uses the same database schema and embedding models

### Backward Compatibility

- Same embedding dimensions (384)
- Same models (text-embedding-3-small or all-MiniLM-L6-v2)
- Same database schema (vcon_embeddings table)
- Existing embeddings remain unchanged

## Troubleshooting

### "Required environment variables not set"

Make sure your `.env` file exists and contains:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` or `HF_API_TOKEN`

### "No embedding provider configured"

Set either `OPENAI_API_KEY` or `HF_API_TOKEN` in your `.env` file.

### Rate Limits

If you hit OpenAI rate limits:
- Reduce batch size: `bash scripts/backfill-embeddings.sh 200 5`
- Increase delay between batches
- Check your OpenAI tier limits

### Script Exits Early

The backfill script automatically stops when all embeddings are generated. This is normal behavior.

## Technical Details

### Script Location

- Main tool: `scripts/embed-vcons.ts`
- Backfill wrapper: `scripts/backfill-embeddings.sh`

### How It Works

1. Queries database for content without embeddings
2. Extracts text from subjects, dialogs, and analyses
3. Generates embeddings via OpenAI or Hugging Face API
4. Stores embeddings in `vcon_embeddings` table with HNSW index
5. Repeats until no more content needs embedding

### Token Limits

- OpenAI: 250k tokens per batch (with per-item 8k token truncation)
- Hugging Face: Processes items sequentially

### Performance

- OpenAI: ~500 items in 2-5 seconds (depending on text length)
- Hugging Face: Slower, but free (3-5 seconds per item)

## See Also

- [INGEST_AND_EMBEDDINGS.md](./INGEST_AND_EMBEDDINGS.md) - Full ingestion guide
- [embeddings.md](./embeddings.md) - Technical embedding implementation details
- [search.md](../guide/search.md) - Using embeddings for semantic search




