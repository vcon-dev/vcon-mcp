-- Optimize Search Functions to Use Materialized tsvector Columns
-- This migration updates the search functions to use pre-computed tsvector columns
-- instead of computing them on-the-fly, dramatically improving performance.

-- ============================================================================
-- Optimized Keyword Search Function
-- ============================================================================
-- Uses materialized tsvector columns for 10-100x faster queries

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
) AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    -- Use materialized tsvector for subject (fast)
    SELECT v.id AS vcon_id, 'subject'::text AS doc_type, NULL::int AS ref_index,
           v.subject AS content,
           v.subject_tsvector AS tsv
    FROM vcons v
    WHERE (start_date IS NULL OR v.created_at >= start_date)
      AND (end_date   IS NULL OR v.created_at <= end_date)
      AND v.subject_tsvector IS NOT NULL
      AND v.subject_tsvector @@ plainto_tsquery('english', query_text)

    UNION ALL
    
    -- Use materialized tsvector for parties (fast)
    SELECT p.vcon_id, 'party', p.party_index,
           concat_ws(' ', p.name, p.mailto, p.tel) AS content,
           p.party_tsvector AS tsv
    FROM parties p
    WHERE p.party_tsvector IS NOT NULL
      AND p.party_tsvector @@ plainto_tsquery('simple', query_text)

    UNION ALL
    
    -- Use materialized tsvector for dialog (fast)
    SELECT d.vcon_id, 'dialog', d.dialog_index, d.body AS content,
           d.body_tsvector AS tsv
    FROM dialog d
    WHERE d.body_tsvector IS NOT NULL
      AND d.body_tsvector @@ plainto_tsquery('english', query_text)

    UNION ALL
    
    -- Use materialized tsvector for analysis (fast)
    SELECT a.vcon_id, 'analysis', a.analysis_index, a.body AS content,
           a.body_tsvector AS tsv
    FROM analysis a
    WHERE a.body_tsvector IS NOT NULL
      AND a.body_tsvector @@ plainto_tsquery('english', query_text)
  )
  SELECT b.vcon_id, b.doc_type, b.ref_index,
         ts_rank_cd(b.tsv, plainto_tsquery('english', query_text), 32)::double precision AS rank,
         ts_headline('english', b.content, plainto_tsquery('english', query_text),
           'ShortWord=2, MinWords=5, MaxWords=20, HighlightAll=TRUE') AS snippet
  FROM base b
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = b.vcon_id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
  ORDER BY rank DESC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Optimized Hybrid Search Function
-- ============================================================================
-- Uses materialized tsvector columns for keyword portion

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
) AS $$
BEGIN
  RETURN QUERY
  WITH sem AS (
    -- Semantic search (unchanged, already optimized with HNSW index)
    SELECT e.vcon_id, MAX((1 - (e.embedding <=> query_embedding))::double precision) AS semantic_score
    FROM vcon_embeddings e
    WHERE query_embedding IS NOT NULL
    GROUP BY e.vcon_id
  ),
  kw AS (
    -- Keyword search using materialized tsvectors (optimized)
    -- Search each table separately and combine scores
    SELECT vcon_id, MAX(keyword_score) AS keyword_score
    FROM (
      -- Subject matches
      SELECT v.id AS vcon_id,
             ts_rank_cd(v.subject_tsvector, plainto_tsquery('english', keyword_query), 32)::double precision AS keyword_score
      FROM vcons v
      WHERE keyword_query IS NOT NULL
        AND v.subject_tsvector IS NOT NULL
        AND v.subject_tsvector @@ plainto_tsquery('english', keyword_query)
      
      UNION ALL
      
      -- Party matches
      SELECT p.vcon_id,
             ts_rank_cd(p.party_tsvector, plainto_tsquery('simple', keyword_query), 32)::double precision * 0.8 AS keyword_score
      FROM parties p
      WHERE keyword_query IS NOT NULL
        AND p.party_tsvector IS NOT NULL
        AND p.party_tsvector @@ plainto_tsquery('simple', keyword_query)
      
      UNION ALL
      
      -- Dialog matches
      SELECT d.vcon_id,
             ts_rank_cd(d.body_tsvector, plainto_tsquery('english', keyword_query), 32)::double precision * 0.6 AS keyword_score
      FROM dialog d
      WHERE keyword_query IS NOT NULL
        AND d.body_tsvector IS NOT NULL
        AND d.body_tsvector @@ plainto_tsquery('english', keyword_query)
      
      UNION ALL
      
      -- Analysis matches
      SELECT a.vcon_id,
             ts_rank_cd(a.body_tsvector, plainto_tsquery('english', keyword_query), 32)::double precision * 0.8 AS keyword_score
      FROM analysis a
      WHERE keyword_query IS NOT NULL
        AND a.body_tsvector IS NOT NULL
        AND a.body_tsvector @@ plainto_tsquery('english', keyword_query)
    ) keyword_matches
    WHERE keyword_query IS NOT NULL
    GROUP BY vcon_id
  )
  SELECT v.id AS vcon_id,
         (coalesce(s.semantic_score, 0) * semantic_weight
         + coalesce(k.keyword_score, 0) * (1 - semantic_weight))::double precision AS combined_score,
         coalesce(s.semantic_score, 0)::double precision AS semantic_score,
         coalesce(k.keyword_score, 0)::double precision AS keyword_score
  FROM vcons v
  LEFT JOIN sem s ON s.vcon_id = v.id
  LEFT JOIN kw  k ON k.vcon_id = v.id
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
    AND ((query_embedding IS NOT NULL AND s.semantic_score IS NOT NULL)
      OR (keyword_query   IS NOT NULL AND k.keyword_score IS NOT NULL))
  ORDER BY combined_score DESC
  LIMIT limit_results;
END;
$$ LANGUAGE plpgsql;

-- Add comments explaining the optimization
COMMENT ON FUNCTION search_vcons_keyword IS 
  'Optimized keyword search using materialized tsvector columns. '
  '10-100x faster than computing tsvectors on-the-fly. '
  'Requires tsvector columns to be populated (see optimize_search_indexes migration).';

COMMENT ON FUNCTION search_vcons_hybrid IS 
  'Optimized hybrid search using materialized tsvector columns for keyword portion. '
  'Semantic portion uses HNSW index. '
  'Requires tsvector columns to be populated (see optimize_search_indexes migration).';

