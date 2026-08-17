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
-- 3. Rebuild vcon_tags_mv on coalesce(type, purpose)
-- ============================================================================
-- Belt and braces: the trigger keeps type populated going forward, but the MV
-- no longer depends on that being true.

DROP MATERIALIZED VIEW IF EXISTS vcon_tags_mv CASCADE;

CREATE MATERIALIZED VIEW vcon_tags_mv AS
SELECT
  a.tenant_id,
  ta.vcon_id,
  jsonb_object_agg(ta.key, ta.value) AS tags,
  a.updated_at AS tag_updated_at,
  a.created_at AS tag_created_at
FROM (
  SELECT a.tenant_id,
         a.vcon_id,
         a.updated_at,
         a.created_at,
         split_part(elem, ':', 1) AS key,
         split_part(elem, ':', 2) AS value
  FROM attachments a
  CROSS JOIN LATERAL jsonb_array_elements_text(a.body::jsonb) AS elem
  WHERE coalesce(a.type, a.purpose) = 'tags'
    AND a.body IS NOT NULL
    AND a.body != ''
    AND a.body ~ '^\s*\[.*\]\s*$'
) ta
JOIN attachments a ON a.vcon_id = ta.vcon_id AND coalesce(a.type, a.purpose) = 'tags'
WHERE ta.key IS NOT NULL AND ta.key != ''
GROUP BY a.tenant_id, ta.vcon_id, a.updated_at, a.created_at;

-- Indexes (unchanged from 20251210120000_optimize_mv_tags_timestamps.sql)
CREATE UNIQUE INDEX idx_vcon_tags_mv_vcon_id ON vcon_tags_mv(vcon_id);
CREATE INDEX idx_vcon_tags_mv_tags_gin ON vcon_tags_mv USING GIN (tags);
CREATE INDEX idx_vcon_tags_mv_tenant ON vcon_tags_mv(tenant_id);
CREATE INDEX idx_vcon_tags_mv_updated ON vcon_tags_mv(tag_updated_at DESC);
CREATE INDEX idx_vcon_tags_mv_tenant_updated ON vcon_tags_mv(tenant_id, tag_updated_at DESC);

-- Partial index used for incremental change detection on tag attachments
DROP INDEX IF EXISTS idx_attachments_type_updated;
CREATE INDEX idx_attachments_type_updated
  ON attachments(updated_at)
  WHERE type = 'tags' OR purpose = 'tags';

ANALYZE attachments;
ANALYZE vcon_tags_mv;
