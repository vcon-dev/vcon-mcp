# Supabase Semantic Search Implementation Guide

## Overview

This guide explains how to implement semantic search for vCon conversation content in Supabase PostgreSQL using the **pgvector** extension for vector similarity search.

---

## Architecture

### High-Level Flow

```
vCon Content → Embedding API → Vector (array of floats) → PostgreSQL (pgvector) → Similarity Search
```

### Components

1. **pgvector Extension** - PostgreSQL extension for vector similarity
2. **Embedding Service** - OpenAI, Sentence Transformers, or custom
3. **Vector Storage** - New columns in Supabase tables
4. **Similarity Functions** - Cosine similarity, L2 distance, inner product
5. **Indexes** - HNSW or IVFFlat indexes for fast retrieval

---

## Step 1: Enable pgvector Extension

### In Supabase Dashboard

```sql
-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
```

### Verify Installation

```sql
SELECT * FROM pg_extension WHERE extname = 'vector';
```

---

## Step 2: Add Vector Columns to Schema

### Add Embedding Columns

```sql
-- Add vector columns to existing tables
ALTER TABLE vcons 
ADD COLUMN subject_embedding vector(1536),  -- OpenAI ada-002 dimension
ADD COLUMN subject_embedding_model TEXT DEFAULT 'text-embedding-ada-002',
ADD COLUMN subject_embedding_updated_at TIMESTAMPTZ;

ALTER TABLE dialog
ADD COLUMN content_embedding vector(1536),
ADD COLUMN content_embedding_model TEXT DEFAULT 'text-embedding-ada-002',
ADD COLUMN content_embedding_updated_at TIMESTAMPTZ;

ALTER TABLE analysis
ADD COLUMN summary_embedding vector(1536),
ADD COLUMN summary_embedding_model TEXT DEFAULT 'text-embedding-ada-002',
ADD COLUMN summary_embedding_updated_at TIMESTAMPTZ;
```

### Alternative: Dedicated Embeddings Table

For more flexibility, create a separate embeddings table:

```sql
-- Dedicated embeddings table for all content types
CREATE TABLE vcon_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    
    -- What is being embedded
    content_type TEXT NOT NULL, -- 'subject', 'dialog', 'analysis_summary'
    content_reference TEXT, -- dialog_index, analysis_index, etc.
    content_text TEXT NOT NULL, -- Original text that was embedded
    
    -- The embedding
    embedding vector(1536) NOT NULL,
    embedding_model TEXT NOT NULL DEFAULT 'text-embedding-ada-002',
    embedding_dimension INTEGER NOT NULL DEFAULT 1536,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Composite index for lookups
    CONSTRAINT vcon_embeddings_unique UNIQUE (vcon_id, content_type, content_reference)
);

-- Indexes for fast retrieval
CREATE INDEX idx_vcon_embeddings_vcon_id ON vcon_embeddings(vcon_id);
CREATE INDEX idx_vcon_embeddings_content_type ON vcon_embeddings(content_type);
```

---

## Step 3: Create Vector Indexes

### HNSW Index (Recommended for Most Cases)

```sql
-- HNSW index for approximate nearest neighbor search
-- Good for: General purpose, balanced performance
CREATE INDEX ON vcon_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- For L2 distance
CREATE INDEX ON vcon_embeddings 
USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);

-- For inner product
CREATE INDEX ON vcon_embeddings 
USING hnsw (embedding vector_ip_ops)
WITH (m = 16, ef_construction = 64);
```

**HNSW Parameters:**
- `m`: Max connections per layer (default: 16, higher = more accurate but slower)
- `ef_construction`: Size of dynamic candidate list (default: 64, higher = better recall)

### IVFFlat Index (For Large Datasets)

```sql
-- IVFFlat index for large-scale search
-- Good for: 1M+ vectors, when you can tolerate some accuracy loss
CREATE INDEX ON vcon_embeddings 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Adjust lists based on dataset size:
-- lists = rows / 1000 for small datasets (< 1M rows)
-- lists = sqrt(rows) for larger datasets
```

**When to Use Which Index:**
- **HNSW**: < 1M vectors, need high accuracy, have memory
- **IVFFlat**: > 1M vectors, can trade accuracy for speed
- **No Index**: < 10K vectors (brute force is fast enough)

---

## Step 4: Generate Embeddings

### Option A: Using OpenAI API

