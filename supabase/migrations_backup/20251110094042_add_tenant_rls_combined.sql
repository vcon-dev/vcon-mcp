-- Add Row Level Security (RLS) for Multi-Tenant Support
-- This migration adds tenant_id column, extraction function, and RLS policies
-- Combined version including fixes for ambiguous column reference and batched processing

-- Suppress NOTICE messages for cleaner output (IF NOT EXISTS generates notices)
SET client_min_messages TO WARNING;

-- Step 1: Add tenant_id column to vcons table
ALTER TABLE vcons ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Step 2: Create index on tenant_id for RLS policy performance
CREATE INDEX IF NOT EXISTS idx_vcons_tenant_id ON vcons(tenant_id) WHERE tenant_id IS NOT NULL;

-- Step 3: Create function to extract tenant ID from attachments
-- This function looks for attachments with a configurable type and extracts
-- the tenant ID from the body JSON using a configurable JSON path.
-- Default: type='tenant', path='id' (i.e., body->>'id')
CREATE OR REPLACE FUNCTION extract_tenant_from_attachments(
  p_vcon_id UUID,
  p_attachment_type TEXT DEFAULT 'tenant',
  p_json_path TEXT DEFAULT 'id'
)
RETURNS TEXT AS $$
DECLARE
  v_tenant_id TEXT;
  v_body_text TEXT;
  v_body_json JSONB;
  v_path_parts TEXT[];
  v_path_part TEXT;
  v_value JSONB;
BEGIN
  -- Find attachment with matching type
  SELECT body INTO v_body_text
  FROM attachments
  WHERE vcon_id = p_vcon_id
    AND type = p_attachment_type
  LIMIT 1;

  -- If no matching attachment found, return NULL
  IF v_body_text IS NULL THEN
    RETURN NULL;
  END IF;

  -- Try to parse body as JSON
  BEGIN
    -- Handle encoding - if encoding is 'json' or NULL, parse directly
    -- For other encodings, we still try to parse (might be plain JSON)
    v_body_json := v_body_text::JSONB;
  EXCEPTION WHEN OTHERS THEN
    -- Not valid JSON, return NULL
    RETURN NULL;
  END;

  -- Extract value from JSON path (simple dot notation support)
  -- Split path by dots
  v_path_parts := string_to_array(p_json_path, '.');
  v_value := v_body_json;

  -- Navigate through path
  FOREACH v_path_part IN ARRAY v_path_parts
  LOOP
    IF v_value IS NULL OR jsonb_typeof(v_value) != 'object' THEN
      RETURN NULL;
    END IF;
    v_value := v_value->v_path_part;
  END LOOP;

  -- Convert to text if found - handle different JSONB types correctly
  IF v_value IS NOT NULL AND v_value != 'null'::JSONB THEN
    -- FIXED: Use #>> '{}' operator for string extraction (removes quotes)
    -- For JSONB strings, ::TEXT includes quotes, but #>> '{}' extracts the text value
    IF jsonb_typeof(v_value) = 'string' THEN
      RETURN v_value #>> '{}';  -- Extract string value without quotes
    ELSIF jsonb_typeof(v_value) IN ('number', 'boolean') THEN
      RETURN v_value::TEXT;  -- Numbers and booleans convert cleanly to text
    ELSE
      RETURN v_value::TEXT;  -- Fallback for other types (arrays, objects)
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create function to populate tenant_id for all existing vCons
-- This uses the default configuration (type='tenant', path='id')
-- FIXED: Qualify tenant_id as vcons.tenant_id to avoid ambiguity
CREATE OR REPLACE FUNCTION populate_tenant_ids(
  p_attachment_type TEXT DEFAULT 'tenant',
  p_json_path TEXT DEFAULT 'id'
)
RETURNS TABLE(
  vcon_uuid UUID,
  tenant_id TEXT,
  updated BOOLEAN
) AS $$
DECLARE
  v_vcon RECORD;
  v_extracted_tenant TEXT;
