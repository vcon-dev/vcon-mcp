-- CON-1177: child tenant_id must match the parent vCon.
--
-- The BEFORE INSERT triggers from 20251122175919_create_tenant_triggers.sql do
--   SELECT tenant_id INTO NEW.tenant_id FROM vcons WHERE id = NEW.vcon_id;
-- which OVERWRITES any tenant_id the writer supplied, and writes NULL when the
-- parent row is not visible (RLS without tenant context) or its tenant_id is
-- still NULL (set later in another transaction). The writer now stamps every
-- child row with the parent's tenant_id (src/db/batch-writer.ts row builders,
-- src/db/queries.ts single-child writes), so the trigger keeps the parent's
-- value when it can see one and otherwise keeps the explicit value instead of
-- clobbering it. The parent stays authoritative whenever it has a tenant.
--
-- On INSERT ... ON CONFLICT DO UPDATE, EXCLUDED carries the trigger's result,
-- so SET tenant_id = EXCLUDED.tenant_id gets the same value.
--
-- Creates the functions in the caller's search_path; a per-group schema needs
-- this migration applied in it as well.

SET client_min_messages TO WARNING;

CREATE OR REPLACE FUNCTION set_parties_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tenant_id := COALESCE(
    (SELECT tenant_id FROM vcons WHERE vcons.id = NEW.vcon_id),
    NEW.tenant_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_dialog_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tenant_id := COALESCE(
    (SELECT tenant_id FROM vcons WHERE vcons.id = NEW.vcon_id),
    NEW.tenant_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_analysis_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tenant_id := COALESCE(
    (SELECT tenant_id FROM vcons WHERE vcons.id = NEW.vcon_id),
    NEW.tenant_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_attachments_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tenant_id := COALESCE(
    (SELECT tenant_id FROM vcons WHERE vcons.id = NEW.vcon_id),
    NEW.tenant_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
