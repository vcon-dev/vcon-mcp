# Embedding Strategy Upgrade: Analysis Elements with encoding='none'

## Overview

This document describes the upgrade to the vCon embedding strategy to explicitly include and prioritize all analysis elements with `encoding='none'`.

## Changes Made

### 1. Updated Embedding Scripts

Two key files were modified to filter and prioritize analysis elements based on their encoding:

#### `/scripts/generate-embeddings-v2.ts`
- Added filter: `AND (a.encoding = 'none' OR a.encoding IS NULL)`
- Added prioritization: Orders results to process `encoding='none'` first
- This ensures text-based analysis is embedded before other types

#### `/supabase/functions/embed-vcons/index.ts`
- Applied same filtering and prioritization logic
- Maintains consistency across local and cloud embedding generation
- Ensures backfill operations prioritize the right content

### 2. SQL Query Enhancement

**Before:**
```sql
SELECT a.vcon_id,
       'analysis'::text as content_type,
       a.analysis_index::text as content_reference,
       a.body as content_text
FROM analysis a
LEFT JOIN vcon_embeddings e
  ON e.vcon_id = a.vcon_id 
  AND e.content_type = 'analysis' 
  AND e.content_reference = a.analysis_index::text
WHERE a.body IS NOT NULL AND a.body <> ''
  AND e.id IS NULL
LIMIT :limit
```

**After:**
```sql
SELECT a.vcon_id,
       'analysis'::text as content_type,
       a.analysis_index::text as content_reference,
       a.body as content_text
FROM analysis a
LEFT JOIN vcon_embeddings e
  ON e.vcon_id = a.vcon_id 
  AND e.content_type = 'analysis' 
  AND e.content_reference = a.analysis_index::text
WHERE a.body IS NOT NULL AND a.body <> ''
  AND (a.encoding = 'none' OR a.encoding IS NULL)
  AND e.id IS NULL
ORDER BY 
  CASE WHEN a.encoding = 'none' THEN 0 ELSE 1 END,
  a.vcon_id
LIMIT :limit
```

## Rationale

### Why Filter by encoding='none'?

According to the IETF vCon specification (draft-ietf-vcon-vcon-core-00), the `encoding` field can have three values:
- `base64url`: Binary or encoded data
- `json`: Structured JSON data
- `none`: Plain text content

Analysis elements with `encoding='none'` contain human-readable text such as:
- Summaries and abstracts
- Sentiment analysis results (as text)
- Transcriptions
- Translation output
- Natural language insights

These text-based analysis results are ideal candidates for semantic search because:
1. They contain meaningful natural language
2. They represent higher-level insights about the conversation
3. They are often more valuable for search than raw dialog
4. They provide curated, processed information

### Why Exclude Other Encodings?

- `encoding='base64url'`: Contains binary data or encoded content that is not suitable for text embedding
- `encoding='json'`: Contains structured data that would produce poor quality embeddings when treated as raw text

### Prioritization Strategy

The ORDER BY clause ensures that:
1. Analysis with `encoding='none'` is processed first (priority 0)
2. Analysis with `encoding IS NULL` is processed second (priority 1)
3. Within each priority group, results are ordered by `vcon_id` for consistency

This prioritization ensures that the most valuable content for semantic search is embedded first, which is particularly important when:
- Running batch operations with rate limits
- Processing large datasets incrementally
- Managing embedding costs

## Impact

### Positive Impacts

1. **Better Search Quality**: Embeddings now focus on text-based analysis that provides better semantic search results
2. **Cost Efficiency**: Excludes non-textual content that would waste embedding API calls
3. **Faster Processing**: Prioritizes the most valuable content for earlier availability
4. **Clearer Intent**: Code now explicitly documents what should and should not be embedded

### Migration Notes

- Existing embeddings are not affected (they remain valid)
- Only new embedding generation will use the updated strategy
- Analysis with `encoding='base64url'` or `encoding='json'` will be skipped
- No database schema changes required
- Backward compatible with existing code

### Do You Need to Remove Existing Embeddings?

