-- Backfill tenant_id on all child tables by joining to vcons.tenant_id
-- This migration populates tenant_id on existing data before RLS policies are enforced

-- Suppress NOTICE messages for cleaner output
SET client_min_messages TO WARNING;

-- Backfill parties.tenant_id
UPDATE parties
SET tenant_id = vcons.tenant_id
FROM vcons
WHERE parties.vcon_id = vcons.id
  AND parties.tenant_id IS DISTINCT FROM vcons.tenant_id;

-- Backfill dialog.tenant_id
UPDATE dialog
SET tenant_id = vcons.tenant_id
FROM vcons
WHERE dialog.vcon_id = vcons.id
  AND dialog.tenant_id IS DISTINCT FROM vcons.tenant_id;

-- Backfill attachments.tenant_id
UPDATE attachments
SET tenant_id = vcons.tenant_id
FROM vcons
WHERE attachments.vcon_id = vcons.id
  AND attachments.tenant_id IS DISTINCT FROM vcons.tenant_id;

-- Backfill analysis.tenant_id
UPDATE analysis
SET tenant_id = vcons.tenant_id
FROM vcons
WHERE analysis.vcon_id = vcons.id
  AND analysis.tenant_id IS DISTINCT FROM vcons.tenant_id;

-- Backfill groups.tenant_id
UPDATE groups
SET tenant_id = vcons.tenant_id
FROM vcons
WHERE groups.vcon_id = vcons.id
  AND groups.tenant_id IS DISTINCT FROM vcons.tenant_id;

-- Backfill party_history.tenant_id (via dialog join to vcons)
UPDATE party_history
SET tenant_id = vcons.tenant_id
FROM dialog
JOIN vcons ON vcons.id = dialog.vcon_id
WHERE party_history.dialog_id = dialog.id
  AND party_history.tenant_id IS DISTINCT FROM vcons.tenant_id;

-- Backfill vcon_embeddings.tenant_id
UPDATE vcon_embeddings
SET tenant_id = vcons.tenant_id
FROM vcons
WHERE vcon_embeddings.vcon_id = vcons.id
  AND vcon_embeddings.tenant_id IS DISTINCT FROM vcons.tenant_id;

-- Backfill embedding_queue.tenant_id
UPDATE embedding_queue
SET tenant_id = vcons.tenant_id
FROM vcons
WHERE embedding_queue.vcon_id = vcons.id
  AND embedding_queue.tenant_id IS DISTINCT FROM vcons.tenant_id;

-- Backfill s3_sync_tracking.tenant_id
UPDATE s3_sync_tracking
SET tenant_id = vcons.tenant_id
FROM vcons
WHERE s3_sync_tracking.vcon_id = vcons.id
  AND s3_sync_tracking.tenant_id IS DISTINCT FROM vcons.tenant_id;

