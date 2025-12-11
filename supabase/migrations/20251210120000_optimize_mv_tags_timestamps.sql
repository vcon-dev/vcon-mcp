-- Optimize mv_tags for speed and efficiency with timestamps
-- Tags are the primary search filter - this must be fast

-- ============================================================================
-- 1. Add timestamps to attachments table
-- ============================================================================
-- The attachments table currently lacks created_at/updated_at columns,
-- making it impossible to track tag modification times or do incremental updates.

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Create index on updated_at for efficient change detection
CREATE INDEX IF NOT EXISTS idx_attachments_updated_at
  ON attachments(updated_at);

-- Composite index for finding tag attachments that changed (for incremental refresh)
CREATE INDEX IF NOT EXISTS idx_attachments_type_updated
  ON attachments(type, updated_at)
  WHERE type = 'tags';

-- ============================================================================
-- 2. Create trigger to auto-update updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_attachments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_attachments_updated_at ON attachments;
CREATE TRIGGER trigger_attachments_updated_at
  BEFORE UPDATE ON attachments
  FOR EACH ROW
  EXECUTE FUNCTION update_attachments_updated_at();

-- ============================================================================
-- 3. Recreate vcon_tags_mv WITH timestamps
-- ============================================================================
-- Include tag_updated_at so queries can filter/sort by modification time

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
  WHERE a.type = 'tags'
    AND a.body IS NOT NULL
    AND a.body != ''
    AND a.body ~ '^\s*\[.*\]\s*$'
) ta
JOIN attachments a ON a.vcon_id = ta.vcon_id AND a.type = 'tags'
WHERE ta.key IS NOT NULL AND ta.key != ''
GROUP BY a.tenant_id, ta.vcon_id, a.updated_at, a.created_at;

-- ============================================================================
-- 4. Create optimized indexes for tag searches
-- ============================================================================

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_vcon_tags_mv_vcon_id
  ON vcon_tags_mv(vcon_id);

-- GIN index for tag containment queries (@> operator)
CREATE INDEX idx_vcon_tags_mv_tags_gin
  ON vcon_tags_mv USING GIN (tags);

-- B-tree index on tenant_id for RLS filtering
CREATE INDEX idx_vcon_tags_mv_tenant
  ON vcon_tags_mv(tenant_id);

-- CRITICAL: Composite index for multi-tenant tag searches
-- This is the primary search pattern: filter by tenant, then by tags
-- Composite GIN index for multi-tenant tag searches (tenant_id, tags)
CREATE INDEX idx_vcon_tags_mv_tenant_tags
  ON vcon_tags_mv USING GIN (tenant_id, tags);

-- Index for sorting by tag modification time (recent tags first)
CREATE INDEX idx_vcon_tags_mv_updated
  ON vcon_tags_mv(tag_updated_at DESC);

-- Composite: tenant + updated_at for "recent tags in my tenant"
CREATE INDEX idx_vcon_tags_mv_tenant_updated
  ON vcon_tags_mv(tenant_id, tag_updated_at DESC);

-- ============================================================================
-- 5. Update search_vcons_by_tags to use timestamps
-- ============================================================================
-- Add optional parameters for filtering by tag modification time

-- Drop all existing overloads of the function (different return type)
DROP FUNCTION IF EXISTS search_vcons_by_tags CASCADE;

CREATE OR REPLACE FUNCTION search_vcons_by_tags(
  tag_filter jsonb DEFAULT '{}'::jsonb,
  max_results int DEFAULT 50,
  tags_modified_after timestamptz DEFAULT NULL,
  tags_modified_before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  vcon_id uuid,
  tag_updated_at timestamptz
) AS $$
DECLARE
  current_tenant TEXT;
