# vCon Database Schema - Visual Reference

**Purpose**: Visual database schema diagram for quick reference.

---

## Complete Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                            VCONS (Parent)                            │
├─────────────────────────────────────────────────────────────────────┤
│ PK  id                    UUID                                       │
│ UK  uuid                  UUID                    NOT NULL           │
│     vcon_version          VARCHAR(10)             NOT NULL '0.3.0'   │
│     subject               TEXT                                       │
│     created_at            TIMESTAMPTZ             NOT NULL NOW()     │
│     updated_at            TIMESTAMPTZ             NOT NULL NOW()     │
│     extensions            TEXT[]                                     │
│     must_support          TEXT[]                                     │
│     redacted              JSONB                   DEFAULT {}         │
│     appended              JSONB                   DEFAULT {}         │
│     group_data            JSONB                   DEFAULT []         │
│     tenant_id             TEXT                    (RLS isolation)    │
│     basename              TEXT                                       │
│     filename              TEXT                                       │
│     done                  BOOLEAN                 DEFAULT false      │
│     corrupt               BOOLEAN                 DEFAULT false      │
│     processed_by          TEXT                                       │
│     privacy_processed     JSONB                   DEFAULT {}         │
│     redaction_rules       JSONB                   DEFAULT {}         │
├─────────────────────────────────────────────────────────────────────┤
│ Indexes:                                                             │
│   - idx_vcons_uuid (uuid)                                            │
│   - idx_vcons_created_at (created_at)                                │
│   - idx_vcons_updated_at (updated_at)                                │
│   - idx_vcons_tenant_id (tenant_id) WHERE tenant_id IS NOT NULL      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┬──────────────────────┐
        │                    │                    │                      │
        ▼                    ▼                    ▼                      ▼
┌───────────────┐    ┌───────────────┐   ┌───────────────┐    ┌──────────────────┐
│   PARTIES     │    │    DIALOG     │   │   ANALYSIS    │    │   ATTACHMENTS    │
├───────────────┤    ├───────────────┤   ├───────────────┤    ├──────────────────┤
│ PK id         │    │ PK id         │   │ PK id         │    │ PK id            │
│ FK vcon_id ───┼───→│ FK vcon_id ───┼──→│ FK vcon_id ───┼───→│ FK vcon_id       │
│    party_index│    │    dialog_idx │   │    analysis_idx│    │    attach_index  │
│    tel        │    │    type       │   │    type       │    │    type          │
│    sip        │    │    start_time │   │    dialog_idx[]│   │    start_time    │
│    stir       │    │    duration_s │   │    mediatype  │    │    party (INT)   │
│    mailto     │    │    parties[]  │   │    filename   │    │    dialog (INT)  │
│    name       │    │    originator │   │    vendor     │    │    mimetype      │
│    did        │    │    mediatype  │   │    product    │    │    filename      │
│    validation │    │    filename   │   │    schema     │    │    body          │
│    jcard      │    │    body       │   │    body       │    │    encoding      │
│    gmlpos     │    │    encoding   │   │    encoding   │    │    url           │
│    civicaddr  │    │    url        │   │    url        │    │    content_hash  │
│    timezone   │    │    content_h  │   │    content_h  │    │    size_bytes    │
│    uuid       │    │    disposition│   │    created_at │    │    metadata      │
│    data_subj  │    │    session_id │   │    confidence │    └──────────────────┘
│    metadata   │    │    application│   │    metadata   │             │
└───────────────┘    │    message_id │   └───────────────┘             │
        │            │    size_bytes │            │                    │
        │            │    metadata   │            │            Special Types:
        │            └───────────────┘            │            ┌───────────────┐
        │                    │                    │            │ type='tags'   │
        │                    │                    │            │ encoding='json'│
        │                    │                    │            │ body: JSON    │
        │                    ▼                    │            │   array of    │
        │            ┌───────────────┐            │            │   "key:value" │
        │            │PARTY_HISTORY  │            │            └───────────────┘
        │            ├───────────────┤            │            ┌───────────────┐
        │            │ PK id         │            │            │ type='tenant' │
        │            │ FK dialog_id  │            │            │ encoding='json'│
        │            │    party_idx  │            │            │ body: JSON    │
        │            │    time       │            │            │   {"id": ...} │
        │            │    event      │            │            └───────────────┘
        │            └───────────────┘            │
        │                                         │
