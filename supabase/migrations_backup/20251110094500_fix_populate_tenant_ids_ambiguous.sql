-- Fix ambiguous column reference in populate_tenant_ids function
-- The WHERE clause was ambiguous between the function's return column and the table column

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