BEGIN
  -- Get current tenant (NULL means show all accessible data)
  current_tenant := get_current_tenant_id();

  RETURN QUERY
  SELECT v.uuid AS vcon_id, ta.tag_updated_at
  FROM vcons v
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
  WHERE
    -- Tenant isolation
    (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
    -- Tag filtering (uses GIN index)
    AND (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
    -- Timestamp filtering
    AND (tags_modified_after IS NULL OR ta.tag_updated_at >= tags_modified_after)
    AND (tags_modified_before IS NULL OR ta.tag_updated_at <= tags_modified_before)
  ORDER BY COALESCE(ta.tag_updated_at, v.created_at) DESC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION search_vcons_by_tags(jsonb, int, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION search_vcons_by_tags(jsonb, int, timestamptz, timestamptz) TO anon;

-- ============================================================================
-- 6. Create fast tag lookup function
-- ============================================================================
-- Optimized single-vcon tag lookup using the MV

CREATE OR REPLACE FUNCTION get_vcon_tags(
  p_vcon_uuid uuid
)
RETURNS TABLE (
  tags jsonb,
  updated_at timestamptz,
  created_at timestamptz
) AS $$
DECLARE
  current_tenant TEXT;
BEGIN
  current_tenant := get_current_tenant_id();

  RETURN QUERY
  SELECT ta.tags, ta.tag_updated_at, ta.tag_created_at
  FROM vcons v
  JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
  WHERE v.uuid = p_vcon_uuid
    AND (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant);
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION get_vcon_tags(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_vcon_tags(uuid) TO anon;

-- ============================================================================
-- 7. Create efficient tag existence check
-- ============================================================================
-- Fast check if a vcon has specific tags (returns boolean)

CREATE OR REPLACE FUNCTION vcon_has_tags(
  p_vcon_uuid uuid,
  tag_filter jsonb
)
RETURNS boolean AS $$
DECLARE
  current_tenant TEXT;
  has_match boolean;
BEGIN
  current_tenant := get_current_tenant_id();

  SELECT EXISTS (
    SELECT 1
    FROM vcons v
    JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
    WHERE v.uuid = p_vcon_uuid
      AND (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
      AND ta.tags @> tag_filter
  ) INTO has_match;

  RETURN has_match;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION vcon_has_tags(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION vcon_has_tags(uuid, jsonb) TO anon;

-- ============================================================================
-- 8. Update search RPCs to include timestamp info
-- ============================================================================

-- Drop existing functions (different return types)
DROP FUNCTION IF EXISTS search_vcons_keyword(text, timestamptz, timestamptz, jsonb, int);
DROP FUNCTION IF EXISTS search_vcons_semantic(vector(1536), jsonb, float, int);
DROP FUNCTION IF EXISTS search_vcons_hybrid(text, vector(1536), jsonb, float, int);
DROP FUNCTION IF EXISTS refresh_vcon_tags_mv();

-- Keyword search with tag timestamps
CREATE OR REPLACE FUNCTION search_vcons_keyword(
  query_text text,
  start_date timestamptz DEFAULT NULL,
  end_date   timestamptz DEFAULT NULL,
  tag_filter jsonb DEFAULT '{}'::jsonb,
  max_results int DEFAULT 50
)
RETURNS TABLE (
  vcon_id uuid,
  doc_type text,
  ref_index int,
  rank float,
  snippet text,
  tag_updated_at timestamptz
) AS $$
DECLARE
  current_tenant TEXT;
BEGIN
  current_tenant := get_current_tenant_id();

  RETURN QUERY
  WITH base AS (
    SELECT v.id AS vcon_id, 'subject'::text AS doc_type, NULL::int AS ref_index,
           v.subject AS content,
           setweight(to_tsvector('english', coalesce(v.subject,'')), 'A') AS tsv
    FROM vcons v
    WHERE (start_date IS NULL OR v.created_at >= start_date)
      AND (end_date   IS NULL OR v.created_at <= end_date)
      AND (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)

    UNION ALL
    SELECT p.vcon_id, 'party', p.party_index,
           concat_ws(' ', p.name, p.mailto, p.tel),
           setweight(to_tsvector('simple',
             coalesce(p.name,'')||' '||coalesce(p.mailto,'')||' '||coalesce(p.tel,'')), 'B')
    FROM parties p
    WHERE (current_tenant IS NULL OR p.tenant_id IS NULL OR p.tenant_id = current_tenant)

    UNION ALL
    SELECT d.vcon_id, 'dialog', d.dialog_index, d.body,
           setweight(to_tsvector('english', coalesce(d.body,'')), 'C')
    FROM dialog d
    WHERE (current_tenant IS NULL OR d.tenant_id IS NULL OR d.tenant_id = current_tenant)

    UNION ALL
    SELECT a.vcon_id, 'analysis', a.analysis_index, a.body,
           setweight(to_tsvector('english', coalesce(a.body,'')), 'B')
    FROM analysis a
    WHERE (current_tenant IS NULL OR a.tenant_id IS NULL OR a.tenant_id = current_tenant)
  )
  SELECT b.vcon_id, b.doc_type, b.ref_index,
         ts_rank_cd(b.tsv, plainto_tsquery('english', query_text), 32) AS rank,
         ts_headline('english', b.content, plainto_tsquery('english', query_text),
           'ShortWord=2, MinWords=5, MaxWords=20, HighlightAll=TRUE') AS snippet,
         ta.tag_updated_at
  FROM base b
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = b.vcon_id
  WHERE b.tsv @@ plainto_tsquery('english', query_text)
    AND (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
  ORDER BY rank DESC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- Semantic search with tag timestamps
CREATE OR REPLACE FUNCTION search_vcons_semantic(
  query_embedding vector(1536),
  tag_filter jsonb DEFAULT '{}'::jsonb,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 50
)
RETURNS TABLE (
  vcon_id uuid,
  content_type text,
  content_reference text,
  content_text text,
  similarity float,
  tag_updated_at timestamptz
) AS $$
DECLARE
  current_tenant TEXT;
BEGIN
  current_tenant := get_current_tenant_id();

  RETURN QUERY
  SELECT e.vcon_id, e.content_type, e.content_reference, e.content_text,
         1 - (e.embedding <=> query_embedding) AS similarity,
         ta.tag_updated_at
  FROM vcon_embeddings e
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = e.vcon_id
  WHERE 1 - (e.embedding <=> query_embedding) > match_threshold
    AND (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
    AND (current_tenant IS NULL OR e.tenant_id IS NULL OR e.tenant_id = current_tenant)
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- Hybrid search with tag timestamps
CREATE OR REPLACE FUNCTION search_vcons_hybrid(
  keyword_query text DEFAULT NULL,
  query_embedding vector(1536) DEFAULT NULL,
  tag_filter jsonb DEFAULT '{}'::jsonb,
  semantic_weight float DEFAULT 0.6,
  limit_results int DEFAULT 50
)
RETURNS TABLE (
  vcon_id uuid,
  combined_score float,
  semantic_score float,
  keyword_score float,
  tag_updated_at timestamptz
) AS $$
DECLARE
  current_tenant TEXT;
BEGIN
  current_tenant := get_current_tenant_id();

  RETURN QUERY
  WITH sem AS (
    SELECT e.vcon_id, MAX(1 - (e.embedding <=> query_embedding)) AS semantic_score
    FROM vcon_embeddings e
    WHERE query_embedding IS NOT NULL
      AND (current_tenant IS NULL OR e.tenant_id IS NULL OR e.tenant_id = current_tenant)
    GROUP BY e.vcon_id
  ),
  kw AS (
    SELECT x.vcon_id, MAX(ts_rank_cd(x.tsv, plainto_tsquery('english', keyword_query), 32)) AS keyword_score
    FROM (
      SELECT v.id AS vcon_id,
             setweight(to_tsvector('english', coalesce(v.subject,'')), 'A') ||
             setweight(to_tsvector('simple', coalesce(p.name,'')||' '||coalesce(p.mailto,'')||' '||coalesce(p.tel,'')), 'B') ||
             setweight(to_tsvector('english', coalesce(d.body,'')), 'C') ||
             setweight(to_tsvector('english', coalesce(a.body,'')), 'B') AS tsv
      FROM vcons v
      LEFT JOIN parties  p ON p.vcon_id = v.id
      LEFT JOIN dialog   d ON d.vcon_id = v.id
      LEFT JOIN analysis a ON a.vcon_id = v.id
      WHERE (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
    ) x
    WHERE keyword_query IS NOT NULL
      AND x.tsv @@ plainto_tsquery('english', keyword_query)
    GROUP BY x.vcon_id
  )
  SELECT v.id AS vcon_id,
         coalesce(s.semantic_score, 0) * semantic_weight
         + coalesce(k.keyword_score, 0) * (1 - semantic_weight) AS combined_score,
         coalesce(s.semantic_score, 0) AS semantic_score,
         coalesce(k.keyword_score, 0) AS keyword_score,
         ta.tag_updated_at
  FROM vcons v
  LEFT JOIN sem s ON s.vcon_id = v.id
  LEFT JOIN kw  k ON k.vcon_id = v.id
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
    AND ((query_embedding IS NOT NULL AND s.semantic_score IS NOT NULL)
      OR (keyword_query   IS NOT NULL AND k.keyword_score IS NOT NULL))
    AND (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
  ORDER BY combined_score DESC
  LIMIT limit_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 9. Refresh helper with timestamp tracking
-- ============================================================================
CREATE OR REPLACE FUNCTION refresh_vcon_tags_mv()
RETURNS TABLE (
  refreshed_at timestamptz,
  row_count bigint
) AS $$
DECLARE
  rc bigint;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY vcon_tags_mv;
  GET DIAGNOSTICS rc = ROW_COUNT;

  RETURN QUERY SELECT NOW(), rc;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. Analyze tables for query planner optimization
-- ============================================================================
ANALYZE attachments;
ANALYZE vcon_tags_mv;

-- ============================================================================
-- 11. Log results
-- ============================================================================
DO $$
DECLARE
  mv_count INTEGER;
  att_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO mv_count FROM vcon_tags_mv;
  SELECT COUNT(*) INTO att_count FROM attachments WHERE type = 'tags';
  RAISE NOTICE 'Tag optimization complete:';
  RAISE NOTICE '  - vcon_tags_mv rows: %', mv_count;
  RAISE NOTICE '  - Tag attachments: %', att_count;
  RAISE NOTICE '  - Timestamps added to attachments table';
  RAISE NOTICE '  - New indexes created for fast tag searches';
END $$;
