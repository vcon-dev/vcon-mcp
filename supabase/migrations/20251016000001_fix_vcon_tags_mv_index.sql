-- Fix materialized view to support concurrent refresh
-- Add unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY

-- Create unique index on vcon_id for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_vcon_tags_mv_vcon_id_unique 
ON vcon_tags_mv (vcon_id);

-- Update refresh function to use concurrent refresh now that we have the index
CREATE OR REPLACE FUNCTION refresh_vcon_tags_mv()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY vcon_tags_mv;
END;
$$ LANGUAGE plpgsql;

-- Refresh the view now that we can do it concurrently
SELECT refresh_vcon_tags_mv();