Indexed Fields:                          Indexed Fields:
- name (trgm)                            - type
- mailto (trgm)                          - vendor
- tel (trgm)                             - product
- uuid                                   - schema
- data_subject_id                        - body (trgm)
                                         - dialog_indices (gin)

        │                    │                    │                      │
        └────────────────────┼────────────────────┴──────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │     GROUPS      │
                    ├─────────────────┤
                    │ PK id           │
                    │ FK vcon_id      │
                    │    group_index  │
                    │    uuid         │  (ref to another vCon)
                    │    body         │  (inline vCon JSON)
                    │    encoding     │  (must be 'json')
                    │    url          │  (external vCon URL)
                    │    content_hash │
                    └─────────────────┘


┌───────────────────────────────────────────────────────────────────────────┐
│                    VCON_EMBEDDINGS (Search Vectors)                        │
├───────────────────────────────────────────────────────────────────────────┤
│ PK  id                        UUID                                         │
│ FK  vcon_id ──────────────────→ vcons.id                                   │
│     content_type              TEXT    ('subject', 'dialog', 'analysis')   │
│     content_reference         TEXT    (e.g., 'dialog_0')                  │
│     content_text              TEXT    (original text)                     │
│     embedding                 VECTOR(384)                                 │
│     embedding_model           TEXT    DEFAULT 'text-embedding-3-small'   │
│     embedding_dimension       INTEGER DEFAULT 384                         │
│     created_at                TIMESTAMPTZ                                 │
│     updated_at                TIMESTAMPTZ                                 │
├───────────────────────────────────────────────────────────────────────────┤
│ Unique: (vcon_id, content_type, content_reference)                        │
│ Indexes:                                                                   │
│   - idx_vcon_embeddings_vcon_id (vcon_id)                                 │
│   - idx_vcon_embeddings_type (content_type)                               │
│   - vcon_embeddings_hnsw_cosine (embedding vector_cosine_ops)            │
│     WITH (m = 16, ef_construction = 64)                                   │
└───────────────────────────────────────────────────────────────────────────┘


┌───────────────────────────────────────────────────────────────────────────┐
│               VCON_TAGS_MV (Materialized View for Tags)                   │
├───────────────────────────────────────────────────────────────────────────┤
│     vcon_id                   UUID                                         │
│     vcon_uuid                 UUID                                         │
│     tags_json                 TEXT    (raw JSON array from attachment)    │
│     tags_object               JSONB   (parsed as {"key": "value"})        │
├───────────────────────────────────────────────────────────────────────────┤
│ Source: attachments WHERE type='tags' AND encoding='json'                 │
│ Refresh: Automatic via trigger                                            │
│ Indexes:                                                                   │
│   - idx_vcon_tags_mv_vcon_id (vcon_id)                                    │
│   - idx_vcon_tags_mv_tags_object (tags_object) GIN                        │
└───────────────────────────────────────────────────────────────────────────┘


┌───────────────────────────────────────────────────────────────────────────┐
│                  PRIVACY_REQUESTS (GDPR Compliance)                        │
├───────────────────────────────────────────────────────────────────────────┤
│ PK  id                        UUID                                         │
│ UK  request_id                TEXT                                         │
│     party_identifier          TEXT    (email, phone, etc.)                │
│     party_name                TEXT                                         │
│     request_type              TEXT    (access, rectification, erasure,    │
│                                        portability, restriction, objection)│
│     request_status            TEXT    (pending, in_progress, completed,   │
│                                        rejected, partially_completed)      │
│     request_date              TIMESTAMPTZ                                 │
│     completion_date           TIMESTAMPTZ                                 │
│     verification_method       TEXT                                         │
│     verification_date         TIMESTAMPTZ                                 │
│     request_details           JSONB                                        │
│     processing_notes          TEXT                                         │
│     rejection_reason          TEXT                                         │
│     acknowledgment_sent_date  TIMESTAMPTZ                                 │
│     response_sent_date        TIMESTAMPTZ                                 │
│     response_method           TEXT                                         │
│     processed_by              TEXT                                         │
│     created_at                TIMESTAMPTZ                                 │
│     updated_at                TIMESTAMPTZ                                 │
│     metadata                  JSONB                                        │
└───────────────────────────────────────────────────────────────────────────┘


┌───────────────────────────────────────────────────────────────────────────┐
│              EMBEDDING_QUEUE (Async Processing Queue)                     │
├───────────────────────────────────────────────────────────────────────────┤
│ PK  id                        UUID                                         │
│ FK  vcon_id ──────────────────→ vcons.id                                   │
│     content_type              TEXT                                         │
│     content_reference         TEXT                                         │
│     status                    TEXT    (pending, processing, completed,    │
│                                        failed)                             │
│     error_message             TEXT                                         │
│     created_at                TIMESTAMPTZ                                 │
│     processed_at              TIMESTAMPTZ                                 │
│     retry_count               INTEGER                                     │
├───────────────────────────────────────────────────────────────────────────┤
│ Trigger: Auto-insert after vcon creation                                  │
│ Processed by: Background worker                                           │
└───────────────────────────────────────────────────────────────────────────┘


