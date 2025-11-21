-- ============================================================================
-- vCon Schema Update: Data Migration
-- Migration Phase 3: Migrate existing data to new format
-- ============================================================================
-- Created: 2025-11-20
-- Purpose: Migrate existing vCons to use new field names and formats
-- Breaking: NO - Maintains both old and new formats during transition
-- Depends on: 20251120150000_vcon_spec_01_alignment.sql, 20251120150100_field_renames.sql
-- ============================================================================

-- ============================================================================
-- Pre-Migration Validation and Reporting
-- ============================================================================

-- Create temporary table to track what will be migrated
CREATE TEMP TABLE migration_preview AS
SELECT 
  'must_support → critical' as migration_type,
  COUNT(*) as records_to_migrate,
  jsonb_agg(uuid ORDER BY created_at LIMIT 5) as sample_uuids
FROM vcons 
WHERE must_support IS NOT NULL AND critical IS NULL

UNION ALL

SELECT 
  'appended → amended' as migration_type,
  COUNT(*) as records_to_migrate,
  jsonb_agg(uuid ORDER BY created_at LIMIT 5) as sample_uuids
FROM vcons 
WHERE appended IS NOT NULL AND appended != '{}'::jsonb 
  AND (amended IS NULL OR amended = '{}'::jsonb)

UNION ALL

SELECT 
  'session_id TEXT → JSONB' as migration_type,
  COUNT(*) as records_to_migrate,
  jsonb_agg(uuid ORDER BY created_at LIMIT 5) as sample_uuids
FROM vcons v
JOIN dialog d ON v.id = d.vcon_id
WHERE d.session_id_legacy IS NOT NULL;

-- Display pre-migration report
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE '============================================';
  RAISE NOTICE 'PRE-MIGRATION REPORT';
  RAISE NOTICE '============================================';
  
  FOR rec IN SELECT * FROM migration_preview LOOP
    RAISE NOTICE '% : % records', rec.migration_type, rec.records_to_migrate;
  END LOOP;
  
  RAISE NOTICE '============================================';
END $$;

-- ============================================================================
-- Step 1: Migrate must_support → critical
-- ============================================================================

DO $$
DECLARE
  migrated_count INTEGER;
BEGIN
  -- Update vcons where must_support exists but critical is null
  UPDATE vcons 
  SET critical = must_support,
      updated_at = NOW()
  WHERE must_support IS NOT NULL 
    AND critical IS NULL;
  
  GET DIAGNOSTICS migrated_count = ROW_COUNT;
  
  RAISE NOTICE 'Migrated % vCons from must_support to critical', migrated_count;
END $$;

-- ============================================================================
-- Step 2: Migrate appended → amended
-- ============================================================================

DO $$
DECLARE
  migrated_count INTEGER;
BEGIN
  -- Update vcons where appended exists but amended is empty
  UPDATE vcons 
  SET amended = appended,
      updated_at = NOW()
  WHERE appended IS NOT NULL 
    AND appended != '{}'::jsonb
    AND (amended IS NULL OR amended = '{}'::jsonb);
  
  GET DIAGNOSTICS migrated_count = ROW_COUNT;
  
  RAISE NOTICE 'Migrated % vCons from appended to amended', migrated_count;
END $$;

-- ============================================================================
-- Step 3: Convert session_id from TEXT to JSONB (in batches to avoid timeout)
-- ============================================================================

DO $$
DECLARE
  total_rows INTEGER;
  converted_count INTEGER;
  batch_size INTEGER := 1000;
  current_offset INTEGER := 0;
  batch_count INTEGER;
BEGIN
  -- Count rows that need conversion
  SELECT COUNT(*) INTO total_rows
  FROM dialog
  WHERE session_id_legacy IS NOT NULL AND session_id IS NULL;
  
  IF total_rows = 0 THEN
    RAISE NOTICE 'No session_id values to convert';
  ELSE
    RAISE NOTICE 'Converting % session_id values from TEXT to JSONB in batches...', total_rows;
    
    -- Convert in batches to avoid timeout
    LOOP
      -- Update next batch
      UPDATE dialog
      SET session_id = jsonb_build_object('local', session_id_legacy, 'remote', 'nil')
      WHERE id IN (
        SELECT id FROM dialog
        WHERE session_id_legacy IS NOT NULL AND session_id IS NULL
        ORDER BY id
        LIMIT batch_size
      );
      
      GET DIAGNOSTICS batch_count = ROW_COUNT;
      
      EXIT WHEN batch_count = 0;
      
      current_offset := current_offset + batch_count;
      RAISE NOTICE '  Converted % / % rows...', current_offset, total_rows;
      
      -- Small delay to avoid overloading
      PERFORM pg_sleep(0.1);
    END LOOP;
    
    RAISE NOTICE 'Session ID conversion complete: % rows converted', current_offset;
  END IF;
END $$;

-- ============================================================================
-- Step 4: Validate session_id JSONB Conversion
-- ============================================================================

