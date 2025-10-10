-- Switch embeddings to 384 dimensions for Sentence-Transformers all-MiniLM-L6-v2

-- Adjust embedding column dimension
ALTER TABLE vcon_embeddings ALTER COLUMN embedding TYPE vector(384);

-- Update defaults to reflect ST model
ALTER TABLE vcon_embeddings ALTER COLUMN embedding_model SET DEFAULT 'sentence-transformers/all-MiniLM-L6-v2';
ALTER TABLE vcon_embeddings ALTER COLUMN embedding_dimension SET DEFAULT 384;

-- Recreate HNSW index for correct ops (drop if exists and recreate)
DROP INDEX IF EXISTS vcon_embeddings_hnsw_cosine;
CREATE INDEX vcon_embeddings_hnsw_cosine
  ON vcon_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Update RPC signatures to vector(384)
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
) AS $$
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION search_vcons_hybrid(
  keyword_query text DEFAULT NULL,
  query_embedding vector(384) DEFAULT NULL,
  tag_filter jsonb DEFAULT '{}'::jsonb,
  semantic_weight float DEFAULT 0.6,
  limit_results int DEFAULT 50
)
RETURNS TABLE (
  vcon_id uuid,
  combined_score float,
  semantic_score float,
  keyword_score float
) AS $$
BEGIN
  RETURN QUERY
  WITH sem AS (
    SELECT e.vcon_id, MAX(1 - (e.embedding <=> query_embedding)) AS semantic_score
    FROM vcon_embeddings e
    WHERE query_embedding IS NOT NULL
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
    ) x
    WHERE keyword_query IS NOT NULL
      AND x.tsv @@ plainto_tsquery('english', keyword_query)
    GROUP BY x.vcon_id
  )
  SELECT v.id AS vcon_id,
         coalesce(s.semantic_score, 0) * semantic_weight
         + coalesce(k.keyword_score, 0) * (1 - semantic_weight) AS combined_score,
         coalesce(s.semantic_score, 0) AS semantic_score,
         coalesce(k.keyword_score, 0) AS keyword_score
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


