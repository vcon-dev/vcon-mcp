-- Optional materialized view to accelerate tag filtering from attachments

CREATE MATERIALIZED VIEW IF NOT EXISTS vcon_tags_mv AS
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

-- Index for fast tags containment queries
CREATE INDEX IF NOT EXISTS idx_vcon_tags_mv_gin ON vcon_tags_mv USING GIN (tags);

-- Helper to refresh the MV
CREATE OR REPLACE FUNCTION refresh_vcon_tags_mv()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY vcon_tags_mv;
END;
$$ LANGUAGE plpgsql;


