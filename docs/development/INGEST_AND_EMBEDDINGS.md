## vCon import from filesystem and embeddings generation

This guide shows how to:
- Import vCons from S3 or local filesystem into Supabase
- Generate and maintain 384‑dim embeddings
- Run continuous sync for production environments

---

### Prerequisites
- Node.js 18+
- Installed dependencies (from repo root):

```bash
npm install
```

- Environment variables (in `.env` file):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `VCON_S3_BUCKET` (optional, for S3 loading)
  - `OPENAI_API_KEY` or `HF_API_TOKEN` (for embeddings)

---

### Quick Start: Full Sync

The simplest way to sync everything (vCons, embeddings, and tags):

```bash
# One-time sync
npm run sync

# Continuous sync (every 5 minutes)
npm run sync:continuous
```

---

### Import vCons

Use the unified sync:vcons command for both S3 and local sources:

```bash
# From S3 (default, last 24 hours)
npm run sync:vcons

# From S3 with custom time window
npm run sync:vcons -- --hours=48      # Last 48 hours
npm run sync:vcons -- --hours=168     # Last 7 days

# From local directory
npm run sync:vcons -- /absolute/path/to/vcons
```

Notes:
- Use absolute directory paths. Files must end with `.vcon` extension.
- The script is idempotent and skips vCons already in the database.
- Handles both legacy (0.0.1-0.2.0) and current (0.3.0) vCon specs.

---

### Embeddings via npm Tool

This repo uses a 384‑dimension embedding setup to match the migrations and HNSW index. The npm tool batches any missing embeddings and supports on‑demand embedding for a specific `vcon_id`.

#### Embedding Strategy

The embedding system generates vectors for three types of content:
1. **Subject**: The vCon subject line
2. **Dialog**: Text from dialog entries (conversations, transcripts)
3. **Analysis**: Analysis bodies with `encoding='none'` or `NULL`

Analysis elements with `encoding='none'` are prioritized because they contain plain text analysis results (summaries, sentiment, transcripts) that are ideal for semantic search. Analysis with `encoding='base64url'` or `encoding='json'` are excluded as they typically contain structured data or binary content that doesn't benefit from text embeddings.

Environment variables (set in `.env` file or exported):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- One provider (choose one):
  - `OPENAI_API_KEY` (uses `text-embedding-3-small` with `dimensions=384`)
  - or Azure OpenAI:
    - `AZURE_OPENAI_EMBEDDING_ENDPOINT` (e.g., `https://your-resource.openai.azure.com`)
    - `AZURE_OPENAI_EMBEDDING_API_KEY`
  - or `HF_API_TOKEN` (Hugging Face Inference API with `sentence-transformers/all-MiniLM-L6-v2`)

#### Generate Embeddings

The recommended way to generate embeddings:

```bash
# Continuous embedding generation (recommended)
npm run sync:embeddings

# Or as part of full sync
npm run sync
```

For more control, use the script directly:

```bash
# Process 100 units (default)
npx tsx scripts/embed-vcons.ts

# Process 500 units with OpenAI
npx tsx scripts/embed-vcons.ts --limit=500 --provider=openai

# Process with Azure OpenAI
npx tsx scripts/embed-vcons.ts --limit=500 --provider=azure

# Run continuously until all done
npx tsx scripts/embed-vcons.ts --continuous --delay=2

# Backfill oldest first
npx tsx scripts/embed-vcons.ts --continuous --oldest-first

# Embed specific vCon
npx tsx scripts/embed-vcons.ts --mode=embed --vcon-id=<uuid>
```

The tool displays progress and a summary of embedded, skipped, and error counts.

**OpenAI Rate Limits:**
- `text-embedding-3-small`: 5,000 requests/min, 5,000,000 tokens/min (Tier 1)
- At 500 items/batch with 2s delay, you process ~15,000 items/minute
- Adjust batch size and delay based on your API tier

---

### Optional: DB queue + trigger for near‑real‑time embedding

Apply the migration that creates a simple queue and a trigger that enqueues newly inserted vCons:

```sql
-- supabase/migrations/20251010140000_embedding_queue_and_trigger.sql
CREATE TABLE IF NOT EXISTS embedding_queue (
  id bigserial primary key,
  vcon_id uuid not null references vcons(id) on delete cascade,
  created_at timestamptz not null default now()
);

CREATE OR REPLACE FUNCTION enqueue_embedding() RETURNS trigger AS $$
BEGIN
  INSERT INTO embedding_queue(vcon_id) VALUES (NEW.id);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enqueue_embedding AFTER INSERT ON vcons
FOR EACH ROW EXECUTE FUNCTION enqueue_embedding();
```

You can then:
- Schedule the npm tool with a cron job to run periodically, or
- Run the backfill script manually after bulk imports

---

### Scheduling with Cron (System Level)

You can schedule the embedding tool to run periodically using system cron:

```bash
# Edit crontab
crontab -e

# Add entry to run every 5 minutes
*/5 * * * * cd /path/to/vcon-mcp && /usr/bin/npm run embeddings:generate -- --limit=200 >> /var/log/embeddings.log 2>&1
```

Or use a process manager like systemd timers or supervisor for more robust scheduling.

---

### Troubleshooting
- Ensure your migrations are applied so that `vcon_embeddings` exists and uses vector(384).
- If embeddings fail due to rate limits, re-run the function; it performs upserts and is safe to retry.
- For very large datasets, start with small `limit` values and increase gradually.


