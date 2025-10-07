# Open Source vCon MCP Server - Expanded Functionality Specification

## Executive Summary

This document provides a comprehensive specification of ALL functionality that will be included in the **open source** vCon MCP server. The goal is to create a powerful, production-ready core that handles all non-privacy/non-compliance operations, making it valuable for general conversation data management.

---

## 1. Core vCon CRUD Operations

### 1.1 Create Operations

#### `create_vcon` Tool
Create a new vCon from JSON data with full validation.

**Input Schema:**
```typescript
{
  vcon_data: {
    type: "object";
    description: "Complete vCon JSON object following IETF spec";
    required: true;
  };
  metadata?: {
    type: "object";
    description: "Additional metadata (basename, filename, tags)";
  };
  validate_before_insert?: {
    type: "boolean";
    default: true;
    description: "Run validation before inserting";
  };
  return_created?: {
    type: "boolean";
    default: true;
    description: "Return the created vCon object";
  };
}
```

**Features:**
- Full IETF vCon specification compliance
- Automatic UUID generation if not provided
- Timestamp management (created_at, updated_at)
- Validation before insertion
- Support for all vCon components (parties, dialog, attachments, analysis)

#### `create_vcon_from_template` Tool
Create vCons from predefined templates.

**Input Schema:**
```typescript
{
  template_name: {
    type: "string";
    enum: ["phone_call", "chat_conversation", "email_thread", "video_meeting", "custom"];
  };
  parties: {
    type: "array";
    items: { /* Party schema */ };
    description: "Participants in the conversation";
  };
  subject?: {
    type: "string";
    description: "Conversation subject/title";
  };
  metadata?: {
    type: "object";
  };
}
```

**Features:**
- Pre-configured templates for common conversation types
- Smart defaults for different conversation mediums
- Extensible template system

### 1.2 Read Operations

#### `get_vcon` Tool
Retrieve a vCon by UUID.

**Input Schema:**
```typescript
{
  uuid: {
    type: "string";
    format: "uuid";
    required: true;
  };
  include_components?: {
    type: "array";
    items: { type: "string"; enum: ["parties", "dialog", "attachments", "analysis", "all"] };
    default: ["all"];
  };
  include_metadata?: {
    type: "boolean";
    default: true;
  };
}
```

**Features:**
- Selective component retrieval
- Full object reconstruction from normalized schema
- Efficient querying with indexed lookups

#### `get_vcon_by_subject` Tool
Find vCons by subject text.

**Input Schema:**
```typescript
{
  subject: {
    type: "string";
    description: "Subject to search for (supports partial matching)";
  };
  exact_match?: {
    type: "boolean";
    default: false;
  };
  limit?: {
    type: "integer";
    default: 100;
    maximum: 1000;
  };
}
```

#### `list_vcons` Tool
List all vCons with pagination.

**Input Schema:**
```typescript
{
  limit?: {
    type: "integer";
    default: 100;
    maximum: 1000;
  };
  offset?: {
    type: "integer";
    default: 0;
  };
  sort_by?: {
    type: "string";
    enum: ["created_at", "updated_at", "subject"];
    default: "created_at";
  };
  sort_order?: {
    type: "string";
    enum: ["asc", "desc"];
    default: "desc";
  };
}
```

### 1.3 Update Operations

#### `update_vcon` Tool
Update vCon metadata and properties.

**Input Schema:**
```typescript
{
  uuid: {
    type: "string";
    format: "uuid";
    required: true;
  };
  updates: {
    type: "object";
    description: "Fields to update";
    required: true;
  };
  merge_strategy?: {
    type: "string";
    enum: ["replace", "merge", "append"];
    default: "merge";
    description: "How to handle nested object updates";
  };
  validate_after_update?: {
    type: "boolean";
    default: true;
  };
}
```

**Features:**
- Subject updates
- Metadata updates
- Tag management
- Group data updates
- Redaction rules updates

#### `update_vcon_status` Tool
Update processing status flags.

**Input Schema:**
```typescript
{
  uuid: {
    type: "string";
    format: "uuid";
  };
  done?: {
    type: "boolean";
  };
  corrupt?: {
    type: "boolean";
  };
  processed_by?: {
    type: "string";
  };
}
```

### 1.4 Delete Operations

#### `delete_vcon` Tool
Delete a vCon and all related data.

**Input Schema:**
```typescript
{
  uuid: {
    type: "string";
    format: "uuid";
    required: true;
  };
  confirm: {
    type: "boolean";
    required: true;
    description: "Confirmation flag to prevent accidental deletion";
  };
  cascade_delete?: {
    type: "boolean";
    default: true;
    description: "Delete all related parties, dialog, attachments, analysis";
  };
}
```

**Features:**
- Cascade deletion of all related components
- Confirmation requirement
- Transaction safety

#### `bulk_delete_vcons` Tool
Delete multiple vCons in a batch.

**Input Schema:**
```typescript
{
  uuids: {
    type: "array";
    items: { type: "string"; format: "uuid" };
    required: true;
  };
  confirm: {
    type: "boolean";
    required: true;
  };
}
```

---

## 2. Component Management

### 2.1 Party Management

#### `add_party` Tool
Add a participant to a vCon.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
    required: true;
  };
  party: {
    type: "object";
    properties: {
      name?: { type: "string" };
      tel?: { type: "string" };
      email?: { type: "string"; format: "email" };
      role?: { type: "string" };
      organization?: { type: "string" };
      uuid?: { type: "string"; format: "uuid" };
      metadata?: { type: "object" };
    };
    required: true;
  };
  return_index?: {
    type: "boolean";
    default: true;
    description: "Return the index of the newly added party";
  };
}
```

#### `update_party` Tool
Update party information.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  party_index: {
    type: "integer";
    minimum: 0;
    description: "Index of party in parties array";
  };
  updates: {
    type: "object";
    description: "Fields to update";
  };
}
```

