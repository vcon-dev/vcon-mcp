-- Fix remote DB compatibility for:
-- 1) exec_sql RPC parameter names expected by the TypeScript server (`q`, `params`)
-- 2) embedding dimension and RPC signatures expected by the server (vector(384))
--
-- This migration is intended to be safe and idempotent.

-- ============================================================================
-- 1) exec_sql wrapper with parameter names: q, params
-- ============================================================================
-- The repo previously created exec_sql(query_params jsonb, query_text text).
-- The TypeScript code calls: supabase.rpc('exec_sql', { q: '...', params: {} })
-- Supabase requires RPC argument names to match Postgres function parameter names.

CREATE OR REPLACE FUNCTION exec_sql(
  q text,
  params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delegate to the existing exec_sql(jsonb, text) overload if present.
  RETURN exec_sql(params, q);
END;
$$;

GRANT EXECUTE ON FUNCTION exec_sql(text, jsonb) TO authenticated, service_role, anon;

COMMENT ON FUNCTION exec_sql(text, jsonb) IS
  'Compatibility wrapper: exec_sql(q text, params jsonb). Delegates to exec_sql(query_params jsonb, query_text text).';

-- ============================================================================
-- 2) Ensure embeddings are 384 dimensions and RPCs accept vector(384)
-- ============================================================================

-- Drop any existing RPCs that conflict in return shape or signature.
-- Postgres does not allow changing a function's OUT parameter types via CREATE OR REPLACE.
DROP FUNCTION IF EXISTS search_vcons_semantic CASCADE;
DROP FUNCTION IF EXISTS search_vcons_hybrid CASCADE;

-- If the table exists, enforce vector(384). If it does not exist, later migrations will create it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vcon_embeddings'
  ) THEN
    -- Ensure extension exists
    CREATE EXTENSION IF NOT EXISTS vector;

    -- Enforce embedding dimension
    ALTER TABLE vcon_embeddings
      ALTER COLUMN embedding TYPE vector(384);

    -- Update defaults if columns exist
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vcon_embeddings' AND column_name = 'embedding_dimension'
    ) THEN
      ALTER TABLE vcon_embeddings ALTER COLUMN embedding_dimension SET DEFAULT 384;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vcon_embeddings' AND column_name = 'embedding_model'
    ) THEN
      ALTER TABLE vcon_embeddings ALTER COLUMN embedding_model SET DEFAULT 'sentence-transformers/all-MiniLM-L6-v2';
    END IF;

    -- Recreate HNSW index for cosine similarity (safe if not present)
    DROP INDEX IF EXISTS vcon_embeddings_hnsw_cosine;
    CREATE INDEX vcon_embeddings_hnsw_cosine
      ON vcon_embeddings USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  END IF;
END;
$$;

-- Semantic search: accept vector(384). Keep return columns compatible with server.
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
BEGIN
  RETURN QUERY
  SELECT e.vcon_id, e.content_type, e.content_reference, e.content_text,
         1 - (e.embedding <=> query_embedding) AS similarity
  FROM vcon_embeddings e
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = e.vcon_id
  WHERE 1 - (e.embedding <=> query_embedding) > match_threshold
    AND (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Hybrid search: accept vector(384). Keyword-only operation still works with NULL embedding.
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
BEGIN
  RETURN QUERY
  WITH sem AS (
    SELECT e.vcon_id, MAX((1 - (e.embedding <=> query_embedding))::double precision) AS semantic_score
    FROM vcon_embeddings e
    WHERE query_embedding IS NOT NULL
    GROUP BY e.vcon_id
  ),
  kw AS (
    SELECT vcon_id, MAX(keyword_score) AS keyword_score
    FROM (
      SELECT v.id AS vcon_id,
             ts_rank_cd(v.subject_tsvector, plainto_tsquery('english', keyword_query), 32)::double precision AS keyword_score
      FROM vcons v
      WHERE keyword_query IS NOT NULL
        AND v.subject_tsvector IS NOT NULL
        AND v.subject_tsvector @@ plainto_tsquery('english', keyword_query)
      UNION ALL
      SELECT p.vcon_id,
             ts_rank_cd(p.party_tsvector, plainto_tsquery('simple', keyword_query), 32)::double precision * 0.8 AS keyword_score
      FROM parties p
      WHERE keyword_query IS NOT NULL
        AND p.party_tsvector IS NOT NULL
        AND p.party_tsvector @@ plainto_tsquery('simple', keyword_query)
      UNION ALL
      SELECT d.vcon_id,
             ts_rank_cd(d.body_tsvector, plainto_tsquery('english', keyword_query), 32)::double precision * 0.6 AS keyword_score
      FROM dialog d
      WHERE keyword_query IS NOT NULL
        AND d.body_tsvector IS NOT NULL
        AND d.body_tsvector @@ plainto_tsquery('english', keyword_query)
      UNION ALL
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
$$;


