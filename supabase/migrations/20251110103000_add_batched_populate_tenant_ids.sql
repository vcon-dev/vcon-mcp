-- Add batched version of populate_tenant_ids to avoid timeouts on large datasets
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

COMMENT ON FUNCTION populate_tenant_ids_batch IS 'Batched version of populate_tenant_ids that processes a limited number of vCons at a time to avoid timeouts. Returns processed_count indicating how many records were processed in this batch.';

