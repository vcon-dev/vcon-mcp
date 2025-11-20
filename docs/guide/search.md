# vCon Search Tools Guide

## Overview

The vCon MCP server provides four search tools with different capabilities, from simple filtering to advanced semantic search.

## Available Search Tools

### 1. `search_vcons` - Basic Filter Search

**Best for:** Finding vCons by metadata (subject, parties, dates)

**Searches:**
- Subject line
- Party names, emails, phone numbers
- Creation dates

**Does NOT search:**
- Dialog content
- Analysis content
- Attachments

**Example:**
```json
{
  "subject": "customer support",
  "party_name": "John Doe",
  "start_date": "2024-01-01T00:00:00Z",
  "limit": 10
}
```

**Returns:** Complete vCon objects matching the filters

---

### 2. `search_vcons_content` - Keyword Search

**Best for:** Finding specific words or phrases in conversation content

**Searches:**
- ✅ Subject
- ✅ Dialog bodies (conversations, transcripts)
- ✅ Analysis bodies (summaries, sentiment, etc.)
- ✅ Party information (names, emails, phones)
- ❌ Attachments (not indexed for full-text search)

**Features:**
- Full-text search with ranking
- Typo tolerance via trigram indexing
- Highlighted snippets in results
- Tag filtering support
- Date range filtering

**Example:**
```json
{
  "query": "billing issue refund",
  "tags": {"department": "sales"},
  "start_date": "2024-01-01T00:00:00Z",
  "limit": 50
}
```

**Returns:** Ranked results with snippets showing where matches were found

**Result format:**
```json
{
  "success": true,
  "count": 5,
  "results": [
    {
      "vcon_id": "uuid",
      "content_type": "analysis",  // or "subject", "dialog", "party"
      "content_index": 0,
      "relevance_score": 0.85,
      "snippet": "...regarding the billing issue and potential refund..."
    }
  ]
}
```

---

### 3. `search_vcons_semantic` - AI-Powered Semantic Search

**Best for:** Finding conversations by meaning, not just keywords

**Searches:**
- ✅ Subject (embedded)
- ✅ Dialog bodies (embedded)
- ✅ Analysis bodies with `encoding='none'` or `NULL` (embedded)
- ❌ Analysis with `encoding='base64url'` or `encoding='json'` (not embedded)
- ❌ Attachments (not embedded)

**Features:**
- Finds conceptually similar content
- Works across paraphrases and synonyms
- AI embeddings using 384-dimensional vectors
- Tag filtering support
- Similarity threshold control

**Requirements:**
- Embeddings must be generated first (see embedding documentation)
- Currently requires pre-computed embedding vector (384 dimensions)

**Example:**
```json
{
  "query": "customer angry about late delivery",
  "threshold": 0.7,
  "limit": 20
}
```

**Note:** Automatic embedding generation from query text is not yet implemented. Use `search_vcons_content` for keyword-based search without embeddings.

**Returns:** Similar conversations ranked by semantic similarity

---

### 4. `search_vcons_hybrid` - Combined Keyword + Semantic Search

**Best for:** Comprehensive search combining exact matches and conceptual similarity

**Searches:**
- Everything from keyword search (subject, dialog, analysis, parties)
- Everything from semantic search (embedded content)

**Features:**
- Combines full-text and semantic search
- Adjustable weighting between keyword and semantic results
- Best of both worlds: exact matches + conceptual matches
- Tag filtering support

**Example:**
```json
{
  "query": "billing dispute",
  "semantic_weight": 0.6,
  "tags": {"priority": "high"},
  "limit": 30
}
```

**Parameters:**
- `semantic_weight`: 0-1 (default 0.6)
  - 0.0 = 100% keyword search
  - 1.0 = 100% semantic search
  - 0.6 = 60% semantic, 40% keyword (recommended)

**Returns:** Combined results with both keyword and semantic scores

---

## What About Attachments?

### Current Status

**Attachments are NOT indexed for search** in the current implementation.

**Why?**

1. **Binary content**: Many attachments contain binary data (PDFs, images, audio) that isn't suitable for text-based search
2. **Encoding**: Attachments with `encoding='base64url'` contain encoded data, not searchable text
3. **Structured data**: Attachments with `encoding='json'` contain structured data that produces poor quality embeddings

### Special Case: Tags

Attachments of type `tags` with `encoding='json'` ARE used for filtering, but not for content search.

Example tags attachment:
```json
{
  "type": "tags",
  "encoding": "json",
  "body": ["department:sales", "priority:high", "region:west"]
}
```

These tags can be used with the `tags` parameter in any search tool:
```json
{
  "query": "customer complaint",
  "tags": {"department": "sales", "priority": "high"}
}
```

### Future Enhancements

Potential future support for attachment content search:

1. **Text extraction**: Extract text from PDFs, Word docs, etc.
2. **Audio transcription**: Transcribe audio attachments to searchable text
3. **OCR**: Extract text from images
4. **Selective indexing**: Index only attachments with text content

If you need to search attachment content, consider:
1. Extracting text and adding it as an analysis element
2. Adding a summary of attachment content as an analysis
3. Using attachment metadata in tags

---

## Analysis Encoding and Search

### Analysis Elements ARE Searchable

Analysis elements are included in search, with filtering based on encoding:

| Encoding | Keyword Search | Semantic Search | Notes |
|----------|---------------|-----------------|-------|
| `none` or `NULL` | ✅ Yes | ✅ Yes | Plain text content, ideal for search |
| `json` | ✅ Yes | ❌ No | Included in keyword search only |
| `base64url` | ✅ Yes | ❌ No | Included in keyword search only |

