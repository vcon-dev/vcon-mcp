-- Diagnose and fix vcon_tags_mv - it was created with 0 rows
-- This migration:
-- 1. Diagnoses what data exists in the attachments table
-- 2. Fixes any encoding issues with tags attachments
-- 3. Recreates the materialized view with a more lenient WHERE clause

-- First, diagnose the current state of tags data
DO $$
DECLARE
  total_attachments INTEGER;
  tags_with_type INTEGER;
  tags_with_encoding_json INTEGER;
  tags_with_encoding_null INTEGER;
  tags_with_valid_body INTEGER;
  sample_body TEXT;
BEGIN
  -- Count total attachments
  SELECT COUNT(*) INTO total_attachments FROM attachments;
  RAISE NOTICE 'Total attachments: %', total_attachments;

  -- Count attachments where type = 'tags'
  SELECT COUNT(*) INTO tags_with_type FROM attachments WHERE type = 'tags';
  RAISE NOTICE 'Attachments with type=tags: %', tags_with_type;

  -- Count tags with encoding = 'json'
  SELECT COUNT(*) INTO tags_with_encoding_json
  FROM attachments WHERE type = 'tags' AND encoding = 'json';
  RAISE NOTICE 'Tags with encoding=json: %', tags_with_encoding_json;

  -- Count tags with NULL encoding
  SELECT COUNT(*) INTO tags_with_encoding_null
  FROM attachments WHERE type = 'tags' AND encoding IS NULL;
  RAISE NOTICE 'Tags with encoding=NULL: %', tags_with_encoding_null;

  -- Count tags with valid JSON array body
  SELECT COUNT(*) INTO tags_with_valid_body
  FROM attachments
  WHERE type = 'tags'
    AND body IS NOT NULL
    AND body != ''
    AND body ~ '^\[.*\]$';
  RAISE NOTICE 'Tags with valid array body: %', tags_with_valid_body;

  -- Get a sample body to inspect
  SELECT body INTO sample_body
  FROM attachments
  WHERE type = 'tags' AND body IS NOT NULL AND body != ''
  LIMIT 1;
  RAISE NOTICE 'Sample tags body: %', COALESCE(LEFT(sample_body, 200), '(none found)');
END $$;

-- Fix any tags attachments that don't have encoding='json'
-- The application code stores tags with encoding='json', but some may have been
-- inserted incorrectly
UPDATE attachments
SET encoding = 'json'
WHERE type = 'tags'
  AND (encoding IS NULL OR encoding != 'json');

-- Drop the existing materialized view and its indexes
DROP MATERIALIZED VIEW IF EXISTS vcon_tags_mv CASCADE;

-- Recreate with more lenient WHERE clause
-- - Accept tags with any encoding (or NULL encoding)
-- - Validate body looks like a JSON array before trying to parse
CREATE MATERIALIZED VIEW vcon_tags_mv AS
SELECT ta.vcon_id, jsonb_object_agg(ta.key, ta.value) AS tags
FROM (
  SELECT a.vcon_id,
         split_part(elem, ':', 1) AS key,
         split_part(elem, ':', 2) AS value
  FROM attachments a
  CROSS JOIN LATERAL jsonb_array_elements_text(a.body::jsonb) AS elem
  WHERE a.type = 'tags'
    AND a.body IS NOT NULL
    AND a.body != ''
    AND a.body ~ '^\s*\[.*\]\s*$'  -- Ensure body looks like a JSON array
) ta
WHERE ta.key IS NOT NULL AND ta.key != ''
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

-- Log the final result
DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM vcon_tags_mv;
  RAISE NOTICE 'vcon_tags_mv recreated with % rows', row_count;

  IF row_count = 0 THEN
    RAISE WARNING 'vcon_tags_mv still has 0 rows - check if there are any tags attachments in the database';
  END IF;
END $$;