#### `remove_party` Tool
Remove a party from a vCon.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  party_index: {
    type: "integer";
    minimum: 0;
  };
  reindex_dialogs?: {
    type: "boolean";
    default: true;
    description: "Automatically update dialog party references";
  };
}
```

#### `find_party` Tool
Find parties matching criteria.

**Input Schema:**
```typescript
{
  vcon_uuid?: {
    type: "string";
    format: "uuid";
    description: "Search within specific vCon, or across all if omitted";
  };
  name?: { type: "string" };
  email?: { type: "string" };
  tel?: { type: "string" };
  role?: { type: "string" };
  organization?: { type: "string" };
}
```

### 2.2 Dialog Management

#### `add_dialog` Tool
Add dialog entry (recording, transcript, message).

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  dialog: {
    type: "object";
    properties: {
      type: { 
        type: "string"; 
        enum: ["recording", "text", "transfer", "video", "email"];
        required: true;
      };
      start: { 
        type: "string"; 
        format: "date-time";
        description: "ISO 8601 timestamp";
      };
      duration?: { 
        type: "number";
        description: "Duration in seconds";
      };
      parties: { 
        type: "array"; 
        items: { type: "integer" };
        description: "Array of party indices involved in this dialog";
      };
      originator?: { 
        type: "integer";
        description: "Party index of originator";
      };
      mimetype?: { type: "string" };
      filename?: { type: "string" };
      body?: { 
        type: "string";
        description: "Content (text or base64 encoded)";
      };
      encoding?: {
        type: "string";
        enum: ["none", "base64", "json"];
      };
      url?: {
        type: "string";
        format: "uri";
        description: "External URL for content";
      };
      disposition?: {
        type: "string";
        enum: ["render", "inline", "attachment"];
      };
      metadata?: { type: "object" };
    };
  };
}
```

**Features:**
- Support for all dialog types (text, audio, video, email)
- Inline or external content (URL)
- Base64 encoding for binary data
- Duration tracking
- Party and originator references

#### `update_dialog` Tool
Update dialog entry.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  dialog_index: {
    type: "integer";
    minimum: 0;
  };
  updates: {
    type: "object";
  };
}
```

#### `remove_dialog` Tool
Remove a dialog entry.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  dialog_index: {
    type: "integer";
    minimum: 0;
  };
}
```

#### `get_dialogs` Tool
Get all dialogs for a vCon with filtering.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  type?: {
    type: "string";
    enum: ["recording", "text", "transfer", "video", "email"];
  };
  party_index?: {
    type: "integer";
    description: "Filter by party involvement";
  };
  date_range?: {
    type: "object";
    properties: {
      start: { type: "string"; format: "date-time" };
      end: { type: "string"; format: "date-time" };
    };
  };
}
```

### 2.3 Attachment Management

#### `add_attachment` Tool
Add attachment to vCon.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  attachment: {
    type: "object";
    properties: {
      type: { 
        type: "string";
        description: "Attachment type (custom types allowed)";
        required: true;
      };
      start?: { 
        type: "string"; 
        format: "date-time";
      };
      party?: {
        type: "integer";
        description: "Associated party index";
      };
      dialog?: {
        type: "integer";
        description: "Associated dialog index";
      };
      mimetype?: { type: "string" };
      filename?: { type: "string" };
      body: { 
        type: "string";
        description: "Attachment content";
        required: true;
      };
      encoding?: {
        type: "string";
        enum: ["none", "base64", "json"];
      };
      url?: {
        type: "string";
        format: "uri";
      };
    };
  };
}
```

**Features:**
- Custom attachment types
- Party and dialog associations
- Inline or external content
- MIME type support

#### `get_attachments` Tool
Retrieve attachments with filtering.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  type?: {
    type: "string";
    description: "Filter by attachment type";
  };
  party_index?: {
    type: "integer";
  };
  dialog_index?: {
    type: "integer";
  };
}
```

#### `update_attachment` Tool
Update attachment metadata.

#### `remove_attachment` Tool
Remove an attachment.

### 2.4 Analysis Management

#### `add_analysis` Tool
Add analysis result to vCon.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  analysis: {
    type: "object";
    properties: {
      type: { 
        type: "string";
        description: "Analysis type (e.g., 'sentiment', 'summary', 'transcription')";
        required: true;
      };
      dialog?: {
        type: "integer";
        description: "Associated dialog index";
      };
      vendor?: { 
        type: "string";
        description: "Analysis vendor/tool name";
      };
      product?: { 
        type: "string";
        description: "Specific product/model used";
      };
      schema?: { 
        type: "string";
        description: "Schema version for analysis body";
      };
      body: { 
        type: "object";
        description: "Analysis result data";
        required: true;
      };
      encoding?: {
        type: "string";
        enum: ["json", "none"];
        default: "json";
      };
      confidence?: {
        type: "number";
        minimum: 0;
        maximum: 1;
        description: "Confidence score for analysis";
      };
    };
  };
}
```

**Features:**
- Flexible analysis types
- Vendor attribution
- Confidence scores
- Dialog association
- Structured result data

#### `get_analysis` Tool
Retrieve analysis results with filtering.

**Input Schema:**
```typescript
{
  vcon_uuid?: {
    type: "string";
    format: "uuid";
    description: "Specific vCon, or search across all";
  };
  analysis_type?: {
    type: "string";
    description: "Filter by analysis type";
  };
  vendor?: {
    type: "string";
  };
  min_confidence?: {
    type: "number";
    minimum: 0;
    maximum: 1;
  };
  dialog_index?: {
    type: "integer";
  };
}
```

#### `update_analysis` Tool
Update analysis result.

#### `remove_analysis` Tool
Remove an analysis result.

---

## 3. Search & Query Operations

### 3.1 Basic Search

#### `search_vcons` Tool
Advanced search across vCons.

**Input Schema:**
```typescript
{
  // Text search
  query?: {
    type: "string";
    description: "Full-text search query";
  };
  subject?: {
    type: "string";
    description: "Search by subject";
  };
  
  // Party search
  party_name?: { type: "string" };
  party_email?: { type: "string" };
  party_tel?: { type: "string" };
  party_role?: { type: "string" };
  
  // Dialog search
  dialog_type?: {
    type: "string";
    enum: ["recording", "text", "transfer", "video", "email"];
  };
  dialog_content?: {
    type: "string";
    description: "Search within dialog content";
  };
  
  // Analysis search
  analysis_type?: {
    type: "string";
    description: "Filter by analysis type";
  };
  
  // Metadata search
  tags?: {
    type: "object";
    description: "Search by tags (key-value pairs)";
  };
  
  // Date range
  date_range?: {
    type: "object";
    properties: {
      start: { type: "string"; format: "date-time" };
      end: { type: "string"; format: "date-time" };
    };
  };
  
  // Status filters
  done?: { type: "boolean" };
  corrupt?: { type: "boolean" };
  
  // Result options
  limit?: {
    type: "integer";
    default: 100;
    maximum: 1000;
  };
  offset?: {
    type: "integer";
    default: 0;
  };
  sort_by?: {
    type: "string";
    enum: ["created_at", "updated_at", "subject", "relevance"];
    default: "created_at";
  };
  sort_order?: {
    type: "string";
    enum: ["asc", "desc"];
    default: "desc";
  };
  
  // Component selection
  include_components?: {
    type: "array";
    items: { type: "string"; enum: ["parties", "dialog", "attachments", "analysis", "metadata"] };
    default: ["metadata"];
  };
}
```

