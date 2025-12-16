-- Fix search RPC functions on remote:
-- - search_vcons_keyword: eliminate return type mismatches by explicit casting and stable tenant filtering
-- - search_vcons_hybrid: eliminate ambiguous column references and align to vector(384)

-- Drop any existing versions (including older signatures/return shapes).
DROP FUNCTION IF EXISTS search_vcons_keyword CASCADE;
DROP FUNCTION IF EXISTS search_vcons_hybrid CASCADE;

-- ============================================================================
-- Keyword search (FTS) with tenant filtering and optional tags filter.
-- Uses materialized tsvector columns if present.
-- ============================================================================
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
    -- Subject
    SELECT v.id::uuid AS vcon_id,
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

    -- Parties
    SELECT p.vcon_id::uuid AS vcon_id,
           'party'::text AS doc_type,
           p.party_index::int AS ref_index,
           concat_ws(' ', p.name, p.mailto, p.tel)::text AS content,
           p.party_tsvector AS tsv
    FROM parties p
    WHERE (current_tenant IS NULL OR p.tenant_id IS NULL OR p.tenant_id = current_tenant)
      AND p.party_tsvector IS NOT NULL
      AND p.party_tsvector @@ plainto_tsquery('simple', query_text)

    UNION ALL

    -- Dialog
    SELECT d.vcon_id::uuid AS vcon_id,
           'dialog'::text AS doc_type,
           d.dialog_index::int AS ref_index,
           d.body::text AS content,
           d.body_tsvector AS tsv
    FROM dialog d
    WHERE (current_tenant IS NULL OR d.tenant_id IS NULL OR d.tenant_id = current_tenant)
      AND d.body_tsvector IS NOT NULL
      AND d.body_tsvector @@ plainto_tsquery('english', query_text)

    UNION ALL

    -- Analysis
    SELECT a.vcon_id::uuid AS vcon_id,
           'analysis'::text AS doc_type,
           a.analysis_index::int AS ref_index,
           a.body::text AS content,
           a.body_tsvector AS tsv
    FROM analysis a
    WHERE (current_tenant IS NULL OR a.tenant_id IS NULL OR a.tenant_id = current_tenant)
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
           'ShortWord=2, MinWords=5, MaxWords=20, HighlightAll=TRUE'
         )::text AS snippet
  FROM base b
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = b.vcon_id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
  ORDER BY rank DESC
  LIMIT max_results;
END;
$$;

-- ============================================================================
-- Hybrid search: keyword + semantic, aligned to vector(384)
-- ============================================================================
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
    SELECT e.vcon_id::uuid AS vcon_id,
           MAX((1 - (e.embedding <=> query_embedding))::double precision) AS semantic_score
    FROM vcon_embeddings e
    WHERE query_embedding IS NOT NULL
      AND (current_tenant IS NULL OR e.tenant_id IS NULL OR e.tenant_id = current_tenant)
    GROUP BY e.vcon_id
  ),
  kw AS (
    SELECT km.vcon_id::uuid AS vcon_id,
           MAX(km.keyword_score)::double precision AS keyword_score
    FROM (
      SELECT v.id::uuid AS vcon_id,
             ts_rank_cd(v.subject_tsvector, plainto_tsquery('english', keyword_query), 32)::double precision AS keyword_score
      FROM vcons v
      WHERE keyword_query IS NOT NULL
        AND (current_tenant IS NULL OR v.tenant_id IS NULL OR v.tenant_id = current_tenant)
        AND v.subject_tsvector IS NOT NULL
        AND v.subject_tsvector @@ plainto_tsquery('english', keyword_query)

      UNION ALL

      SELECT p.vcon_id::uuid AS vcon_id,
             ts_rank_cd(p.party_tsvector, plainto_tsquery('simple', keyword_query), 32)::double precision * 0.8 AS keyword_score
      FROM parties p
      WHERE keyword_query IS NOT NULL
        AND (current_tenant IS NULL OR p.tenant_id IS NULL OR p.tenant_id = current_tenant)
        AND p.party_tsvector IS NOT NULL
        AND p.party_tsvector @@ plainto_tsquery('simple', keyword_query)

      UNION ALL

      SELECT d.vcon_id::uuid AS vcon_id,
             ts_rank_cd(d.body_tsvector, plainto_tsquery('english', keyword_query), 32)::double precision * 0.6 AS keyword_score
      FROM dialog d
      WHERE keyword_query IS NOT NULL
        AND (current_tenant IS NULL OR d.tenant_id IS NULL OR d.tenant_id = current_tenant)
        AND d.body_tsvector IS NOT NULL
        AND d.body_tsvector @@ plainto_tsquery('english', keyword_query)

      UNION ALL

      SELECT a.vcon_id::uuid AS vcon_id,
             ts_rank_cd(a.body_tsvector, plainto_tsquery('english', keyword_query), 32)::double precision * 0.8 AS keyword_score
      FROM analysis a
      WHERE keyword_query IS NOT NULL
        AND (current_tenant IS NULL OR a.tenant_id IS NULL OR a.tenant_id = current_tenant)
        AND a.body_tsvector IS NOT NULL
        AND a.body_tsvector @@ plainto_tsquery('english', keyword_query)
    ) km
    WHERE keyword_query IS NOT NULL
    GROUP BY km.vcon_id
  )
  SELECT v.id::uuid AS vcon_id,
         (coalesce(s.semantic_score, 0) * semantic_weight
          + coalesce(k.keyword_score, 0) * (1 - semantic_weight))::double precision AS combined_score,
         coalesce(s.semantic_score, 0)::double precision AS semantic_score,
         coalesce(k.keyword_score, 0)::double precision AS keyword_score
  FROM vcons v
  LEFT JOIN sem s ON s.vcon_id = v.id
  LEFT JOIN kw  k ON k.vcon_id = v.id
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
    AND (
      (query_embedding IS NOT NULL AND s.vcon_id IS NOT NULL)
      OR (keyword_query IS NOT NULL AND k.vcon_id IS NOT NULL)
    )
  ORDER BY combined_score DESC
  LIMIT limit_results;
END;
$$;