```python
import openai
from supabase import create_client

# Initialize clients
openai.api_key = "your-openai-key"
supabase = create_client("your-supabase-url", "your-supabase-key")

def generate_embedding(text: str, model: str = "text-embedding-ada-002") -> list[float]:
    """Generate embedding using OpenAI API."""
    response = openai.embeddings.create(
        input=text,
        model=model
    )
    return response.data[0].embedding

def embed_vcon_content(vcon_id: str, subject: str, dialog_texts: list[str]):
    """Generate and store embeddings for vCon content."""
    
    # Embed subject
    if subject:
        subject_embedding = generate_embedding(subject)
        supabase.table('vcon_embeddings').upsert({
            'vcon_id': vcon_id,
            'content_type': 'subject',
            'content_reference': None,
            'content_text': subject,
            'embedding': subject_embedding,
            'embedding_model': 'text-embedding-ada-002',
            'embedding_dimension': 1536
        }).execute()
    
    # Embed dialogs
    for idx, text in enumerate(dialog_texts):
        if text and len(text.strip()) > 0:
            dialog_embedding = generate_embedding(text)
            supabase.table('vcon_embeddings').upsert({
                'vcon_id': vcon_id,
                'content_type': 'dialog',
                'content_reference': str(idx),
                'content_text': text,
                'embedding': dialog_embedding,
                'embedding_model': 'text-embedding-ada-002',
                'embedding_dimension': 1536
            }).execute()

# Usage
embed_vcon_content(
    vcon_id="123e4567-e89b-12d3-a456-426614174000",
    subject="Customer support call regarding billing issue",
    dialog_texts=[
        "Hello, I have a question about my bill",
        "I can help with that. What's your account number?",
        "It's 12345. I was charged twice this month."
    ]
)
```

### Option B: Using Sentence Transformers (Local/Self-Hosted)

```python
from sentence_transformers import SentenceTransformer
from supabase import create_client

# Load model (384-dim or 768-dim depending on model)
model = SentenceTransformer('all-MiniLM-L6-v2')  # 384 dimensions

supabase = create_client("your-supabase-url", "your-supabase-key")

def generate_embedding_local(text: str) -> list[float]:
    """Generate embedding using local Sentence Transformers model."""
    embedding = model.encode(text)
    return embedding.tolist()

# Update schema for 384-dim embeddings
# ALTER TABLE vcon_embeddings ALTER COLUMN embedding TYPE vector(384);
```

### Option C: Batch Processing with Edge Functions (Preferred in this repo)