**Short answer**: No, you don't have to.

**Detailed answer**: 

The upgrade changes what NEW embeddings are created, but doesn't automatically remove existing embeddings for analysis elements with `encoding='base64url'` or `encoding='json'`. Here are your options:

#### Option 1: Keep Them (Recommended for most cases)
**Pros:**
- No data loss
- Zero disruption to existing searches
- No migration required
- They become "frozen" data that won't be regenerated

**Cons:**
- May slightly pollute search results with low-quality matches
- Takes up database space (though typically minimal)

**When to choose:** If you have a small number of these embeddings, or if you're not seeing quality issues in your semantic search results.

#### Option 2: Remove Them (Optional cleanup)
**Pros:**
- Cleaner semantic search results
- Frees up database space
- Ensures only text-based content is searchable

**Cons:**
- Requires running a cleanup script
- Permanent deletion of data

**When to choose:** If you have many embeddings for non-text analysis, or if you notice search quality issues from binary/JSON content matches.

### How to Check and Clean Up

1. **Check what exists:**
```bash
# Run the coverage check query
psql $DATABASE_URL -f scripts/check-embedding-coverage.sql
```

2. **Review and optionally clean:**
```bash
# Review what would be deleted (safe, read-only)
psql $DATABASE_URL -f scripts/cleanup-non-text-embeddings.sql

# If you decide to delete, uncomment STEP 3 in the file and run again
```

The cleanup script has safety checks and previews what will be deleted before you commit to the change.

## Usage

### Generate Embeddings Locally

```bash
# Process up to 100 text units per batch with 2 second delay
npx tsx scripts/generate-embeddings-v2.ts 100 2
```

### Backfill via Edge Function

```bash
# Process 500 text units per batch with 2 second delay
./scripts/backfill-embeddings.sh 500 2
```

### Verify Analysis Encoding Distribution

Check what analysis records exist in your database:

```sql
SELECT 
  encoding,
  COUNT(*) as count,
  COUNT(DISTINCT vcon_id) as unique_vcons
FROM analysis
GROUP BY encoding
ORDER BY count DESC;
```

Check embedding coverage:

```sql
SELECT 
  a.encoding,
  COUNT(*) as total_analysis,
  COUNT(e.id) as embedded_count,
  COUNT(*) - COUNT(e.id) as missing_embeddings
FROM analysis a
LEFT JOIN vcon_embeddings e 
  ON e.vcon_id = a.vcon_id 
  AND e.content_type = 'analysis' 
  AND e.content_reference = a.analysis_index::text
WHERE a.body IS NOT NULL AND a.body <> ''
GROUP BY a.encoding
ORDER BY total_analysis DESC;
```

## Testing

To verify the upgrade is working correctly:

1. **Check that encoding='none' is being processed:**
```sql
SELECT COUNT(*) 
FROM vcon_embeddings e
JOIN analysis a 
  ON e.vcon_id = a.vcon_id 
  AND e.content_reference = a.analysis_index::text
WHERE e.content_type = 'analysis' 
  AND a.encoding = 'none';
```

2. **Verify other encodings are excluded:**
```sql
SELECT COUNT(*) 
FROM vcon_embeddings e
JOIN analysis a 
  ON e.vcon_id = a.vcon_id 
  AND e.content_reference = a.analysis_index::text
WHERE e.content_type = 'analysis' 
  AND a.encoding IN ('base64url', 'json');
```

Expected result: The second query should return 0.

## Related Documentation

- [INGEST_AND_EMBEDDINGS.md](./INGEST_AND_EMBEDDINGS.md) - Complete embedding guide
- [SUPABASE_SEMANTIC_SEARCH_GUIDE.md](../SUPABASE_SEMANTIC_SEARCH_GUIDE.md) - Semantic search implementation
- [vCon Specification](../background_docs/draft-ietf-vcon-vcon-core-00.txt) - Official vCon standard

## Version History

- **v1.0** (October 2025): Initial implementation focusing on encoding='none' analysis elements