-- Check if any session_id conversions failed or need manual review
CREATE TEMP TABLE session_id_issues AS
SELECT 
  v.uuid as vcon_uuid,
  d.dialog_index,
  d.session_id_legacy as original_value,
  d.session_id as converted_value,
  CASE 
    WHEN d.session_id IS NULL AND d.session_id_legacy IS NOT NULL THEN 'conversion_failed'
    WHEN jsonb_typeof(d.session_id) != 'object' AND d.session_id IS NOT NULL THEN 'invalid_format'
    WHEN d.session_id ? 'local' AND d.session_id ? 'remote' THEN 'ok'
    ELSE 'missing_required_keys'
  END as issue_type
FROM vcons v
JOIN dialog d ON v.id = d.vcon_id
WHERE d.session_id_legacy IS NOT NULL
  AND (
    d.session_id IS NULL 
    OR jsonb_typeof(d.session_id) != 'object'
    OR NOT (d.session_id ? 'local' AND d.session_id ? 'remote')
  );

-- Report session_id issues
DO $$
DECLARE
  issue_count INTEGER;
  rec RECORD;
BEGIN
  SELECT COUNT(*) INTO issue_count FROM session_id_issues;
  
  IF issue_count > 0 THEN
    RAISE WARNING '============================================';
    RAISE WARNING 'SESSION_ID CONVERSION ISSUES: % records', issue_count;
    RAISE WARNING '============================================';
    
    FOR rec IN SELECT * FROM session_id_issues LIMIT 10 LOOP
      RAISE WARNING 'vCon: %, Dialog: %, Issue: %', 
        rec.vcon_uuid, rec.dialog_index, rec.issue_type;
    END LOOP;
    
    IF issue_count > 10 THEN
      RAISE WARNING '... and % more issues', issue_count - 10;
    END IF;
  ELSE
    RAISE NOTICE 'All session_id values successfully migrated to JSONB format';
  END IF;
END $$;

-- ============================================================================
-- Step 5: Validate Transfer Dialogs
-- ============================================================================

-- Check for transfer dialogs missing required fields
CREATE TEMP TABLE transfer_dialog_issues AS
SELECT 
  v.uuid as vcon_uuid,
  d.dialog_index,
  d.transferee IS NULL as missing_transferee,
  d.transferor IS NULL as missing_transferor,
  d.transfer_target IS NULL as missing_transfer_target,
  CASE 
    WHEN d.transferee IS NULL THEN 'missing_transferee'
    WHEN d.transferor IS NULL THEN 'missing_transferor'
    WHEN d.transfer_target IS NULL THEN 'missing_transfer_target'
    ELSE 'ok'
  END as issue_type
FROM vcons v
JOIN dialog d ON v.id = d.vcon_id
WHERE d.type = 'transfer'
  AND (
    d.transferee IS NULL 
    OR d.transferor IS NULL 
    OR d.transfer_target IS NULL
  );

-- Report transfer dialog issues
DO $$
DECLARE
  issue_count INTEGER;
  rec RECORD;
BEGIN
  SELECT COUNT(*) INTO issue_count FROM transfer_dialog_issues;
  
  IF issue_count > 0 THEN
    RAISE WARNING '============================================';
    RAISE WARNING 'TRANSFER DIALOG ISSUES: % records', issue_count;
    RAISE WARNING 'These transfer dialogs are missing required fields';
    RAISE WARNING '============================================';
    
    FOR rec IN SELECT * FROM transfer_dialog_issues LIMIT 10 LOOP
      RAISE WARNING 'vCon: %, Dialog: %, Issue: %', 
        rec.vcon_uuid, rec.dialog_index, rec.issue_type;
    END LOOP;
    
    IF issue_count > 10 THEN
      RAISE WARNING '... and % more issues. Run: SELECT * FROM transfer_dialog_issues;', 
        issue_count - 10;
    END IF;
  ELSE
    RAISE NOTICE 'All transfer dialogs have required fields';
  END IF;
END $$;

-- ============================================================================
-- Step 6: Validate party_history Events
-- ============================================================================

-- Check for DTMF events missing dtmf field
CREATE TEMP TABLE party_history_issues AS
SELECT 
  v.uuid as vcon_uuid,
  d.dialog_index,
  ph.event,
  ph.dtmf,
  'missing_dtmf_value' as issue_type
FROM vcons v
JOIN dialog d ON v.id = d.vcon_id
JOIN party_history ph ON d.id = ph.dialog_id
WHERE ph.event IN ('dtmfdown', 'dtmfup')
  AND ph.dtmf IS NULL;

-- Report party_history issues
DO $$
DECLARE
  issue_count INTEGER;
  rec RECORD;
BEGIN
  SELECT COUNT(*) INTO issue_count FROM party_history_issues;
  
  IF issue_count > 0 THEN
    RAISE WARNING '============================================';
    RAISE WARNING 'PARTY_HISTORY ISSUES: % records', issue_count;
    RAISE WARNING 'These DTMF events are missing required dtmf field';
    RAISE WARNING '============================================';
    
    FOR rec IN SELECT * FROM party_history_issues LIMIT 10 LOOP
      RAISE WARNING 'vCon: %, Dialog: %, Event: %', 
        rec.vcon_uuid, rec.dialog_index, rec.event;
    END LOOP;
  ELSE
    RAISE NOTICE 'All DTMF events have required dtmf field';
  END IF;
