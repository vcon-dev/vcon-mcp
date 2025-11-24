-- Create triggers to auto-populate tenant_id on INSERT and cascade updates from vcons to children
-- This ensures tenant_id is always kept in sync with the parent vcons table

-- Suppress NOTICE messages for cleaner output
SET client_min_messages TO WARNING;

-- Function to set tenant_id on parties INSERT
CREATE OR REPLACE FUNCTION set_parties_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id
  FROM vcons
  WHERE vcons.id = NEW.vcon_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to set tenant_id on dialog INSERT
CREATE OR REPLACE FUNCTION set_dialog_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id
  FROM vcons
  WHERE vcons.id = NEW.vcon_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to set tenant_id on attachments INSERT
CREATE OR REPLACE FUNCTION set_attachments_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id
  FROM vcons
  WHERE vcons.id = NEW.vcon_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to set tenant_id on analysis INSERT
CREATE OR REPLACE FUNCTION set_analysis_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id
  FROM vcons
  WHERE vcons.id = NEW.vcon_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to set tenant_id on groups INSERT
CREATE OR REPLACE FUNCTION set_groups_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id
  FROM vcons
  WHERE vcons.id = NEW.vcon_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to set tenant_id on party_history INSERT (via dialog)
CREATE OR REPLACE FUNCTION set_party_history_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  SELECT vcons.tenant_id INTO NEW.tenant_id
  FROM dialog
  JOIN vcons ON vcons.id = dialog.vcon_id
  WHERE dialog.id = NEW.dialog_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to set tenant_id on vcon_embeddings INSERT
CREATE OR REPLACE FUNCTION set_vcon_embeddings_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id
  FROM vcons
  WHERE vcons.id = NEW.vcon_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to set tenant_id on embedding_queue INSERT
CREATE OR REPLACE FUNCTION set_embedding_queue_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id
  FROM vcons
  WHERE vcons.id = NEW.vcon_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to set tenant_id on s3_sync_tracking INSERT
CREATE OR REPLACE FUNCTION set_s3_sync_tracking_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id
  FROM vcons
  WHERE vcons.id = NEW.vcon_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to cascade tenant_id updates from vcons to all child tables
CREATE OR REPLACE FUNCTION cascade_tenant_id_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update if tenant_id actually changed
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    -- Update parties
    UPDATE parties SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    
    -- Update dialog
    UPDATE dialog SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    
    -- Update attachments
    UPDATE attachments SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    
    -- Update analysis
    UPDATE analysis SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    
    -- Update groups
    UPDATE groups SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    
    -- Update party_history (via dialog)
    UPDATE party_history
    SET tenant_id = NEW.tenant_id
    FROM dialog
    WHERE dialog.id = party_history.dialog_id
      AND dialog.vcon_id = NEW.id;
    
    -- Update vcon_embeddings
    UPDATE vcon_embeddings SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    
    -- Update embedding_queue
    UPDATE embedding_queue SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
    
    -- Update s3_sync_tracking
    UPDATE s3_sync_tracking SET tenant_id = NEW.tenant_id WHERE vcon_id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS trg_set_parties_tenant_id ON parties;
DROP TRIGGER IF EXISTS trg_set_dialog_tenant_id ON dialog;
DROP TRIGGER IF EXISTS trg_set_attachments_tenant_id ON attachments;
DROP TRIGGER IF EXISTS trg_set_analysis_tenant_id ON analysis;
DROP TRIGGER IF EXISTS trg_set_groups_tenant_id ON groups;
DROP TRIGGER IF EXISTS trg_set_party_history_tenant_id ON party_history;
DROP TRIGGER IF EXISTS trg_set_vcon_embeddings_tenant_id ON vcon_embeddings;
DROP TRIGGER IF EXISTS trg_set_embedding_queue_tenant_id ON embedding_queue;
DROP TRIGGER IF EXISTS trg_set_s3_sync_tracking_tenant_id ON s3_sync_tracking;
DROP TRIGGER IF EXISTS trg_cascade_tenant_id_update ON vcons;

-- Create triggers for INSERT operations
CREATE TRIGGER trg_set_parties_tenant_id
  BEFORE INSERT ON parties
  FOR EACH ROW
  EXECUTE FUNCTION set_parties_tenant_id();

CREATE TRIGGER trg_set_dialog_tenant_id
  BEFORE INSERT ON dialog
  FOR EACH ROW
  EXECUTE FUNCTION set_dialog_tenant_id();

CREATE TRIGGER trg_set_attachments_tenant_id
  BEFORE INSERT ON attachments
  FOR EACH ROW
  EXECUTE FUNCTION set_attachments_tenant_id();

CREATE TRIGGER trg_set_analysis_tenant_id
  BEFORE INSERT ON analysis
  FOR EACH ROW
  EXECUTE FUNCTION set_analysis_tenant_id();

CREATE TRIGGER trg_set_groups_tenant_id
  BEFORE INSERT ON groups
  FOR EACH ROW
  EXECUTE FUNCTION set_groups_tenant_id();

CREATE TRIGGER trg_set_party_history_tenant_id
  BEFORE INSERT ON party_history
  FOR EACH ROW
  EXECUTE FUNCTION set_party_history_tenant_id();

CREATE TRIGGER trg_set_vcon_embeddings_tenant_id
  BEFORE INSERT ON vcon_embeddings
  FOR EACH ROW
  EXECUTE FUNCTION set_vcon_embeddings_tenant_id();

CREATE TRIGGER trg_set_embedding_queue_tenant_id
  BEFORE INSERT ON embedding_queue
  FOR EACH ROW
  EXECUTE FUNCTION set_embedding_queue_tenant_id();

CREATE TRIGGER trg_set_s3_sync_tracking_tenant_id
  BEFORE INSERT ON s3_sync_tracking
  FOR EACH ROW
  EXECUTE FUNCTION set_s3_sync_tracking_tenant_id();

-- Create trigger to cascade tenant_id updates from vcons
CREATE TRIGGER trg_cascade_tenant_id_update
  AFTER UPDATE OF tenant_id ON vcons
  FOR EACH ROW
  EXECUTE FUNCTION cascade_tenant_id_update();

