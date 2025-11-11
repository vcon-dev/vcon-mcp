# sync-to-s3 Edge Function

Incremental sync of vCons from Supabase to S3, including embeddings generation.

## Overview

This Edge Function:
- Queries for vCons that need syncing (new or updated since last sync)
- Generates embeddings if missing
- Exports vCons to JSON format with embeddings included
- Uploads to S3 with organized key structure
- Tracks sync status to avoid duplicates

## Environment Variables

### Required

- `SUPABASE_URL` - Your Supabase project URL (e.g., `https://your-project.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin operations
- `VCON_S3_BUCKET` - S3 bucket name for storing vCons
- `AWS_ACCESS_KEY_ID` - AWS access key ID
- `AWS_SECRET_ACCESS_KEY` - AWS secret access key

### Optional

- `VCON_S3_PREFIX` - S3 prefix/folder path (e.g., `production`). Default: empty
- `AWS_REGION` - AWS region. Default: `us-east-1`

### Embedding Provider (choose one)

- `OPENAI_API_KEY` - OpenAI API key (uses `text-embedding-3-small` with 384 dimensions)
- `HF_API_TOKEN` - Hugging Face API token (uses `sentence-transformers/all-MiniLM-L6-v2`)

If neither is provided, the function will sync vCons without generating embeddings.

## Deployment

```bash
# Deploy the function
supabase functions deploy sync-to-s3

# Set environment variables (via Supabase Dashboard or CLI)
# Go to: Project Settings → Edge Functions → sync-to-s3 → Secrets
```

## Usage

### Manual Trigger

```bash
curl -X GET "https://<your-project-ref>.supabase.co/functions/v1/sync-to-s3?limit=50" \
  -H "Authorization: Bearer <your-anon-key>"
```

### Query Parameters

- `limit` - Maximum number of vCons to sync per run (default: 50, max: 100)

### Response

```json
{
  "synced": 10,
  "embedded": 5,
  "errors": 0,
  "total_processed": 10,
  "error_details": []
}
```

## S3 Key Structure

vCons are stored with the following key structure:

```
{VCON_S3_PREFIX}/{year}/{month}/{vcon_uuid}.vcon.json
```

Example: `production/2024/11/123e4567-e89b-12d3-a456-426614174000.vcon.json`

## JSON Format

The exported JSON includes:

- Full vCon data (parties, dialog, attachments, analysis)
- Embeddings in `_embeddings` field:
  ```json
  {
    "_embeddings": {
      "subject": {
        "embedding": [...],
        "model": "text-embedding-3-small",
        "dimension": 384
      },
      "dialog": [
        {
          "index": 0,
          "embedding": [...],
          "model": "text-embedding-3-small",
          "dimension": 384
        }
      ],
      "analysis": [...]
    },
    "_sync_metadata": {
      "synced_at": "2024-11-10T13:30:00Z",
      "embedding_model": "text-embedding-3-small",
      "embedding_dimension": 384
    }
  }
  ```

## Scheduling

The function is scheduled to run every 5 minutes via pg_cron (see migration `20251110133000_setup_s3_sync_cron.sql`).

If pg_cron is not available, configure via Supabase Dashboard:
1. Go to Edge Functions → Schedules
2. Create new schedule:
   - Name: `sync-to-s3`
   - Schedule: `*/5 * * * *` (every 5 minutes)
   - Function: `sync-to-s3`
   - Method: `GET`
   - Query params: `limit=50`

## Database Requirements

The function uses the following database objects (created by migrations):

- `s3_sync_tracking` table - Tracks synced vCons
- `get_unsynced_vcons(limit)` - Returns vCons needing sync
- `check_vcon_embeddings_complete(vcon_id)` - Checks embedding status
- `get_vcon_embeddings(vcon_id)` - Retrieves embeddings
- `mark_vcon_synced(...)` - Marks vCon as synced

## Error Handling

- Retries failed S3 uploads up to 3 times with exponential backoff
- Continues processing other vCons if one fails
- Logs errors to console for monitoring
- Returns error details in response (limited to 10)

## Performance

- Processes vCons in batches (default: 50 per run)
- Generates embeddings only if missing
- Uses efficient database queries with indexes
- S3 uploads are retried on failure

