-- Add missing search_vcons_by_tags RPC function
-- This function efficiently searches vCons by tag key-value pairs using the materialized view

CREATE OR REPLACE FUNCTION search_vcons_by_tags(
  tag_filter jsonb DEFAULT '{}'::jsonb,
  max_results int DEFAULT 50
)
RETURNS TABLE (
  vcon_id uuid
) AS $$
BEGIN
  RETURN QUERY
  SELECT v.uuid AS vcon_id
  FROM vcons v
  LEFT JOIN vcon_tags_mv ta ON ta.vcon_id = v.id
  WHERE tag_filter = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filter)
  ORDER BY v.created_at DESC
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION search_vcons_by_tags(jsonb, int) TO authenticated;
GRANT EXECUTE ON FUNCTION search_vcons_by_tags(jsonb, int) TO anon;

-- Note: Materialized view refresh is handled in the next migration
-- (20251016000001_fix_vcon_tags_mv_index.sql) which adds the required unique index