**Features:**
- Full-text search across subjects and content
- Multi-field filtering
- Date range queries
- Party-based search
- Analysis type filtering
- Tag-based search
- Pagination support
- Configurable result components

### 3.2 Advanced Search

#### `full_text_search` Tool
PostgreSQL full-text search.

**Input Schema:**
```typescript
{
  search_query: {
    type: "string";
    description: "Search query using PostgreSQL syntax";
    required: true;
  };
  search_fields?: {
    type: "array";
    items: { type: "string"; enum: ["subject", "dialog_content", "analysis_content"] };
    default: ["subject", "dialog_content"];
  };
  rank_threshold?: {
    type: "number";
    default: 0.1;
    description: "Minimum relevance rank (0-1)";
  };
  limit?: { type: "integer"; default: 100 };
}
```

**Features:**
- PostgreSQL tsvector search
- Relevance ranking
- Multi-field search
- Configurable thresholds

#### `semantic_search` Tool
Vector-based semantic search for conversation content.

**Input Schema:**
```typescript
{
  query: {
    type: "string";
    required: true;
    description: "Natural language query describing what you're looking for";
  };
  search_scope?: {
    type: "array";
    items: { type: "string"; enum: ["subject", "dialog", "analysis_summaries"] };
    default: ["subject", "dialog"];
    description: "Where to perform semantic search";
  };
  similarity_threshold?: {
    type: "number";
    minimum: 0;
    maximum: 1;
    default: 0.7;
    description: "Minimum cosine similarity (0-1)";
  };
  embedding_provider?: {
    type: "string";
    enum: ["openai", "sentence_transformers", "custom"];
    default: "openai";
    description: "Embedding model provider";
  };
  limit?: {
    type: "integer";
    default: 20;
    maximum: 100;
  };
  include_similarity_scores?: {
    type: "boolean";
    default: true;
  };
  filter_tags?: {
    type: "object";
    description: "Pre-filter by exact tags before semantic search";
  };
}
```

**How It Works:**
1. Query is converted to vector embedding
2. Conversation content (subjects, dialog, summaries) are pre-embedded and stored
3. Cosine similarity computed between query and stored embeddings
4. Results ranked by semantic similarity

**Example Use Cases:**
```typescript
// Natural language search
semantic_search("customer frustrated about billing errors")
// Finds conversations about billing issues even if tagged differently
// Returns vCons discussing invoices, charges, payment problems

// Conceptual search
semantic_search("technical troubleshooting with escalation")
// Finds complex support conversations regardless of exact wording

// Intent-based search
semantic_search("customer wants to upgrade their subscription")
// Finds sales conversations about upsells, plan changes, expansions
```

**Response:**
```typescript
{
  results: Array<{
    vcon_uuid: string;
    similarity_score: number;
    matched_content: {
      subject?: string;
      dialog_excerpts?: Array<{
        dialog_index: number;
        text: string;
        relevance: number;
      }>;
    };
    tags?: object;
  }>;
  query_embedding?: number[]; // Optional: return for debugging
}
```

**Features:**
- Natural language queries
- Concept-based matching (not just keywords)
- Cross-lingual search (if model supports it)
- Intent and sentiment matching
- Can combine with tag filters for hybrid search

**Implementation Notes:**
- Requires embedding storage (vector column in PostgreSQL with pgvector extension)
- Embeddings can be pre-computed during vCon ingestion
- Can use OpenAI embeddings, Sentence Transformers, or custom models
- Consider caching embeddings for frequently searched content

#### `hybrid_search` Tool
Combine semantic and exact search for best results.

**Input Schema:**
```typescript
{
  semantic_query?: {
    type: "string";
    description: "Natural language query for semantic matching";
  };
  keyword_query?: {
    type: "string";
    description: "Keywords for exact/full-text matching";
  };
  tags?: {
    type: "object";
    description: "Exact tag filters";
  };
  weight_semantic?: {
    type: "number";
    minimum: 0;
    maximum: 1;
    default: 0.5;
    description: "Weight for semantic results (1 - this = keyword weight)";
  };
  limit?: {
    type: "integer";
    default: 20;
  };
}
```

**Example:**
```typescript
hybrid_search({
  semantic_query: "customer unhappy with service quality",
  tags: {
    department: "support",
    status: "open"
  },
  weight_semantic: 0.7
})
// Returns: Open support conversations semantically similar to
// "customer unhappy with service quality"
```

**Benefits of Hybrid Approach:**
1. **Precision + Recall**: Exact tags for precision, semantic for recall
2. **Handle Typos**: Semantic search doesn't require exact spelling
3. **Find Concepts**: Semantic finds related concepts not in tags
4. **Controllable**: Adjust weights based on use case

#### `aggregate_stats` Tool
Get aggregated statistics.

**Input Schema:**
```typescript
{
  group_by?: {
    type: "string";
    enum: ["analysis_type", "party_role", "dialog_type", "date", "hour", "day_of_week"];
  };
  filters?: {
    type: "object";
    description: "Filters to apply before aggregation";
  };
  metrics?: {
    type: "array";
    items: { type: "string"; enum: ["count", "avg_duration", "party_count", "dialog_count"] };
    default: ["count"];
  };
}
```

**Features:**
- Group by various dimensions
- Multiple aggregation metrics
- Pre-aggregation filtering

---

## 4. Tag Management System

Tags in vCon are **key-value pairs stored as a special attachment** with `type: "tag"`. They provide simple, flexible metadata for categorization, filtering, and organization. The Python vCon library uses `vcon.add_tag()` which creates these special attachments behind the scenes.

### 4.1 Core Tag Operations

