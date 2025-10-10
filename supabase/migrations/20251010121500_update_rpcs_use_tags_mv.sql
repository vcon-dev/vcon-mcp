-- Redefine RPCs to join the materialized view vcon_tags_mv for tag filtering

-- Keyword RPC using MV
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
  )
  SELECT b.vcon_id, b.doc_type, b.ref_index,
         ts_rank_cd(b.tsv, plainto_tsquery('english', query_text), 32) AS rank,
         ts_headline('english', b.content, plainto_tsquery('english', query_text),
           'ShortWord=2, MinWords=5, MaxWords=20, HighlightAll=TRUE') AS snippet
  FROM base b
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = b.vcon_id
  WHERE b.tsv @@ plainto_tsquery('english', query_text)
    AND (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
  ORDER BY rank DESC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Semantic RPC using MV
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

-- Hybrid RPC using MV
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


