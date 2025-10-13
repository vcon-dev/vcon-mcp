# Scripts

Utility scripts for managing vCons and embeddings.

## Data Loading

### `load-vcons.ts`
Load standard vCon files from a directory into the database.

```bash
npx tsx scripts/load-vcons.ts /path/to/vcon/files
```

### `load-legacy-vcons.ts`
Load and migrate legacy vCon files (pre-0.3.0 spec) to the current specification.

```bash
npx tsx scripts/load-legacy-vcons.ts /path/to/legacy/vcons
```

Features:
- Idempotent (skips already loaded vCons)
- Validates vCon structure
- Reports success/failure statistics
- Migrates old spec versions to 0.3.0

## Embeddings

### `backfill-embeddings.sh`
Process all unembedded conversations in batches with rate limiting.

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

