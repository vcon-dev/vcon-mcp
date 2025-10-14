-- Check Embedding Coverage by Analysis Encoding Type
-- This query shows which analysis encodings have embeddings

-- Overall analysis encoding distribution
SELECT 
  COALESCE(a.encoding, 'NULL') as encoding,
  COUNT(*) as total_analysis,
  COUNT(DISTINCT a.vcon_id) as unique_vcons
FROM analysis a
WHERE a.body IS NOT NULL AND a.body <> ''
GROUP BY a.encoding
ORDER BY total_analysis DESC;

-- Embedding coverage by encoding type
SELECT 
  COALESCE(a.encoding, 'NULL') as encoding,
  COUNT(DISTINCT a.id) as total_analysis,
  COUNT(DISTINCT e.id) as embedded_count,
  COUNT(DISTINCT a.id) - COUNT(DISTINCT e.id) as missing_embeddings,
  ROUND(100.0 * COUNT(DISTINCT e.id) / NULLIF(COUNT(DISTINCT a.id), 0), 2) as coverage_percent
FROM analysis a
LEFT JOIN vcon_embeddings e 
  ON e.vcon_id = a.vcon_id 
  AND e.content_type = 'analysis' 
  AND e.content_reference = a.analysis_index::text
WHERE a.body IS NOT NULL AND a.body <> ''
GROUP BY a.encoding
ORDER BY total_analysis DESC;

-- Count embeddings that would be excluded under new strategy
SELECT 
  COUNT(*) as embeddings_for_excluded_encodings
FROM vcon_embeddings e
JOIN analysis a 
  ON e.vcon_id = a.vcon_id 
  AND e.content_reference = a.analysis_index::text
WHERE e.content_type = 'analysis' 
  AND a.encoding NOT IN ('none')
  AND a.encoding IS NOT NULL;

-- Sample of analysis types and encodings
SELECT 
  a.type,
  COALESCE(a.encoding, 'NULL') as encoding,
  COUNT(*) as count
FROM analysis a
WHERE a.body IS NOT NULL AND a.body <> ''
GROUP BY a.type, a.encoding
ORDER BY count DESC
LIMIT 20;

