-- Optimize indexes for large-scale multi-tenant deployment
-- Focus on tenant_id as primary search vector

-- ============================================================================
-- 1. Replace Partial Indexes with Full Indexes
-- ============================================================================
-- The current partial indexes (WHERE tenant_id IS NOT NULL) don't help queries
-- where tenant_id IS NULL is a valid filter condition in RLS policies.
-- Full indexes are more versatile for the RLS pattern:
--   tenant_id IS NULL OR tenant_id = get_current_tenant_id()

-- Drop partial indexes and recreate as full indexes
DROP INDEX IF EXISTS idx_vcons_tenant_id;
CREATE INDEX idx_vcons_tenant_id ON vcons(tenant_id);

DROP INDEX IF EXISTS idx_parties_tenant_id;
CREATE INDEX idx_parties_tenant_id ON parties(tenant_id);

DROP INDEX IF EXISTS idx_dialog_tenant_id;
CREATE INDEX idx_dialog_tenant_id ON dialog(tenant_id);

DROP INDEX IF EXISTS idx_attachments_tenant_id;
CREATE INDEX idx_attachments_tenant_id ON attachments(tenant_id);

DROP INDEX IF EXISTS idx_analysis_tenant_id;
CREATE INDEX idx_analysis_tenant_id ON analysis(tenant_id);

DROP INDEX IF EXISTS idx_groups_tenant_id;
CREATE INDEX idx_groups_tenant_id ON groups(tenant_id);

DROP INDEX IF EXISTS idx_party_history_tenant_id;
CREATE INDEX idx_party_history_tenant_id ON party_history(tenant_id);

DROP INDEX IF EXISTS idx_vcon_embeddings_tenant_id;
CREATE INDEX idx_vcon_embeddings_tenant_id ON vcon_embeddings(tenant_id);

DROP INDEX IF EXISTS idx_embedding_queue_tenant_id;
CREATE INDEX idx_embedding_queue_tenant_id ON embedding_queue(tenant_id);

DROP INDEX IF EXISTS idx_s3_sync_tracking_tenant_id;
CREATE INDEX idx_s3_sync_tracking_tenant_id ON s3_sync_tracking(tenant_id);

-- ============================================================================
-- 2. Composite Indexes for Common Query Patterns
-- ============================================================================

-- Tags search: tenant + type (for finding tags attachments per tenant)
CREATE INDEX IF NOT EXISTS idx_attachments_tenant_type
  ON attachments(tenant_id, type);

-- Embeddings search: tenant + content_type (for semantic search per tenant)
CREATE INDEX IF NOT EXISTS idx_vcon_embeddings_tenant_content_type
  ON vcon_embeddings(tenant_id, content_type);

-- Dialog search: tenant + vcon_id (for fetching dialogs per tenant)
CREATE INDEX IF NOT EXISTS idx_dialog_tenant_vcon
  ON dialog(tenant_id, vcon_id);

-- Analysis search: tenant + vcon_id + type (for fetching analysis per tenant)
CREATE INDEX IF NOT EXISTS idx_analysis_tenant_vcon_type
  ON analysis(tenant_id, vcon_id, type);

-- Parties search: tenant + vcon_id (for fetching parties per tenant)
CREATE INDEX IF NOT EXISTS idx_parties_tenant_vcon
  ON parties(tenant_id, vcon_id);

-- ============================================================================
-- 3. Recreate vcon_tags_mv with tenant_id
-- ============================================================================
-- The current materialized view lacks tenant_id, making it unusable for
-- tenant-filtered queries without a JOIN back to vcons/attachments.

DROP MATERIALIZED VIEW IF EXISTS vcon_tags_mv CASCADE;

CREATE MATERIALIZED VIEW vcon_tags_mv AS
SELECT
  a.tenant_id,
  ta.vcon_id,
  jsonb_object_agg(ta.key, ta.value) AS tags
FROM (
  SELECT a.tenant_id,
         a.vcon_id,
         split_part(elem, ':', 1) AS key,
         split_part(elem, ':', 2) AS value
  FROM attachments a
  CROSS JOIN LATERAL jsonb_array_elements_text(a.body::jsonb) AS elem
  WHERE a.type = 'tags'
    AND a.body IS NOT NULL
    AND a.body != ''
    AND a.body ~ '^\s*\[.*\]\s*$'
) ta
JOIN attachments a ON a.vcon_id = ta.vcon_id AND a.type = 'tags'
WHERE ta.key IS NOT NULL AND ta.key != ''
GROUP BY a.tenant_id, ta.vcon_id;

-- Index for tenant-filtered tag searches (primary use case)
CREATE INDEX idx_vcon_tags_mv_tenant ON vcon_tags_mv(tenant_id);

-- GIN index for tag containment queries (jsonb only - tenant filtering uses btree)
CREATE INDEX idx_vcon_tags_mv_tags_gin ON vcon_tags_mv USING GIN (tags);

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_vcon_tags_mv_vcon_id ON vcon_tags_mv(vcon_id);

-- Recreate the helper function
CREATE OR REPLACE FUNCTION refresh_vcon_tags_mv()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY vcon_tags_mv;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. Update search_vcons_by_tags to use tenant filtering
-- ============================================================================

CREATE OR REPLACE FUNCTION search_vcons_by_tags(
  tag_filter jsonb DEFAULT '{}'::jsonb,
  max_results int DEFAULT 50
)
RETURNS TABLE (
  vcon_id uuid
) AS $$
DECLARE
  current_tenant TEXT;
BEGIN
  -- Get current tenant (NULL means show all accessible data)
  current_tenant := get_current_tenant_id();

  RETURN QUERY
  SELECT v.uuid AS vcon_id
  FROM vcons v
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
  WHERE
    -- Tenant isolation
    (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
    -- Tag filtering
    AND (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
  ORDER BY v.created_at DESC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION search_vcons_by_tags(jsonb, int) TO authenticated;
GRANT EXECUTE ON FUNCTION search_vcons_by_tags(jsonb, int) TO anon;

-- ============================================================================
-- 5. Analyze Tables to Update Statistics
-- ============================================================================
-- This helps the query planner make better decisions with the new indexes

ANALYZE vcons;
ANALYZE attachments;
ANALYZE dialog;
ANALYZE analysis;
ANALYZE parties;
ANALYZE vcon_embeddings;
ANALYZE vcon_tags_mv;

-- Log results
DO $$
DECLARE
  mv_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO mv_count FROM vcon_tags_mv;
  RAISE NOTICE 'Tenant optimization complete. vcon_tags_mv has % rows', mv_count;
END $$;
