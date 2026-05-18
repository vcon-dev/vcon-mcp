# MCP Tools Reference

Complete reference for all Model Context Protocol (MCP) tools provided by the vCon MCP Server.

## Overview

The vCon MCP Server provides 35 tools organized into these functional groups:

- **[Redesigned Contract Tools](#redesigned-contract-tools)** - Recommended discovery, fetch, and search surface for new clients
- **[Core Operations](#core-operations)** - Create, read, update, delete vCons
- **[Component Management](#component-management)** - Add dialog, analysis, attachments
- **[Search & Query](#search--query)** - Four search modes with different capabilities
- **[Tag Management](#tag-management)** - Organize with key-value metadata
- **[Database Tools](#database-tools)** - Inspect and optimize database
- **[Database Analytics](#database-analytics)** - Comprehensive database analytics and insights
- **[Database Size Tools](#database-size-tools)** - Smart limits and size awareness for large databases
- **[Schema & Examples](#schema--examples)** - Get schemas and example vCons

## Recommended Starting Point

If you are building a new client, especially an LLM-generated one, start with the redesigned additive tool family:

- `vcon_capabilities`
- `vcon_taxonomy`
- `vcon_search`
- `vcon_fetch`
- `describe_response_shape`

These tools were added to address undocumented limits, inconsistent envelopes, and hard-to-predict payloads in the older tool set.

## Are The Older Tools Still Useful?

Yes. The older tools are still useful for backward compatibility, narrow workflows, and incremental migration. Existing clients built around `get_vcon`, `search_vcons`, `search_vcons_content`, `search_vcons_semantic`, `search_vcons_hybrid`, and `search_by_tags` can keep working while new clients adopt the redesigned surface.

For new client work, prefer the redesigned tools first. Treat the older tools as compatibility and specialized interfaces rather than the default entry point.

---

## Tool Categories

Tools are organized into **5 categories** that can be enabled or disabled for different deployment scenarios. By default, all categories are enabled.

| Category | Tools | Description |
|----------|-------|-------------|
| `read` | `get_vcon`, `vcon_fetch`, `vcon_capabilities`, `vcon_search`, `vcon_taxonomy`, `describe_response_shape`, `search_vcons`, `search_vcons_content`, `search_vcons_semantic`, `search_vcons_hybrid`, `get_tags`, `search_by_tags`, `get_unique_tags` | All read operations |
| `write` | `create_vcon`, `update_vcon`, `delete_vcon`, `add_analysis`, `add_dialog`, `add_attachment`, `create_vcon_from_template`, `manage_tag`, `remove_all_tags` | All mutating operations |
| `schema` | `get_schema`, `get_examples` | Documentation helpers |
| `analytics` | `get_database_analytics`, `get_monthly_growth_analytics`, `get_attachment_analytics`, `get_tag_analytics`, `get_content_analytics`, `get_database_health_metrics` | Business intelligence |
| `infra` | `get_database_shape`, `get_database_stats`, `analyze_query`, `get_database_size_info`, `get_smart_search_limits` | Admin/debugging |

### Enabling/Disabling Categories

Configure via environment variables:

```bash
# Use a preset profile
MCP_TOOLS_PROFILE=readonly   # Options: full, readonly, user, admin, minimal

# Or enable specific categories only
MCP_ENABLED_CATEGORIES=read,write,schema

# Or disable specific categories (starts with all enabled)
MCP_DISABLED_CATEGORIES=analytics,infra

# Disable individual tools
MCP_DISABLED_TOOLS=delete_vcon,analyze_query
```

### Deployment Profiles

| Profile | Categories | Use Case |
|---------|------------|----------|
| `full` | All | Development, full access |
| `readonly` | read, schema | Read-only deployments |
| `user` | read, write, schema | End-user facing |
| `admin` | read, analytics, infra, schema | Admin dashboards |
| `minimal` | read, write | Basic CRUD only |

See the [Configuration Guide](../guide/configuration.md) for more details.

## Redesigned Contract Tools

These tools are additive. They do not replace the legacy tools immediately, but they are the recommended surface for new client development.

### vcon_capabilities

Discover supported include groups, search modes, cursor semantics, byte-budget defaults, and migration hints before building a client.

**Use first when:**
- You need to inspect limits before making calls
- You are generating a client from tool descriptions
- You want to know which include groups and search modes are supported

### vcon_taxonomy

Return dataset-specific guidance, including the portal taxonomy and preferred data sources.

**Important dataset hints surfaced by this tool:**
- Use `tags.portal` values like `negative_experience`, `dnc_request`, and `bad_call_quality` before semantic search for "bad call" or upset-customer views
- Prefer `attachment:strolid_dealer` over sparse `dealer_name` tags for dealer-aware interfaces

### vcon_search

Unified metadata, keyword, semantic, and hybrid search with one stable response shape:

```json
{
  "ok": true,
  "items": [...],
  "page": {
    "count": 25,
    "total": 187,
    "next_cursor": "..."
  }
}
```

**Highlights:**
- `mode`: `metadata`, `keyword`, `semantic`, or `hybrid`
- `include`: explicit field groups such as `core`, `summary`, `dealer`, `tags`
- cursor pagination via `page.next_cursor`
- explicit response budgeting with `max_response_bytes`
- loud failure with `RESPONSE_TOO_LARGE` instead of silent truncation

### vcon_fetch

Single-record fetch with one stable response shape:

```json
{
  "ok": true,
  "item": {
    "id": "...",
    "summary": [...],
    "dealer": {...}
  }
}
```

**Highlights:**
- explicit `include` groups instead of `response_format`
- normalized primary identifier field: `id`
- useful lightweight pattern: `include=["core","summary","dealer"]`
- explicit response budgeting with `max_response_bytes`

### describe_response_shape

Return the published JSON schema plus one concrete example for redesigned and legacy tools. Use this when a client needs to probe actual envelope structure before wiring a parser.

---

## Core Operations

### create_vcon

Create a new vCon (Virtual Conversation) record.

**Input Parameters:**

```typescript
{
  vcon_data: {
    vcon: "0.4.0",           // vCon version
    uuid?: string,           // Auto-generated if not provided
    subject?: string,        // Conversation subject
    parties: Party[],        // At least one party required
    dialog?: Dialog[],       // Optional conversation content
    analysis?: Analysis[],   // Optional AI analysis
    attachments?: Attachment[], // Optional files
    extensions?: string[],   // Optional extensions
    critical?: string[]      // Optional: extensions that must be supported (v0.4.0)
  },
  metadata?: {
    basename?: string,
    filename?: string,
    tags?: object
  },
  validate_before_insert?: boolean  // Default: true
}
```

**Response:**

```typescript
{
  success: boolean,
  uuid: string,           // UUID of created vCon
  vcon?: object          // Full vCon if requested
}
```

**Example:**

```typescript
{
  "vcon_data": {
    "vcon": "0.4.0",
    "subject": "Customer Support Call",
    "parties": [
      {
        "name": "Agent Smith",
        "mailto": "smith@company.com",
        "role": "agent"
      },
      {
        "name": "John Doe",
        "tel": "+1-555-1234",
        "role": "customer"
      }
    ]
  }
}
```

---

### get_vcon

Retrieve a vCon by UUID.

**Input Parameters:**

```typescript
{
  uuid: string,              // vCon UUID (required)
  include_components?: string[], // ["parties", "dialog", "analysis", "attachments", "all"]
  include_metadata?: boolean  // Default: true
}
```

**Response:**

```typescript
{
  success: boolean,
  vcon: {
    vcon: "0.4.0",
    uuid: string,
    created_at: string,
    updated_at?: string,
    subject?: string,
    parties: Party[],
    dialog?: Dialog[],
    analysis?: Analysis[],
    attachments?: Attachment[]
  }
}
```

**Example:**

```typescript
{
  "uuid": "123e4567-e89b-12d3-a456-426614174000"
}
```

---

### update_vcon

Update vCon metadata and top-level fields.

**Input Parameters:**

```typescript
{
  uuid: string,           // vCon UUID (required)
  updates: {
    subject?: string,
    extensions?: string[],
    critical?: string[],
    [key: string]: any
  },
  merge_strategy?: "replace" | "merge" | "append",  // Default: "merge"
  validate_after_update?: boolean  // Default: true
}
```

**Response:**

```typescript
{
  success: boolean,
  message: string,
  updated_vcon?: object
}
```

**Example:**

```typescript
{
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "updates": {
    "subject": "Updated: Customer Support Call - Resolved"
  }
}
```

---

### delete_vcon

Delete a vCon and all related data.

**Input Parameters:**

```typescript
{
  uuid: string,           // vCon UUID (required)
  confirm: boolean,       // Must be true (safety check)
  cascade_delete?: boolean  // Default: true (deletes all components)
}
```

**Response:**

```typescript
{
  success: boolean,
  message: string,
  deleted_uuid: string
}
```

**Example:**

```typescript
{
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "confirm": true
}
```

---

### create_vcon_from_template

Create a vCon from a predefined template.

**Input Parameters:**

```typescript
{
  template_name: "phone_call" | "chat_conversation" | "email_thread" | "video_meeting" | "custom",
  subject?: string,
  parties: Party[],      // At least 2 parties required
  metadata?: object,
  template_params?: object  // Template-specific parameters
}
```

**Templates Available:**

- **phone_call** - Phone conversation with duration tracking
- **chat_conversation** - Text-based chat with timestamps
- **email_thread** - Email chain with threading
- **video_meeting** - Video conference with participants
- **custom** - Blank template with custom fields

**Response:**

```typescript
{
  success: boolean,
  uuid: string,
  vcon: object
}
```

**Example:**

```typescript
{
  "template_name": "phone_call",
  "subject": "Sales Call",
  "parties": [
    { "name": "Sales Rep", "mailto": "rep@company.com" },
    { "name": "Prospect", "mailto": "prospect@client.com" }
  ]
}
```

---

## Component Management

### add_dialog

Add a dialog entry (conversation segment) to a vCon.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,      // vCon UUID (required)
  dialog: {
    type: "recording" | "text" | "transfer" | "incomplete",  // Required
    start?: string,       // ISO 8601 timestamp
    duration?: number,    // Duration in seconds
    parties?: number[],   // Array of party indices
    originator?: number,  // Party index of originator
    mediatype?: string,   // MIME type
    filename?: string,
    body?: string,        // Dialog content
    encoding?: "none" | "base64url" | "json",
    url?: string,         // External URL
    session_id?: string,
    application?: string,
    message_id?: string
  }
}
```

**Response:**

```typescript
{
  success: boolean,
  message: string,
  dialog_index: number
}
```

**Example:**

```typescript
{
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "dialog": {
    "type": "text",
    "start": "2025-10-14T10:30:00Z",
    "parties": [0, 1],
    "originator": 1,
    "body": "Hello, I need help with my account.",
    "encoding": "none"
  }
}
```

---

### add_analysis

Add AI/ML analysis results to a vCon.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,      // vCon UUID (required)
  analysis: {
    type: string,         // Analysis type (e.g., "sentiment", "summary")
    dialog?: number | number[],  // Associated dialog indices
    vendor: string,       // REQUIRED - Analysis vendor
    product?: string,     // Product/model name
    schema?: string,      // Schema version
    body?: string,        // Analysis content
    encoding?: "none" | "json" | "base64url",
    url?: string,
    mediatype?: string
  }
}
```

**Common Analysis Types:**

- `sentiment` - Sentiment analysis
- `summary` - Conversation summary
- `transcript` - Transcription
- `translation` - Translation
- `keywords` - Keyword extraction
- `entities` - Named entity recognition
- `topics` - Topic classification
- `action_items` - Action item extraction

**Response:**

```typescript
{
  success: boolean,
  message: string,
  analysis_index: number
}
```

**Example:**

```typescript
{
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "analysis": {
    "type": "sentiment",
    "vendor": "OpenAI",
    "product": "GPT-4",
    "schema": "v1.0",
    "body": "{\"sentiment\": \"positive\", \"score\": 0.85, \"confidence\": 0.92}",
    "encoding": "json",
    "dialog": [0]
  }
}
```

---

### add_attachment

Add an attachment (file, document, etc.) to a vCon.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,      // vCon UUID (required)
  attachment: {
    type: string,         // Attachment type
    start?: string,       // ISO 8601 timestamp
    party?: number,       // Associated party index
    dialog?: number,      // Associated dialog index
    mediatype?: string,   // MIME type
    filename?: string,
    body?: string,        // Attachment content
    encoding?: "none" | "base64url" | "json",
    url?: string         // External URL
  }
}
```

**Response:**

```typescript
{
  success: boolean,
  message: string,
  attachment_index: number
}
```

**Example:**

```typescript
{
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "attachment": {
    "type": "invoice",
    "mediatype": "application/pdf",
    "filename": "invoice-12345.pdf",
    "body": "base64-encoded-pdf-content",
    "encoding": "base64url"
  }
}
```

---

## Search & Query

### search_vcons

Basic search with filtering by metadata (subject, parties, dates).

**Input Parameters:**

```typescript
{
  subject?: string,       // Subject text search
  party_name?: string,    // Party name search
  party_email?: string,   // Party email search
  party_tel?: string,     // Party phone search
  start_date?: string,    // ISO 8601 date
  end_date?: string,      // ISO 8601 date
  limit?: number,         // Default: 50, Max: 1000
  offset?: number         // For pagination
}
```

**Response:**

```typescript
{
  success: boolean,
  count: number,
  vcons: VCon[],
  has_more: boolean
}
```

**Example:**

```typescript
{
  "subject": "support",
  "start_date": "2025-10-01T00:00:00Z",
  "limit": 20
}
```

---

### search_vcons_content

Full-text keyword search across dialog, analysis, and party content.

**Input Parameters:**

```typescript
{
  query: string,          // Search query (required)
  tags?: object,          // Tag filters
  start_date?: string,
  end_date?: string,
  limit?: number,         // Default: 50
  include_snippets?: boolean  // Default: true
}
```

**Response:**

```typescript
{
  success: boolean,
  count: number,
  results: [{
    vcon_id: string,
    content_type: "subject" | "dialog" | "analysis" | "party",
    content_index?: number,
    relevance_score: number,
    snippet?: string,     // Highlighted match
    vcon?: object
  }]
}
```

**Example:**

```typescript
{
  "query": "billing issue refund",
  "tags": { "department": "support" },
  "limit": 25
}
```

---

### search_vcons_semantic

AI-powered semantic search using embeddings.

**Input Parameters:**

```typescript
{
  query?: string,         // Natural language query
  embedding?: number[],   // Or provide embedding directly (384 dims)
  threshold?: number,     // Similarity threshold (0-1), default: 0.7
  tags?: object,          // Tag filters
  limit?: number          // Default: 20
}
```

**Response:**

```typescript
{
  success: boolean,
  count: number,
  results: [{
    vcon_id: string,
    similarity_score: number,
    matched_content: {
      subject?: string,
      dialog_excerpts?: Array<{
        dialog_index: number,
        text: string,
        relevance: number
      }>
    },
    vcon?: object
  }]
}
```

**Example:**

```typescript
{
  "query": "customer frustrated about late delivery",
  "threshold": 0.75,
  "tags": { "priority": "high" },
  "limit": 15
}
```

---

### search_vcons_hybrid

Combined keyword + semantic search for comprehensive results.

**Input Parameters:**

```typescript
{
  query: string,          // Search query (required)
  semantic_weight?: number,  // 0-1, default: 0.6 (60% semantic, 40% keyword)
  tags?: object,
  start_date?: string,
  end_date?: string,
  limit?: number          // Default: 30
}
```

**Response:**

```typescript
{
  success: boolean,
  count: number,
  results: [{
    vcon_id: string,
    combined_score: number,
    keyword_score: number,
    semantic_score: number,
    vcon?: object
  }]
}
```

**Example:**

```typescript
{
  "query": "pricing discussion discount",
  "semantic_weight": 0.5,
  "tags": { "department": "sales" },
  "limit": 20
}
```

---

## Tag Management

The tag toolset was consolidated to 5 tools. Tags are stored as a
special vCon attachment (`type: "tags"`, `encoding: "json"`, body is a
JSON array of `"key:value"` strings).

### manage_tag

Add, update, or remove a single tag on a vCon. Replaces the older
`add_tag`, `update_tags`, and `remove_tag` tools.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,                       // vCon UUID (required)
  action: "set" | "remove",                // (required)
  key: string,                             // Tag key (required)
  value?: string | number | boolean        // Required when action="set"
}
```

**Response (on success):**

```typescript
{
  success: true,
  message: string,
  action: "set" | "remove",
  key: string,
  value?: string                            // Stringified, only when action="set"
}
```

**Examples:**

```typescript
// Set a tag
{
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "action": "set",
  "key": "department",
  "value": "sales"
}

// Remove a tag
{
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "action": "remove",
  "key": "department"
}
```

---

### get_tags

Retrieve tags from a vCon. Provide a specific `key` to get one tag, or
omit `key` to get all tags. Replaces the older `get_tag` and
`get_all_tags` tools.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,                                       // (required)
  key?: string,                                            // Omit for all tags
  default_value?: string | number | boolean | null         // Used when key is provided
}
```

**Response — single tag (key provided):**

```typescript
{
  success: true,
  key: string,
  value: string | number | boolean | null,
  exists: boolean
}
```

**Response — all tags (key omitted):**

```typescript
{
  success: true,
  vcon_uuid: string,
  tags: { [key: string]: string },
  count: number
}
```

**Example Response (all tags):**

```json
{
  "success": true,
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "tags": {
    "department": "sales",
    "priority": "high",
    "status": "open",
    "customer_id": "CUST-12345"
  },
  "count": 4
}
```

---

### remove_all_tags

Remove all tags from a vCon.

**Input Parameters:**

```typescript
{
  vcon_uuid: string                       // (required)
}
```

---

### search_by_tags

Find vCons by tag criteria. All specified tags must match (AND logic).

**Input Parameters:**

```typescript
{
  tags: { [key: string]: string },        // Non-empty object (required)
  limit?: number,                          // Default: 50, Max: 100
  return_full_vcons?: boolean,             // Default: false for >20 results, true otherwise
  max_full_vcons?: number                  // Default: 20, Max: 50
}
```

**Response:**

```typescript
{
  success: true,
  count: number,
  tags_searched: object,
  vcon_uuids: string[],                    // All matching UUIDs (up to limit)
  vcons?: VCon[],                          // Only when return_full_vcons=true
  message?: string                          // Hint about result size
}
```

**Behavior:**

- Always returns `vcon_uuids` for matching vCons (up to `limit`).
- For result sets > 20, only UUIDs are returned by default to keep the
  response under MCP size limits.
- Set `return_full_vcons: true` to receive full vCon objects (capped at
  `max_full_vcons`).
- The `tags` parameter must be a non-empty object; null, undefined, or
  `{}` is rejected.

**Example:**

```typescript
{
  "tags": {
    "department": "support",
    "priority": "high",
    "status": "open"
  },
  "limit": 25
}
```

---

### get_unique_tags

Discover all unique tag keys and values across the database. Useful for
building selection UIs and tag analytics.

**Input Parameters:**

```typescript
{
  include_counts?: boolean,                // Include usage counts; default false
  key_filter?: string,                     // Case-insensitive substring match on keys
  min_count?: number                       // Minimum occurrence; default 1
}
```

**Response:**

```typescript
{
  success: true,
  unique_keys: string[],
  unique_key_count: number,
  tags_by_key: {
    [key: string]: string[]                // All distinct values per key
  },
  counts_per_value?: {                     // Only when include_counts=true
    [key: string]: { [value: string]: number }
  },
  total_vcons_with_tags: number
}
```

**Example:**

```typescript
{
  "include_counts": true,
  "key_filter": "department"
}
```

---

## Database Tools

### get_database_shape

Get database structure, sizes, and indexes.

**Input Parameters:**

```typescript
{
  include_counts?: boolean,   // Default: true
  include_sizes?: boolean,    // Default: true
  include_indexes?: boolean,  // Default: true
  include_columns?: boolean   // Default: false
}
```

**Response:**

```typescript
{
  success: boolean,
  database_shape: {
    timestamp: string,
    tables: [{
      name: string,
      schema: string,
      row_count: number,
      total_size: string,
      table_size: string,
      indexes_size: string,
      indexes?: Array<{
        indexname: string,
        index_type: string,
        index_size: string
      }>,
      columns?: Array<{
        column_name: string,
        data_type: string,
        is_nullable: string
      }>
    }],
    relationships: Array<{
      from_table: string,
      from_column: string,
      to_table: string,
      to_column: string
    }>
  }
}
```

---

### get_database_stats

Get performance metrics and usage statistics.

**Input Parameters:**

```typescript
{
  include_query_stats?: boolean,   // Default: true
  include_index_usage?: boolean,   // Default: true
  include_cache_stats?: boolean,   // Default: true
  table_name?: string               // Specific table
}
```

**Response:**

```typescript
{
  success: boolean,
  database_stats: {
    timestamp: string,
    cache_stats: {
      hit_ratio: string,
      heap_blocks_hit: number,
      heap_blocks_read: number
    },
    table_stats: Array<{
      table_name: string,
      sequential_scans: number,
      index_scans: number,
      inserts: number,
      updates: number,
      deletes: number,
      live_rows: number,
      dead_rows: number
    }>,
    index_usage: Array<{
      table_name: string,
      index_name: string,
      scans: number,
      rows_read: number
    }>,
    unused_indexes: Array<{
      table_name: string,
      index_name: string,
      index_size: string
    }>
  }
}
```

---

### analyze_query

Analyze SQL query execution plan (limited support).

**Input Parameters:**

```typescript
{
  query: string,          // SELECT query (required)
  analyze_mode?: "explain" | "explain_analyze"  // Default: "explain"
}
```

**Note:** Has limited support due to RPC constraints. Use direct database access for full EXPLAIN capabilities.

---

## Database Analytics

### get_database_analytics

Get comprehensive database analytics including size, growth trends, content distribution, and health metrics.

**Input Parameters:**

```typescript
{
  include_growth_trends?: boolean,      // Include monthly growth trends (default: true)
  include_content_analytics?: boolean,  // Include content analysis (default: true)
  include_attachment_stats?: boolean,   // Include attachment statistics (default: true)
  include_tag_analytics?: boolean,      // Include tag usage patterns (default: true)
  include_health_metrics?: boolean,     // Include health metrics (default: true)
  months_back?: number                  // Months to analyze (default: 12)
}
```

**Response:**

```typescript
{
  success: true,
  database_analytics: {
    timestamp: string,
    summary: {
      total_vcons: number,
      total_parties: number,
      total_dialogs: number,
      total_analysis: number,
      total_attachments: number,
      total_size_bytes: number,
      total_size_pretty: string,
      database_health_score: number
    },
    tables: {
      [table_name]: {
        row_count: number,
        total_size: string,
        table_size: string
      }
    },
    growth: {
      monthly_data: Array<{
        month: string,
        vcon_count: number,
        total_size: number
      }>,
      summary: {
        total_growth: number,
        avg_monthly_growth: number,
        growth_percentage: number
      }
    },
    content: {
      dialog_types: Array<{
        type: string,
        count: number,
        avg_duration: number
      }>,
      analysis_types: Array<{
        type: string,
        vendor: string,
        count: number
      }>,
      party_roles: Array<{
        role: string,
        count: number,
        unique_names: number
      }>
    },
    attachments: {
      type_breakdown: Array<{
        type: string,
        count: number,
        total_size: number,
        percentage: number
      }>,
      size_distribution: Array<{
        size_bucket: string,
        count: number,
        percentage: number
      }>
    },
    tags: {
      tag_frequency: Array<{
        key: string,
        usage_count: number,
        unique_values: number
      }>,
      value_distribution: Array<{
        key: string,
        value: string,
        count: number,
        percentage: number
      }>
    },
    health: {
      table_performance: Array<{
        table_name: string,
        sequential_scans: number,
        index_scans: number,
        dead_row_percentage: number
      }>,
      index_usage: Array<{
        table_name: string,
        index_name: string,
        scans: number,
        health_status: string
      }>
    }
  }
}
```

**Example:**

```typescript
{
  "include_growth_trends": true,
  "include_content_analytics": true,
  "months_back": 6
}
```

---

### get_monthly_growth_analytics

Get detailed monthly growth analytics with trends and projections.

**Input Parameters:**

```typescript
{
  months_back?: number,           // Months to analyze (default: 12)
  include_projections?: boolean,  // Include growth projections (default: true)
  granularity?: 'monthly' | 'weekly' | 'daily'  // Time granularity (default: 'monthly')
}
```

**Response:**

```typescript
{
  success: true,
  monthly_growth_analytics: {
    timestamp: string,
    period: string,
    granularity: string,
    trends: {
      vcon_creation: Array<{
        period: string,
        vcon_count: number,
        unique_vcons: number
      }>,
      size_growth: Array<{
        period: string,
        dialog_size: number,
        attachment_size: number,
        total_size: number
      }>,
      content_volume: Array<{
        period: string,
        vcon_count: number,
        dialog_count: number,
        analysis_count: number,
        attachment_count: number
      }>
    },
    growth_rates: {
      vcon_growth_rate: number,
      size_growth_rate: number
    },
    projections: {
      next_3_months: {
        projected_vcons: number,
        projected_size: number,
        projected_size_pretty: string
      },
      growth_rates: {
        vcon_growth_rate: number,
        size_growth_rate: number
      }
    }
  }
}
```

---

### get_attachment_analytics

Get comprehensive attachment analytics including file type distribution and size analysis.

**Input Parameters:**

```typescript
{
  include_size_distribution?: boolean,  // Include size distribution (default: true)
  include_type_breakdown?: boolean,     // Include file type breakdown (default: true)
  include_temporal_patterns?: boolean,  // Include temporal patterns (default: false)
  top_n_types?: number                  // Top N file types to analyze (default: 10)
}
```

**Response:**

```typescript
{
  success: true,
  attachment_analytics: {
    timestamp: string,
    summary: {
      total_attachments: number,
      total_size: number,
      avg_size: number,
      unique_types: number,
      vcons_with_attachments: number
    },
    type_breakdown: Array<{
      type: string,
      count: number,
      total_size: number,
      avg_size: number,
      percentage: number
    }>,
    size_distribution: Array<{
      size_bucket: string,
      count: number,
      total_size: number,
      percentage: number
    }>,
    temporal_patterns: Array<{
      month: string,
      attachment_count: number,
      total_size: number,
      avg_size: number
    }>
  }
}
```

---

### get_tag_analytics

Get comprehensive tag analytics including usage patterns and value distribution.

**Input Parameters:**

```typescript
{
  include_frequency_analysis?: boolean,  // Include frequency analysis (default: true)
  include_value_distribution?: boolean,  // Include value distribution (default: true)
  include_temporal_trends?: boolean,     // Include temporal trends (default: false)
  top_n_keys?: number,                   // Top N tag keys to analyze (default: 20)
  min_usage_count?: number               // Minimum usage count filter (default: 1)
}
```

**Response:**

```typescript
{
  success: true,
  tag_analytics: {
    timestamp: string,
    summary: {
      unique_keys: number,
      unique_values: number,
      vcons_with_tags: number,
      total_tag_assignments: number
    },
    frequency_analysis: Array<{
      key: string,
      usage_count: number,
      unique_values: number,
      vcons_with_tag: number,
      avg_values_per_key: number
    }>,
    value_distribution: Array<{
      key: string,
      value: string,
      count: number,
      percentage: number
    }>,
    temporal_trends: Array<{
      month: string,
      key: string,
      usage_count: number
    }>
  }
}
```

---

### get_content_analytics

Get comprehensive content analytics including dialog types, analysis breakdown, and conversation metrics.

**Input Parameters:**

```typescript
{
  include_dialog_analysis?: boolean,     // Include dialog analysis (default: true)
  include_analysis_breakdown?: boolean,  // Include analysis breakdown (default: true)
  include_party_patterns?: boolean,      // Include party patterns (default: true)
  include_conversation_metrics?: boolean, // Include conversation metrics (default: true)
  include_temporal_content?: boolean     // Include temporal content patterns (default: false)
}
```

**Response:**

```typescript
{
  success: true,
  content_analytics: {
    timestamp: string,
    summary: {
      total_vcons: number,
      total_parties: number,
      total_dialogs: number,
      total_analysis: number,
      total_attachments: number,
      total_duration_seconds: number,
      avg_duration_seconds: number
    },
    dialog_analysis: Array<{
      type: string,
      count: number,
      avg_duration: number,
      total_duration: number,
      total_size: number,
      unique_vcons: number
    }>,
    analysis_breakdown: Array<{
      type: string,
      vendor: string,
      count: number,
      avg_confidence: number,
      unique_vcons: number
    }>,
    party_patterns: Array<{
      role: string,
      count: number,
      unique_names: number,
      unique_emails: number,
      unique_phones: number,
      unique_vcons: number
    }>,
    conversation_metrics: {
      total_conversations: number,
      avg_parties_per_conversation: number,
      avg_dialogs_per_conversation: number,
      avg_analysis_per_conversation: number,
      avg_attachments_per_conversation: number,
      avg_duration_per_conversation: number,
      avg_size_per_conversation: number,
      max_parties_in_conversation: number,
      max_dialogs_in_conversation: number
    },
    temporal_content: Array<{
      month: string,
      vcon_count: number,
      dialog_count: number,
      analysis_count: number,
      attachment_count: number,
      total_duration: number
    }>
  }
}
```

---

### get_database_health_metrics

Get database health metrics including performance indicators and optimization recommendations.

**Input Parameters:**

```typescript
{
  include_performance_metrics?: boolean,  // Include performance metrics (default: true)
  include_storage_efficiency?: boolean,   // Include storage efficiency (default: true)
  include_index_health?: boolean,         // Include index health (default: true)
  include_connection_metrics?: boolean,   // Include connection metrics (default: true)
  include_recommendations?: boolean       // Include recommendations (default: true)
}
```

**Response:**

```typescript
{
  success: true,
  database_health_metrics: {
    timestamp: string,
    overall_score: number,
    metrics: {
      performance: Array<{
        table_name: string,
        sequential_scans: number,
        index_scans: number,
        inserts: number,
        updates: number,
        deletes: number,
        live_rows: number,
        dead_rows: number,
        dead_row_percentage: number,
        index_usage_ratio: number
      }>,
      storage: Array<{
        table_name: string,
        total_size: string,
        table_size: string,
        index_size: string,
        index_size_percentage: number
      }>,
      indexes: Array<{
        table_name: string,
        index_name: string,
        scans: number,
        rows_read: number,
        rows_fetched: number,
        index_size: string,
        health_status: 'UNUSED' | 'LOW_USAGE' | 'ACTIVE'
      }>,
      connections: {
        heap_read: number,
        heap_hit: number,
        cache_hit_ratio: number,
        idx_read: number,
        idx_hit: number,
        idx_cache_hit_ratio: number
      }
    },
    recommendations: string[],
    alerts: string[]
  }
}
```

---

## Database Size Tools

### get_database_size_info

Get database size information and smart recommendations for query limits. Essential for large databases to prevent memory exhaustion.

**Input Parameters:**

```typescript
{
  include_recommendations?: boolean  // Include smart recommendations (default: true)
}
```

**Response:**

```typescript
{
  success: true,
  database_size_info: {
    total_vcons: number,
    total_size_bytes: number,
    total_size_pretty: string,
    size_category: 'small' | 'medium' | 'large' | 'very_large',
    recommendations: {
      max_basic_search_limit: number,
      max_content_search_limit: number,
      max_semantic_search_limit: number,
      max_analytics_limit: number,
      recommended_response_format: string,
      memory_warning: boolean
    },
    table_sizes: {
      [table_name]: {
        row_count: number,
        size_bytes: number,
        size_pretty: string
      }
    }
  }
}
```

**Example:**

```typescript
{
  "include_recommendations": true
}
```

---

### get_smart_search_limits

Get smart search limits based on database size and query complexity. Helps prevent memory exhaustion by suggesting appropriate limits.

**Input Parameters:**

```typescript
{
  query_type: 'basic' | 'content' | 'semantic' | 'hybrid' | 'analytics',
  estimated_result_size?: 'small' | 'medium' | 'large' | 'unknown'  // Default: 'unknown'
}
```

**Response:**

```typescript
{
  success: true,
  smart_limits: {
    query_type: string,
    estimated_result_size: string,
    recommended_limit: number,
    recommended_response_format: string,
    memory_warning: boolean,
    explanation: string
  }
}
```

**Example:**

```typescript
{
  "query_type": "content",
  "estimated_result_size": "large"
}
```

---

## Schema & Examples

### get_schema

Get vCon schema definition.

**Input Parameters:**

```typescript
{
  format?: "json_schema" | "typescript" | "openapi",  // Default: "json_schema"
  version?: string        // vCon version, default: "latest"
}
```

**Response:**

```typescript
{
  success: boolean,
  format: string,
  version: string,
  schema: object | string
}
```

---

### get_examples

Get example vCons.

**Input Parameters:**

```typescript
{
  example_type: "minimal" | "phone_call" | "chat" | "email" | "video" | "full_featured",
  format?: "json" | "yaml"  // Default: "json"
}
```

**Response:**

```typescript
{
  success: boolean,
  example_type: string,
  format: string,
  vcon: object | string
}
```

**Example Types:**

- **minimal** - Bare minimum required fields
- **phone_call** - Phone conversation example
- **chat** - Text chat example
- **email** - Email thread example
- **video** - Video meeting example
- **full_featured** - All features demonstrated

---

## Error Responses

All tools return errors in this format:

```typescript
{
  success: false,
  error: string,
  details?: any
}
```

**Common Error Codes:**

- `VALIDATION_ERROR` - Invalid input parameters
- `NOT_FOUND` - vCon or resource not found
- `DATABASE_ERROR` - Database operation failed
- `PERMISSION_DENIED` - Insufficient permissions
- `RATE_LIMIT_EXCEEDED` - Too many requests

---

## Usage Notes

### Best Practices

1. **Always validate** - Use `validate_before_insert` for create operations
2. **Use appropriate search** - Choose the right search tool for your use case
3. **Tag consistently** - Establish a tagging schema
4. **Monitor performance** - Use database tools regularly
5. **Handle errors** - Check `success` field in all responses

### Rate Limits

- Search operations: 100 requests/minute
- Create operations: 50 requests/minute
- Other operations: 200 requests/minute

### Pagination

For search results:
- Use `limit` and `offset` parameters
- Check `has_more` in response
- Maximum `limit` is 1000

---

## Next Steps

- See [Resources](./resources.md) for URI-based access
- See [Prompts](./prompts.md) for query templates
- See [TypeScript Types](./types.md) for type definitions
- See [Examples](/examples/) for practical usage

