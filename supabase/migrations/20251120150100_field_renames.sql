-- ============================================================================
-- vCon Schema Update: Field Renames with Backward Compatibility
-- Migration Phase 2: Rename must_support → critical, appended → amended
-- ============================================================================
-- Created: 2025-11-20
-- Purpose: Implement spec field renames while maintaining backward compatibility
-- Breaking: SOFT - Old field names deprecated but still accessible via views
-- Depends on: 20251120150000_vcon_spec_01_alignment.sql
-- ============================================================================

-- ============================================================================
-- Step 1: Mark Old Columns as Deprecated
-- ============================================================================

-- These columns still exist in schema but are deprecated per spec draft-01
COMMENT ON COLUMN vcons.must_support IS 
  '⚠️  DEPRECATED in draft-ietf-vcon-vcon-core-01 (Section 4.1.4). 
  Renamed to "critical". Use vcons.critical instead. 
  This column will be removed in a future version.';

COMMENT ON COLUMN vcons.appended IS 
  '⚠️  DEPRECATED in draft-ietf-vcon-vcon-core-01 (Section 4.1.9). 
  Renamed to "amended". Use vcons.amended instead. 
  This column will be removed in a future version.';

-- ============================================================================
-- Step 2: Create Backward Compatibility View
-- ============================================================================

-- Drop view if exists (to handle re-running migration)
DROP VIEW IF EXISTS vcons_legacy;

-- Create read-only view with old field names for backward compatibility
CREATE OR REPLACE VIEW vcons_legacy AS
SELECT 
  -- Core fields (unchanged)
  id,
  uuid,
  vcon_version,
  subject,
  created_at,
  updated_at,
  extensions,
  redacted,
  group_data,
  basename,
  filename,
  done,
  corrupt,
  processed_by,
  privacy_processed,
  redaction_rules,
  tenant_id,
  
  -- New fields with old names (for backward compatibility)
  critical as must_support,     -- Maps new 'critical' to old 'must_support'
  amended as appended,          -- Maps new 'amended' to old 'appended'
  
  -- Keep new fields visible too
  critical,
  amended
FROM vcons;

COMMENT ON VIEW vcons_legacy IS 
  '⚠️  DEPRECATED: Backward compatibility view for old field names.
  Provides read-only access to vcons with deprecated field names (must_support, appended).
  
  Migration Path:
  - Old code can SELECT from this view to access old field names
  - New code should SELECT directly from vcons table using new field names
  - This view will be removed when must_support and appended columns are dropped
  
  Field Mappings:
  - must_support → critical (Section 4.1.4)
  - appended → amended (Section 4.1.9)
  
  See: draft-ietf-vcon-vcon-core-01 for specification details.';

-- ============================================================================
-- Step 3: Create Helper Functions for Dual-Field Support
-- ============================================================================

-- Function to get critical/must_support value (prefers critical)
CREATE OR REPLACE FUNCTION get_vcon_critical(vcon_id UUID)
RETURNS TEXT[] AS $$
DECLARE
  result TEXT[];
BEGIN
  SELECT COALESCE(critical, must_support) INTO result
  FROM vcons
  WHERE id = vcon_id;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_vcon_critical(UUID) IS 
  'Helper function to get critical extensions, falling back to must_support for backward compatibility';

-- Function to get amended/appended value (prefers amended)
CREATE OR REPLACE FUNCTION get_vcon_amended(vcon_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT COALESCE(
    NULLIF(amended, '{}'::jsonb),
    NULLIF(appended, '{}'::jsonb),
    '{}'::jsonb
  ) INTO result
  FROM vcons
  WHERE id = vcon_id;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_vcon_amended(UUID) IS 
  'Helper function to get amended data, falling back to appended for backward compatibility';

-- ============================================================================
-- Step 4: Create Trigger to Sync Old and New Fields
-- ============================================================================

-- Trigger function to keep old and new fields in sync during transition period
CREATE OR REPLACE FUNCTION sync_vcon_deprecated_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- If critical is set, also set must_support
  IF NEW.critical IS NOT NULL THEN
    NEW.must_support := NEW.critical;
  -- If must_support is set but critical is null, set critical
  ELSIF NEW.must_support IS NOT NULL AND NEW.critical IS NULL THEN
    NEW.critical := NEW.must_support;
  END IF;
  
  -- If amended is set, also set appended
  IF NEW.amended IS NOT NULL AND NEW.amended != '{}'::jsonb THEN
    NEW.appended := NEW.amended;
  -- If appended is set but amended is empty, set amended
  ELSIF NEW.appended IS NOT NULL AND NEW.appended != '{}'::jsonb 
        AND (NEW.amended IS NULL OR NEW.amended = '{}'::jsonb) THEN
    NEW.amended := NEW.appended;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists (to handle re-running migration)
DROP TRIGGER IF EXISTS sync_deprecated_fields_trigger ON vcons;

-- Create trigger on INSERT and UPDATE
CREATE TRIGGER sync_deprecated_fields_trigger
  BEFORE INSERT OR UPDATE ON vcons
  FOR EACH ROW
  EXECUTE FUNCTION sync_vcon_deprecated_fields();

COMMENT ON FUNCTION sync_vcon_deprecated_fields() IS 
  '⚠️  TEMPORARY: Keeps deprecated fields (must_support, appended) in sync with new fields (critical, amended).
  This trigger maintains backward compatibility during the transition period.
  Will be removed when deprecated columns are dropped.';

-- ============================================================================
-- Step 5: Create Migration Info View
-- ============================================================================

-- Create view to show which vCons are using old vs new field names
CREATE OR REPLACE VIEW vcon_field_usage AS
SELECT 
  uuid,
  CASE 
    WHEN critical IS NOT NULL THEN 'new'
    WHEN must_support IS NOT NULL THEN 'old'
    ELSE 'none'
  END as critical_field_usage,
  CASE 
    WHEN amended IS NOT NULL AND amended != '{}'::jsonb THEN 'new'
    WHEN appended IS NOT NULL AND appended != '{}'::jsonb THEN 'old'
    ELSE 'none'
  END as amended_field_usage,
  critical,
  must_support,
  amended,
  appended,
  created_at,
  updated_at
FROM vcons;

COMMENT ON VIEW vcon_field_usage IS 
  'Shows which vCons are using new vs old field names.
  Useful for tracking migration progress from must_support/appended to critical/amended.';

-- ============================================================================
-- Migration Tracking
-- ============================================================================

-- Record this migration
INSERT INTO migration_reports (migration_name, records_affected, issues_found, report_data)
VALUES (
  'vcon_spec_01_alignment_phase2',
  (SELECT COUNT(*) FROM vcons),
  (SELECT COUNT(*) FROM vcons WHERE must_support IS NOT NULL AND critical IS NULL),
  jsonb_build_object(
    'phase', 2,
    'description', 'Field renames with backward compatibility (must_support→critical, appended→amended)',
    'total_vcons', (SELECT COUNT(*) FROM vcons),
    'using_old_critical', (SELECT COUNT(*) FROM vcons WHERE must_support IS NOT NULL AND critical IS NULL),
    'using_new_critical', (SELECT COUNT(*) FROM vcons WHERE critical IS NOT NULL),
    'using_old_amended', (SELECT COUNT(*) FROM vcons WHERE appended IS NOT NULL AND appended != '{}'::jsonb AND amended = '{}'::jsonb),
    'using_new_amended', (SELECT COUNT(*) FROM vcons WHERE amended IS NOT NULL AND amended != '{}'::jsonb),
    'compatibility_view_created', true,
    'sync_trigger_created', true
  )
);
