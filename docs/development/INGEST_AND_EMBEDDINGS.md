## vCon import from filesystem and Supabase embeddings (Edge Function)

This guide shows how to:
- Import vCons from your local filesystem into Supabase using the existing loader scripts
- Generate and maintain 384‑dim embeddings via a Supabase Edge Function, with optional Cron and DB triggers

---

### Prerequisites
- Node.js 18+
- Installed dependencies (from repo root):

```bash
npm install
```

- Environment variables available to the Node loader scripts (e.g. in a `.env` file at repo root):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

The loaders print the database URL at startup so you can verify connectivity.

---

### Import vCons from a directory

Two scripts are available. Both are idempotent and will skip vCons already in the database.

1) Standard vCon import

```bash
npx tsx scripts/load-vcons.ts /absolute/path/to/vcons
```

2) Legacy vCon import with migration to spec 0.3.0

```bash
npx tsx scripts/load-legacy-vcons.ts /absolute/path/to/legacy
```

Notes:
- Use an absolute directory path. Files must end with the `.vcon` extension.
- The scripts validate the vCon JSON and print a summary of successes, skips, and failures.
- Default path if none is provided is visible in each script; pass your directory explicitly to avoid surprises.

---

### Embeddings via Supabase Edge Function (Option B)

This repo uses a 384‑dimension embedding setup to match the migrations and HNSW index. The Edge Function batches any missing embeddings and supports on‑demand embedding for a specific `vcon_id`.

#### Embedding Strategy

The embedding system generates vectors for three types of content:
1. **Subject**: The vCon subject line
2. **Dialog**: Text from dialog entries (conversations, transcripts)
3. **Analysis**: Analysis bodies with `encoding='none'` or `NULL`

Analysis elements with `encoding='none'` are prioritized because they contain plain text analysis results (summaries, sentiment, transcripts) that are ideal for semantic search. Analysis with `encoding='base64url'` or `encoding='json'` are excluded as they typically contain structured data or binary content that doesn't benefit from text embeddings.

Environment variables for the Edge Function (set in the Supabase project):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- One provider (choose one):
  - `OPENAI_API_KEY` (uses `text-embedding-3-small` with `dimensions=384`)
  - or `HF_API_TOKEN` (Hugging Face Inference API with `sentence-transformers/all-MiniLM-L6-v2`)

Deploy the function:

```bash
supabase functions deploy embed-vcons
```

Manual triggers:
- Backfill (default mode):

```bash
curl -sS "https://<your-project-ref>.functions.supabase.co/embed-vcons?mode=backfill&limit=200"
```

- Embed a single vCon:

```bash
curl -sS "https://<your-project-ref>.functions.supabase.co/embed-vcons?mode=embed&vcon_id=<uuid>"
```

The function responds with a JSON summary: counts for embedded, skipped, and errors.

#### Backfill all unembedded conversations with rate limiting

Use the provided script to process all conversations in batches:

```bash
# Default: 500 per batch, 2 second delay
./scripts/backfill-embeddings.sh

# Custom: 200 per batch, 5 second delay (for stricter rate limits)
./scripts/backfill-embeddings.sh 200 5

# Aggressive: 500 per batch, 0.5 second delay
./scripts/backfill-embeddings.sh 500 0.5
```

The script will:
- Loop through all unembedded text units in batches
- Respect rate limits with configurable delays between batches
- Show progress and totals
- Stop automatically when all embeddings are complete

**OpenAI Rate Limits:**
- `text-embedding-3-small`: 5,000 requests/min, 5,000,000 tokens/min (Tier 1)
- At 500 items/batch with 2s delay, you process ~15,000 items/minute
- Adjust batch size and delay based on your API tier

---

### Optional: DB queue + trigger for near‑real‑time embedding

Apply the migration that creates a simple queue and a trigger that enqueues newly inserted vCons:

```sql
-- supabase/migrations/<timestamp>_embedding_queue_and_trigger.sql
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

You can either:
- Schedule the Edge Function with Cron (polling/backfill), or
- Have the function drain `embedding_queue` on each run for lower latency.

---

### Scheduling with Supabase Cron
Configure a schedule in the Supabase Dashboard → Edge Functions → Schedules to run every 5 minutes:

```text
GET /embed-vcons?mode=backfill&limit=200
```

Ensure the Edge Function environment contains the provider key and Supabase URL/Service Role key.

Environment variables (Edge Function):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` or `HF_API_TOKEN`

---

### Troubleshooting
- Ensure your migrations are applied so that `vcon_embeddings` exists and uses vector(384).
- If embeddings fail due to rate limits, re-run the function; it performs upserts and is safe to retry.
- For very large datasets, start with small `limit` values and increase gradually.


