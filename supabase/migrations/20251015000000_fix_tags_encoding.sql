-- Migration to fix tags attachment encoding
-- Tags attachments should have encoding='json' since the body contains JSON.stringify'd arrays

-- Update any tags attachments that don't have encoding='json'
UPDATE attachments
SET encoding = 'json'
WHERE type = 'tags'
  AND (encoding IS NULL OR encoding != 'json');

-- Verify the update
DO $$
DECLARE
  tags_count INTEGER;
  fixed_count INTEGER;
BEGIN
  -- Count total tags attachments
  SELECT COUNT(*) INTO tags_count
  FROM attachments
  WHERE type = 'tags';
  
  -- Count tags with correct encoding
  SELECT COUNT(*) INTO fixed_count
  FROM attachments
  WHERE type = 'tags' AND encoding = 'json';
  
  -- Log the results
  RAISE NOTICE 'Total tags attachments: %', tags_count;
  RAISE NOTICE 'Tags with encoding=json: %', fixed_count;
  
  IF tags_count > 0 AND fixed_count = tags_count THEN
    RAISE NOTICE '✓ All tags attachments have correct encoding';
  ELSIF tags_count > 0 THEN
    RAISE WARNING 'Some tags attachments may still have incorrect encoding';
  ELSE
    RAISE NOTICE 'No tags attachments found';
  END IF;
END $$;