### Why Filter Semantic Search by Encoding?

Analysis with `encoding='none'` contains human-readable text like:
- Conversation summaries
- Transcriptions
- Sentiment analysis results
- Translation output
- Natural language insights

These are ideal for semantic search because they contain meaningful natural language.

Analysis with `encoding='json'` or `encoding='base64url'` typically contains:
- Structured data (poor quality embeddings)
- Binary content (not suitable for embeddings)
- Encoded data (not searchable as text)

---

## Search Comparison

| Feature | search_vcons | search_vcons_content | search_vcons_semantic | search_vcons_hybrid |
|---------|--------------|---------------------|----------------------|---------------------|
| Subject | ✅ Filter | ✅ Search | ✅ Search | ✅ Search |
| Dialog | ❌ | ✅ Search | ✅ Search | ✅ Search |
| Analysis | ❌ | ✅ Search | ✅ (encoding=none) | ✅ All |
| Attachments | ❌ | ❌ | ❌ | ❌ |
| Party Info | ✅ Filter | ✅ Search | ❌ | ✅ Search |
| Tags | ❌ | ✅ Filter | ✅ Filter | ✅ Filter |
| Ranking | ❌ | ✅ Relevance | ✅ Similarity | ✅ Combined |
| Snippets | ❌ | ✅ Yes | ❌ | ❌ |
| Requires Embeddings | ❌ | ❌ | ✅ | ⚠️ Optional |

---

## Best Practices

### When to Use Each Tool

1. **`search_vcons`**: Quick metadata lookups
   - "Find vCons with party email john@example.com"
   - "Show me vCons from last week"
   - "List vCons with subject containing 'urgent'"

2. **`search_vcons_content`**: Keyword-based content search
   - "Find conversations mentioning 'refund'"
   - "Search for 'technical support' in dialog"
   - "Find analysis containing 'positive sentiment'"

3. **`search_vcons_semantic`**: Concept-based search
   - "Find conversations where customer was unhappy"
   - "Show me calls about payment issues"
   - "Find similar conversations to this one"

4. **`search_vcons_hybrid`**: Comprehensive search
   - "Find all billing-related conversations" (gets both exact matches and related topics)
   - "Search for customer complaints" (finds variations and synonyms)
   - Best when you want both precision and recall

### Performance Tips

1. **Use filters**: Date ranges and tags can dramatically reduce search scope
2. **Set appropriate limits**: Start with smaller limits (10-20) for faster results
3. **Choose the right tool**: Don't use semantic search if keyword search is sufficient
4. **Pre-generate embeddings**: Semantic search requires embeddings to be generated beforehand

---

## Generating Embeddings

For semantic and hybrid search to work effectively, you need to generate embeddings for your vCons.

See the following guides:
- [INGEST_AND_EMBEDDINGS.md](./INGEST_AND_EMBEDDINGS.md) - Complete guide to embedding generation
- [EMBEDDING_STRATEGY_UPGRADE.md](./EMBEDDING_STRATEGY_UPGRADE.md) - Details on which content is embedded

**Quick start:**
```bash
# Generate embeddings for all vCons (default: 500 per batch, 2 second delay)
npm run embeddings:backfill

# Or with custom settings
./scripts/backfill-embeddings.sh 200 5

# Check embedding coverage
npm run embeddings:check
```

---

## Troubleshooting

### "No results found" for content search

- Check that the content exists in dialog or analysis
- Try a simpler query (fewer words)
- Use wildcards or partial words
- Check date range filters

### "Embedding generation not yet implemented"

- Semantic search currently requires pre-computed embeddings
- Use `search_vcons_content` for keyword search instead
- Generate embeddings using the scripts in `/scripts/`

### "Embedding must be 384 dimensions"

- The system uses 384-dimensional embeddings
- If you're providing embeddings, ensure they match this dimension
- Use `text-embedding-3-small` with `dimensions=384` (OpenAI)
- Or use `sentence-transformers/all-MiniLM-L6-v2` (Hugging Face)

### Poor search results

- For keyword search: Try simpler, more specific terms
- For semantic search: Ensure embeddings are up to date
- For hybrid search: Adjust `semantic_weight` parameter
- Consider using tags to filter results

---

## Examples

### Find customer complaints in dialog

```json
{
  "query": "customer complaint angry upset frustrated",
  "limit": 20
}
```

### Find high-priority sales conversations

```json
{
  "query": "pricing quote proposal",
  "tags": {
    "department": "sales",
    "priority": "high"
  },
  "start_date": "2024-01-01T00:00:00Z"
}
```

### Hybrid search with keyword emphasis

```json
{
  "query": "billing invoice payment",
  "semantic_weight": 0.3,
  "limit": 30
}
```

### Find conversations similar to a specific vCon

1. Get the vCon's embedding from the database
2. Use it in semantic search:

```json
{
  "embedding": [0.123, 0.456, ...],  // 384 dimensions
  "threshold": 0.75,
  "limit": 10
}
```

---

## Related Documentation

- [QUICK_START.md](../QUICK_START.md) - Getting started with vCon MCP
- [INGEST_AND_EMBEDDINGS.md](./INGEST_AND_EMBEDDINGS.md) - Embedding generation
- [SUPABASE_SEMANTIC_SEARCH_GUIDE.md](../SUPABASE_SEMANTIC_SEARCH_GUIDE.md) - Database search implementation