┌───────────────────────────────────────────────────────────────────────────┐
│               S3_SYNC_TRACKING (External Storage Sync)                    │
├───────────────────────────────────────────────────────────────────────────┤
│ PK  vcon_id ──────────────────→ vcons.id                                   │
│     s3_key                    TEXT    (S3 object key)                     │
│     s3_bucket                 TEXT    (S3 bucket name)                    │
│     last_synced_at            TIMESTAMPTZ                                 │
│     sync_status               TEXT    (pending, synced, failed)           │
│     vcon_updated_at           TIMESTAMPTZ (copy of vcons.updated_at)     │
│     sync_error                TEXT                                         │
│     retry_count               INTEGER                                     │
├───────────────────────────────────────────────────────────────────────────┤
│ Sync Strategy: pg_cron job syncs most recently updated first              │
│ Indexes:                                                                   │
│   - idx_s3_sync_status (sync_status)                                      │
│   - idx_s3_sync_updated (vcon_updated_at DESC)                            │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Table Relationships Summary

### Parent-Child Relationships (ON DELETE CASCADE)

```
vcons (1) ──→ (N) parties
vcons (1) ──→ (N) dialog
vcons (1) ──→ (N) analysis
vcons (1) ──→ (N) attachments
vcons (1) ──→ (N) groups
vcons (1) ──→ (N) vcon_embeddings
vcons (1) ──→ (N) embedding_queue
vcons (1) ──→ (1) s3_sync_tracking

dialog (1) ──→ (N) party_history
```

### Unique Constraints

```
vcons:           (uuid)
parties:         (vcon_id, party_index)
dialog:          (vcon_id, dialog_index)
analysis:        (vcon_id, analysis_index)
attachments:     (vcon_id, attachment_index)
groups:          (vcon_id, group_index)
vcon_embeddings: (vcon_id, content_type, content_reference)
```

---

## Data Type Reference

### Enums (Constrained TEXT)

```sql
-- Dialog type
CHECK (type IN ('recording', 'text', 'transfer', 'incomplete'))

-- Encoding
CHECK (encoding IN ('base64url', 'json', 'none') OR encoding IS NULL)

-- Dialog disposition
CHECK (disposition IN ('no-answer', 'congestion', 'failed', 'busy', 
                       'hung-up', 'voicemail-no-message') OR disposition IS NULL)

-- Party event
CHECK (event IN ('join', 'drop', 'hold', 'unhold', 'mute', 'unmute'))

-- Privacy request type
CHECK (request_type IN ('access', 'rectification', 'erasure', 
                        'portability', 'restriction', 'objection'))

-- Privacy request status
CHECK (request_status IN ('pending', 'in_progress', 'completed', 
                          'rejected', 'partially_completed'))

-- Embedding queue status
CHECK (status IN ('pending', 'processing', 'completed', 'failed'))

-- S3 sync status
CHECK (sync_status IN ('pending', 'synced', 'failed'))
```

### Array Types

```sql
-- Dialog parties
parties INTEGER[]

-- Analysis dialog references
dialog_indices INTEGER[]

-- vCon extensions
extensions TEXT[]

-- vCon must_support
must_support TEXT[]
```

### JSONB Types

```sql
-- vCon metadata
redacted JSONB           -- {"uuid": "...", "type": "..."}
appended JSONB           -- {"uuid": "...", "url": "..."}
group_data JSONB         -- Array of group objects

-- Party metadata
jcard JSONB              -- vCard JSON representation
civicaddress JSONB       -- Civic address object
metadata JSONB           -- Custom metadata

-- Attachment body (when encoding='json')
body TEXT                -- Stored as TEXT, parsed as JSON when needed

-- Tags object (materialized view)
tags_object JSONB        -- {"key1": "value1", "key2": "value2"}

-- Privacy metadata
privacy_processed JSONB
redaction_rules JSONB
request_details JSONB
```

### Vector Type

```sql
-- Embeddings
embedding VECTOR(384)    -- 384-dimensional vector for semantic search
```

---

## Index Strategy Overview

### Primary Indexes (Fast Lookups)

