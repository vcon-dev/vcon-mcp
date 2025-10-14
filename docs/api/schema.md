# Database Schema Reference

Complete database schema for the vCon MCP Server running on PostgreSQL/Supabase.

## Overview

The vCon database is fully compliant with [IETF vCon Core](https://datatracker.ietf.org/doc/html/draft-ietf-vcon-vcon-core-00) specification and provides:

- **Normalized storage** for efficient querying
- **Full-text search** with trigram indexing
- **Semantic search** with pgvector embeddings
- **Tag management** via attachments
- **Privacy extensions** for GDPR/CCPA compliance

---

## Core Tables

### vcons

Main table storing vCon metadata and top-level fields.

```sql
CREATE TABLE vcons (
    -- Primary Keys
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    uuid UUID UNIQUE NOT NULL,
    
    -- vCon Core Fields (Section 4.1)
    vcon_version VARCHAR(10) NOT NULL DEFAULT '0.3.0',
    subject TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Extensions (Section 4.1.3-4.1.4)
    extensions TEXT[],
    must_support TEXT[],
    
    -- Advanced Features
    redacted JSONB DEFAULT '{}',
    appended JSONB DEFAULT '{}',
    group_data JSONB DEFAULT '[]',
    
    -- Metadata
    basename TEXT,
    filename TEXT,
    done BOOLEAN DEFAULT false,
    corrupt BOOLEAN DEFAULT false,
    processed_by TEXT,
    
    -- Privacy Extensions (not in core spec)
    privacy_processed JSONB DEFAULT '{}',
    redaction_rules JSONB DEFAULT '{}',
    
    CONSTRAINT valid_uuid CHECK (uuid IS NOT NULL)
);
```

**Indexes:**
```sql
CREATE INDEX idx_vcons_uuid ON vcons(uuid);
CREATE INDEX idx_vcons_created_at ON vcons(created_at);
CREATE INDEX idx_vcons_updated_at ON vcons(updated_at);
```

---

### parties

Normalized table for conversation participants (Section 4.2).

```sql
CREATE TABLE parties (
    -- Primary Keys
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    party_index INTEGER NOT NULL,
    
    -- Contact Information
    tel TEXT,
    sip TEXT,
    mailto TEXT,
    name TEXT,
    
    -- Identity & Verification
    stir TEXT,
    did TEXT,
    uuid UUID,
    validation TEXT,
    
    -- Location
    timezone TEXT,
    gmlpos TEXT,
    civicaddress JSONB,
    
    -- vCard
    jcard JSONB,
    
    -- Privacy Extensions (not in core spec)
    data_subject_id TEXT,
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(vcon_id, party_index)
);
```

**Indexes:**
```sql
CREATE INDEX idx_parties_vcon ON parties(vcon_id);
CREATE INDEX idx_parties_tel ON parties(tel) WHERE tel IS NOT NULL;
CREATE INDEX idx_parties_email ON parties(mailto) WHERE mailto IS NOT NULL;
CREATE INDEX idx_parties_name ON parties(name) WHERE name IS NOT NULL;
CREATE INDEX idx_parties_uuid ON parties(uuid) WHERE uuid IS NOT NULL;
CREATE INDEX idx_parties_data_subject ON parties(data_subject_id) 
  WHERE data_subject_id IS NOT NULL;

-- Trigram indexes for fuzzy search
CREATE INDEX idx_parties_name_trgm ON parties USING gin (name gin_trgm_ops);
CREATE INDEX idx_parties_mail_trgm ON parties USING gin (mailto gin_trgm_ops);
CREATE INDEX idx_parties_tel_trgm ON parties USING gin (tel gin_trgm_ops);
```

---

### dialog

Conversation content segments (Section 4.3).

```sql
CREATE TABLE dialog (
    -- Primary Keys
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    dialog_index INTEGER NOT NULL,
    
    -- Core Fields
    type TEXT NOT NULL CHECK (type IN ('recording', 'text', 'transfer', 'incomplete')),
    start_time TIMESTAMPTZ,
    duration_seconds REAL,
    parties INTEGER[],
    originator INTEGER,
    
    -- Media
    mediatype TEXT,
    filename TEXT,
    size_bytes BIGINT,
    
    -- Content
    body TEXT,
    encoding TEXT CHECK (encoding IS NULL OR encoding IN ('base64url', 'json', 'none')),
    url TEXT,
    content_hash TEXT,
    
    -- Call Disposition
    disposition TEXT CHECK (disposition IS NULL OR disposition IN (
      'no-answer', 'congestion', 'failed', 'busy', 'hung-up', 'voicemail-no-message'
    )),
    
    -- Session Tracking
    session_id TEXT,
    application TEXT,
    message_id TEXT,
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(vcon_id, dialog_index)
);
```

**Indexes:**
```sql
CREATE INDEX idx_dialog_vcon ON dialog(vcon_id);
CREATE INDEX idx_dialog_type ON dialog(type);
CREATE INDEX idx_dialog_start ON dialog(start_time);
CREATE INDEX idx_dialog_session ON dialog(session_id) 
  WHERE session_id IS NOT NULL;

-- Trigram index for content search
CREATE INDEX idx_dialog_body_trgm ON dialog USING gin (body gin_trgm_ops);
```

---

### party_history

Track party events during a dialog (Section 4.3.11).

```sql
CREATE TABLE party_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dialog_id UUID NOT NULL REFERENCES dialog(id) ON DELETE CASCADE,
    party_index INTEGER NOT NULL,
    time TIMESTAMPTZ NOT NULL,
    event TEXT NOT NULL CHECK (event IN (
      'join', 'drop', 'hold', 'unhold', 'mute', 'unmute'
    ))
);
```

---

### analysis

AI/ML analysis results (Section 4.5).

```sql
CREATE TABLE analysis (
    -- Primary Keys
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    analysis_index INTEGER NOT NULL,
    
    -- Core Fields
    type TEXT NOT NULL,
    dialog_indices INTEGER[],
    vendor TEXT NOT NULL,
    product TEXT,
    schema TEXT,
    
    -- Media
    mediatype TEXT,
    filename TEXT,
    
    -- Content
    body TEXT,
    encoding TEXT CHECK (encoding IS NULL OR encoding IN ('base64url', 'json', 'none')),
    url TEXT,
    content_hash TEXT,
    
    -- Additional metadata
    created_at TIMESTAMPTZ,
    confidence REAL,
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(vcon_id, analysis_index)
);
```

**Indexes:**
```sql
CREATE INDEX idx_analysis_vcon ON analysis(vcon_id);
CREATE INDEX idx_analysis_type ON analysis(type);
CREATE INDEX idx_analysis_vendor ON analysis(vendor);
CREATE INDEX idx_analysis_product ON analysis(product) 
  WHERE product IS NOT NULL;
CREATE INDEX idx_analysis_schema ON analysis(schema) 
  WHERE schema IS NOT NULL;
CREATE INDEX idx_analysis_dialog ON analysis USING GIN (dialog_indices);

-- Trigram index for content search
CREATE INDEX idx_analysis_body_trgm ON analysis USING gin (body gin_trgm_ops);
```

---

### attachments

Additional files and metadata (Section 4.4).

```sql
CREATE TABLE attachments (
    -- Primary Keys
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    attachment_index INTEGER NOT NULL,
    
    -- Core Fields
    type TEXT,
    start_time TIMESTAMPTZ,
    party INTEGER,
    dialog INTEGER,
    
    -- Media
    mimetype TEXT,
    filename TEXT,
    size_bytes BIGINT,
    
    -- Content
    body TEXT,
    encoding TEXT CHECK (encoding IS NULL OR encoding IN ('base64url', 'json', 'none')),
    url TEXT,
    content_hash TEXT,
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}',
    
    UNIQUE(vcon_id, attachment_index)
);
```

**Indexes:**
```sql
CREATE INDEX idx_attachments_vcon ON attachments(vcon_id);
CREATE INDEX idx_attachments_type ON attachments(type);
CREATE INDEX idx_attachments_party ON attachments(party);
CREATE INDEX idx_attachments_dialog ON attachments(dialog);
```

---

### groups

vCon grouping references (Section 4.6).

```sql
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    group_index INTEGER NOT NULL,
    
    -- Reference or Inline Content
    uuid UUID,
    body TEXT,
    encoding TEXT CHECK (encoding = 'json'),
    url TEXT,
    content_hash TEXT,
    
    UNIQUE(vcon_id, group_index)
);
```

**Indexes:**
```sql
CREATE INDEX idx_groups_vcon ON groups(vcon_id);
CREATE INDEX idx_groups_uuid ON groups(uuid) WHERE uuid IS NOT NULL;
```

---

## Search & Embeddings

### vcon_embeddings

Semantic search embeddings using pgvector.

```sql
CREATE TABLE vcon_embeddings (
    -- Primary Keys
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vcon_id UUID NOT NULL REFERENCES vcons(id) ON DELETE CASCADE,
    
    -- Content Reference
    content_type TEXT NOT NULL,              -- 'subject' | 'dialog' | 'analysis'
    content_reference TEXT,                  -- dialog_index or analysis_index
    content_text TEXT NOT NULL,
    
    -- Embedding
    embedding vector(384) NOT NULL,          -- 384-dimensional vector
    embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    embedding_dimension INTEGER NOT NULL DEFAULT 384,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT vcon_embeddings_unique UNIQUE (vcon_id, content_type, content_reference)
);
```

**Indexes:**
```sql
CREATE INDEX idx_vcon_embeddings_vcon_id ON vcon_embeddings(vcon_id);
CREATE INDEX idx_vcon_embeddings_type ON vcon_embeddings(content_type);

-- HNSW index for fast cosine similarity search
CREATE INDEX vcon_embeddings_hnsw_cosine 
  ON vcon_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**Notes:**
- Uses OpenAI's `text-embedding-3-small` model (384 dimensions)
- HNSW (Hierarchical Navigable Small World) index for approximate nearest neighbor search
- Cosine similarity for semantic matching

---

### vcon_tags_mv

Materialized view for efficient tag queries.

```sql
CREATE MATERIALIZED VIEW vcon_tags_mv AS
SELECT 
  a.vcon_id,
  split_part(elem, ':', 1) AS key,
  split_part(elem, ':', 2) AS value
FROM attachments a
CROSS JOIN LATERAL jsonb_array_elements_text(a.body::jsonb) AS elem
WHERE a.type = 'tags' AND a.encoding = 'json';

CREATE UNIQUE INDEX idx_vcon_tags_mv_unique 
  ON vcon_tags_mv(vcon_id, key, value);
CREATE INDEX idx_vcon_tags_mv_key ON vcon_tags_mv(key);
CREATE INDEX idx_vcon_tags_mv_value ON vcon_tags_mv(value);
```

**Refresh:**
```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY vcon_tags_mv;
```

---

## Privacy Extensions

### privacy_requests

GDPR/CCPA compliance tracking (not in core spec).

```sql
CREATE TABLE privacy_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id TEXT UNIQUE NOT NULL,
    
    -- Subject Information
    party_identifier TEXT NOT NULL,
    party_name TEXT,
    
    -- Request Details
    request_type TEXT NOT NULL CHECK (request_type IN (
        'access', 'rectification', 'erasure', 'portability', 
        'restriction', 'objection'
    )),
    request_status TEXT NOT NULL DEFAULT 'pending' CHECK (request_status IN (
        'pending', 'in_progress', 'completed', 'rejected', 'partially_completed'
    )),
    
    -- Dates
    request_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completion_date TIMESTAMPTZ,
    verification_date TIMESTAMPTZ,
    acknowledgment_sent_date TIMESTAMPTZ,
    response_sent_date TIMESTAMPTZ,
    
    -- Processing
    verification_method TEXT,
    processing_notes TEXT,
    rejection_reason TEXT,
    response_method TEXT,
    processed_by TEXT,
    
    -- Metadata
    request_details JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## RPC Functions

### search_vcons_keyword

Full-text keyword search with tag filtering.

```sql
CREATE OR REPLACE FUNCTION search_vcons_keyword(
  query_text text,
  start_date timestamptz DEFAULT NULL,
  end_date timestamptz DEFAULT NULL,
  tag_filter jsonb DEFAULT '{}'::jsonb,
  max_results int DEFAULT 50
)
RETURNS TABLE (
  vcon_id uuid,
  doc_type text,
  ref_index int,
  rank float,
  snippet text
);
```

**Parameters:**
- `query_text` - Keyword query
- `start_date` - Optional date range start
- `end_date` - Optional date range end
- `tag_filter` - JSON object with tag filters
- `max_results` - Maximum results to return

**Returns:**
- `vcon_id` - vCon UUID
- `doc_type` - Where match was found (subject, party, dialog, analysis)
- `ref_index` - Index of matched component
- `rank` - Relevance score
- `snippet` - Highlighted text excerpt

---

### search_vcons_semantic

Vector similarity search with tag filtering.

```sql
CREATE OR REPLACE FUNCTION search_vcons_semantic(
  query_embedding vector(384),
  tag_filter jsonb DEFAULT '{}'::jsonb,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 50
)
RETURNS TABLE (
  vcon_id uuid,
  content_type text,
  content_reference text,
  content_text text,
  similarity float
);
```

**Parameters:**
- `query_embedding` - 384-dimensional embedding vector
- `tag_filter` - JSON object with tag filters
- `match_threshold` - Minimum similarity (0-1)
- `match_count` - Maximum results to return

**Returns:**
- `vcon_id` - vCon UUID
- `content_type` - Type of content (subject, dialog, analysis)
- `content_reference` - Reference to specific content
- `content_text` - Matched text
- `similarity` - Cosine similarity score (0-1)

---

### search_vcons_hybrid

Combined keyword + semantic search.

```sql
CREATE OR REPLACE FUNCTION search_vcons_hybrid(
  keyword_query text DEFAULT NULL,
  query_embedding vector(384) DEFAULT NULL,
  tag_filter jsonb DEFAULT '{}'::jsonb,
  semantic_weight float DEFAULT 0.6,
  limit_results int DEFAULT 50
)
RETURNS TABLE (
  vcon_id uuid,
  combined_score float,
  semantic_score float,
  keyword_score float
);
```

**Parameters:**
- `keyword_query` - Keyword query (optional)
- `query_embedding` - Embedding vector (optional)
- `tag_filter` - JSON object with tag filters
- `semantic_weight` - Weight for semantic vs keyword (0-1)
- `limit_results` - Maximum results to return

**Returns:**
- `vcon_id` - vCon UUID
- `combined_score` - Weighted combination of scores
- `semantic_score` - Semantic similarity score
- `keyword_score` - Keyword relevance score

---

## Migrations

The database schema is version controlled through migrations:

```
supabase/migrations/
├── 20251007184415_initial_vcon_schema.sql      # Core tables
├── 20251010120000_search_and_embeddings.sql    # Search setup
├── 20251010121000_vcon_tags_mv.sql             # Tag materialized view
├── 20251010121500_update_rpcs_use_tags_mv.sql  # Tag RPC updates
├── 20251010123000_switch_embeddings_to_384.sql # 384-dim embeddings
├── 20251010130000_fix_keyword_rank_type.sql    # Type fixes
├── 20251010140000_embedding_queue_and_trigger.sql # Auto-embedding
├── 20251012150000_exec_sql_rpc.sql             # Utility RPC
├── 20251014000000_fix_search_types.sql         # Search fixes
└── 20251015000000_fix_tags_encoding.sql        # Tag encoding fixes
```

**Apply migrations:**
```bash
npx supabase db push
```

---

## Performance Characteristics

### Table Sizes (estimated)

| Table | Rows per vCon | Storage per Row | Total (10K vCons) |
|-------|---------------|-----------------|-------------------|
| vcons | 1 | ~2 KB | ~20 MB |
| parties | 2-5 | ~1 KB | ~40 MB |
| dialog | 1-10 | ~5 KB | ~250 MB |
| analysis | 0-5 | ~2 KB | ~50 MB |
| attachments | 1-3 | ~10 KB | ~150 MB |
| vcon_embeddings | 5-10 | ~2 KB | ~100 MB |

### Query Performance

| Query Type | Typical Time | Index Used |
|-----------|--------------|------------|
| Get by UUID | ~10ms | B-tree on uuid |
| Search by party | ~50ms | Trigram GIN |
| Keyword search | ~100ms | Full-text + trigram |
| Semantic search | ~200ms | HNSW vector |
| Hybrid search | ~300ms | Combined indexes |
| Tag search | ~50ms | Materialized view |

---

## Best Practices

### Indexing
1. **Use partial indexes** for nullable columns
2. **Create covering indexes** for common queries
3. **Monitor index usage** with `pg_stat_user_indexes`
4. **Drop unused indexes** to save space

### Queries
1. **Filter by date** whenever possible
2. **Use tags** for categorical filtering
3. **Limit results** to avoid large scans
4. **Use prepared statements** for repeated queries

### Maintenance
1. **Vacuum regularly** to reclaim space
2. **Analyze tables** after bulk inserts
3. **Refresh materialized views** nightly
4. **Monitor embedding queue** for backlogs

---

## Next Steps

- See [Tools Reference](./tools.md) for database operations
- See [Types Reference](./types.md) for TypeScript types
- See [Search Guide](/guide/search.md) for query optimization
- See [Database Tools Guide](/guide/database-tools.md) for inspection

