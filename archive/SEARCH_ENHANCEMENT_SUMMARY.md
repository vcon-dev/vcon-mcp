# Search Enhancement Summary

## Problem

The user reported that the search tool doesn't provide options to search content from analysis or attachments.

## Analysis

Upon investigation, I found two key issues:

1. **The basic `search_vcons` tool** only searches metadata (subject, party info, dates) but NOT content in dialog, analysis, or attachments
2. **Powerful search capabilities existed but were not exposed:** The database had keyword, semantic, and hybrid search functions that searched dialog and analysis, but these were not available as MCP tools

## What Was Missing

### Before:
- ✅ `search_vcons` - Basic filtering by metadata
- ❌ No keyword search tool for content
- ❌ No semantic search tool 
- ❌ No hybrid search tool
- ❌ Attachments not indexed for search

### Searched Content:
- ✅ Subject (via filter)
- ✅ Party info (via filter)
- ❌ Dialog content (not searchable)
- ❌ Analysis content (not searchable)
- ❌ Attachments (not searchable)

## Solution Implemented

### 1. Added Three New MCP Tools

#### `search_vcons_content` - Keyword Search
- Full-text search across dialog, analysis, parties, and subject
- Uses PostgreSQL trigram indexes for typo tolerance
- Returns ranked results with highlighted snippets
- Supports tag filtering and date ranges

#### `search_vcons_semantic` - Semantic Search
- AI-powered semantic search using 384-dim embeddings
- Finds conversations by meaning, not just keywords
- Searches subject, dialog, and analysis (with encoding='none')
- Requires embeddings to be generated first

#### `search_vcons_hybrid` - Hybrid Search
- Combines keyword and semantic search
- Adjustable weighting between the two approaches
- Best of both worlds: exact matches + conceptual similarity
- Falls back to keyword-only if embeddings not provided

### 2. Updated Documentation

Created comprehensive documentation:
- `/docs/SEARCH_TOOLS_GUIDE.md` - Complete guide to all search tools
- Updated `README.md` with search tool descriptions
- Added feature descriptions for advanced search

### 3. Created Test Script

`/scripts/test-search-tools.ts` - Tests all search functionality and provides status checks

### 4. Fixed Database Type Issues

Created migration `20251014000000_fix_search_types.sql` to fix type mismatches in search functions (real vs double precision)

## What Content Is Now Searchable

| Content Type | search_vcons | search_vcons_content | search_vcons_semantic | search_vcons_hybrid |
|--------------|--------------|---------------------|----------------------|---------------------|
| **Subject** | ✅ Filter | ✅ Search | ✅ Search | ✅ Search |
| **Dialog** | ❌ | ✅ Search | ✅ Search | ✅ Search |
| **Analysis (encoding=none)** | ❌ | ✅ Search | ✅ Search | ✅ Search |
| **Analysis (other encoding)** | ❌ | ✅ Search | ❌ | ✅ Search |
| **Party Info** | ✅ Filter | ✅ Search | ❌ | ✅ Search |
| **Attachments** | ❌ | ❌ | ❌ | ❌ |

### Why Attachments Are Not Searchable

Attachments are **intentionally excluded** from content search for several reasons:

1. **Binary content**: Many attachments are PDFs, images, audio files - not suitable for text search
2. **Encoding**: Attachments with `encoding='base64url'` contain encoded binary data
3. **Structured data**: Attachments with `encoding='json'` contain structured data that produces poor embeddings
4. **Performance**: Indexing all attachment content would be expensive and often pointless

#### Exception: Tags
Attachments of type `tags` with `encoding='json'` ARE used for filtering (not content search). Example:
```json
{
  "type": "tags",
  "encoding": "json",
  "body": ["department:sales", "priority:high"]
}
```

#### Future Enhancement Options
To make attachment content searchable, you could:
1. Extract text from PDFs/docs and add as analysis
2. Transcribe audio attachments and add as dialog/analysis
3. OCR images and add extracted text as analysis
4. Add attachment summaries as analysis elements