#### `add_tag` Tool
Add or update a tag on a vCon.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
    required: true;
  };
  key: {
    type: "string";
    required: true;
    description: "Tag key/name";
  };
  value: {
    type: ["string", "number", "boolean"];
    required: true;
    description: "Tag value";
  };
  overwrite?: {
    type: "boolean";
    default: true;
    description: "Overwrite if tag already exists";
  };
}
```

**Features:**
- String, number, or boolean values
- Automatic type handling
- Overwrite protection option
- Creates tag attachment if none exists

**Examples:**
```typescript
// Customer identification
add_tag(uuid, "customer_id", "CUST-12345")

// Interaction tracking
add_tag(uuid, "interaction_id", "INT-2024-001")

// Business metadata
add_tag(uuid, "department", "sales")
add_tag(uuid, "priority", "high")
add_tag(uuid, "resolved", true)

// Campaign tracking
add_tag(uuid, "campaign", "spring_2024")
add_tag(uuid, "source", "web_chat")

// Quality scores
add_tag(uuid, "quality_score", 8.5)
add_tag(uuid, "csat", 4)
```

#### `get_tag` Tool
Retrieve a specific tag value.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
    required: true;
  };
  key: {
    type: "string";
    required: true;
    description: "Tag key to retrieve";
  };
  default_value?: {
    type: ["string", "number", "boolean", "null"];
    description: "Value to return if tag doesn't exist";
  };
}
```

**Response:**
```typescript
{
  key: string;
  value: string | number | boolean | null;
  exists: boolean;
}
```

#### `get_all_tags` Tool
Get all tags for a vCon.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
    required: true;
  };
  filter_prefix?: {
    type: "string";
    description: "Only return tags starting with this prefix (e.g., 'customer_')";
  };
}
```

**Response:**
```typescript
{
  tags: Record<string, string | number | boolean>;
  count: number;
}
```

**Example Response:**
```json
{
  "tags": {
    "customer_id": "CUST-12345",
    "interaction_id": "INT-2024-001",
    "department": "sales",
    "priority": "high",
    "resolved": true,
    "quality_score": 8.5
  },
  "count": 6
}
```

#### `remove_tag` Tool
Remove a tag from a vCon.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
    required: true;
  };
  key: {
    type: "string";
    required: true;
    description: "Tag key to remove";
  };
}
```

#### `update_tags` Tool
Update multiple tags at once.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
    required: true;
  };
  tags: {
    type: "object";
    required: true;
    description: "Key-value pairs to add/update";
  };
  merge?: {
    type: "boolean";
    default: true;
    description: "Merge with existing tags vs replace all";
  };
}
```

**Example:**
```typescript
update_tags(uuid, {
  "status": "closed",
  "resolution": "resolved",
  "resolution_time": 1842,  // seconds
  "follow_up_required": false
}, merge: true)
```

### 4.2 Bulk Tag Operations

#### `bulk_add_tags` Tool
Add same tag(s) to multiple vCons.

**Input Schema:**
```typescript
{
  vcon_uuids: {
    type: "array";
    items: { type: "string"; format: "uuid" };
    required: true;
  };
  tags: {
    type: "object";
    required: true;
    description: "Tags to add to all vCons";
  };
  overwrite?: {
    type: "boolean";
    default: true;
  };
}
```

**Example Use Cases:**
```typescript
// Tag all conversations from a campaign
bulk_add_tags(campaign_vcon_uuids, {
  "campaign": "summer_promo_2024",
  "tagged_date": "2024-06-15"
})

// Mark conversations for review
bulk_add_tags(flagged_uuids, {
  "needs_review": true,
  "flagged_by": "quality_system"
})

// Update department after reorganization
bulk_add_tags(sales_team_uuids, {
  "department": "revenue_operations"
})
```

#### `bulk_remove_tags` Tool
Remove tag(s) from multiple vCons.

**Input Schema:**
```typescript
{
  vcon_uuids: {
    type: "array";
    items: { type: "string"; format: "uuid" };
    required: true;
  };
  tag_keys: {
    type: "array";
    items: { type: "string" };
    required: true;
    description: "Tag keys to remove";
  };
}
```

#### `bulk_tag_by_search` Tool
Tag all vCons matching search criteria.

**Input Schema:**
```typescript
{
  search_criteria: {
    type: "object";
    required: true;
    description: "Search criteria to find vCons to tag";
  };
  tags: {
    type: "object";
    required: true;
    description: "Tags to apply";
  };
  preview?: {
    type: "boolean";
    default: false;
    description: "Preview how many vCons would be tagged";
  };
  max_count?: {
    type: "integer";
    description: "Maximum number of vCons to tag";
  };
}
```

**Example:**
```typescript
// Tag all unresolved high-priority conversations
bulk_tag_by_search({
  tags: { priority: "high", resolved: false },
  date_range: { start: "2024-01-01", end: "2024-06-30" }
}, {
  "needs_escalation": true,
  "escalation_date": "2024-07-01"
})
```

### 4.3 Tag-Based Search & Filtering

#### `search_by_tags` Tool
Find vCons by tag criteria.

**Input Schema:**
```typescript
{
  tags: {
    type: "object";
    required: true;
    description: "Tag criteria (all must match)";
  };
  match_mode?: {
    type: "string";
    enum: ["all", "any", "exact"];
    default: "all";
    description: "How to match multiple tags";
  };
  include_components?: {
    type: "array";
    items: { type: "string"; enum: ["parties", "dialog", "attachments", "analysis", "metadata"] };
    default: ["metadata"];
  };
  limit?: {
    type: "integer";
    default: 100;
  };
  offset?: {
    type: "integer";
    default: 0;
  };
}
```

**Match Modes:**
- **all**: vCon must have ALL specified tags with matching values (AND)
- **any**: vCon must have ANY of the specified tags (OR)
- **exact**: vCon must have EXACTLY these tags, no more, no less

**Examples:**
```typescript
// Find all high-priority sales conversations
search_by_tags({
  department: "sales",
  priority: "high"
}, match_mode: "all")

// Find conversations needing review OR escalation
search_by_tags({
  needs_review: true,
  needs_escalation: true
}, match_mode: "any")

// Find conversations with specific campaign tag
search_by_tags({
  campaign: "spring_2024"
})
```

#### `search_by_tag_prefix` Tool
Find vCons with tags matching a prefix.

**Input Schema:**
```typescript
{
  prefix: {
    type: "string";
    required: true;
    description: "Tag key prefix to match";
  };
  value_filter?: {
    type: "string";
    description: "Optional value filter";
  };
  limit?: { type: "integer"; default: 100 };
}
```

**Example:**
```typescript
// Find all vCons with any customer-related tags
search_by_tag_prefix("customer_")

