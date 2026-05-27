-- Fix enqueue_embedding trigger: insert NEW.uuid (not NEW.id)
--
-- The embedding_queue.vcon_id foreign key was changed in production from
--   REFERENCES vcons(id)   -- as declared in 20251010140000
-- to
--   REFERENCES vcons(uuid)
-- without a corresponding update to this trigger, which still inserted
-- NEW.id. The result: every INSERT into vcons fired the trigger, the FK
-- rejected the random gen_random_uuid() value (because nothing in vcons
-- has that as its uuid column), and the whole transaction rolled back —
-- silently blocking all new vcon row creation in production.
--
-- This migration aligns the trigger with the live FK target. NEW.uuid is
-- the deterministic vCon UUID the rest of the system uses to identify
-- vCons; that's what consumers (transcribe queue, analysis joins) already
-- expect to find in embedding_queue.

CREATE OR REPLACE FUNCTION enqueue_embedding() RETURNS trigger AS $$
BEGIN
  INSERT INTO embedding_queue(vcon_id) VALUES (NEW.uuid);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
