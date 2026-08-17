-- Tag storage: treat attachments.purpose = 'tags' as equivalent to type = 'tags'
--
-- vCon 0.4.0 attachments carry `purpose`, not `type` (vcon-core defines `type`
-- only on Dialog and Analysis). All tag read paths and vcon_tags_mv key on
-- attachments.type = 'tags', so a spec-correct 0.4.0 vCon that carries its tags
-- as an attachment with purpose='tags' landed with type NULL and its tags were
-- silently invisible.
--
-- Fix at the one place every writer routes through: a BEFORE trigger on
-- attachments that mirrors 'tags' across both columns. Every existing
-- type='tags' consumer (queries.ts, database-analytics.ts, the MV) keeps
-- working unchanged, and exported vCons now carry the spec field too.

-- ============================================================================
-- 1. Normalize on write
-- ============================================================================
CREATE OR REPLACE FUNCTION normalize_tags_attachment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.purpose = 'tags' AND NEW.type IS NULL THEN
    NEW.type := 'tags';
  ELSIF NEW.type = 'tags' AND NEW.purpose IS NULL THEN
    NEW.purpose := 'tags';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_attachments_normalize_tags ON attachments;
CREATE TRIGGER trigger_attachments_normalize_tags
  BEFORE INSERT OR UPDATE ON attachments
  FOR EACH ROW
  EXECUTE FUNCTION normalize_tags_attachment();

-- ============================================================================
-- 2. Backfill existing rows (both directions)
-- ============================================================================
UPDATE attachments SET type = 'tags' WHERE type IS NULL AND purpose = 'tags';
UPDATE attachments SET purpose = 'tags' WHERE purpose IS NULL AND type = 'tags';

-- ============================================================================
-- 3. vcon_tags_mv is NOT rebuilt here
-- ============================================================================
-- 20260817120000_vcon_tags_mv_object_body.sql already defines the MV on
-- coalesce(type, purpose), so the "belt and braces" rebuild this migration
-- used to carry is redundant. It is also unsafe: on a database that has
-- already applied 20260817120000, this file applies out of order and its
-- rebuild would revert the MV to the array-only body predicate, silently
-- re-breaking tags for every object-bodied vCon. Leaving the MV alone makes
-- this migration order-independent.

-- Partial index used for incremental change detection on tag attachments
DROP INDEX IF EXISTS idx_attachments_type_updated;
CREATE INDEX idx_attachments_type_updated
  ON attachments(updated_at)
  WHERE type = 'tags' OR purpose = 'tags';

ANALYZE attachments;
ANALYZE vcon_tags_mv;