// Returns vCons with tags like:
// customer_id, customer_name, customer_tier, etc.
```

#### `search_by_tag_pattern` Tool
Advanced tag search with wildcards.

**Input Schema:**
```typescript
{
  pattern: {
    type: "object";
    required: true;
    description: "Tag patterns with wildcards";
  };
  limit?: { type: "integer"; default: 100 };
}
```

**Example:**
```typescript
// Find conversations tagged with any Q1 campaign
search_by_tag_pattern({
  campaign: "q1_*"
})

// Find conversations with numeric quality scores above threshold
search_by_tag_pattern({
  quality_score: ">8.0"
})
```

### 4.4 Tag Analytics & Reporting

#### `get_tag_statistics` Tool
Get statistics about tag usage.

**Input Schema:**
```typescript
{
  tag_key?: {
    type: "string";
    description: "Specific tag key to analyze, or all if omitted";
  };
  date_range?: {
    type: "object";
    properties: {
      start: { type: "string"; format: "date-time" };
      end: { type: "string"; format: "date-time" };
    };
  };
}
```

**Response:**
```typescript
{
  tag_key: string;
  total_occurrences: number;
  unique_values: number;
  value_distribution: Record<string, number>;
  most_common_values: Array<{ value: string | number | boolean; count: number }>;
  data_types: Array<"string" | "number" | "boolean">;
}
```

**Example Response:**
```json
{
  "tag_key": "department",
  "total_occurrences": 15420,
  "unique_values": 8,
  "value_distribution": {
    "sales": 6200,
    "support": 5100,
    "billing": 2800,
    "technical": 1320
  },
  "most_common_values": [
    { "value": "sales", "count": 6200 },
    { "value": "support", "count": 5100 },
    { "value": "billing", "count": 2800 }
  ],
  "data_types": ["string"]
}
```

#### `get_all_tag_keys` Tool
List all unique tag keys in the database.

**Input Schema:**
```typescript
{
  sort_by?: {
    type: "string";
    enum: ["alphabetical", "frequency", "recent"];
    default: "alphabetical";
  };
  limit?: {
    type: "integer";
    default: 100;
  };
}
```

**Response:**
```typescript
{
  tag_keys: Array<{
    key: string;
    count: number;
    data_types: string[];
    first_seen: string; // ISO timestamp
    last_seen: string; // ISO timestamp
  }>;
  total_unique_keys: number;
}
```

#### `suggest_tags` Tool
Get tag suggestions based on vCon content.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
    required: true;
  };
  suggestion_sources?: {
    type: "array";
    items: { type: "string"; enum: ["subject", "parties", "dialog_content", "analysis", "similar_vcons"] };
    default: ["subject", "parties", "similar_vcons"];
  };
  max_suggestions?: {
    type: "integer";
    default: 10;
  };
}
```

**Response:**
```typescript
{
  suggested_tags: Array<{
    key: string;
    value: string | number | boolean;
    confidence: number; // 0-1
    source: string;
    reason: string;
  }>;
}
```

**Example Response:**
```json
{
  "suggested_tags": [
    {
      "key": "department",
      "value": "sales",
      "confidence": 0.92,
      "source": "dialog_content",
      "reason": "Multiple mentions of 'sales quota', 'sales team'"
    },
    {
      "key": "priority",
      "value": "high",
      "confidence": 0.78,
      "source": "similar_vcons",
      "reason": "Similar conversations are tagged high priority"
    },
    {
      "key": "product",
      "value": "enterprise_suite",
      "confidence": 0.85,
      "source": "subject",
      "reason": "Subject contains 'Enterprise Suite Demo'"
    }
  ]
}
```

### 4.5 Tag Templates & Presets

#### `create_tag_template` Tool
Create reusable tag templates.

**Input Schema:**
```typescript
{
  template_name: {
    type: "string";
    required: true;
  };
  tags: {
    type: "object";
    required: true;
    description: "Default tag key-value pairs";
  };
  variables?: {
    type: "array";
    items: { type: "string" };
    description: "Tag keys that should be filled in per-use";
  };
  description?: {
    type: "string";
  };
}
```

**Example:**
```typescript
// Create a customer support template
create_tag_template(
  "customer_support_call",
  {
    department: "support",
    type: "phone_call",
    recorded: true,
    // Variables to be filled in:
    // agent_id, customer_id, ticket_id, resolution
  },
  variables: ["agent_id", "customer_id", "ticket_id", "resolution"]
)
```

#### `apply_tag_template` Tool
Apply a template to a vCon.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
    required: true;
  };
  template_name: {
    type: "string";
    required: true;
  };
  variable_values?: {
    type: "object";
    description: "Values for template variables";
  };
}
```

**Example:**
```typescript
apply_tag_template(uuid, "customer_support_call", {
  agent_id: "AGENT-123",
  customer_id: "CUST-456",
  ticket_id: "TICKET-789",
  resolution: "resolved"
})
```

#### `list_tag_templates` Tool
List available tag templates.

**Response:**
```typescript
{
  templates: Array<{
    name: string;
    description: string;
    tags: object;
    variables: string[];
    usage_count: number;
  }>;
}
```

### 4.6 Tag Validation & Cleanup

#### `validate_tags` Tool
Validate tags across vCons.

**Input Schema:**
```typescript
{
  vcon_uuid?: {
    type: "string";
    format: "uuid";
    description: "Validate specific vCon, or all if omitted";
  };
  rules?: {
    type: "array";
    items: {
      type: "object";
      properties: {
        key: { type: "string" };
        required?: { type: "boolean" };
        data_type?: { type: "string"; enum: ["string", "number", "boolean"] };
        allowed_values?: { type: "array" };
        pattern?: { type: "string"; description: "Regex pattern" };
      };
    };
  };
}
```

**Example:**
```typescript
validate_tags(uuid, rules: [
  {
    key: "department",
    required: true,
    allowed_values: ["sales", "support", "billing", "technical"]
  },
  {
    key: "customer_id",
    required: true,
    pattern: "^CUST-\\d{4,}$"
  },
  {
    key: "priority",
    allowed_values: ["low", "medium", "high", "urgent"]
  }
])
```

#### `cleanup_tags` Tool
Clean up malformed or deprecated tags.

**Input Schema:**
```typescript
{
  operations: {
    type: "array";
    items: {
      type: "string";
      enum: [
        "remove_empty_values",
        "normalize_case",
        "trim_whitespace",
        "remove_deprecated_keys",
        "standardize_types",
        "remove_duplicates"
      ];
    };
    required: true;
  };
  deprecated_keys?: {
    type: "array";
    items: { type: "string" };
    description: "Tag keys to remove";
  };
  dry_run?: {
    type: "boolean";
    default: true;
  };
}
```

### 4.7 Tag Resources (MCP URI Access)

```typescript
"vcon://uuid/{uuid}/tags": {
  description: "Get all tags for a vCon";
  mimeType: "application/json";
}