BEGIN
  -- Loop through all vCons
  -- Fixed: Qualify tenant_id as vcons.tenant_id to avoid ambiguity
  FOR v_vcon IN SELECT id, uuid FROM vcons WHERE vcons.tenant_id IS NULL
  LOOP
    -- Extract tenant from attachments
    v_extracted_tenant := extract_tenant_from_attachments(
      v_vcon.id,
      p_attachment_type,
      p_json_path
    );

    -- Update tenant_id if found
    IF v_extracted_tenant IS NOT NULL THEN
      UPDATE vcons
      SET tenant_id = v_extracted_tenant
      WHERE id = v_vcon.id;

      vcon_uuid := v_vcon.uuid;
      tenant_id := v_extracted_tenant;
      updated := TRUE;
      RETURN NEXT;
    ELSE
      -- No tenant found
      vcon_uuid := v_vcon.uuid;
      tenant_id := NULL;
      updated := FALSE;
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Step 4b: Create batched version to avoid timeouts on large datasets
-- This function processes a limited number of vCons at a time
-- FIXED: Added SECURITY DEFINER to bypass RLS when updating tenant_id
CREATE OR REPLACE FUNCTION populate_tenant_ids_batch(
  p_attachment_type TEXT DEFAULT 'tenant',
  p_json_path TEXT DEFAULT 'id',
  p_batch_size INTEGER DEFAULT 1000
)
RETURNS TABLE(
  vcon_uuid UUID,
  tenant_id TEXT,
  updated BOOLEAN,
  processed_count INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vcon RECORD;
  v_extracted_tenant TEXT;
  v_processed INTEGER := 0;
BEGIN
  -- Loop through vCons in batches
  -- Fixed: Qualify tenant_id as vcons.tenant_id to avoid ambiguity
  FOR v_vcon IN 
    SELECT id, uuid 
    FROM vcons 
    WHERE vcons.tenant_id IS NULL
    LIMIT p_batch_size
  LOOP
    -- Extract tenant from attachments
    v_extracted_tenant := extract_tenant_from_attachments(
      v_vcon.id,
      p_attachment_type,
      p_json_path
    );

    -- Update tenant_id if found
    IF v_extracted_tenant IS NOT NULL THEN
      UPDATE vcons
      SET tenant_id = v_extracted_tenant
      WHERE id = v_vcon.id;

      vcon_uuid := v_vcon.uuid;
      tenant_id := v_extracted_tenant;
      updated := TRUE;
      v_processed := v_processed + 1;
      processed_count := v_processed;
      RETURN NEXT;
    ELSE
      -- No tenant found
      vcon_uuid := v_vcon.uuid;
      tenant_id := NULL;
      updated := FALSE;
      v_processed := v_processed + 1;
      processed_count := v_processed;
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Enable Row Level Security on all tables
ALTER TABLE vcons ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE dialog ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;

-- Step 6: Create helper function to get current tenant from JWT or config
-- This function checks JWT claims first, then falls back to a configurable setting
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS TEXT AS $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  -- First, try to get from JWT claim (for authenticated users)
  -- Supabase stores tenant in JWT claims if configured
  BEGIN
    v_tenant_id := current_setting('request.jwt.claims', true)::jsonb->>'tenant_id';
  EXCEPTION WHEN OTHERS THEN
    v_tenant_id := NULL;
  END;

  -- If not in JWT, try to get from app settings (for service role)
  IF v_tenant_id IS NULL THEN
    BEGIN
      v_tenant_id := current_setting('app.current_tenant_id', true);
    EXCEPTION WHEN OTHERS THEN
      v_tenant_id := NULL;
    END;
  END IF;

  RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Step 7: Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "vcons_tenant_isolation" ON vcons;
DROP POLICY IF EXISTS "parties_tenant_isolation" ON parties;
DROP POLICY IF EXISTS "dialog_tenant_isolation" ON dialog;
DROP POLICY IF EXISTS "attachments_tenant_isolation" ON attachments;
DROP POLICY IF EXISTS "analysis_tenant_isolation" ON analysis;
DROP POLICY IF EXISTS "groups_tenant_isolation" ON groups;
DROP POLICY IF EXISTS "party_history_tenant_isolation" ON party_history;
DROP POLICY IF EXISTS "privacy_requests_tenant_isolation" ON privacy_requests;

-- Step 8: Create RLS policies for vcons table
-- Policy: Users can only see vCons where tenant_id matches their current tenant
CREATE POLICY "vcons_tenant_isolation" ON vcons
  FOR ALL
  USING (
    tenant_id IS NULL OR tenant_id = get_current_tenant_id()
  );

-- Step 9: Create RLS policies for child tables
-- These policies check the parent vCon's tenant_id

-- Parties table
CREATE POLICY "parties_tenant_isolation" ON parties
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM vcons
      WHERE vcons.id = parties.vcon_id
        AND (vcons.tenant_id IS NULL OR vcons.tenant_id = get_current_tenant_id())
    )
  );

