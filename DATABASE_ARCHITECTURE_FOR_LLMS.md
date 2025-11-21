# vCon Database Architecture - Complete Guide for LLMs

**Purpose**: This document describes the complete database architecture for the vCon MCP Server project. It is designed for AI systems and future developers who need to understand how to build applications that interact with this database.

**Last Updated**: November 19, 2025  
**Database**: PostgreSQL (Supabase)  
**Specification Compliance**: IETF draft-ietf-vcon-vcon-core-00

---

## Table of Contents

1. [Overview](#overview)
2. [Core Data Model](#core-data-model)
3. [Database Tables Reference](#database-tables-reference)
4. [Indexes and Performance](#indexes-and-performance)
5. [Search Capabilities](#search-capabilities)
6. [Multi-Tenant Architecture](#multi-tenant-architecture)
7. [Data Relationships](#data-relationships)
8. [Query Patterns](#query-patterns)
9. [Extensions and Features](#extensions-and-features)
10. [Best Practices for Applications](#best-practices-for-applications)

---

## Overview

### What is vCon?

vCon (Virtual Conversation) is an IETF standard for representing conversations in a portable, interoperable format. Think of it as "PDF for conversations" - a standardized container for conversations from any medium (voice, video, text, email), participants, AI analysis, attachments, and privacy markers.

### Database Technology Stack

- **Database**: PostgreSQL 15+ (hosted on Supabase)
- **Vector Extension**: pgvector for semantic search (384-dimensional embeddings)
- **Search Extension**: pg_trgm for trigram-based fuzzy text search
- **Row Level Security (RLS)**: Multi-tenant isolation support
- **Caching Layer**: Optional Redis for 20-50x faster reads

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     vCon Database                            │
├─────────────────────────────────────────────────────────────┤
│  Core Tables:                                                │
│    - vcons (main conversation container)                     │
│    - parties (participants in conversations)                 │
│    - dialog (conversation segments/recordings)               │
│    - analysis (AI/ML processing results)                     │
│    - attachments (files, documents, metadata)                │
│    - groups (vCon aggregation/references)                    │
│    - party_history (party events during conversation)        │
│                                                               │
│  Extension Tables:                                           │
│    - vcon_embeddings (semantic search vectors)               │
│    - vcon_tags_mv (materialized view for tags)               │
│    - privacy_requests (GDPR/privacy compliance)              │
│    - embedding_queue (async embedding generation)            │
│    - s3_sync_tracking (external storage sync)                │
├─────────────────────────────────────────────────────────────┤
│  Search RPCs:                                                │
│    - search_vcons_keyword() - Full-text search               │
│    - search_vcons_semantic() - Vector similarity search      │
│    - search_vcons_hybrid() - Combined keyword + semantic     │
│    - search_vcons_by_tags() - Tag-based filtering            │
├─────────────────────────────────────────────────────────────┤
│  Multi-Tenant Features:                                      │
│    - Row Level Security (RLS) on all tables                  │
│    - Configurable tenant extraction from attachments         │
│    - JWT-based tenant identification                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Data Model

### The vCon Object Structure (IETF Compliant)

Every vCon is a structured conversation object following the IETF specification. Here is the canonical structure:

```typescript
{
  vcon: "0.3.0",                    // Version string (current spec version)
  uuid: "550e8400-e29b-41d4-a716-...", // Unique identifier
  created_at: "2025-01-01T12:00:00Z",  // ISO 8601 timestamp
  updated_at: "2025-01-01T13:00:00Z",  // ISO 8601 timestamp
  subject: "Customer Support Call",     // Optional subject/title
  
  // Optional extension fields
  extensions: ["privacy", "consent"],   // Extension identifiers
  must_support: ["redaction"],          // Required extensions
  
  // Privacy and versioning
  redacted: { uuid: "...", type: "..." },  // Redaction info
  appended: { uuid: "..." },               // Appended vCon reference
  
  // Core arrays (normalized into separate tables)
  parties: [...],      // Array of Party objects
  dialog: [...],       // Array of Dialog objects
  analysis: [...],     // Array of Analysis objects
  attachments: [...],  // Array of Attachment objects
  group: [...]         // Array of Group objects (aggregated vCons)
}
```

### Data Normalization Strategy

The vCon JSON structure is **normalized** into PostgreSQL tables for efficient querying:

- **vcons table**: Top-level metadata (uuid, subject, timestamps, extensions)
- **Child tables**: Arrays are broken out (parties, dialog, analysis, attachments, groups)
- **Indexes**: Strategic indexes on UUIDs, foreign keys, timestamps, and search fields
- **JSONB fields**: Complex nested data preserved as JSONB (redacted, appended, metadata)

This normalization allows:
- Fast searching across all conversations
- Efficient filtering by participant, date, content type
- Join queries across related entities
- Tag-based filtering via attachments

---

## Database Tables Reference

### Table 1: `vcons` - Main Container Table

**Purpose**: Stores top-level vCon metadata and serves as the parent for all related tables.

**Key Fields**:

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | UUID | Yes | Internal primary key (auto-generated) |
| `uuid` | UUID | Yes | vCon UUID from original document (unique) |
| `vcon_version` | VARCHAR(10) | Yes | Version string, default '0.3.0' |
| `subject` | TEXT | No | Conversation subject/title |
| `created_at` | TIMESTAMPTZ | Yes | Creation timestamp (ISO 8601) |
| `updated_at` | TIMESTAMPTZ | Yes | Last update timestamp |
| `extensions` | TEXT[] | No | Array of extension identifiers |
| `must_support` | TEXT[] | No | Required extension support |
| `redacted` | JSONB | No | Redaction metadata object |
| `appended` | JSONB | No | Appended vCon reference |
| `group_data` | JSONB | No | Group metadata (if applicable) |
| `tenant_id` | TEXT | No | Tenant identifier for RLS isolation |

**Extension Fields** (not in IETF spec):
- `basename`, `filename`, `done`, `corrupt`, `processed_by` - Processing metadata
- `privacy_processed`, `redaction_rules` - Privacy compliance tracking

**Relationships**:
- Parent to: `parties`, `dialog`, `analysis`, `attachments`, `groups`, `vcon_embeddings`

**Indexes**:
- `idx_vcons_uuid` - Fast UUID lookups
- `idx_vcons_created_at` - Date range queries
- `idx_vcons_tenant_id` - Multi-tenant filtering (RLS)

---

### Table 2: `parties` - Conversation Participants

**Purpose**: Stores information about people/entities involved in the conversation.

**Key Fields**:

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | UUID | Yes | Internal primary key |
| `vcon_id` | UUID | Yes | Foreign key to vcons.id |
| `party_index` | INTEGER | Yes | Index in original parties array |
| `tel` | TEXT | No | Phone number |
| `sip` | TEXT | No | SIP URI |
| `stir` | TEXT | No | STIR token |
| `mailto` | TEXT | No | Email address |
| `name` | TEXT | No | Display name |
| `did` | TEXT | No | Decentralized Identifier (DID) |
| `uuid` | UUID | No | Party UUID (IETF spec Section 4.2.12) |
| `validation` | TEXT | No | Validation status |
| `jcard` | JSONB | No | vCard JSON representation |
| `gmlpos` | TEXT | No | GML position data |
| `civicaddress` | JSONB | No | Civic address object |
| `timezone` | TEXT | No | Party timezone |

**Extension Fields**:
- `data_subject_id` - Consistent identifier for privacy requests across vCons

**Unique Constraint**: `(vcon_id, party_index)` - Ensures one entry per party per vCon

**Indexes**:
- `idx_parties_vcon` - Join to vcons table
- `idx_parties_tel`, `idx_parties_email`, `idx_parties_name` - Search by contact info
- `idx_parties_name_trgm`, `idx_parties_mail_trgm`, `idx_parties_tel_trgm` - Fuzzy search
- `idx_parties_uuid` - UUID lookups

---

### Table 3: `dialog` - Conversation Segments

**Purpose**: Stores conversation segments (recordings, text messages, transcripts, transfers).

**Key Fields**:

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | UUID | Yes | Internal primary key |
| `vcon_id` | UUID | Yes | Foreign key to vcons.id |
| `dialog_index` | INTEGER | Yes | Index in original dialog array |
| `type` | TEXT | Yes | 'recording', 'text', 'transfer', 'incomplete' |
| `start_time` | TIMESTAMPTZ | No | Segment start time |
| `duration_seconds` | REAL | No | Duration in seconds |
| `parties` | INTEGER[] | No | Array of party indexes involved |
| `originator` | INTEGER | No | Index of originating party |
| `mediatype` | TEXT | No | MIME type (e.g., 'audio/wav', 'text/plain') |
| `filename` | TEXT | No | Original filename |
| `body` | TEXT | No | Text content or encoded binary |
| `encoding` | TEXT | No | 'base64url', 'json', or 'none' |
| `url` | TEXT | No | External URL for content |
| `content_hash` | TEXT | No | Content integrity hash |
| `disposition` | TEXT | No | Call disposition (for telephony) |
| `session_id` | TEXT | No | Session identifier (IETF Section 4.3.10) |
| `application` | TEXT | No | Application identifier (IETF Section 4.3.13) |
| `message_id` | TEXT | No | Message identifier (IETF Section 4.3.14) |

**Type Constraint**: `type IN ('recording', 'text', 'transfer', 'incomplete')`

**Encoding Constraint**: `encoding IN ('base64url', 'json', 'none')` or NULL

**Disposition Constraint**: One of 'no-answer', 'congestion', 'failed', 'busy', 'hung-up', 'voicemail-no-message' or NULL

**Unique Constraint**: `(vcon_id, dialog_index)`

**Indexes**:
- `idx_dialog_vcon` - Join to vcons table
- `idx_dialog_type` - Filter by dialog type
- `idx_dialog_start` - Time-based queries
- `idx_dialog_session` - Session lookups
- `idx_dialog_body_trgm` - Full-text search on dialog content

---

### Table 4: `analysis` - AI/ML Processing Results

**Purpose**: Stores AI/ML analysis results (transcripts, summaries, sentiment, translations, etc.).

**Key Fields**:

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | UUID | Yes | Internal primary key |
| `vcon_id` | UUID | Yes | Foreign key to vcons.id |
| `analysis_index` | INTEGER | Yes | Index in original analysis array |
| `type` | TEXT | Yes | Analysis type (e.g., 'summary', 'transcript', 'sentiment') |
| `dialog_indices` | INTEGER[] | No | Array of dialog indexes analyzed |
| `mediatype` | TEXT | No | MIME type of result |
| `filename` | TEXT | No | Filename if applicable |
| `vendor` | TEXT | Yes | **REQUIRED** - AI vendor (e.g., 'OpenAI', 'AWS') |
| `product` | TEXT | No | Product/model name (e.g., 'Whisper-1', 'GPT-4') |
| `schema` | TEXT | No | Schema version (IETF Section 4.5.7) **NOT** 'schema_version' |
| `body` | TEXT | No | Analysis content (string, not JSONB) |
| `encoding` | TEXT | No | 'base64url', 'json', or 'none' |
| `url` | TEXT | No | External URL for analysis |
| `content_hash` | TEXT | No | Content integrity hash |

**Critical Field Name Corrections** (common mistakes):
- Field is `schema`, NOT `schema_version`
- `vendor` is **REQUIRED** (no `?` in TypeScript)
- `body` is TEXT type (string), not JSONB

**Unique Constraint**: `(vcon_id, analysis_index)`

**Indexes**:
- `idx_analysis_vcon` - Join to vcons table
- `idx_analysis_type` - Filter by analysis type
- `idx_analysis_vendor` - Filter by vendor
- `idx_analysis_dialog` - GIN index on dialog_indices array
- `idx_analysis_body_trgm` - Full-text search on analysis content

---

### Table 5: `attachments` - Files and Metadata

**Purpose**: Stores attachments, files, documents, and special metadata (like tags, tenant info).

**Key Fields**:

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | UUID | Yes | Internal primary key |
| `vcon_id` | UUID | Yes | Foreign key to vcons.id |
| `attachment_index` | INTEGER | Yes | Index in original attachments array |
| `type` | TEXT | No | Attachment type (e.g., 'invoice', 'tags', 'tenant') |
| `start_time` | TIMESTAMPTZ | No | Timestamp of attachment |
| `party` | INTEGER | No | Associated party index |
| `dialog` | INTEGER | No | Associated dialog index (IETF Section 4.4.4) |
| `mimetype` | TEXT | No | MIME type |
| `filename` | TEXT | No | Original filename |
| `body` | TEXT | No | Attachment content or encoded data |
| `encoding` | TEXT | No | 'base64url', 'json', or 'none' |
| `url` | TEXT | No | External URL |
| `content_hash` | TEXT | No | Content integrity hash |

**Special Attachment Types**:

1. **Tags** (`type='tags'`, `encoding='json'`):
   - Format: JSON array of "key:value" strings
   - Example: `["status:closed", "sentiment:positive", "priority:high"]`
   - Used for filtering searches

2. **Tenant** (`type='tenant'`, `encoding='json'`):
   - Format: JSON object with tenant identifier
   - Example: `{"id": "acme-corp", "name": "Acme Corporation"}`
   - Used for multi-tenant RLS isolation

**Unique Constraint**: `(vcon_id, attachment_index)`

**Indexes**:
- `idx_attachments_vcon` - Join to vcons table
- `idx_attachments_type` - Filter by attachment type
- `idx_attachments_party` - Filter by party
- `idx_attachments_dialog` - Filter by dialog

---

### Table 6: `groups` - vCon Aggregation

**Purpose**: References to other vCons for aggregation/grouping.

**Key Fields**:

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | UUID | Yes | Internal primary key |
| `vcon_id` | UUID | Yes | Foreign key to vcons.id (parent) |
| `group_index` | INTEGER | Yes | Index in original group array |
| `uuid` | UUID | No | Referenced vCon UUID |
| `body` | TEXT | No | Inline vCon content (JSON) |
| `encoding` | TEXT | No | Must be 'json' per spec |
| `url` | TEXT | No | External URL to referenced vCon |
| `content_hash` | TEXT | No | Content integrity hash |

**Unique Constraint**: `(vcon_id, group_index)`

**Indexes**:
- `idx_groups_vcon` - Join to vcons table
- `idx_groups_uuid` - Lookup referenced vCons

---

### Table 7: `party_history` - Party Events

**Purpose**: Tracks party events during a conversation (join, drop, hold, mute, etc.).

**Key Fields**:

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | UUID | Yes | Internal primary key |
| `dialog_id` | UUID | Yes | Foreign key to dialog.id |
| `party_index` | INTEGER | Yes | Party index in vCon |
| `time` | TIMESTAMPTZ | Yes | Event timestamp |
| `event` | TEXT | Yes | Event type |

**Event Types**: 'join', 'drop', 'hold', 'unhold', 'mute', 'unmute'

**Relationships**:
- Child of `dialog` table

---

### Table 8: `vcon_embeddings` - Semantic Search Vectors

**Purpose**: Stores vector embeddings for semantic search using pgvector.

**Key Fields**:

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| `id` | UUID | Yes | Internal primary key |
| `vcon_id` | UUID | Yes | Foreign key to vcons.id |
| `content_type` | TEXT | Yes | 'subject', 'dialog', or 'analysis' |
| `content_reference` | TEXT | No | Index reference (e.g., 'dialog_0') |
| `content_text` | TEXT | Yes | Original text that was embedded |
| `embedding` | VECTOR(384) | Yes | 384-dimensional vector |
| `embedding_model` | TEXT | Yes | Model used (default 'text-embedding-3-small') |
| `embedding_dimension` | INTEGER | Yes | Dimension count (384) |
| `created_at` | TIMESTAMPTZ | Yes | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Yes | Last update timestamp |

**Vector Configuration**:
- **Dimension**: 384 (optimized for OpenAI text-embedding-3-small)
- **Index Type**: HNSW (Hierarchical Navigable Small World)
- **Distance Metric**: Cosine similarity
- **Index Parameters**: m=16, ef_construction=64

**Unique Constraint**: `(vcon_id, content_type, content_reference)`

**Indexes**:
- `idx_vcon_embeddings_vcon_id` - Join to vcons
- `idx_vcon_embeddings_type` - Filter by content type
- `vcon_embeddings_hnsw_cosine` - HNSW index for vector search

**Migration Note**: The system was migrated from 1536 to 384 dimensions for better performance.

---

### Table 9: `vcon_tags_mv` - Materialized View for Tags

**Purpose**: Pre-computed materialized view that extracts tags from attachments for fast filtering.

**Structure**:
```sql
CREATE MATERIALIZED VIEW vcon_tags_mv AS
SELECT 
  v.id as vcon_id,
  v.uuid as vcon_uuid,
  a.body as tags_json,
  jsonb_object_agg(key, value) as tags_object
FROM vcons v
JOIN attachments a ON a.vcon_id = v.id
WHERE a.type = 'tags' AND a.encoding = 'json'
GROUP BY v.id, v.uuid, a.body;
```

**Refresh**: Automatically refreshed via triggers on attachments table

**Indexes**:
- `idx_vcon_tags_mv_vcon_id` - Fast vCon lookups
- `idx_vcon_tags_mv_tags_object` - GIN index for JSONB tag queries

---

### Table 10: `privacy_requests` - GDPR/Privacy Compliance

**Purpose**: Tracks privacy requests (access, erasure, rectification) for GDPR compliance.

**Key Fields**:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `request_id` | TEXT | Unique request identifier |
| `party_identifier` | TEXT | Party's identifier (email, phone, etc.) |
| `request_type` | TEXT | 'access', 'rectification', 'erasure', 'portability', 'restriction', 'objection' |
| `request_status` | TEXT | 'pending', 'in_progress', 'completed', 'rejected', 'partially_completed' |
| `request_date` | TIMESTAMPTZ | When request was made |
| `completion_date` | TIMESTAMPTZ | When request was completed |
| `verification_method` | TEXT | How identity was verified |
| `request_details` | JSONB | Additional request metadata |
| `processing_notes` | TEXT | Internal notes |

---

### Table 11: `embedding_queue` - Async Embedding Generation

**Purpose**: Queue for generating embeddings asynchronously (triggered after vCon creation).

**Key Fields**:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `vcon_id` | UUID | Foreign key to vcons.id |
| `content_type` | TEXT | Type of content to embed |
| `content_reference` | TEXT | Reference to specific content |
| `status` | TEXT | 'pending', 'processing', 'completed', 'failed' |
| `created_at` | TIMESTAMPTZ | Queue entry creation |
| `processed_at` | TIMESTAMPTZ | When processed |

---

### Table 12: `s3_sync_tracking` - External Storage Sync

**Purpose**: Tracks synchronization of vCons to external S3-compatible storage.

**Key Fields**:

| Column | Type | Description |
|--------|------|-------------|
| `vcon_id` | UUID | Foreign key to vcons.id |
| `s3_key` | TEXT | S3 object key |
| `last_synced_at` | TIMESTAMPTZ | Last successful sync |
| `sync_status` | TEXT | 'pending', 'synced', 'failed' |
| `updated_at` | TIMESTAMPTZ | vCon last update time |

**Sync Strategy**: Periodic pg_cron job syncs most recently updated vCons first

---

## Indexes and Performance

### Index Strategy

The database uses 25+ strategic indexes for optimal query performance:

**Primary Lookup Indexes**:
- UUID lookups on all tables
- Foreign key indexes for joins
- Created/updated timestamp indexes for date filtering

**Search Indexes**:
- **GIN Trigram Indexes** (`pg_trgm`): Fuzzy text search on parties, dialog, analysis
- **GIN JSONB Indexes**: Fast JSONB containment queries on tags
- **GIN Array Indexes**: Fast array containment on dialog_indices
- **HNSW Vector Index**: Approximate nearest neighbor search for semantic queries

**Multi-Tenant Indexes**:
- `idx_vcons_tenant_id` - Fast RLS filtering

### Query Performance Guidelines

**Fast Queries** (< 50ms):
- UUID lookups
- Foreign key joins
- Date range filters with proper indexes
- Tag filtering via materialized view

**Medium Queries** (50-500ms):
- Full-text keyword search (trigram)
- Semantic search (vector similarity, < 1M embeddings)
- Hybrid search (combined keyword + semantic)

**Slow Queries** (> 500ms):
- Large result sets without limits
- Complex multi-table aggregations without indexes
- Semantic search with very large embedding tables

**Optimization Tips**:
1. Always use `LIMIT` on searches
2. Filter by date ranges to reduce search space
3. Use materialized view for tag queries
4. Consider Redis caching for frequently accessed vCons
5. Use appropriate search type (keyword vs semantic vs hybrid)

---

## Search Capabilities

The database provides four search methods via PostgreSQL RPC functions:

### 1. Keyword Search (`search_vcons_keyword`)

**Purpose**: Full-text search with trigram matching for typo tolerance.

**Searches**:
- vCon subjects
- Party names, emails, phone numbers
- Dialog text content
- Analysis text content

**Parameters**:
```sql
search_vcons_keyword(
  query_text text,                    -- Search query
  start_date timestamptz DEFAULT NULL, -- Optional date filter
  end_date timestamptz DEFAULT NULL,   -- Optional date filter
  tag_filter jsonb DEFAULT '{}',       -- Optional tag filter
  max_results int DEFAULT 50           -- Result limit
)
```

**Returns**:
```typescript
{
  vcon_id: UUID,
  doc_type: string,      // 'subject', 'party', 'dialog', 'analysis'
  ref_index: number,     // Index in array (if applicable)
  rank: number,          // Relevance score
  snippet: string        // Highlighted snippet
}
```

**Use Cases**:
- Exact phrase matching
- Finding specific terms/keywords
- Searching by contact information
- Typo-tolerant search

---

### 2. Semantic Search (`search_vcons_semantic`)

**Purpose**: AI-powered similarity search using vector embeddings.

**Searches**: Meaning and context, not exact words.

**Parameters**:
```sql
search_vcons_semantic(
  query_embedding vector(384),         -- Query vector
  tag_filter jsonb DEFAULT '{}',       -- Optional tag filter
  match_threshold float DEFAULT 0.7,   -- Similarity threshold (0-1)
  match_count int DEFAULT 50           -- Result limit
)
```

**Returns**:
```typescript
{
  vcon_id: UUID,
  content_type: string,     // 'subject', 'dialog', 'analysis'
  content_reference: string, // Reference to specific content
  content_text: string,      // Original text
  similarity: number         // Similarity score (0-1)
}
```

**Use Cases**:
- Conceptual search ("frustrated customers")
- Finding similar conversations
- Topic-based retrieval
- Multilingual search (if embeddings support it)

**Note**: Requires embeddings to be generated first (async process).

---

### 3. Hybrid Search (`search_vcons_hybrid`)

**Purpose**: Combines keyword and semantic search with weighted scoring.

**Parameters**:
```sql
search_vcons_hybrid(
  keyword_query text DEFAULT NULL,     -- Optional keyword query
  query_embedding vector(384) DEFAULT NULL, -- Optional vector query
  tag_filter jsonb DEFAULT '{}',       -- Optional tag filter
  semantic_weight float DEFAULT 0.6,   -- Weight for semantic (0-1)
  limit_results int DEFAULT 50         -- Result limit
)
```

**Returns**:
```typescript
{
  vcon_id: UUID,
  combined_score: number,    // Weighted total score
  semantic_score: number,    // Semantic component
  keyword_score: number      // Keyword component
}
```

**Scoring Formula**:
```
combined_score = (semantic_score * semantic_weight) + 
                 (keyword_score * (1 - semantic_weight))
```

**Use Cases**:
- Best overall search results
- Balancing precision (keyword) and recall (semantic)
- Complex queries with multiple aspects

---

### 4. Tag Search (`search_vcons_by_tags`)

**Purpose**: Filter vCons by exact tag key-value pairs.

**Parameters**:
```sql
search_vcons_by_tags(
  required_tags jsonb,                 -- Tags that must match
  max_results int DEFAULT 100          -- Result limit
)
```

**Tag Format**:
- Stored as JSON array in attachments: `["key1:value1", "key2:value2"]`
- Queried as JSON object: `{"key1": "value1", "key2": "value2"}`

**Returns**: Array of vCon UUIDs

**Use Cases**:
- Filtering by status, priority, category
- Finding conversations with specific attributes
- Pre-filtering before other search types

---

## Multi-Tenant Architecture

The database supports **Row Level Security (RLS)** for multi-tenant data isolation.

### How Tenant Isolation Works

1. **Tenant Identification**:
   - Tenant ID extracted from vCon attachments (`type='tenant'`)
   - Stored in `vcons.tenant_id` column
   - Configurable extraction path (default: `body->>'id'`)

2. **Tenant Context**:
   - Retrieved from JWT claims (`request.jwt.claims->>'tenant_id'`)
   - Or set via application setting (`app.current_tenant_id`)
   - Helper function: `get_current_tenant_id()`

3. **RLS Policies**:
   - Applied to all core tables (vcons, parties, dialog, analysis, attachments, groups)
   - Users only see data where `tenant_id` matches current tenant
   - NULL tenant_id = accessible to all tenants

### Enabling Multi-Tenancy

**Step 1**: Add tenant attachment to vCons:
```json
{
  "type": "tenant",
  "encoding": "json",
  "body": "{\"id\": \"acme-corp\", \"name\": \"Acme Corporation\"}"
}
```

**Step 2**: Populate tenant_id column:
```sql
-- Process all vCons in batch
SELECT * FROM populate_tenant_ids_batch('tenant', 'id', 1000);
```

**Step 3**: Set tenant context in application:
```typescript
// Using Supabase client with JWT
const { data, error } = await supabase
  .rpc('set_config', {
    setting: 'app.current_tenant_id',
    value: 'acme-corp',
    is_local: true
  });
```

### Custom Tenant Configuration

Default configuration can be changed:

**Attachment Type**: Change from 'tenant' to custom type:
```sql
SELECT * FROM populate_tenant_ids_batch('organization', 'id', 1000);
```

**JSON Path**: Change from 'id' to nested path:
```sql
-- Extract from nested JSON: {"org": {"tenant_id": "acme-corp"}}
SELECT * FROM populate_tenant_ids_batch('tenant', 'org.tenant_id', 1000);
```

### RLS Policy Structure

```sql
-- Example RLS policy on vcons table
CREATE POLICY "vcons_tenant_isolation" ON vcons
  FOR ALL
  USING (
    tenant_id IS NULL OR tenant_id = get_current_tenant_id()
  );
```

**Policy Behavior**:
- If `tenant_id IS NULL`: Row visible to all tenants
- If `tenant_id` matches current tenant: Row visible
- Otherwise: Row hidden

---

## Data Relationships

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         vcons (parent)                       │
│  id (PK), uuid (unique), subject, tenant_id, extensions     │
└──────────────────────┬──────────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┬───────────────┬──────────────┐
       │               │               │               │              │
       ▼               ▼               ▼               ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│   parties   │ │   dialog    │ │  analysis   │ │ attachments │ │   groups    │
│ vcon_id (FK)│ │ vcon_id (FK)│ │ vcon_id (FK)│ │ vcon_id (FK)│ │ vcon_id (FK)│
│party_index  │ │dialog_index │ │analysis_idx │ │attach_index │ │group_index  │
└─────────────┘ └──────┬──────┘ └─────────────┘ └─────────────┘ └─────────────┘
                       │
                       ▼
                ┌─────────────────┐
                │  party_history  │
                │  dialog_id (FK) │
                │  party_index    │
                └─────────────────┘

           ┌────────────────────────┐
           │   vcon_embeddings      │
           │   vcon_id (FK)         │
           │   embedding vector(384)│
           └────────────────────────┘
```

### Foreign Key Constraints

All child tables have `ON DELETE CASCADE`:
- When a vCon is deleted, all related data is automatically removed
- Ensures referential integrity
- Prevents orphaned records

### Join Patterns

**Get Complete vCon**:
```sql
SELECT 
  v.*,
  json_agg(DISTINCT p.*) as parties,
  json_agg(DISTINCT d.*) as dialog,
  json_agg(DISTINCT a.*) as analysis,
  json_agg(DISTINCT at.*) as attachments
FROM vcons v
LEFT JOIN parties p ON p.vcon_id = v.id
LEFT JOIN dialog d ON d.vcon_id = v.id
LEFT JOIN analysis a ON a.vcon_id = v.id
LEFT JOIN attachments at ON at.vcon_id = v.id
WHERE v.uuid = '...'
GROUP BY v.id;
```

**Get vCons by Party**:
```sql
SELECT DISTINCT v.*
FROM vcons v
JOIN parties p ON p.vcon_id = v.id
WHERE p.mailto = 'user@example.com';
```

**Get vCons with Specific Tags**:
```sql
SELECT v.*
FROM vcons v
JOIN vcon_tags_mv tags ON tags.vcon_id = v.id
WHERE tags.tags_object @> '{"status": "closed"}';
```

---

## Query Patterns

### Common Application Queries

#### 1. Create a Complete vCon

```sql
-- Insert vCon
INSERT INTO vcons (uuid, vcon_version, subject, created_at, updated_at, tenant_id)
VALUES ($1, '0.3.0', $2, NOW(), NOW(), $3)
RETURNING id, uuid;

-- Insert parties
INSERT INTO parties (vcon_id, party_index, name, mailto, tel)
VALUES 
  ($1, 0, 'Alice', 'alice@example.com', NULL),
  ($1, 1, 'Bob', 'bob@example.com', '+1-555-0100');

-- Insert dialog
INSERT INTO dialog (vcon_id, dialog_index, type, body, encoding, parties)
VALUES ($1, 0, 'text', 'Hello, how can I help?', 'none', ARRAY[0, 1]);

-- Insert analysis
INSERT INTO analysis (vcon_id, analysis_index, type, vendor, body, encoding)
VALUES ($1, 0, 'summary', 'OpenAI', 'Positive customer interaction...', 'none');

-- Insert tags as attachment
INSERT INTO attachments (vcon_id, attachment_index, type, encoding, body)
VALUES ($1, 0, 'tags', 'json', '["status:open", "priority:high"]');
```

#### 2. Get vCon by UUID

```sql
-- Main vCon
SELECT * FROM vcons WHERE uuid = $1;

-- Parties
SELECT * FROM parties WHERE vcon_id = (SELECT id FROM vcons WHERE uuid = $1)
ORDER BY party_index;

-- Dialog
SELECT * FROM dialog WHERE vcon_id = (SELECT id FROM vcons WHERE uuid = $1)
ORDER BY dialog_index;

-- Analysis
SELECT * FROM analysis WHERE vcon_id = (SELECT id FROM vcons WHERE uuid = $1)
ORDER BY analysis_index;

-- Attachments
SELECT * FROM attachments WHERE vcon_id = (SELECT id FROM vcons WHERE uuid = $1)
ORDER BY attachment_index;
```

#### 3. Search by Date Range and Subject

```sql
SELECT * FROM vcons
WHERE created_at >= $1 
  AND created_at <= $2
  AND subject ILIKE '%' || $3 || '%'
ORDER BY created_at DESC
LIMIT 50;
```

#### 4. Find vCons by Party Contact Info

```sql
SELECT DISTINCT v.*
FROM vcons v
JOIN parties p ON p.vcon_id = v.id
WHERE p.mailto = $1 OR p.tel = $2
ORDER BY v.created_at DESC;
```

#### 5. Get vCons with Specific Analysis Type

```sql
SELECT DISTINCT v.*, a.type as analysis_type, a.vendor
FROM vcons v
JOIN analysis a ON a.vcon_id = v.id
WHERE a.type = 'transcript'
ORDER BY v.created_at DESC;
```

#### 6. Full-Text Keyword Search

```sql
SELECT * FROM search_vcons_keyword(
  'refund request',           -- search query
  '2025-01-01'::timestamptz,  -- start date
  '2025-12-31'::timestamptz,  -- end date
  '{"status": "closed"}'::jsonb, -- tag filter
  50                          -- max results
);
```

#### 7. Semantic Search

```sql
-- Assume query_vector is generated by your embedding service
SELECT * FROM search_vcons_semantic(
  $1::vector(384),            -- query embedding
  '{}'::jsonb,                -- no tag filter
  0.75,                       -- similarity threshold
  20                          -- max results
);
```

#### 8. Get Tags for a vCon

```sql
-- Direct query on attachments
SELECT body
FROM attachments
WHERE vcon_id = (SELECT id FROM vcons WHERE uuid = $1)
  AND type = 'tags'
  AND encoding = 'json';

-- Using materialized view
SELECT tags_object
FROM vcon_tags_mv
WHERE vcon_uuid = $1;
```

#### 9. Update vCon Metadata

```sql
UPDATE vcons
SET 
  subject = $2,
  updated_at = NOW(),
  extensions = $3,
  must_support = $4
WHERE uuid = $1;
```

#### 10. Delete vCon and All Related Data

```sql
-- Cascading delete removes all child records automatically
DELETE FROM vcons WHERE uuid = $1;
```

#### 11. Get Database Analytics

```sql
-- vCon count
SELECT COUNT(*) as total_vcons FROM vcons;

-- vCons by date range
SELECT DATE_TRUNC('day', created_at) as date, COUNT(*) as count
FROM vcons
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY date
ORDER BY date;

-- Top analysis vendors
SELECT vendor, COUNT(*) as count
FROM analysis
GROUP BY vendor
ORDER BY count DESC
LIMIT 10;

-- Tag distribution
SELECT jsonb_object_keys(tags_object) as tag_key, COUNT(*) as count
FROM vcon_tags_mv
GROUP BY tag_key
ORDER BY count DESC;
```

---

## Extensions and Features

### 1. Embedding Generation (Async)

**Trigger**: Automatically queues embedding generation after vCon creation.

**Process**:
1. vCon created → triggers insert into `embedding_queue`
2. Background worker picks up queue entries
3. Generates embeddings for subject, dialog, analysis
4. Stores embeddings in `vcon_embeddings` table
5. Updates queue status to 'completed'

**Embedding Sources**:
- vCon subject
- Dialog body (if encoding='none' or 'json')
- Analysis body (if encoding='none' or 'json')

**Model**: Default is OpenAI `text-embedding-3-small` (384 dimensions)

### 2. Materialized View Refresh

**Tags Materialized View** (`vcon_tags_mv`):
- Automatically refreshes via trigger on attachments table
- Keeps tag index up-to-date
- Provides fast tag-based filtering

**Manual Refresh**:
```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY vcon_tags_mv;
```

### 3. S3 Sync (Optional)

**Purpose**: Backup vCons to external S3-compatible storage.

**Mechanism**:
- pg_cron job runs periodically
- Syncs most recently updated vCons first
- Tracks sync status in `s3_sync_tracking` table

**Configuration**: See `setup-pg-cron-guide.md` for setup instructions.

### 4. Privacy Extensions (GDPR Compliance)

**Privacy Requests Table**:
- Tracks access, erasure, rectification requests
- Linked to parties via `party_identifier`
- Status tracking through lifecycle

**Redaction Support**:
- `vcons.redacted` field stores redaction metadata
- Custom redaction rules in `vcons.redaction_rules`
- Privacy processing state in `vcons.privacy_processed`

### 5. Redis Caching (Optional)

**Performance Boost**: 20-50x faster reads for frequently accessed vCons.

**Cache Strategy**:
- Cache-first reads: Check Redis → fallback to Supabase
- Write-through: Update both Redis and Supabase
- TTL: Configurable (default 1 hour)

**Cache Keys**:
- `vcon:{uuid}` - Complete vCon JSON
- Auto-invalidation on updates/deletes

**Setup**: Set `REDIS_URL` environment variable.

---

## Best Practices for Applications

### 1. Always Use Parameterized Queries

**Bad**:
```sql
SELECT * FROM vcons WHERE uuid = '${userInput}';  -- SQL injection risk
```

**Good**:
```sql
SELECT * FROM vcons WHERE uuid = $1;  -- Parameterized
```

### 2. Use Appropriate Indexes

- Filter by `created_at` with date range for time-based queries
- Use `uuid` for lookups (indexed)
- Filter by `tenant_id` for multi-tenant apps (indexed)
- Use search RPCs for full-text and semantic search

### 3. Limit Result Sets

Always use `LIMIT` to prevent memory issues:
```sql
SELECT * FROM vcons ORDER BY created_at DESC LIMIT 100;
```

### 4. Handle Tenant Context

For multi-tenant apps:
```typescript
// Set tenant context before queries
await supabase.rpc('set_config', {
  setting: 'app.current_tenant_id',
  value: currentTenant,
  is_local: true
});

// Now all queries respect RLS
const { data } = await supabase.from('vcons').select('*');
```

### 5. Use Transactions for Multi-Table Inserts

When creating a vCon with multiple child records:
```sql
BEGIN;
  -- Insert vCon
  INSERT INTO vcons (...) RETURNING id;
  -- Insert parties
  INSERT INTO parties (...);
  -- Insert dialog
  INSERT INTO dialog (...);
COMMIT;
```

### 6. Choose the Right Search Type

| Use Case | Search Type |
|----------|-------------|
| Exact phrases, specific terms | `search_vcons_keyword` |
| Conceptual/meaning-based | `search_vcons_semantic` |
| Best overall results | `search_vcons_hybrid` |
| Filter by tags first | `search_vcons_by_tags` → then search |

### 7. Generate Embeddings Asynchronously

Don't block vCon creation waiting for embeddings:
1. Insert vCon → triggers queue entry
2. Return success to user immediately
3. Background worker generates embeddings
4. Semantic search available once embeddings complete

### 8. Cache Frequently Accessed vCons

Use Redis for:
- vCons accessed multiple times
- Dashboard queries
- Recently viewed conversations

### 9. Monitor Query Performance

Use `EXPLAIN ANALYZE` to understand query plans:
```sql
EXPLAIN ANALYZE
SELECT * FROM search_vcons_keyword('billing', NULL, NULL, '{}', 50);
```

### 10. Respect IETF Spec Field Names

Common mistakes to avoid:
- Use `analysis.schema`, NOT `schema_version`
- `analysis.vendor` is REQUIRED (always provide)
- `analysis.body` is TEXT, not JSONB
- `parties.uuid` exists (Section 4.2.12)
- `dialog.session_id`, `application`, `message_id` exist
- Don't set default values for `encoding` fields

### 11. Handle Optional Fields Correctly

Many fields are optional in IETF spec:
- Check for NULL before using
- Use `COALESCE` for safe defaults
- Don't assume presence of dialog, analysis, or attachments

### 12. Use Batch Operations for Large Datasets

When processing many vCons:
```sql
-- Batch insert parties
INSERT INTO parties (vcon_id, party_index, name, mailto)
SELECT * FROM UNNEST($1::uuid[], $2::int[], $3::text[], $4::text[]);
```

### 13. Validate Data Before Insert

- Check UUID format
- Validate dialog type constraints
- Validate encoding values
- Ensure required fields (vendor, type, etc.)

### 14. Clean Up Failed Operations

If transaction fails:
- Rollback ensures no partial data
- Re-queue embedding jobs if failed
- Log errors for debugging

### 15. Security Considerations

- Use Row Level Security (RLS) for multi-tenancy
- Validate JWT tokens for authenticated users
- Use service role key only for admin operations
- Never expose service role key to clients
- Sanitize user input before queries

---

## Additional Resources

### Related Documentation

- **IETF Specification**: `background_docs/draft-ietf-vcon-vcon-core-00.txt`
- **Migration Files**: `supabase/migrations/` directory
- **TypeScript Types**: `src/types/vcon.ts`
- **Query Implementation**: `src/db/queries.ts`
- **RLS Guide**: `docs/guide/rls-multi-tenant.md`
- **Search Guide**: `docs/guide/search.md`
- **Tag Guide**: `docs/guide/tags.md`

### Database Setup Scripts

- **Initial Schema**: `20251007184415_initial_vcon_schema.sql`
- **Search Setup**: `20251010120000_search_and_embeddings.sql`
- **RLS Setup**: `20251110094042_add_tenant_rls_combined.sql`
- **Embedding Queue**: `20251010140000_embedding_queue_and_trigger.sql`
- **S3 Sync**: `20251110132000_s3_sync_tracking.sql`

### Testing

Test scripts in `scripts/` directory:
- `test-database-tools.ts` - Database operations
- `test-search-tools.ts` - Search functionality
- `test-semantic-search.ts` - Semantic search
- `test-tags.ts` - Tag system
- `test-tenant-setup.ts` - Multi-tenant RLS

### Example Usage

See `scripts/` directory:
- `load-vcons.ts` - Bulk load vCons
- `generate-embeddings-v2.ts` - Generate embeddings
- `migrate-tags-encoding.ts` - Migrate tag format
- `check-embedding-coverage.sql` - Verify embeddings

---

## Summary for LLM Application Development

When building applications to interact with this database:

1. **Understand the IETF vCon spec** - This database implements it faithfully
2. **Use the correct field names** - Especially analysis.schema, vendor (required), body (TEXT)
3. **Leverage the search RPCs** - Don't write your own full-text search
4. **Consider multi-tenancy** - Use RLS if building SaaS
5. **Cache with Redis** - For production performance
6. **Generate embeddings async** - Don't block on embedding generation
7. **Use tags for filtering** - Efficient pre-filtering mechanism
8. **Respect relationships** - Use foreign keys and joins properly
9. **Always limit results** - Prevent memory issues
10. **Test with real data** - Use provided test scripts

The database is designed for:
- **Scalability**: Indexed for millions of vCons
- **Performance**: Optimized search with multiple strategies
- **Compliance**: IETF spec compliant, GDPR-ready
- **Multi-tenancy**: RLS support built-in
- **Extensibility**: Plugin architecture, custom metadata

**Key Insight**: This is not just a document database - it's a normalized relational database optimized for conversation analytics, search, and AI processing. Treat it as such for best results.

---

**End of Document**

*This document provides the complete database architecture and design patterns necessary for building robust applications on top of the vCon MCP Server database. For specific API usage, refer to the TypeScript query implementation in `src/db/queries.ts`.*