```
vcons:
  - PRIMARY KEY (id)
  - UNIQUE (uuid)
  - INDEX (created_at)
  - INDEX (updated_at)
  - INDEX (tenant_id) WHERE tenant_id IS NOT NULL

All child tables:
  - PRIMARY KEY (id)
  - INDEX (vcon_id)           -- Foreign key joins
  - UNIQUE (vcon_id, *_index) -- Array position
```

### Search Indexes (Full-Text)

```
Trigram Indexes (pg_trgm) for fuzzy matching:
  - parties.name   GIN (gin_trgm_ops)
  - parties.mailto GIN (gin_trgm_ops)
  - parties.tel    GIN (gin_trgm_ops)
  - dialog.body    GIN (gin_trgm_ops)
  - analysis.body  GIN (gin_trgm_ops)
```

### Semantic Search Indexes

```
Vector Indexes (pgvector) for similarity:
  - vcon_embeddings.embedding HNSW (vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
```

### JSONB Indexes

```
GIN Indexes for JSONB containment:
  - vcon_tags_mv.tags_object GIN
```

### Array Indexes

```
GIN Indexes for array containment:
  - analysis.dialog_indices GIN
```

---

## Row Level Security (RLS) Policy Structure

### Tenant Isolation Pattern

```sql
-- Main table policy
CREATE POLICY "vcons_tenant_isolation" ON vcons
  FOR ALL
  USING (
    tenant_id IS NULL OR tenant_id = get_current_tenant_id()
  );

-- Child table policies (check parent)
CREATE POLICY "parties_tenant_isolation" ON parties
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM vcons
      WHERE vcons.id = parties.vcon_id
        AND (vcons.tenant_id IS NULL OR vcons.tenant_id = get_current_tenant_id())
    )
  );

-- Applied to all child tables: parties, dialog, analysis, 
-- attachments, groups, party_history
```

### Tenant Context Functions

```sql
-- Get current tenant from JWT or app settings
get_current_tenant_id() RETURNS TEXT

-- Extract tenant from vCon attachments
extract_tenant_from_attachments(
  p_vcon_id UUID,
  p_attachment_type TEXT DEFAULT 'tenant',
  p_json_path TEXT DEFAULT 'id'
) RETURNS TEXT

-- Populate tenant_id for existing vCons
populate_tenant_ids_batch(
  p_attachment_type TEXT DEFAULT 'tenant',
  p_json_path TEXT DEFAULT 'id',
  p_batch_size INTEGER DEFAULT 1000
) RETURNS TABLE(...)
```

---

## Search RPC Functions

### Available Search Functions

```sql
-- Keyword search (full-text with trigram)
search_vcons_keyword(
  query_text text,
  start_date timestamptz DEFAULT NULL,
  end_date timestamptz DEFAULT NULL,
  tag_filter jsonb DEFAULT '{}',
  max_results int DEFAULT 50
) RETURNS TABLE(vcon_id, doc_type, ref_index, rank, snippet)

-- Semantic search (vector similarity)
search_vcons_semantic(
  query_embedding vector(384),
  tag_filter jsonb DEFAULT '{}',
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 50
) RETURNS TABLE(vcon_id, content_type, content_reference, content_text, similarity)

-- Hybrid search (combined keyword + semantic)
search_vcons_hybrid(
  keyword_query text DEFAULT NULL,
  query_embedding vector(384) DEFAULT NULL,
  tag_filter jsonb DEFAULT '{}',
  semantic_weight float DEFAULT 0.6,
  limit_results int DEFAULT 50
) RETURNS TABLE(vcon_id, combined_score, semantic_score, keyword_score)

-- Tag-based search
search_vcons_by_tags(
  required_tags jsonb,
  max_results int DEFAULT 100
) RETURNS uuid[]
```

---

## Common Query Patterns (SQL)

### Get Complete vCon

```sql
-- Get main vCon
SELECT * FROM vcons WHERE uuid = $1;

-- Get all related data
SELECT 
  v.*,
  (SELECT json_agg(p ORDER BY p.party_index) FROM parties p WHERE p.vcon_id = v.id) as parties,
  (SELECT json_agg(d ORDER BY d.dialog_index) FROM dialog d WHERE d.vcon_id = v.id) as dialog,
  (SELECT json_agg(a ORDER BY a.analysis_index) FROM analysis a WHERE a.vcon_id = v.id) as analysis,
  (SELECT json_agg(at ORDER BY at.attachment_index) FROM attachments at WHERE at.vcon_id = v.id) as attachments
FROM vcons v
WHERE v.uuid = $1;
```

### Search by Date Range

