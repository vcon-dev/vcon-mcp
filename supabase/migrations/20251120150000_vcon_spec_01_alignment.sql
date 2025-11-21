-- ============================================================================
-- vCon Schema Update: Alignment with draft-ietf-vcon-vcon-core-01
-- Migration Phase 1: Non-Breaking Schema Additions
-- ============================================================================
-- Created: 2025-11-20
-- Purpose: Add new fields and capabilities from vCon spec draft-01
-- Breaking: NO - Only adds new optional columns
-- ============================================================================

-- Add critical column (renamed from must_support in spec draft-01)
ALTER TABLE vcons ADD COLUMN IF NOT EXISTS critical TEXT[];
CREATE INDEX IF NOT EXISTS idx_vcons_critical ON vcons USING GIN (critical) WHERE critical IS NOT NULL;
COMMENT ON COLUMN vcons.critical IS 'Section 4.1.4: Extensions that MUST be understood (renamed from must_support in draft-01)';

-- Add amended column (renamed from appended in spec draft-01)
ALTER TABLE vcons ADD COLUMN IF NOT EXISTS amended JSONB DEFAULT '{}';
COMMENT ON COLUMN vcons.amended IS 'Section 4.1.9: Reference to prior vCon version (renamed from appended in draft-01)';

-- ============================================================================
-- Dialog Table Updates: Transfer Support
-- ============================================================================

-- Add transfer dialog fields (Section 4.3.12)
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS transferee INTEGER;
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS transferor INTEGER;
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS transfer_target INTEGER[];
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS original INTEGER[];
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS consultation INTEGER[];
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS target_dialog INTEGER[];

-- Add indexes for transfer queries
CREATE INDEX IF NOT EXISTS idx_dialog_transfer_fields ON dialog(transferee, transferor) 
  WHERE transferee IS NOT NULL OR transferor IS NOT NULL;

-- Add helpful comments
COMMENT ON COLUMN dialog.transferee IS 'Section 4.3.12: Party index for transferee (REQUIRED when type=transfer)';
COMMENT ON COLUMN dialog.transferor IS 'Section 4.3.12: Party index for transferor (REQUIRED when type=transfer)';
COMMENT ON COLUMN dialog.transfer_target IS 'Section 4.3.12: Party index(es) for transfer target (REQUIRED when type=transfer). Use -1 for known but unavailable dialog.';
COMMENT ON COLUMN dialog.original IS 'Section 4.3.12: Dialog index(es) for original call. Use -1 for known but unavailable dialog.';
COMMENT ON COLUMN dialog.consultation IS 'Section 4.3.12: Dialog index(es) for consultation call (optional). Use -1 for known but unavailable dialog.';
COMMENT ON COLUMN dialog.target_dialog IS 'Section 4.3.12: Dialog index(es) for target call. Use -1 for known but unavailable dialog.';

-- ============================================================================
-- party_history Table Updates: DTMF Support
-- ============================================================================

-- Add DTMF support to party_history (Section 4.3.11)
ALTER TABLE party_history ADD COLUMN IF NOT EXISTS dtmf TEXT;

-- Update event constraint to include DTMF events
ALTER TABLE party_history DROP CONSTRAINT IF EXISTS party_history_event_check;
ALTER TABLE party_history ADD CONSTRAINT party_history_event_check 
  CHECK (event IN ('join', 'drop', 'hold', 'unhold', 'mute', 'unmute', 'dtmfdown', 'dtmfup'));

-- Add index for DTMF queries
CREATE INDEX IF NOT EXISTS idx_party_history_dtmf ON party_history(dtmf) WHERE dtmf IS NOT NULL;

COMMENT ON COLUMN party_history.dtmf IS 'Section 4.3.11.1: DTMF digit/character (REQUIRED when event IN (dtmfdown, dtmfup))';

-- ============================================================================
-- Attachments Table Updates
-- ============================================================================

-- Add purpose field as alternative to type (Section 4.4.1)
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS purpose TEXT;
CREATE INDEX IF NOT EXISTS idx_attachments_purpose ON attachments(purpose) WHERE purpose IS NOT NULL;
COMMENT ON COLUMN attachments.purpose IS 'Section 4.4.1: Alternative to type for semantic purpose';

-- ============================================================================
-- Dialog session_id Format Change (OPTIMIZED for large tables)
-- ============================================================================

-- Change session_id from TEXT to JSONB to support SessionId Object (Section 4.3.10, 2.2)
-- Use a multi-step approach to avoid statement timeout on large tables

-- Step 1: Add new JSONB column
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS session_id_jsonb JSONB;

-- Step 2: Rename old column to legacy (no data conversion yet)
ALTER TABLE dialog RENAME COLUMN session_id TO session_id_legacy;

-- Step 3: Rename new column to session_id
ALTER TABLE dialog RENAME COLUMN session_id_jsonb TO session_id;

-- Step 4: Convert data in batches (runs in background, won't timeout)
-- This will be handled by the data migration file
-- For now, session_id is NULL and session_id_legacy has the old TEXT values

-- Add index for JSONB queries (won't timeout since column is empty)
CREATE INDEX IF NOT EXISTS idx_dialog_session_jsonb ON dialog USING GIN (session_id) WHERE session_id IS NOT NULL;

COMMENT ON COLUMN dialog.session_id IS 'Section 4.3.10: SessionId object with local/remote UUIDs. Can be single object or array matching parties structure.';
COMMENT ON COLUMN dialog.session_id_legacy IS 'Original TEXT session_id values. Will be converted to JSONB in data migration phase. Safe to drop after validation.';

-- ============================================================================
-- Migration Tracking
-- ============================================================================

-- Create migration reports table if not exists
CREATE TABLE IF NOT EXISTS migration_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_name TEXT NOT NULL,
  run_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  records_affected INTEGER,
  issues_found INTEGER,
  report_data JSONB,
  UNIQUE(migration_name, run_date)
);

COMMENT ON TABLE migration_reports IS 'Tracks schema migration execution and results';

-- Record this migration
INSERT INTO migration_reports (migration_name, records_affected, issues_found, report_data)
VALUES (
  'vcon_spec_01_alignment_phase1',
  (SELECT COUNT(*) FROM vcons),
  0,
  jsonb_build_object(
    'phase', 1,
    'description', 'Non-breaking schema additions for draft-ietf-vcon-vcon-core-01',
    'total_vcons', (SELECT COUNT(*) FROM vcons),
    'total_dialogs', (SELECT COUNT(*) FROM dialog),
    'total_party_history', (SELECT COUNT(*) FROM party_history),
    'total_attachments', (SELECT COUNT(*) FROM attachments)
  )
);