"vcon://uuid/{uuid}/tags/{key}": {
  description: "Get specific tag value";
  mimeType: "application/json";
}

"vcon://tags/search": {
  description: "Search vCons by tags";
  mimeType: "application/json";
  parameters: {
    tags: object;
    match_mode?: "all" | "any" | "exact";
  };
}

"vcon://tags/keys": {
  description: "List all unique tag keys";
  mimeType: "application/json";
}

"vcon://tags/stats": {
  description: "Tag usage statistics";
  mimeType: "application/json";
  parameters: {
    tag_key?: string;
  };
}

"vcon://tags/templates": {
  description: "List tag templates";
  mimeType: "application/json";
}
```

### 4.8 Common Tag Patterns

#### Standard Business Tags
```typescript
// Customer relationship
{
  "customer_id": "CUST-12345",
  "customer_name": "Acme Corp",
  "customer_tier": "enterprise",
  "customer_segment": "b2b"
}

// Interaction tracking
{
  "interaction_id": "INT-2024-001",
  "interaction_type": "support_call",
  "channel": "phone",
  "interaction_date": "2024-01-15"
}

// Agent/employee tracking
{
  "agent_id": "AGENT-789",
  "agent_name": "Sarah Johnson",
  "team": "support_tier_2",
  "supervisor": "MGR-045"
}

// Categorization
{
  "department": "sales",
  "product": "enterprise_suite",
  "region": "north_america",
  "language": "en-US"
}

// Status tracking
{
  "status": "closed",
  "resolution": "resolved",
  "escalated": false,
  "follow_up_required": true,
  "follow_up_date": "2024-01-20"
}

// Quality & metrics
{
  "quality_score": 8.5,
  "csat": 4,
  "nps": 9,
  "handled_by_bot": false,
  "first_contact_resolution": true
}

// Compliance & legal
{
  "recorded": true,
  "recording_consent": true,
  "retention_period_days": 2555,
  "data_classification": "confidential"
}
```

---

## 5. Batch & Bulk Operations

### 5.1 Batch Import

#### `import_vcons_batch` Tool
Import multiple vCons from array.

**Input Schema:**
```typescript
{
  vcons: {
    type: "array";
    items: { type: "object" };
    description: "Array of vCon objects";
    required: true;
  };
  validate_all?: {
    type: "boolean";
    default: true;
    description: "Validate all vCons before inserting any";
  };
  continue_on_error?: {
    type: "boolean";
    default: false;
    description: "Continue importing valid vCons if some fail";
  };
  return_results?: {
    type: "boolean";
    default: true;
    description: "Return detailed import results";
  };
}
```

**Response:**
```typescript
{
  total: number;
  successful: number;
  failed: number;
  errors: Array<{ index: number; error: string; vcon_uuid?: string }>;
  imported_uuids: string[];
}
```

#### `import_vcons_from_file` Tool
Import vCons from file.

**Input Schema:**
```typescript
{
  file_path: {
    type: "string";
    description: "Path to JSON file or JSONL file";
    required: true;
  };
  format: {
    type: "string";
    enum: ["json_array", "jsonl", "auto_detect"];
    default: "auto_detect";
  };
  batch_size?: {
    type: "integer";
    default: 100;
    description: "Number of vCons to process per batch";
  };
  validate_all?: { type: "boolean"; default: true };
  continue_on_error?: { type: "boolean"; default: false };
}
```

**Features:**
- JSON array format support
- JSONL (newline-delimited JSON) support
- Batched processing for large files
- Error handling options

#### `import_vcons_from_url` Tool
Import vCons from remote URL.

**Input Schema:**
```typescript
{
  url: {
    type: "string";
    format: "uri";
    required: true;
  };
  format: {
    type: "string";
    enum: ["json_array", "jsonl", "auto_detect"];
    default: "auto_detect";
  };
  headers?: {
    type: "object";
    description: "HTTP headers for request";
  };
  auth?: {
    type: "object";
    properties: {
      type: { type: "string"; enum: ["basic", "bearer", "api_key"] };
      credentials: { type: "object" };
    };
  };
}
```

### 4.2 Batch Export

#### `export_vcons_batch` Tool
Export multiple vCons.

**Input Schema:**
```typescript
{
  uuids: {
    type: "array";
    items: { type: "string"; format: "uuid" };
    description: "UUIDs to export";
  };
  search_criteria?: {
    type: "object";
    description: "Alternative to UUIDs - export by search";
  };
  format: {
    type: "string";
    enum: ["json_array", "jsonl", "individual_files"];
    default: "json_array";
  };
  output_path?: {
    type: "string";
    description: "File path or directory for export";
  };
  include_components?: {
    type: "array";
    items: { type: "string"; enum: ["parties", "dialog", "attachments", "analysis", "all"] };
    default: ["all"];
  };
  compression?: {
    type: "string";
    enum: ["none", "gzip", "zip"];
    default: "none";
  };
}
```

**Features:**
- Multiple export formats
- Selective component export
- Compression options
- File or in-memory export

#### `export_to_url` Tool
POST vCons to external URL.

**Input Schema:**
```typescript
{
  uuids: {
    type: "array";
    items: { type: "string"; format: "uuid" };
  };
  destination_url: {
    type: "string";
    format: "uri";
    required: true;
  };
  batch_size?: {
    type: "integer";
    default: 10;
    description: "Number of vCons per HTTP request";
  };
  headers?: {
    type: "object";
  };
  auth?: {
    type: "object";
  };
  retry_on_failure?: {
    type: "boolean";
    default: true;
  };
  max_retries?: {
    type: "integer";
    default: 3;
  };
}
```

### 4.3 Batch Updates

#### `bulk_update_vcons` Tool
Update multiple vCons at once.

**Input Schema:**
```typescript
{
  uuids: {
    type: "array";
    items: { type: "string"; format: "uuid" };
  };
  updates: {
    type: "object";
    description: "Updates to apply to all vCons";
    required: true;
  };
  merge_strategy?: {
    type: "string";
    enum: ["replace", "merge", "append"];
    default: "merge";
  };
}
```

#### `bulk_tag_vcons` Tool
Add/remove tags from multiple vCons.

**Input Schema:**
```typescript
{
  uuids: {
    type: "array";
    items: { type: "string"; format: "uuid" };
  };
  tags_to_add?: {
    type: "object";
    description: "Tags to add (key-value pairs)";
  };
  tags_to_remove?: {
    type: "array";
    items: { type: "string" };
    description: "Tag keys to remove";
  };
}
```

---

## 5. Validation & Quality Operations

### 5.1 Validation

#### `validate_vcon` Tool
Validate vCon against IETF specification.

**Input Schema:**
```typescript
{
  vcon_uuid?: {
    type: "string";
    format: "uuid";
    description: "Validate stored vCon";
  };
  vcon_data?: {
    type: "object";
    description: "Validate provided vCon object";
  };
  strict_mode?: {
    type: "boolean";
    default: false;
    description: "Enforce strict compliance vs lenient";
  };
  check_references?: {
    type: "boolean";
    default: true;
    description: "Validate party/dialog index references";
  };
}
```

**Response:**
```typescript
{
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
    severity: "error" | "warning";
  }>;
  warnings: string[];
  compliance_level: "full" | "partial" | "non_compliant";
}
```

#### `validate_vcons_batch` Tool
Batch validation.

**Input Schema:**
```typescript
{
  uuids?: {
    type: "array";
    items: { type: "string"; format: "uuid" };
  };
  search_criteria?: {
    type: "object";
    description: "Validate all matching vCons";
  };
  parallel_processing?: {
    type: "boolean";
    default: true;
  };
}
```

**Response:**
```typescript
{
  total: number;
  valid: number;
  invalid: number;
  results: Array<{
    uuid: string;
    valid: boolean;
    errors: string[];
  }>;
}
```

### 5.2 Data Quality

#### `check_data_quality` Tool
Run data quality checks.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  checks: {
    type: "array";
    items: {
      type: "string";
      enum: [
        "missing_parties",
        "empty_dialogs",
        "orphaned_references",
        "invalid_timestamps",
        "missing_required_fields",
        "duplicate_parties",
        "invalid_urls",
        "encoding_issues"
      ];
    };
    default: ["all"];
  };
}
```