## Analysis Content and Encoding

Analysis elements are searchable, with filtering by encoding type:

### Keyword Search (`search_vcons_content`)
- ✅ All analysis elements with body content
- Includes encoding='none', 'json', and 'base64url'

### Semantic Search (`search_vcons_semantic`)
- ✅ Only analysis with `encoding='none'` or `NULL`
- ❌ Excludes `encoding='json'` and `encoding='base64url'`

**Why?** Analysis with `encoding='none'` contains plain text like summaries, transcripts, and sentiment - ideal for semantic search. JSON/base64 content produces poor quality embeddings.

## Files Changed

### Source Code
1. `/src/tools/vcon-crud.ts` - Added 3 new tool definitions
2. `/src/index.ts` - Added handlers for new search tools
3. `/src/db/queries.ts` - Updated embedding dimension comment (1536 -> 384)

### Documentation
4. `/docs/SEARCH_TOOLS_GUIDE.md` - Complete search guide (NEW)
5. `/README.md` - Updated with new search tools
6. `/SEARCH_ENHANCEMENT_SUMMARY.md` - This document (NEW)

### Tests & Scripts
7. `/scripts/test-search-tools.ts` - Test script for search functionality (NEW)

### Database
8. `/supabase/migrations/20251014000000_fix_search_types.sql` - Fixed type mismatches (NEW)

## Usage Examples

### Search for specific keywords in conversations
```json
{
  "tool": "search_vcons_content",
  "arguments": {
    "query": "billing refund payment",
    "limit": 20
  }
}
```

### Find conversations by meaning (requires embeddings)
```json
{
  "tool": "search_vcons_semantic",
  "arguments": {
    "query": "customer complaint about late delivery",
    "threshold": 0.75,
    "limit": 10
  }
}
```

### Comprehensive hybrid search
```json
{
  "tool": "search_vcons_hybrid",
  "arguments": {
    "query": "technical support issue",
    "semantic_weight": 0.6,
    "tags": {"department": "support"},
    "limit": 30
  }
}
```

## Testing

Run the test script to verify all search functionality:

```bash
npx tsx scripts/test-search-tools.ts
```

This will:
- Test keyword search
- Check embedding coverage
- Test semantic search (if embeddings exist)
- Test hybrid search
- Verify tag filtering capability

## Embeddings Required

For semantic and hybrid search to work optimally, you need to generate embeddings:

```bash
# Generate embeddings for all vCons
./scripts/backfill-embeddings.sh 500 2

# Check coverage
psql $DATABASE_URL -f scripts/check-embedding-coverage.sql
```

See `/docs/INGEST_AND_EMBEDDINGS.md` for complete embedding documentation.

## Known Limitations

1. **Automatic embedding generation**: Semantic search currently requires pre-computed embeddings. Automatic embedding from query text not yet implemented (would require OpenAI API key at query time).

2. **Keyword search performance**: On large datasets, keyword search may timeout. This can be addressed with:
   - Database query optimization
   - Adding indexes
   - Implementing pagination
   - Using more specific queries

3. **Attachment content**: Not indexed for search. Extract text and add as analysis if you need to search attachment content.

## Migration Path

If you have existing data:

1. **Keyword search works immediately** - uses existing text indexes
2. **Semantic search requires embeddings** - run backfill script
3. **No data migration needed** - all existing vCons work with new tools

## Next Steps

1. Generate embeddings for your vCons (if using semantic/hybrid search)
2. Try the new search tools via MCP
3. Refer to `/docs/SEARCH_TOOLS_GUIDE.md` for detailed usage examples
4. Monitor performance and adjust limits/filters as needed

## Summary

The search tools now provide comprehensive content search across dialog and analysis, with three different search strategies (keyword, semantic, hybrid) to suit different use cases. Attachments remain intentionally excluded from content indexing, but their text content can be made searchable by adding it as analysis elements.

