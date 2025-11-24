-- Create indexes on all tenant_id columns for fast RLS policy evaluation
-- These indexes are critical for performance when RLS policies filter by tenant_id

-- Suppress NOTICE messages for cleaner output
SET client_min_messages TO WARNING;

-- Index on vcons.tenant_id (if not exists)
CREATE INDEX IF NOT EXISTS idx_vcons_tenant_id ON vcons(tenant_id) WHERE tenant_id IS NOT NULL;

-- Index on parties.tenant_id
CREATE INDEX IF NOT EXISTS idx_parties_tenant_id ON parties(tenant_id) WHERE tenant_id IS NOT NULL;

-- Index on dialog.tenant_id
CREATE INDEX IF NOT EXISTS idx_dialog_tenant_id ON dialog(tenant_id) WHERE tenant_id IS NOT NULL;

-- Index on attachments.tenant_id
CREATE INDEX IF NOT EXISTS idx_attachments_tenant_id ON attachments(tenant_id) WHERE tenant_id IS NOT NULL;

-- Index on analysis.tenant_id
CREATE INDEX IF NOT EXISTS idx_analysis_tenant_id ON analysis(tenant_id) WHERE tenant_id IS NOT NULL;

-- Index on groups.tenant_id
CREATE INDEX IF NOT EXISTS idx_groups_tenant_id ON groups(tenant_id) WHERE tenant_id IS NOT NULL;

-- Index on party_history.tenant_id
CREATE INDEX IF NOT EXISTS idx_party_history_tenant_id ON party_history(tenant_id) WHERE tenant_id IS NOT NULL;

-- Index on vcon_embeddings.tenant_id
CREATE INDEX IF NOT EXISTS idx_vcon_embeddings_tenant_id ON vcon_embeddings(tenant_id) WHERE tenant_id IS NOT NULL;

-- Index on embedding_queue.tenant_id
CREATE INDEX IF NOT EXISTS idx_embedding_queue_tenant_id ON embedding_queue(tenant_id) WHERE tenant_id IS NOT NULL;

-- Index on s3_sync_tracking.tenant_id
CREATE INDEX IF NOT EXISTS idx_s3_sync_tracking_tenant_id ON s3_sync_tracking(tenant_id) WHERE tenant_id IS NOT NULL;

