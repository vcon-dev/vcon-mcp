# MCP Tools Reference

Complete reference for all Model Context Protocol (MCP) tools provided by the vCon MCP Server.

## Overview

The vCon MCP Server provides 20+ tools organized into these categories:

- **[Core Operations](#core-operations)** - Create, read, update, delete vCons
- **[Component Management](#component-management)** - Add dialog, analysis, attachments
- **[Search & Query](#search--query)** - Four search modes with different capabilities
- **[Tag Management](#tag-management)** - Organize with key-value metadata
- **[Database Tools](#database-tools)** - Inspect and optimize database
- **[Schema & Examples](#schema--examples)** - Get schemas and example vCons

---

## Core Operations

### create_vcon

Create a new vCon (Virtual Conversation) record.

**Input Parameters:**

```typescript
{
  vcon_data: {
    vcon: "0.3.0",           // vCon version
    uuid?: string,           // Auto-generated if not provided
    subject?: string,        // Conversation subject
    parties: Party[],        // At least one party required
    dialog?: Dialog[],       // Optional conversation content
    analysis?: Analysis[],   // Optional AI analysis
    attachments?: Attachment[], // Optional files
    extensions?: string[],   // Optional extensions
    must_support?: string[]  // Optional requirements
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
    "vcon": "0.3.0",
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
    vcon: "0.3.0",
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
    must_support?: string[],
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

### add_tag

Add or update a single tag on a vCon.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,      // vCon UUID (required)
  key: string,            // Tag key (required)
  value: string | number | boolean,  // Tag value (required)
  overwrite?: boolean     // Default: true
}
```

**Response:**

```typescript
{
  success: boolean,
  message: string,
  key: string,
  value: any
}
```

**Example:**

```typescript
{
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "key": "department",
  "value": "sales"
}
```

---

### get_tag

Retrieve a specific tag value.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,      // vCon UUID (required)
  key: string,            // Tag key (required)
  default_value?: any     // Return if tag doesn't exist
}
```

**Response:**

```typescript
{
  success: boolean,
  key: string,
  value: any,
  exists: boolean
}
```

---

### get_all_tags

Get all tags for a vCon.

**Input Parameters:**

```typescript
{
  vcon_uuid: string       // vCon UUID (required)
}
```

**Response:**

```typescript
{
  success: boolean,
  vcon_uuid: string,
  tags: {
    [key: string]: string | number | boolean
  },
  count: number
}
```

**Example Response:**

```json
{
  "success": true,
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

### remove_tag

Remove a tag from a vCon.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,      // vCon UUID (required)
  key: string             // Tag key to remove (required)
}
```

---

### search_by_tags

Find vCons by tag criteria (all tags must match).

**Input Parameters:**

```typescript
{
  tags: {                 // Tag key-value pairs (required)
    [key: string]: string
  },
  limit?: number          // Default: 50, Max: 100
}
```

**Response:**

```typescript
{
  success: boolean,
  count: number,
  tags_searched: object,
  vcon_uuids: string[],
  vcons: VCon[]
}
```

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

Discover all available tags across all vCons.

**Input Parameters:**

```typescript
{
  include_counts?: boolean,   // Include usage statistics
  key_filter?: string,        // Filter by key substring
  min_count?: number          // Minimum occurrence count
}
```

**Response:**

```typescript
{
  success: boolean,
  unique_keys: string[],
  unique_key_count: number,
  tags_by_key: {
    [key: string]: string[]   // All values for each key
  },
  counts_per_value?: {        // If include_counts=true
    [key: string]: {
      [value: string]: number
    }
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

### update_tags

Update multiple tags at once.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,      // vCon UUID (required)
  tags: {                 // Tags to add/update (required)
    [key: string]: string | number | boolean
  },
  merge?: boolean         // Merge with existing (true) or replace all (false)
}
```

**Example:**

```typescript
{
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "tags": {
    "status": "closed",
    "resolution": "resolved",
    "resolved_at": "2025-10-14T15:30:00Z"
  },
  "merge": true
}
```

---

### remove_all_tags

Remove all tags from a vCon.

**Input Parameters:**

```typescript
{
  vcon_uuid: string       // vCon UUID (required)
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

