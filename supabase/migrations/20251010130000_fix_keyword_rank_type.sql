-- Fix type mismatch in search_vcons_keyword: cast rank to double precision

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
         ts_rank_cd(b.tsv, plainto_tsquery('english', query_text), 32)::double precision AS rank,
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