**Response:**
```typescript
{
  quality_score: number; // 0-100
  issues: Array<{
    check: string;
    severity: "critical" | "warning" | "info";
    message: string;
    suggested_fix?: string;
  }>;
  passed_checks: string[];
  failed_checks: string[];
}
```

#### `repair_vcon` Tool
Attempt automatic repair of vCon issues.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  repair_actions: {
    type: "array";
    items: {
      type: "string";
      enum: [
        "fix_timestamps",
        "remove_orphaned_references",
        "add_missing_uuids",
        "normalize_encodings",
        "deduplicate_parties"
      ];
    };
  };
  dry_run?: {
    type: "boolean";
    default: true;
    description: "Preview changes without applying";
  };
}
```

---

## 6. Analysis & Insight Operations (Non-Compliance)

### 6.1 Content Analysis

#### `analyze_conversation` Prompt
Generic analysis workflow.

**Arguments:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
    required: true;
  };
  analysis_type: {
    type: "string";
    enum: ["sentiment", "summary", "topics", "entities", "keywords", "language_detection", "custom"];
    required: true;
  };
  parameters?: {
    type: "object";
    description: "Analysis-specific parameters";
  };
  save_to_vcon?: {
    type: "boolean";
    default: true;
    description: "Save results as analysis entry";
  };
}
```

**Features:**
- Sentiment analysis
- Conversation summarization
- Topic extraction
- Named entity recognition
- Keyword extraction
- Language detection
- Custom analysis pipelines

#### `extract_insights` Prompt
Extract specific insights.

**Arguments:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  insight_types: {
    type: "array";
    items: {
      type: "string";
      enum: [
        "key_topics",
        "action_items",
        "decisions_made",
        "questions_asked",
        "participant_sentiment",
        "conversation_flow",
        "important_quotes"
      ];
    };
    required: true;
  };
  format?: {
    type: "string";
    enum: ["json", "markdown", "text"];
    default: "json";
  };
}
```

### 6.2 Transcription (Integration Ready)

#### `transcribe_dialog` Tool
Transcribe audio/video dialog.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  dialog_index: {
    type: "integer";
    minimum: 0;
  };
  service: {
    type: "string";
    enum: ["deepgram", "whisper", "google_speech", "aws_transcribe", "custom"];
    description: "Transcription service to use";
  };
  options?: {
    type: "object";
    properties: {
      language?: { type: "string" };
      model?: { type: "string" };
      punctuation?: { type: "boolean" };
      diarization?: { type: "boolean" };
      timestamps?: { type: "boolean" };
    };
  };
  save_as_analysis?: {
    type: "boolean";
    default: true;
  };
}
```

**Features:**
- Multiple transcription service support
- Speaker diarization
- Timestamp generation
- Language detection
- Automatic save to analysis

---

## 7. MCP Resources (URI-based Access)

### 7.1 Direct vCon Access

```typescript
"vcon://uuid/{uuid}": {
  description: "Get complete vCon by UUID";
  mimeType: "application/json";
}

"vcon://uuid/{uuid}/parties": {
  description: "Get parties array";
  mimeType: "application/json";
}

"vcon://uuid/{uuid}/dialog": {
  description: "Get dialog array";
  mimeType: "application/json";
}

"vcon://uuid/{uuid}/dialog/{index}": {
  description: "Get specific dialog by index";
  mimeType: "application/json";
}

"vcon://uuid/{uuid}/attachments": {
  description: "Get attachments array";
  mimeType: "application/json";
}

"vcon://uuid/{uuid}/attachments/{index}": {
  description: "Get specific attachment by index";
  mimeType: "application/json";
}

"vcon://uuid/{uuid}/analysis": {
  description: "Get all analysis results";
  mimeType: "application/json";
}

"vcon://uuid/{uuid}/analysis/{type}": {
  description: "Get analysis by type";
  mimeType: "application/json";
}

"vcon://uuid/{uuid}/metadata": {
  description: "Get vCon metadata only (no content)";
  mimeType: "application/json";
}
```

