-- Add tenant_id column to vcons and all child tables for fast multi-tenant RLS
-- This denormalizes tenant_id to avoid expensive EXISTS subqueries in RLS policies

-- Suppress NOTICE messages for cleaner output
SET client_min_messages TO WARNING;

-- Add tenant_id to vcons table (the parent table for multi-tenancy)
ALTER TABLE vcons ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Add tenant_id to parties table
ALTER TABLE parties ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Add tenant_id to dialog table
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Add tenant_id to attachments table
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Add tenant_id to analysis table
ALTER TABLE analysis ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Add tenant_id to groups table
ALTER TABLE groups ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Add tenant_id to party_history table
ALTER TABLE party_history ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Add tenant_id to vcon_embeddings table
ALTER TABLE vcon_embeddings ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Add tenant_id to embedding_queue table
ALTER TABLE embedding_queue ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Add tenant_id to s3_sync_tracking table
ALTER TABLE s3_sync_tracking ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Add comments
COMMENT ON COLUMN vcons.tenant_id IS 'Tenant identifier for multi-tenancy support';
COMMENT ON COLUMN parties.tenant_id IS 'Tenant identifier denormalized from parent vcons table for fast RLS evaluation';
COMMENT ON COLUMN dialog.tenant_id IS 'Tenant identifier denormalized from parent vcons table for fast RLS evaluation';
COMMENT ON COLUMN attachments.tenant_id IS 'Tenant identifier denormalized from parent vcons table for fast RLS evaluation';
COMMENT ON COLUMN analysis.tenant_id IS 'Tenant identifier denormalized from parent vcons table for fast RLS evaluation';
COMMENT ON COLUMN groups.tenant_id IS 'Tenant identifier denormalized from parent vcons table for fast RLS evaluation';
COMMENT ON COLUMN party_history.tenant_id IS 'Tenant identifier denormalized from parent vcons table (via dialog) for fast RLS evaluation';
COMMENT ON COLUMN vcon_embeddings.tenant_id IS 'Tenant identifier denormalized from parent vcons table for fast RLS evaluation';
COMMENT ON COLUMN embedding_queue.tenant_id IS 'Tenant identifier denormalized from parent vcons table for fast RLS evaluation';
COMMENT ON COLUMN s3_sync_tracking.tenant_id IS 'Tenant identifier denormalized from parent vcons table for fast RLS evaluation';

