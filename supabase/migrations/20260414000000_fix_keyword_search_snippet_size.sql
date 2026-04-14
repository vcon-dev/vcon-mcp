-- Fix: search_vcons_keyword snippets were returning entire document bodies
-- Root cause: HighlightAll=TRUE in ts_headline causes the full content to be returned
-- even when MaxWords=20 is set. For transcripts stored as JSON blobs, this means
-- 50 results × up to 100KB each = well over the 1MB MCP tool result limit.
-- Fix: remove HighlightAll=TRUE and add MaxFragments=3 to return small context windows.

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
           'MaxFragments=3, MaxWords=25, MinWords=5, FragmentDelimiter= '' ... '''
         )::text AS snippet
  FROM base b
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = b.vcon_id
  WHERE (tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter))
  ORDER BY rank DESC
  LIMIT max_results;
END;
$$;

GRANT EXECUTE ON FUNCTION search_vcons_keyword TO authenticated;
GRANT EXECUTE ON FUNCTION search_vcons_keyword TO service_role;
GRANT EXECUTE ON FUNCTION search_vcons_keyword TO anon;