```typescript
// Supabase Edge Function for batch embedding
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const { vcon_id, texts } = await req.json()
  
  // Call OpenAI API
  const embeddings = await Promise.all(
    texts.map(text => generateEmbedding(text))
  )
  
  // Store in Supabase
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  )
  
  for (let i = 0; i < embeddings.length; i++) {
    await supabase.table('vcon_embeddings').insert({
      vcon_id,
      content_type: 'dialog',
      content_reference: String(i),
      content_text: texts[i],
      embedding: embeddings[i]
    })
  }
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

See `docs/INGEST_AND_EMBEDDINGS.md` for the production-ready function (`supabase/functions/embed-vcons/index.ts`), environment variables, and Cron scheduling. This repository standardizes on 384‑dim embeddings to match the migrations and HNSW index.

---

## Step 5: Semantic Search Queries

### Basic Cosine Similarity Search

```sql
-- Function to search by semantic similarity
CREATE OR REPLACE FUNCTION search_vcons_semantic(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 20
)
RETURNS TABLE (
    vcon_id uuid,
    content_type text,
    content_text text,
    similarity float
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        e.vcon_id,
        e.content_type,
        e.content_text,
        1 - (e.embedding <=> query_embedding) AS similarity
    FROM vcon_embeddings e
    WHERE 1 - (e.embedding <=> query_embedding) > match_threshold
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Usage
SELECT * FROM search_vcons_semantic(
    (SELECT embedding FROM vcon_embeddings WHERE id = 'some-id'), -- query embedding
    0.7, -- minimum similarity
    20   -- max results
);
```

### Similarity Operators in pgvector

```sql
-- Cosine distance (most common for semantic search)
-- Returns 0-2, where 0 = identical, 1 = orthogonal, 2 = opposite
embedding1 <=> embedding2

-- L2 distance (Euclidean)
-- Returns >= 0, where 0 = identical
embedding1 <-> embedding2

-- Inner product (negative inner product)
-- Returns negative value, larger (less negative) = more similar
embedding1 <#> embedding2

-- Cosine similarity (1 - cosine distance)
-- Returns 0-1, where 1 = identical, 0 = orthogonal
1 - (embedding1 <=> embedding2)
```

### Python Implementation

```python
from supabase import create_client
import openai

class VConSemanticSearch:
    def __init__(self, supabase_url: str, supabase_key: str, openai_key: str):
        self.supabase = create_client(supabase_url, supabase_key)
        openai.api_key = openai_key
    
    def search(
        self, 
        query: str, 
        threshold: float = 0.7, 
        limit: int = 20,
        content_types: list[str] = None
    ) -> list[dict]:
        """
        Semantic search for vCons.
        
        Args:
            query: Natural language search query
            threshold: Minimum similarity (0-1)
            limit: Max results
            content_types: Filter by content type ['subject', 'dialog', 'analysis_summary']
        
        Returns:
            List of matching results with similarity scores
        """
        
        # Generate query embedding
        query_embedding = openai.embeddings.create(
            input=query,
            model="text-embedding-ada-002"
        ).data[0].embedding
        
        # Build query
        rpc_params = {
            'query_embedding': query_embedding,
            'match_threshold': threshold,
            'match_count': limit
        }
        
        # Execute search
        results = self.supabase.rpc(
            'search_vcons_semantic',
            rpc_params
        ).execute()
        
        # Group by vCon
        vcon_results = {}
        for row in results.data:
            vcon_id = row['vcon_id']
            if vcon_id not in vcon_results:
                vcon_results[vcon_id] = {
                    'vcon_id': vcon_id,
                    'max_similarity': row['similarity'],
                    'matches': []
                }
            
            vcon_results[vcon_id]['matches'].append({
                'content_type': row['content_type'],
                'content_text': row['content_text'],
                'similarity': row['similarity']
            })
        
        # Sort by max similarity
        return sorted(
            vcon_results.values(),
            key=lambda x: x['max_similarity'],
            reverse=True
        )

# Usage
searcher = VConSemanticSearch(
    supabase_url="your-url",
    supabase_key="your-key",
    openai_key="your-openai-key"
)

results = searcher.search(
    query="customer frustrated about billing errors",
    threshold=0.75,
    limit=10
)

for result in results:
    print(f"vCon {result['vcon_id']}: {result['max_similarity']:.3f}")
    for match in result['matches']:
        print(f"  - {match['content_type']}: {match['content_text'][:100]}...")
```

---

## Step 6: Hybrid Search (Semantic + Exact)

### SQL Function for Hybrid Search with Tags-from-Attachments

```sql
CREATE OR REPLACE FUNCTION search_vcons_hybrid(
    query_text text,
    query_embedding vector(1536),
    tag_filters jsonb DEFAULT '{}',
    semantic_weight float DEFAULT 0.5,
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 20
)
RETURNS TABLE (
    vcon_id uuid,
    subject text,
    tags jsonb,
    semantic_score float,
    keyword_score float,
    combined_score float
) AS $$
BEGIN
    RETURN QUERY
    WITH tags_kv AS (
        SELECT a.vcon_id,
               split_part(elem, ':', 1) AS key,
               split_part(elem, ':', 2) AS value
        FROM attachments a
        CROSS JOIN LATERAL jsonb_array_elements_text(a.body::jsonb) AS elem
        WHERE a.type = 'tags' AND a.encoding = 'json'
    ),
    tags_agg AS (
        SELECT vcon_id, jsonb_object_agg(key, value) AS tags
        FROM tags_kv GROUP BY vcon_id
    ),
    semantic_results AS (
        SELECT
            e.vcon_id,
            MAX(1 - (e.embedding <=> query_embedding)) AS semantic_score
        FROM vcon_embeddings e
        WHERE 1 - (e.embedding <=> query_embedding) > match_threshold
        GROUP BY e.vcon_id
    ),
    keyword_results AS (
        SELECT
            v.id AS vcon_id,
            ts_rank_cd(
                setweight(to_tsvector('english', COALESCE(v.subject, '')), 'A') ||
                setweight(to_tsvector('english', COALESCE(d.body, '')), 'C') ||
                setweight(to_tsvector('english', COALESCE(a.body, '')), 'B'),
                plainto_tsquery('english', query_text)
            ) AS keyword_score
        FROM vcons v
        LEFT JOIN dialog d ON d.vcon_id = v.id
        LEFT JOIN analysis a ON a.vcon_id = v.id
        WHERE query_text IS NOT NULL
          AND (setweight(to_tsvector('english', COALESCE(v.subject, '')), 'A') ||
               setweight(to_tsvector('english', COALESCE(d.body, '')), 'C') ||
               setweight(to_tsvector('english', COALESCE(a.body, '')), 'B'))
              @@ plainto_tsquery('english', query_text)
    )
    SELECT
        v.id AS vcon_id,
        COALESCE(sr.semantic_score, 0) AS semantic_score,
        COALESCE(kr.keyword_score, 0) AS keyword_score,
        (COALESCE(sr.semantic_score, 0) * semantic_weight + 
         COALESCE(kr.keyword_score, 0) * (1 - semantic_weight)) AS combined_score
    FROM vcons v
    LEFT JOIN tags_agg ta ON ta.vcon_id = v.id
    LEFT JOIN semantic_results sr ON v.id = sr.vcon_id
    LEFT JOIN keyword_results kr ON v.id = kr.vcon_id
    WHERE (tag_filters = '{}'::jsonb OR (ta.tags IS NOT NULL AND ta.tags @> tag_filters))
      AND (sr.semantic_score IS NOT NULL OR kr.keyword_score IS NOT NULL)
    ORDER BY combined_score DESC
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
```

### Python Implementation

```python
def hybrid_search(
    self,
    semantic_query: str = None,
    keyword_query: str = None,
    tags: dict = None,
    semantic_weight: float = 0.5,
    threshold: float = 0.7,
    limit: int = 20
) -> list[dict]:
    """
    Hybrid search combining semantic and keyword search with tag filters.
    
    Args:
        semantic_query: Natural language query for semantic search
        keyword_query: Keywords for full-text search
        tags: Exact tag filters
        semantic_weight: Weight for semantic vs keyword (0-1)
        threshold: Minimum semantic similarity
        limit: Max results
    """
    
    # Generate embedding if semantic query provided
    query_embedding = None
    if semantic_query:
        query_embedding = openai.embeddings.create(
            input=semantic_query,
            model="text-embedding-ada-002"
        ).data[0].embedding
    
    # Execute hybrid search
    results = self.supabase.rpc('search_vcons_hybrid', {
        'query_text': keyword_query or semantic_query or '',
        'query_embedding': query_embedding,
        'tag_filters': tags or {},
        'semantic_weight': semantic_weight,
        'match_threshold': threshold,
        'match_count': limit
    }).execute()
    
    return results.data

# Usage
results = searcher.hybrid_search(
    semantic_query="customer unhappy with billing",
    tags={"department": "support", "status": "open"},
    semantic_weight=0.7,
    limit=10
)
```

---

## Step 7: Automatic Embedding Generation

### Trigger for Automatic Embedding on Insert

```sql
-- Function to automatically generate embeddings
CREATE OR REPLACE FUNCTION generate_vcon_embeddings()
RETURNS TRIGGER AS $$
BEGIN
    -- Call Edge Function or external service to generate embeddings
    -- This is a placeholder - actual implementation would call embedding service
    
    PERFORM net.http_post(
        url := current_setting('app.embedding_service_url'),
        body := jsonb_build_object(
            'vcon_id', NEW.id,
            'subject', NEW.subject,
            'metadata', NEW.metadata
        )
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically generate embeddings
CREATE TRIGGER trigger_generate_embeddings
    AFTER INSERT OR UPDATE OF subject, metadata ON vcons
    FOR EACH ROW
    EXECUTE FUNCTION generate_vcon_embeddings();
```

### Background Job for Batch Embedding

```python
import asyncio
from datetime import datetime, timedelta

async def embedding_worker():
    """Background worker to generate embeddings for new vCons."""
    
    while True:
        # Find vCons without embeddings
        result = supabase.table('vcons').select('id, subject').is_('subject_embedding', 'null').limit(100).execute()
        
        for vcon in result.data:
            try:
                # Generate embedding
                embedding = generate_embedding(vcon['subject'])
                
                # Update vCon
                supabase.table('vcons').update({
                    'subject_embedding': embedding,
                    'subject_embedding_updated_at': datetime.now().isoformat()
                }).eq('id', vcon['id']).execute()
                
            except Exception as e:
                print(f"Error embedding vCon {vcon['id']}: {e}")
        
        # Wait before next batch
        await asyncio.sleep(60)

# Run worker
asyncio.run(embedding_worker())
```

---

## Step 8: Performance Optimization

### Query Optimization

```sql
-- Set search parameters for better performance
SET hnsw.ef_search = 40; -- Default is 40, increase for better recall

-- For IVFFlat
SET ivfflat.probes = 10; -- Default is 1, increase for better recall
```

### Embedding Dimension Reduction

```python
# Use smaller embedding models for better performance
# OpenAI text-embedding-3-small: 1536 dims (default) or can be reduced
# Sentence Transformers all-MiniLM-L6-v2: 384 dims

# Reduce OpenAI embedding dimensions
response = openai.embeddings.create(
    input=text,
    model="text-embedding-3-small",
    dimensions=512  # Reduce from 1536 to 512
)
```

### Caching Strategy

```python
import hashlib
import redis

redis_client = redis.Redis(host='localhost', port=6379, db=0)

def get_cached_embedding(text: str) -> list[float] | None:
    """Get embedding from cache."""
    cache_key = f"emb:{hashlib.md5(text.encode()).hexdigest()}"
    cached = redis_client.get(cache_key)
    if cached:
        return json.loads(cached)
    return None

def cache_embedding(text: str, embedding: list[float]):
    """Cache embedding for 7 days."""
    cache_key = f"emb:{hashlib.md5(text.encode()).hexdigest()}"
    redis_client.setex(cache_key, 604800, json.dumps(embedding))  # 7 days

def generate_embedding_with_cache(text: str) -> list[float]:
    """Generate embedding with caching."""
    cached = get_cached_embedding(text)
    if cached:
        return cached
    
    embedding = generate_embedding(text)
    cache_embedding(text, embedding)
    return embedding
```

---

## Step 9: Monitoring & Maintenance

### Track Embedding Coverage

```sql
-- Check embedding coverage
SELECT 
    COUNT(*) AS total_vcons,
    COUNT(subject_embedding) AS vcons_with_subject_embedding,
    COUNT(subject_embedding)::float / COUNT(*) * 100 AS coverage_percentage
FROM vcons;

-- Find vCons missing embeddings
SELECT id, subject, created_at
FROM vcons
WHERE subject_embedding IS NULL
ORDER BY created_at DESC
LIMIT 100;
```

### Monitor Search Performance

```sql
-- Enable timing
\timing on

-- Test query performance
EXPLAIN ANALYZE
SELECT *
FROM search_vcons_semantic(
    (SELECT embedding FROM vcon_embeddings WHERE id = 'test-id'),
    0.7,
    20
);
```

### Index Maintenance

```sql
-- Rebuild index if needed
REINDEX INDEX vcon_embeddings_embedding_idx;

-- Vacuum to reclaim space
VACUUM ANALYZE vcon_embeddings;
```

---

## Cost Considerations

### OpenAI Embedding Costs

- **text-embedding-ada-002**: $0.0001 per 1K tokens (~750 words)
- **text-embedding-3-small**: $0.00002 per 1K tokens
- **text-embedding-3-large**: $0.00013 per 1K tokens

**Example Costs:**
- 100K vCons with 200-word subjects: $26.67 (ada-002)
- 1M dialog messages averaging 50 words: $66.67 (ada-002)

### Self-Hosted Alternative

Use Sentence Transformers locally:
- No API costs
- Faster for batch processing
- 384-768 dimensions (vs 1536)
- Slightly lower accuracy

---

## Summary

### Key Decisions

1. **Embedding Model**
   - OpenAI ada-002: Best accuracy, API costs
   - Sentence Transformers: Free, good accuracy, self-hosted

2. **Storage Strategy**
   - Dedicated embeddings table (recommended)
   - Embedded in existing tables (simpler)

3. **Index Type**
   - HNSW: < 1M vectors, high accuracy
   - IVFFlat: > 1M vectors, faster but less accurate

4. **Search Strategy**
   - Pure semantic: Best for natural language queries
   - Hybrid: Combine with tags and keywords for precision

### Implementation Checklist

- [ ] Enable pgvector extension
- [ ] Add vector columns to schema
- [ ] Create appropriate indexes
- [ ] Implement embedding generation
- [ ] Create search functions
- [ ] Set up caching
- [ ] Monitor performance
- [ ] Plan for maintenance

This architecture provides production-ready semantic search for vCon conversations in Supabase! 🚀
