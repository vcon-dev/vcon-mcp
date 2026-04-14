-- Fix: all search RPCs returned vcons.id (internal PK) instead of vcons.uuid (spec field).
-- get_vcon looks up by vcons.uuid, so every search result → get_vcon call failed with
-- "vCon not found" because the IDs were from different columns.
--
-- Pattern for each fix:
--   - keyword: add internal_id to base CTE; JOIN vcons for uuid in party/dialog/analysis branches
--   - semantic: JOIN vcons v ON v.id = e.vcon_id; return v.uuid
--   - hybrid:   final SELECT was v.id; change to v.uuid (joins already use v.id correctly)

-- ============================================================================
-- 1. search_vcons_keyword
-- ============================================================================
DROP FUNCTION IF EXISTS search_vcons_keyword CASCADE;

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
  rank double precision,
  snippet text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  current_tenant TEXT;
BEGIN
  current_tenant := get_current_tenant_id();

  RETURN QUERY
  WITH base AS (
    -- Subject (vcons accessed directly — has both id and uuid)
    SELECT v.uuid AS vcon_id,
           v.id   AS internal_id,
           'subject'::text AS doc_type,
           NULL::int AS ref_index,
           v.subject::text AS content,
           v.subject_tsvector AS tsv
    FROM vcons v
    WHERE (start_date IS NULL OR v.created_at >= start_date)
      AND (end_date   IS NULL OR v.created_at <= end_date)
      AND (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
      AND v.subject_tsvector IS NOT NULL
      AND v.subject_tsvector @@ plainto_tsquery('english', query_text)

    UNION ALL

    -- Parties (join vcons to get uuid)
    SELECT v.uuid AS vcon_id,
           p.vcon_id AS internal_id,
           'party'::text AS doc_type,
           p.party_index::int AS ref_index,
           concat_ws(' ', p.name, p.mailto, p.tel)::text AS content,
           p.party_tsvector AS tsv
    FROM parties p
    JOIN vcons v ON v.id = p.vcon_id
    WHERE (current_tenant IS NULL OR p.tenant_id IS NULL OR p.tenant_id = current_tenant)
      AND (start_date IS NULL OR v.created_at >= start_date)
      AND (end_date   IS NULL OR v.created_at <= end_date)
      AND p.party_tsvector IS NOT NULL
      AND p.party_tsvector @@ plainto_tsquery('simple', query_text)

    UNION ALL

    -- Dialog (join vcons to get uuid)
    SELECT v.uuid AS vcon_id,
           d.vcon_id AS internal_id,
           'dialog'::text AS doc_type,
           d.dialog_index::int AS ref_index,
           d.body::text AS content,
           d.body_tsvector AS tsv
    FROM dialog d
    JOIN vcons v ON v.id = d.vcon_id
    WHERE (current_tenant IS NULL OR d.tenant_id IS NULL OR d.tenant_id = current_tenant)
      AND (start_date IS NULL OR v.created_at >= start_date)
      AND (end_date   IS NULL OR v.created_at <= end_date)
      AND d.body_tsvector IS NOT NULL
      AND d.body_tsvector @@ plainto_tsquery('english', query_text)

    UNION ALL

    -- Analysis (join vcons to get uuid)
    SELECT v.uuid AS vcon_id,
           a.vcon_id AS internal_id,
           'analysis'::text AS doc_type,
           a.analysis_index::int AS ref_index,
           a.body::text AS content,
           a.body_tsvector AS tsv
    FROM analysis a
    JOIN vcons v ON v.id = a.vcon_id
    WHERE (current_tenant IS NULL OR a.tenant_id IS NULL OR a.tenant_id = current_tenant)
      AND (start_date IS NULL OR v.created_at >= start_date)
      AND (end_date   IS NULL OR v.created_at <= end_date)
      AND a.body_tsvector IS NOT NULL
      AND a.body_tsvector @@ plainto_tsquery('english', query_text)
  )
  SELECT b.vcon_id,
         b.doc_type,
         b.ref_index,
         ts_rank_cd(b.tsv, plainto_tsquery('english', query_text), 32)::double precision AS rank,
         ts_headline(
           'english',
           b.content,
           plainto_tsquery('english', query_text),
           'MaxFragments=3, MaxWords=25, MinWords=5, FragmentDelimiter= '' ... '''
         )::text AS snippet
  FROM base b
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = b.internal_id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
  ORDER BY rank DESC
  LIMIT max_results;
END;
$$;

GRANT EXECUTE ON FUNCTION search_vcons_keyword TO authenticated;
GRANT EXECUTE ON FUNCTION search_vcons_keyword TO service_role;
GRANT EXECUTE ON FUNCTION search_vcons_keyword TO anon;

-- ============================================================================
-- 2. search_vcons_semantic
-- ============================================================================
DROP FUNCTION IF EXISTS search_vcons_semantic CASCADE;

CREATE OR REPLACE FUNCTION search_vcons_semantic(
  query_embedding vector(384),
  tag_filter jsonb DEFAULT '{}'::jsonb,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 50
)
RETURNS TABLE (
  vcon_id uuid,
  content_type text,
  content_reference text,
  content_text text,
  similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  current_tenant TEXT;
BEGIN
  current_tenant := get_current_tenant_id();

  RETURN QUERY
  SELECT v.uuid AS vcon_id,
         e.content_type,
         e.content_reference,
         e.content_text,
         (1 - (e.embedding <=> query_embedding))::float AS similarity
  FROM vcon_embeddings e
  JOIN vcons v ON v.id = e.vcon_id
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = e.vcon_id
  WHERE 1 - (e.embedding <=> query_embedding) > match_threshold
    AND (current_tenant IS NULL OR e.tenant_id IS NULL OR e.tenant_id = current_tenant)
    AND (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION search_vcons_semantic TO authenticated;
GRANT EXECUTE ON FUNCTION search_vcons_semantic TO service_role;
GRANT EXECUTE ON FUNCTION search_vcons_semantic TO anon;

-- ============================================================================
-- 3. search_vcons_hybrid
-- ============================================================================
DROP FUNCTION IF EXISTS search_vcons_hybrid CASCADE;

CREATE OR REPLACE FUNCTION search_vcons_hybrid(
  keyword_query text DEFAULT NULL,
  query_embedding vector(384) DEFAULT NULL,
  tag_filter jsonb DEFAULT '{}'::jsonb,
  semantic_weight double precision DEFAULT 0.6,
  limit_results int DEFAULT 50
)
RETURNS TABLE (
  vcon_id uuid,
  combined_score double precision,
  semantic_score double precision,
  keyword_score double precision
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  current_tenant TEXT;
BEGIN
  current_tenant := get_current_tenant_id();

  RETURN QUERY
  WITH sem AS (
    SELECT e.vcon_id,
           MAX((1 - (e.embedding <=> query_embedding))::double precision) AS semantic_score
    FROM vcon_embeddings e
    WHERE query_embedding IS NOT NULL
      AND (current_tenant IS NULL OR e.tenant_id IS NULL OR e.tenant_id = current_tenant)
    GROUP BY e.vcon_id
  ),
  kw AS (
    SELECT km.vcon_id,
           MAX(km.keyword_score)::double precision AS keyword_score
    FROM (
      SELECT v.id AS vcon_id,
             ts_rank_cd(v.subject_tsvector, plainto_tsquery('english', keyword_query), 32)::double precision AS keyword_score
      FROM vcons v
      WHERE keyword_query IS NOT NULL
        AND (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
        AND v.subject_tsvector IS NOT NULL
        AND v.subject_tsvector @@ plainto_tsquery('english', keyword_query)

      UNION ALL

      SELECT p.vcon_id,
             ts_rank_cd(p.party_tsvector, plainto_tsquery('simple', keyword_query), 32)::double precision * 0.8 AS keyword_score
      FROM parties p
      WHERE keyword_query IS NOT NULL
        AND (current_tenant IS NULL OR p.tenant_id IS NULL OR p.tenant_id = current_tenant)
        AND p.party_tsvector IS NOT NULL
        AND p.party_tsvector @@ plainto_tsquery('simple', keyword_query)

      UNION ALL

      SELECT d.vcon_id,
             ts_rank_cd(d.body_tsvector, plainto_tsquery('english', keyword_query), 32)::double precision * 0.6 AS keyword_score
      FROM dialog d
      WHERE keyword_query IS NOT NULL
        AND (current_tenant IS NULL OR d.tenant_id IS NULL OR d.tenant_id = current_tenant)
        AND d.body_tsvector IS NOT NULL
        AND d.body_tsvector @@ plainto_tsquery('english', keyword_query)

      UNION ALL

      SELECT a.vcon_id,
             ts_rank_cd(a.body_tsvector, plainto_tsquery('english', keyword_query), 32)::double precision * 0.8 AS keyword_score
      FROM analysis a
      WHERE keyword_query IS NOT NULL
        AND (current_tenant IS NULL OR a.tenant_id IS NULL OR a.tenant_id = current_tenant)
        AND a.body_tsvector IS NOT NULL
        AND a.body_tsvector @@ plainto_tsquery('english', keyword_query)
    ) km
    GROUP BY km.vcon_id
  )
  -- Join to vcons to get the external uuid (not the internal id)
  SELECT v.uuid AS vcon_id,
         (coalesce(s.semantic_score, 0) * semantic_weight
          + coalesce(k.keyword_score, 0) * (1 - semantic_weight))::double precision AS combined_score,
         coalesce(s.semantic_score, 0)::double precision AS semantic_score,
         coalesce(k.keyword_score, 0)::double precision AS keyword_score
  FROM vcons v
  LEFT JOIN sem s ON s.vcon_id = v.id
  LEFT JOIN kw  k ON k.vcon_id = v.id
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
    AND (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
    AND (
      (query_embedding IS NOT NULL AND s.vcon_id IS NOT NULL)
      OR (keyword_query IS NOT NULL AND k.vcon_id IS NOT NULL)
    )
  ORDER BY combined_score DESC
  LIMIT limit_results;
END;
$$;

GRANT EXECUTE ON FUNCTION search_vcons_hybrid TO authenticated;
GRANT EXECUTE ON FUNCTION search_vcons_hybrid TO service_role;
GRANT EXECUTE ON FUNCTION search_vcons_hybrid TO anon;
