-- Fix vcon_tags_mv to properly cast TEXT body to JSONB
-- The previous migration (20251201120000) incorrectly removed the ::jsonb cast
-- The body column is TEXT type containing JSON strings like '["key:value"]'
-- We must cast it to jsonb before using jsonb_array_elements_text()

-- Drop the existing materialized view and its indexes
DROP MATERIALIZED VIEW IF EXISTS vcon_tags_mv CASCADE;

-- Recreate with correct TEXT to JSONB cast
CREATE MATERIALIZED VIEW vcon_tags_mv AS
SELECT ta.vcon_id, jsonb_object_agg(ta.key, ta.value) AS tags
FROM (
  SELECT a.vcon_id,
         split_part(elem, ':', 1) AS key,
         split_part(elem, ':', 2) AS value
  FROM attachments a
  CROSS JOIN LATERAL jsonb_array_elements_text(a.body::jsonb) AS elem
  WHERE a.type = 'tags' AND a.encoding = 'json'
) ta
GROUP BY ta.vcon_id;

-- Recreate the GIN index for fast tag containment queries
CREATE INDEX idx_vcon_tags_mv_gin ON vcon_tags_mv USING GIN (tags);

-- Create unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_vcon_tags_mv_vcon_id ON vcon_tags_mv (vcon_id);

-- Recreate the helper function
CREATE OR REPLACE FUNCTION refresh_vcon_tags_mv()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY vcon_tags_mv;
END;
$$ LANGUAGE plpgsql;

-- Log the result
DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM vcon_tags_mv;
  RAISE NOTICE 'vcon_tags_mv recreated with % rows', row_count;
END $$;
