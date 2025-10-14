-- OPTIONAL: Cleanup Non-Text Analysis Embeddings
-- This script removes embeddings for analysis elements with encoding='base64url' or 'json'
-- These embeddings are not useful for semantic search as they represent binary or structured data

-- ⚠️ WARNING: This will permanently delete embeddings. Run the check query first!
-- ⚠️ Only run this if you're confident you want to remove these embeddings.

-- STEP 1: Review what will be deleted (RUN THIS FIRST)
SELECT 
  e.id,
  e.vcon_id,
  e.content_reference,
  a.type as analysis_type,
  a.encoding,
  a.vendor,
  LENGTH(e.content_text) as text_length,
  SUBSTRING(e.content_text, 1, 100) as content_preview
FROM vcon_embeddings e
JOIN analysis a 
  ON e.vcon_id = a.vcon_id 
  AND e.content_reference = a.analysis_index::text
WHERE e.content_type = 'analysis' 
  AND a.encoding IN ('base64url', 'json')
ORDER BY e.vcon_id, e.content_reference
LIMIT 50;

-- STEP 2: Get total count
SELECT COUNT(*) as total_to_delete
FROM vcon_embeddings e
JOIN analysis a 
  ON e.vcon_id = a.vcon_id 
  AND e.content_reference = a.analysis_index::text
WHERE e.content_type = 'analysis' 
  AND a.encoding IN ('base64url', 'json');

-- STEP 3: Actually delete (UNCOMMENT TO RUN)
-- DELETE FROM vcon_embeddings e
-- USING analysis a
-- WHERE e.vcon_id = a.vcon_id 
--   AND e.content_reference = a.analysis_index::text
--   AND e.content_type = 'analysis'
--   AND a.encoding IN ('base64url', 'json');

-- STEP 4: Verify deletion (RUN AFTER STEP 3)
-- SELECT COUNT(*) as remaining_non_text_embeddings
-- FROM vcon_embeddings e
-- JOIN analysis a 
--   ON e.vcon_id = a.vcon_id 
--   AND e.content_reference = a.analysis_index::text
-- WHERE e.content_type = 'analysis' 
--   AND a.encoding IN ('base64url', 'json');