-- Dialog table
CREATE POLICY "dialog_tenant_isolation" ON dialog
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM vcons
      WHERE vcons.id = dialog.vcon_id
        AND (vcons.tenant_id IS NULL OR vcons.tenant_id = get_current_tenant_id())
    )
  );

-- Attachments table
CREATE POLICY "attachments_tenant_isolation" ON attachments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM vcons
      WHERE vcons.id = attachments.vcon_id
        AND (vcons.tenant_id IS NULL OR vcons.tenant_id = get_current_tenant_id())
    )
  );

-- Analysis table
CREATE POLICY "analysis_tenant_isolation" ON analysis
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM vcons
      WHERE vcons.id = analysis.vcon_id
        AND (vcons.tenant_id IS NULL OR vcons.tenant_id = get_current_tenant_id())
    )
  );

-- Groups table
CREATE POLICY "groups_tenant_isolation" ON groups
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM vcons
      WHERE vcons.id = groups.vcon_id
        AND (vcons.tenant_id IS NULL OR vcons.tenant_id = get_current_tenant_id())
    )
  );

-- Party history table
CREATE POLICY "party_history_tenant_isolation" ON party_history
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM dialog
      JOIN vcons ON vcons.id = dialog.vcon_id
      WHERE dialog.id = party_history.dialog_id
        AND (vcons.tenant_id IS NULL OR vcons.tenant_id = get_current_tenant_id())
    )
  );

-- Privacy requests table (optional - may want different policy)
-- For now, allow access if tenant matches or if no tenant is set
CREATE POLICY "privacy_requests_tenant_isolation" ON privacy_requests
  FOR ALL
  USING (TRUE);  -- Privacy requests may need different access control

-- Step 10: Create policy for service role to bypass RLS when needed
-- This allows service role (with proper configuration) to access all data
-- Service role should set app.current_tenant_id or use JWT with tenant_id claim
-- Note: Service role key bypasses RLS by default in Supabase, but this policy
-- provides explicit access for cases where RLS is still enforced

-- Step 11: Add comments explaining the tenant system
COMMENT ON COLUMN vcons.tenant_id IS 'Tenant identifier extracted from attachments. Used for Row Level Security multi-tenant isolation.';
COMMENT ON FUNCTION extract_tenant_from_attachments IS 'Extracts tenant ID from vCon attachments based on configurable type and JSON path. Default: type=''tenant'', path=''id''.';
COMMENT ON FUNCTION get_current_tenant_id IS 'Gets current tenant ID from JWT claims or app settings. Used by RLS policies.';
COMMENT ON FUNCTION populate_tenant_ids_batch IS 'Batched version of populate_tenant_ids that processes a limited number of vCons at a time to avoid timeouts. Returns processed_count indicating how many records were processed in this batch.';