### 7.2 Search Resources

```typescript
"vcon://search": {
  description: "Search vCons with query parameters";
  mimeType: "application/json";
  parameters: {
    q?: string; // query
    subject?: string;
    party?: string;
    type?: string;
    limit?: number;
    offset?: number;
  };
}

"vcon://recent": {
  description: "Get most recent vCons";
  mimeType: "application/json";
  parameters: {
    limit?: number;
    hours?: number;
  };
}
```

### 7.3 Aggregate Resources

```typescript
"vcon://stats/summary": {
  description: "Database summary statistics";
  mimeType: "application/json";
  content: {
    total_vcons: number;
    total_parties: number;
    total_dialogs: number;
    total_analysis: number;
    by_type: Record<string, number>;
    by_status: Record<string, number>;
  };
}

"vcon://stats/analysis_types": {
  description: "Analysis types with counts";
  mimeType: "application/json";
}

"vcon://stats/party_roles": {
  description: "Party roles distribution";
  mimeType: "application/json";
}

"vcon://stats/dialog_types": {
  description: "Dialog types distribution";
  mimeType: "application/json";
}
```

---

## 8. Format Conversion & Export

### 8.1 Format Conversion

#### `export_vcon` Prompt
Export in various formats.

**Arguments:**
```typescript
{
  uuid: {
    type: "string";
    format: "uuid";
  };
  format: {
    type: "string";
    enum: ["standard", "minimal", "readable", "csv", "html"];
    default: "standard";
  };
  include_binary?: {
    type: "boolean";
    default: false;
    description: "Include base64 binary data";
  };
  compression?: {
    type: "string";
    enum: ["none", "gzip", "zip"];
    default: "none";
  };
}
```

**Formats:**
- **standard**: Full IETF vCon JSON
- **minimal**: Metadata + references only
- **readable**: Human-readable HTML or Markdown
- **csv**: Flattened CSV export (for dialogs/parties)
- **html**: Formatted HTML view

#### `convert_format` Tool
Convert between vCon versions.

**Input Schema:**
```typescript
{
  vcon_uuid: {
    type: "string";
    format: "uuid";
  };
  target_version: {
    type: "string";
    enum: ["0.0.1", "0.0.2", "latest"];
    default: "latest";
  };
  preserve_extensions?: {
    type: "boolean";
    default: true;
  };
}
```

---

## 9. Database & System Operations

### 9.1 Database Management

#### `database_stats` Tool
Get database statistics.

**Response:**
```typescript
{
  total_vcons: number;
  total_parties: number;
  total_dialogs: number;
  total_attachments: number;
  total_analysis: number;
  database_size_mb: number;
  oldest_vcon: string; // ISO timestamp
  newest_vcon: string; // ISO timestamp
  by_analysis_type: Record<string, number>;
  by_dialog_type: Record<string, number>;
}
```

#### `vacuum_database` Tool
Clean up and optimize database.

**Input Schema:**
```typescript
{
  remove_orphaned_records?: {
    type: "boolean";
    default: true;
  };
  analyze_tables?: {
    type: "boolean";
    default: true;
  };
  rebuild_indexes?: {
    type: "boolean";
    default: false;
  };
}
```

### 9.2 Health Checks

#### `health_check` Tool
Server health status.

**Response:**
```typescript
{
  status: "healthy" | "degraded" | "unhealthy";
  database_connection: boolean;
  response_time_ms: number;
  version: string;
  uptime_seconds: number;
  last_error?: string;
}
```

---

## 10. Webhook & Event System (Open Source)

### 10.1 Webhook Configuration

#### `configure_webhook` Tool
Set up webhooks for events.

**Input Schema:**
```typescript
{
  webhook_url: {
    type: "string";
    format: "uri";
    required: true;
  };
  events: {
    type: "array";
    items: {
      type: "string";
      enum: [
        "vcon.created",
        "vcon.updated",
        "vcon.deleted",
        "dialog.added",
        "analysis.added",
        "validation.failed"
      ];
    };
    required: true;
  };
  auth?: {
    type: "object";
    properties: {
      type: { type: "string"; enum: ["basic", "bearer", "api_key"] };
      credentials: { type: "object" };
    };
  };
  retry_policy?: {
    type: "object";
    properties: {
      max_retries: { type: "integer"; default: 3 };
      retry_delay_ms: { type: "integer"; default: 1000 };
    };
  };
}
```

---

## 11. Developer Features

### 11.1 Schema & Documentation

#### `get_schema` Tool
Get vCon schema definition.

**Input Schema:**
```typescript
{
  version?: {
    type: "string";
    default: "latest";
  };
  format?: {
    type: "string";
    enum: ["json_schema", "typescript", "openapi"];
    default: "json_schema";
  };
}
```

#### `get_examples` Tool
Get example vCons.

**Input Schema:**
```typescript
{
  example_type: {
    type: "string";
    enum: ["minimal", "phone_call", "chat", "email", "video", "full_featured"];
  };
  format?: {
    type: "string";
    enum: ["json", "yaml"];
    default: "json";
  };
}
```

---

## Summary of Open Source Features

### Core Capabilities
✅ Full CRUD operations for vCons
✅ Component management (parties, dialog, attachments, analysis)
✅ Advanced search and filtering
✅ Batch import/export
✅ Validation and data quality checks
✅ Basic analysis (sentiment, topics, summaries)
✅ Format conversion
✅ Webhook system
✅ Full-text search
✅ Aggregation and statistics
✅ MCP Resources (URI-based access)

### What's NOT Included (Proprietary)
❌ Consent management
❌ Privacy request handling (GDPR/CCPA)
❌ Compliance checking
❌ Access logging with audit trails
❌ Privacy-level data filtering
❌ PII detection and masking (beyond basic)
❌ Data retention enforcement
❌ Transparency service integration
❌ Regulatory compliance workflows

This makes the open source version extremely valuable for:
- Development and testing
- Non-regulated use cases
- Custom implementations
- Academic research
- Community building

While the proprietary version is essential for:
- Healthcare (HIPAA)
- Finance (PCI)
- EU operations (GDPR)
- California operations (CCPA)
- Enterprise compliance needs