```sql
SELECT * FROM vcons
WHERE created_at >= $1 AND created_at <= $2
ORDER BY created_at DESC
LIMIT 100;
```

### Find vCons by Party

```sql
SELECT DISTINCT v.*
FROM vcons v
JOIN parties p ON p.vcon_id = v.id
WHERE p.mailto = $1 OR p.tel = $2
ORDER BY v.created_at DESC;
```

### Get vCons with Tags

```sql
SELECT v.*
FROM vcons v
JOIN vcon_tags_mv t ON t.vcon_id = v.id
WHERE t.tags_object @> '{"status": "closed", "priority": "high"}';
```

---

## Database Statistics Queries

### vCon Counts

```sql
-- Total vCons
SELECT COUNT(*) FROM vcons;

-- vCons by date range
SELECT 
  DATE_TRUNC('day', created_at) as date,
  COUNT(*) as count
FROM vcons
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY date
ORDER BY date;

-- vCons by tenant
SELECT tenant_id, COUNT(*) as count
FROM vcons
WHERE tenant_id IS NOT NULL
GROUP BY tenant_id
ORDER BY count DESC;
```

### Content Analysis

```sql
-- Analysis types distribution
SELECT type, COUNT(*) as count
FROM analysis
GROUP BY type
ORDER BY count DESC;

-- Dialog types distribution
SELECT type, COUNT(*) as count
FROM dialog
GROUP BY type
ORDER BY count DESC;

-- Top analysis vendors
SELECT vendor, COUNT(*) as count
FROM analysis
GROUP BY vendor
ORDER BY count DESC;
```

### Tag Statistics

```sql
-- Tag key distribution
SELECT 
  jsonb_object_keys(tags_object) as tag_key,
  COUNT(*) as count
FROM vcon_tags_mv
GROUP BY tag_key
ORDER BY count DESC;

-- Tag value distribution for specific key
SELECT 
  tags_object->>'status' as status,
  COUNT(*) as count
FROM vcon_tags_mv
WHERE tags_object ? 'status'
GROUP BY status
ORDER BY count DESC;
```

### Storage Statistics

```sql
-- Table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Embedding coverage
SELECT 
  COUNT(DISTINCT v.id) as total_vcons,
  COUNT(DISTINCT e.vcon_id) as vcons_with_embeddings,
  COUNT(DISTINCT e.vcon_id) * 100.0 / COUNT(DISTINCT v.id) as coverage_percent
FROM vcons v
LEFT JOIN vcon_embeddings e ON e.vcon_id = v.id;
```

---

## Performance Monitoring

### Index Usage

```sql
-- Index usage statistics
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

### Cache Hit Rates

```sql
-- Table cache hit rate
SELECT 
  schemaname,
  tablename,
  heap_blks_hit,
  heap_blks_read,
  CASE 
    WHEN (heap_blks_hit + heap_blks_read) = 0 THEN 0
    ELSE ROUND(heap_blks_hit::numeric / (heap_blks_hit + heap_blks_read), 4) * 100
  END as cache_hit_rate
FROM pg_statio_user_tables
WHERE schemaname = 'public'
ORDER BY cache_hit_rate DESC;
```

### Slow Queries

```sql
-- Query performance monitoring (requires pg_stat_statements extension)
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  max_time
FROM pg_stat_statements
WHERE query LIKE '%vcons%'
ORDER BY mean_time DESC
LIMIT 10;
```

---

## Migration History

The database schema is managed through migrations in `supabase/migrations/`:

1. `20251007184415_initial_vcon_schema.sql` - Core tables and indexes
2. `20251010120000_search_and_embeddings.sql` - Search infrastructure
3. `20251010121000_vcon_tags_mv.sql` - Tags materialized view
4. `20251010123000_switch_embeddings_to_384.sql` - Vector dimension update
5. `20251010140000_embedding_queue_and_trigger.sql` - Async embedding generation
6. `20251110094042_add_tenant_rls_combined.sql` - Multi-tenant RLS
7. `20251110132000_s3_sync_tracking.sql` - External storage sync
8. `20251119132450_pg_cron_setup.sql` - Scheduled jobs
9. Various fixes and optimizations

---

## Summary

This visual reference provides:
- Complete entity relationship diagram
- Table structures with all fields
- Index strategies
- Search RPC functions
- Common query patterns
- Performance monitoring queries

Use this as a quick reference when building applications or debugging database issues.

For detailed explanations, see:
- **DATABASE_ARCHITECTURE_FOR_LLMS.md** - Complete architecture guide
- **DATABASE_QUICKSTART_FOR_LLMS.md** - Practical code examples

