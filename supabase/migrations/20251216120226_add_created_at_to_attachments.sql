-- Migration: Add created_at tracking for attachments and analysis
-- Backfill was run manually due to table size.

-- Add created_at column to attachments table if it doesn't exist
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- Add indexes for efficient queries by created_at
CREATE INDEX IF NOT EXISTS idx_attachments_created_at ON attachments(created_at);
CREATE INDEX IF NOT EXISTS idx_analysis_created_at ON analysis(created_at);