END $$;

-- ============================================================================
-- Step 7: Generate Comprehensive Migration Report
-- ============================================================================

-- Insert comprehensive migration report
INSERT INTO migration_reports (
  migration_name, 
  records_affected, 
  issues_found, 
  report_data
)
SELECT 
  'vcon_spec_01_alignment_phase3' as migration_name,
  (
    SELECT COUNT(*) FROM vcons 
    WHERE critical IS NOT NULL 
       OR (amended IS NOT NULL AND amended != '{}'::jsonb)
  ) as records_affected,
  (
    SELECT COUNT(*) FROM session_id_issues
  ) + (
    SELECT COUNT(*) FROM transfer_dialog_issues
  ) + (
    SELECT COUNT(*) FROM party_history_issues
  ) as issues_found,
  jsonb_build_object(
    'phase', 3,
    'description', 'Data migration from old to new field formats',
    'migration_timestamp', NOW(),
    
    -- Critical migration stats
    'critical_migration', jsonb_build_object(
      'total_migrated', (SELECT COUNT(*) FROM vcons WHERE critical IS NOT NULL),
      'using_new_field', (SELECT COUNT(*) FROM vcons WHERE critical IS NOT NULL),
      'using_old_field', (SELECT COUNT(*) FROM vcons WHERE must_support IS NOT NULL)
    ),
    
    -- Amended migration stats
    'amended_migration', jsonb_build_object(
      'total_migrated', (
        SELECT COUNT(*) FROM vcons 
        WHERE amended IS NOT NULL AND amended != '{}'::jsonb
      ),
      'using_new_field', (
        SELECT COUNT(*) FROM vcons 
        WHERE amended IS NOT NULL AND amended != '{}'::jsonb
      ),
      'using_old_field', (
        SELECT COUNT(*) FROM vcons 
        WHERE appended IS NOT NULL AND appended != '{}'::jsonb
      )
    ),
    
    -- Session ID migration stats
    'session_id_migration', jsonb_build_object(
      'total_dialogs', (SELECT COUNT(*) FROM dialog),
      'with_session_id', (SELECT COUNT(*) FROM dialog WHERE session_id IS NOT NULL),
      'issues_found', (SELECT COUNT(*) FROM session_id_issues)
    ),
    
    -- Transfer dialog validation
    'transfer_dialogs', jsonb_build_object(
      'total_transfer_dialogs', (SELECT COUNT(*) FROM dialog WHERE type = 'transfer'),
      'missing_required_fields', (SELECT COUNT(*) FROM transfer_dialog_issues)
    ),
    
    -- Party history validation
    'party_history', jsonb_build_object(
      'total_events', (SELECT COUNT(*) FROM party_history),
      'dtmf_events', (
        SELECT COUNT(*) FROM party_history 
        WHERE event IN ('dtmfdown', 'dtmfup')
      ),
      'missing_dtmf', (SELECT COUNT(*) FROM party_history_issues)
    ),
    
    -- Overall summary
    'summary', jsonb_build_object(
      'total_vcons', (SELECT COUNT(*) FROM vcons),
      'total_issues', (
        SELECT COUNT(*) FROM session_id_issues
      ) + (
        SELECT COUNT(*) FROM transfer_dialog_issues
      ) + (
        SELECT COUNT(*) FROM party_history_issues
      ),
      'migration_status', CASE 
        WHEN (
          SELECT COUNT(*) FROM session_id_issues
        ) + (
          SELECT COUNT(*) FROM transfer_dialog_issues
        ) + (
          SELECT COUNT(*) FROM party_history_issues
        ) = 0 THEN 'SUCCESS'
        ELSE 'COMPLETED_WITH_ISSUES'
      END
    )
  ) as report_data;

-- ============================================================================
-- Post-Migration Summary
-- ============================================================================

DO $$
DECLARE
  report RECORD;
BEGIN
  SELECT * INTO report 
  FROM migration_reports 
  WHERE migration_name = 'vcon_spec_01_alignment_phase3'
  ORDER BY run_date DESC 
  LIMIT 1;
  
  RAISE NOTICE '============================================';
  RAISE NOTICE 'MIGRATION PHASE 3 COMPLETE';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Records Affected: %', report.records_affected;
  RAISE NOTICE 'Issues Found: %', report.issues_found;
  RAISE NOTICE 'Status: %', report.report_data->'summary'->>'migration_status';
  RAISE NOTICE '';
  RAISE NOTICE 'For detailed report, run:';
  RAISE NOTICE 'SELECT jsonb_pretty(report_data) FROM migration_reports WHERE migration_name = ''vcon_spec_01_alignment_phase3'';';
  RAISE NOTICE '============================================';
END $$;

-- ============================================================================
-- Cleanup Temporary Tables
-- ============================================================================

DROP TABLE IF EXISTS migration_preview;
DROP TABLE IF EXISTS session_id_issues;
DROP TABLE IF EXISTS transfer_dialog_issues;
DROP TABLE IF EXISTS party_history_issues;
