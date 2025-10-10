-- Search & Embeddings Setup for vCon
-- - Trigram indexes for keyword search
-- - pgvector table and HNSW index for semantic search
-- - RPCs: search_vcons_keyword, search_vcons_semantic, search_vcons_hybrid

-- Ensure required extensions
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- Trigram indexes (for partial/typo-tolerant keyword search)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_parties_name_trgm  ON parties  USING gin (name   gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_parties_mail_trgm  ON parties  USING gin (mailto gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_parties_tel_trgm   ON parties  USING gin (tel    gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_dialog_body_trgm   ON dialog   USING gin (body   gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_analysis_body_trgm ON analysis USING gin (body   gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- Embeddings storage (semantic search)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vcon_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,              -- 'subject' | 'dialog' | 'analysis'
    content_reference TEXT,                  -- e.g., dialog_index or analysis_index
    content_text TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    embedding_dimension INTEGER NOT NULL DEFAULT 1536,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vcon_embeddings_unique UNIQUE (vcon_id, content_type, content_reference)
);

CREATE INDEX IF NOT EXISTS idx_vcon_embeddings_vcon_id ON vcon_embeddings(vcon_id);
CREATE INDEX IF NOT EXISTS idx_vcon_embeddings_type ON vcon_embeddings(content_type);

-- HNSW index for cosine similarity
CREATE INDEX IF NOT EXISTS vcon_embeddings_hnsw_cosine
  ON vcon_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- -----------------------------------------------------------------------------
-- Helper CTE snippet (for reference): derive tags from attachments of type 'tags'
-- We inline this logic inside each RPC to avoid dependency on additional views.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- RPC: Keyword Search (FTS + trigram) with tags-from-attachments filtering
-- -----------------------------------------------------------------------------
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
  snippet text
) AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT v.id AS vcon_id, 'subject'::text AS doc_type, NULL::int AS ref_index,
           v.subject AS content,
           setweight(to_tsvector('english', coalesce(v.subject,'')), 'A') AS tsv
    FROM vcons v
    WHERE (start_date IS NULL OR v.created_at >= start_date)
      AND (end_date   IS NULL OR v.created_at <= end_date)

    UNION ALL
    SELECT p.vcon_id, 'party', p.party_index,
           concat_ws(' ', p.name, p.mailto, p.tel),
           setweight(to_tsvector('simple',
             coalesce(p.name,'')||' '||coalesce(p.mailto,'')||' '||coalesce(p.tel,'')), 'B')
    FROM parties p

    UNION ALL
    SELECT d.vcon_id, 'dialog', d.dialog_index, d.body,
           setweight(to_tsvector('english', coalesce(d.body,'')), 'C')
    FROM dialog d

    UNION ALL
    SELECT a.vcon_id, 'analysis', a.analysis_index, a.body,
           setweight(to_tsvector('english', coalesce(a.body,'')), 'B')
    FROM analysis a
  ),
  tags_kv AS (
    SELECT a.vcon_id,
           split_part(elem, ':', 1) AS key,
           split_part(elem, ':', 2) AS value
    FROM attachments a
    CROSS JOIN LATERAL jsonb_array_elements_text(a.body::jsonb) AS elem
    WHERE a.type = 'tags' AND a.encoding = 'json'
  ),
  tags_agg AS (
    SELECT vcon_id, jsonb_object_agg(key, value) AS tags
    FROM tags_kv GROUP BY vcon_id
  )
  SELECT b.vcon_id, b.doc_type, b.ref_index,
         ts_rank_cd(b.tsv, plainto_tsquery('english', query_text), 32) AS rank,
         ts_headline('english', b.content, plainto_tsquery('english', query_text),
           'ShortWord=2, MinWords=5, MaxWords=20, HighlightAll=TRUE') AS snippet
  FROM base b
  LEFT JOIN tags_agg ta ON ta.vcon_id = b.vcon_id
  WHERE b.tsv @@ plainto_tsquery('english', query_text)
    AND (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
  ORDER BY rank DESC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- RPC: Semantic Search (pgvector cosine) with tags-from-attachments filtering
-- -----------------------------------------------------------------------------
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
  similarity float
) AS $$
BEGIN
  RETURN QUERY
  WITH tags_kv AS (
    SELECT a.vcon_id,
           split_part(elem, ':', 1) AS key,
           split_part(elem, ':', 2) AS value
    FROM attachments a
    CROSS JOIN LATERAL jsonb_array_elements_text(a.body::jsonb) AS elem
    WHERE a.type = 'tags' AND a.encoding = 'json'
  ),
  tags_agg AS (
    SELECT vcon_id, jsonb_object_agg(key, value) AS tags
    FROM tags_kv GROUP BY vcon_id
  )
  SELECT e.vcon_id, e.content_type, e.content_reference, e.content_text,
         1 - (e.embedding <=> query_embedding) AS similarity
  FROM vcon_embeddings e
  LEFT JOIN tags_agg ta ON ta.vcon_id = e.vcon_id
  WHERE 1 - (e.embedding <=> query_embedding) > match_threshold
    AND (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- RPC: Hybrid Search (weighted fusion of semantic and keyword)
-- -----------------------------------------------------------------------------
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
  keyword_score float
) AS $$
BEGIN
  RETURN QUERY
  WITH tags_kv AS (
    SELECT a.vcon_id,
           split_part(elem, ':', 1) AS key,
           split_part(elem, ':', 2) AS value
    FROM attachments a
    CROSS JOIN LATERAL jsonb_array_elements_text(a.body::jsonb) AS elem
    WHERE a.type = 'tags' AND a.encoding = 'json'
  ),
  tags_agg AS (
    SELECT vcon_id, jsonb_object_agg(key, value) AS tags
    FROM tags_kv GROUP BY vcon_id
  ),
  sem AS (
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
  LEFT JOIN tags_agg ta ON ta.vcon_id = v.id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
    AND ((query_embedding IS NOT NULL AND s.semantic_score IS NOT NULL)
      OR (keyword_query   IS NOT NULL AND k.keyword_score IS NOT NULL))
  ORDER BY combined_score DESC
  LIMIT limit_results;
END;
$$ LANGUAGE plpgsql;


