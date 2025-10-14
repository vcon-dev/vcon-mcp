# TypeScript Types Reference

Complete TypeScript type definitions for the vCon MCP Server.

## Overview

The vCon MCP Server provides full type safety through TypeScript and Zod validation. All types comply with [IETF vCon Core](https://datatracker.ietf.org/doc/html/draft-ietf-vcon-vcon-core-00) specification.

---

## Core vCon Types

### VCon

Main vCon object representing a complete virtual conversation.

```typescript
interface VCon {
  // Core Metadata (Section 4.1)
  vcon: string;                    // vCon version (e.g., "0.3.0")
  uuid: string;                    // vCon UUID (RFC 4122)
  created_at: string;              // ISO 8601 timestamp
  updated_at?: string;             // ISO 8601 timestamp
  subject?: string;                // Conversation subject/title
  
  // Extensions (Section 4.1.3)
  extensions?: string[];           // Extension identifiers
  must_support?: string[];         // Required extension support
  
  // Components
  parties: Party[];                // Participants (at least 1 required)
  dialog?: Dialog[];               // Conversation segments
  analysis?: Analysis[];           // AI/ML analysis results
  attachments?: Attachment[];      // Additional files/data
  
  // Advanced Features
  group?: Group[];                 // vCon grouping (Section 4.6)
  redacted?: Record<string, any>;  // Redaction tracking
  appended?: Record<string, any>;  // Append-only modifications
}
```

---

### Party

Represents a participant in a conversation (Section 4.2).

```typescript
interface Party {
  // Contact Information
  tel?: string;                    // Phone number (E.164 format)
  sip?: string;                    // SIP URI
  mailto?: string;                 // Email address
  name?: string;                   // Display name
  
  // Identity & Verification (Section 4.2.3-4.2.6)
  stir?: string;                   // STIR/SHAKEN PASSporT
  did?: string;                    // Decentralized Identifier
  uuid?: string;                   // UUID for this party (RFC 4122)
  validation?: string;             // Identity validation info
  
  // Location (Section 4.2.7-4.2.9)
  timezone?: string;               // IANA timezone
  gmlpos?: string;                 // GML position
  civicaddress?: object;           // RFC 5139 civic address
  
  // vCard (Section 4.2.10)
  jcard?: object;                  // JSON vCard (RFC 7095)
  
  // At least one contact method required
}
```

**Party Examples:**

```typescript
// Phone party
{
  tel: "+1-555-1234",
  name: "John Doe",
  timezone: "America/New_York"
}

// Email party
{
  mailto: "support@example.com",
  name: "Support Agent",
  uuid: "550e8400-e29b-41d4-a716-446655440000"
}

// SIP party
{
  sip: "sip:user@example.com",
  name: "Alice Smith",
  stir: "eyJhbGciOiJFUzI1NiIsInR5cCI6InBhc3Nwb3J0..."
}
```

---

### Dialog

Represents a segment of conversation content (Section 4.3).

```typescript
interface Dialog {
  // Required
  type: "recording" | "text" | "transfer" | "incomplete";
  
  // Timing (Section 4.3.2-4.3.3)
  start?: string;                  // ISO 8601 timestamp
  duration?: number;               // Duration in seconds
  
  // Participants (Section 4.3.4-4.3.5)
  parties?: number | number[];     // Party index or array of indexes
  originator?: number;             // Party index of originator
  
  // Content
  body?: string;                   // Dialog content
  encoding?: "none" | "base64url" | "json";
  url?: string;                    // External URL
  
  // Media (Section 4.3.6-4.3.7)
  mediatype?: string;              // MIME type
  filename?: string;               // Original filename
  
  // Call Disposition (Section 4.3.9)
  disposition?: 
    | "no-answer"
    | "congestion"
    | "failed"
    | "busy"
    | "hung-up"
    | "voicemail-no-message";
  
  // Session Tracking (Section 4.3.10, 4.3.13, 4.3.14)
  session_id?: string;             // Session identifier
  application?: string;            // Application that created dialog
  message_id?: string;             // Message identifier
  
  // Integrity
  content_hash?: string | string[]; // SHA-256 hash
}
```

**Dialog Examples:**

```typescript
// Text message
{
  type: "text",
  start: "2025-10-14T10:30:00Z",
  parties: [0, 1],
  originator: 1,
  body: "Hello, I need help with my account.",
  encoding: "none"
}

// Audio recording
{
  type: "recording",
  start: "2025-10-14T10:30:00Z",
  duration: 185.5,
  parties: [0, 1],
  mediatype: "audio/mpeg",
  filename: "call-recording.mp3",
  url: "https://storage.example.com/recordings/abc123.mp3",
  encoding: "none"
}

// Video call
{
  type: "recording",
  start: "2025-10-14T14:00:00Z",
  duration: 3600,
  parties: [0, 1, 2],
  mediatype: "video/mp4",
  session_id: "video-call-abc123",
  application: "Zoom",
  disposition: "hung-up"
}
```

---

### Analysis

AI/ML analysis results for conversation content (Section 4.5).

```typescript
interface Analysis {
  // Required
  type: string;                    // Analysis type (see types below)
  vendor: string;                  // REQUIRED: Vendor/producer
  
  // References (Section 4.5.2)
  dialog?: number | number[];      // Dialog index(es) analyzed
  
  // Product Info (Section 4.5.6-4.5.7)
  product?: string;                // Product/model name
  schema?: string;                 // Schema identifier/version
  
  // Content (Section 4.5.8)
  body?: string;                   // Analysis content (any format)
  encoding?: "none" | "json" | "base64url";
  url?: string;                    // External URL
  
  // Media
  mediatype?: string;              // MIME type of body
  filename?: string;               // Filename if applicable
  
  // Integrity
  content_hash?: string | string[]; // SHA-256 hash
}
```

**Common Analysis Types:**

| Type | Description | Body Format |
|------|-------------|-------------|
| `summary` | Conversation summary | Text or JSON |
| `transcript` | Speech-to-text | Text or JSON with timestamps |
| `translation` | Language translation | Text or JSON |
| `sentiment` | Sentiment analysis | JSON with scores |
| `keywords` | Keyword extraction | JSON array |
| `entities` | Named entity recognition | JSON |
| `topics` | Topic classification | JSON |
| `action_items` | Action item extraction | JSON array |
| `pii_detection` | PII identification | JSON |

**Analysis Examples:**

```typescript
// Sentiment analysis
{
  type: "sentiment",
  vendor: "OpenAI",
  product: "GPT-4",
  schema: "v1.0",
  dialog: [0],
  body: JSON.stringify({
    sentiment: "positive",
    score: 0.85,
    confidence: 0.92
  }),
  encoding: "json"
}

// Transcript
{
  type: "transcript",
  vendor: "Google Cloud",
  product: "Speech-to-Text",
  dialog: [0],
  body: JSON.stringify({
    transcript: "Hello, I need help with my account.",
    confidence: 0.98,
    language: "en-US"
  }),
  encoding: "json"
}

// Summary
{
  type: "summary",
  vendor: "Anthropic",
  product: "Claude-3.5",
  body: "Customer called about billing issue. Agent provided refund.",
  encoding: "none"
}
```

---

### Attachment

Additional files or data associated with a conversation (Section 4.4).

```typescript
interface Attachment {
  // Type & Timing
  type?: string;                   // Attachment type
  start?: string;                  // ISO 8601 timestamp
  
  // References (Section 4.4.3-4.4.4)
  party?: number;                  // Associated party index
  dialog?: number;                 // Associated dialog index
  
  // Content
  body?: string;                   // Attachment content
  encoding?: "none" | "json" | "base64url";
  url?: string;                    // External URL
  
  // Media
  mediatype?: string;              // MIME type
  filename?: string;               // Original filename
  
  // Integrity
  content_hash?: string | string[]; // SHA-256 hash
}
```

**Special Attachment Types:**

```typescript
// Tags attachment (for metadata)
{
  type: "tags",
  encoding: "json",
  body: JSON.stringify([
    "department:sales",
    "priority:high",
    "customer_id:12345"
  ])
}

// PDF document
{
  type: "invoice",
  party: 0,
  mediatype: "application/pdf",
  filename: "invoice-12345.pdf",
  body: "base64-encoded-content",
  encoding: "base64url"
}

// Screenshot
{
  type: "screenshot",
  dialog: 0,
  mediatype: "image/png",
  filename: "error-screenshot.png",
  url: "https://storage.example.com/screenshots/abc.png",
  encoding: "none"
}
```

---

### Group

Reference to other vCons for grouping (Section 4.6).

```typescript
interface Group {
  // Reference
  uuid?: string;                   // UUID of referenced vCon
  url?: string;                    // External URL to vCon
  
  // Inline Content
  body?: string;                   // Inline vCon content
  encoding: "json";                // Must be 'json' per spec
  
  // Integrity
  content_hash?: string | string[]; // SHA-256 hash
  
  // Exactly one of: uuid, url, or body+encoding required
}
```

---

## MCP Tool Input Types

### CreateVConInput

```typescript
interface CreateVConInput {
  vcon_data: {
    vcon?: string;                 // Default: "0.3.0"
    uuid?: string;                 // Auto-generated if not provided
    subject?: string;
    parties: Party[];              // At least 1 required
    dialog?: Dialog[];
    analysis?: Analysis[];
    attachments?: Attachment[];
    extensions?: string[];
    must_support?: string[];
  };
  metadata?: {
    basename?: string;
    filename?: string;
    tags?: Record<string, string>;
  };
  validate_before_insert?: boolean; // Default: true
}
```

### SearchVConsInput

```typescript
interface SearchVConsInput {
  // Metadata Filters
  subject?: string;                // Subject text search
  party_name?: string;             // Party name search
  party_email?: string;            // Party email search
  party_tel?: string;              // Party phone search
  
  // Date Filters
  start_date?: string;             // ISO 8601
  end_date?: string;               // ISO 8601
  
  // Pagination
  limit?: number;                  // Default: 50, Max: 1000
  offset?: number;                 // For pagination
}
```

### SearchVConsContentInput

```typescript
interface SearchVConsContentInput {
  query: string;                   // REQUIRED: Search query
  tags?: Record<string, string>;   // Tag filters
  start_date?: string;             // ISO 8601
  end_date?: string;               // ISO 8601
  limit?: number;                  // Default: 50
  include_snippets?: boolean;      // Default: true
}
```

### SearchVConsSemanticInput

```typescript
interface SearchVConsSemanticInput {
  query?: string;                  // Natural language query
  embedding?: number[];            // Or provide embedding (384 dims)
  threshold?: number;              // Similarity threshold (0-1), default: 0.7
  tags?: Record<string, string>;   // Tag filters
  limit?: number;                  // Default: 20
}
```

### SearchVConsHybridInput

```typescript
interface SearchVConsHybridInput {
  query: string;                   // REQUIRED: Search query
  semantic_weight?: number;        // 0-1, default: 0.6
  tags?: Record<string, string>;   // Tag filters
  start_date?: string;             // ISO 8601
  end_date?: string;               // ISO 8601
  limit?: number;                  // Default: 30
}
```

### TagInput

```typescript
interface ManageTagInput {
  vcon_uuid: string;               // UUID (RFC 4122)
  action: "set" | "remove";        // Action to perform
  key: string;                     // Tag key
  value?: string | number | boolean; // Tag value (required for "set")
}

interface GetTagsInput {
  vcon_uuid: string;               // UUID (RFC 4122)
  key?: string;                    // Specific tag key (optional)
  default_value?: any;             // Default if key not found
}

interface SearchByTagsInput {
  tags: Record<string, string>;    // REQUIRED: Tag key-value pairs
  limit?: number;                  // Default: 50, Max: 100
}

interface GetUniqueTagsInput {
  include_counts?: boolean;        // Include usage statistics
  key_filter?: string;             // Filter by key substring
  min_count?: number;              // Minimum occurrence count
}
```

---

## MCP Response Types

### StandardResponse

```typescript
interface StandardResponse {
  success: boolean;
  message?: string;
  error?: string;
  details?: any;
}
```

### CreateVConResponse

```typescript
interface CreateVConResponse extends StandardResponse {
  uuid: string;
  vcon?: VCon;
}
```

### GetVConResponse

```typescript
interface GetVConResponse extends StandardResponse {
  vcon: VCon;
}
```

### SearchResponse

```typescript
interface SearchResponse<T> extends StandardResponse {
  count: number;
  results: T[];
  has_more?: boolean;
}
```

### SearchContentResult

```typescript
interface SearchContentResult {
  vcon_id: string;
  content_type: "subject" | "dialog" | "analysis" | "party";
  content_index?: number;
  relevance_score: number;
  snippet?: string;
  vcon?: VCon;
}
```

### SearchSemanticResult

```typescript
interface SearchSemanticResult {
  vcon_id: string;
  similarity_score: number;
  matched_content: {
    subject?: string;
    dialog_excerpts?: Array<{
      dialog_index: number;
      text: string;
      relevance: number;
    }>;
  };
  vcon?: VCon;
}
```

### SearchHybridResult

```typescript
interface SearchHybridResult {
  vcon_id: string;
  combined_score: number;
  keyword_score: number;
  semantic_score: number;
  vcon?: VCon;
}
```

### TagsResponse

```typescript
interface GetTagsResponse extends StandardResponse {
  vcon_uuid: string;
  tags: Record<string, string | number | boolean>;
  count: number;
}

interface GetTagResponse extends StandardResponse {
  key: string;
  value: any;
  exists: boolean;
}

interface UniqueTagsResponse extends StandardResponse {
  unique_keys: string[];
  unique_key_count: number;
  tags_by_key: Record<string, string[]>;
  counts_per_value?: Record<string, Record<string, number>>;
  total_vcons_with_tags: number;
}
```

---

## Validation

All types are validated using Zod schemas. Example:

```typescript
import { z } from 'zod';

const PartySchema = z.object({
  tel: z.string().optional(),
  sip: z.string().optional(),
  mailto: z.string().email().optional(),
  name: z.string().optional(),
  did: z.string().optional(),
  uuid: z.string().uuid().optional(),
  validation: z.string().optional(),
  timezone: z.string().optional(),
  jcard: z.any().optional(),
  gmlpos: z.string().optional(),
  civicaddress: z.any().optional()
}).refine(
  data => data.tel || data.sip || data.mailto,
  { message: "At least one contact method required" }
);
```

---

## Type Guards

```typescript
// Check if vCon is valid
function isValidVCon(obj: any): obj is VCon {
  return (
    typeof obj.vcon === 'string' &&
    typeof obj.uuid === 'string' &&
    Array.isArray(obj.parties) &&
    obj.parties.length > 0
  );
}

// Check dialog type
function isTextDialog(dialog: Dialog): boolean {
  return dialog.type === 'text';
}

// Check if analysis has JSON body
function hasJsonAnalysis(analysis: Analysis): boolean {
  return analysis.encoding === 'json' && !!analysis.body;
}
```

---

## Constants

```typescript
// vCon Version
export const VCON_VERSION = '0.3.0';

// Dialog Types
export const DIALOG_TYPES = ['recording', 'text', 'transfer', 'incomplete'] as const;

// Encoding Types
export const ENCODING_TYPES = ['none', 'base64url', 'json'] as const;

// Disposition Values
export const DISPOSITIONS = [
  'no-answer',
  'congestion',
  'failed',
  'busy',
  'hung-up',
  'voicemail-no-message'
] as const;

// Common Analysis Types
export const ANALYSIS_TYPES = [
  'summary',
  'transcript',
  'translation',
  'sentiment',
  'keywords',
  'entities',
  'topics',
  'action_items',
  'pii_detection'
] as const;
```

---

## Next Steps

- See [Tools Reference](./tools.md) for tool definitions
- See [Database Schema](./schema.md) for database structure
- See [Examples](/examples/) for usage examples
- See [vCon Spec](https://datatracker.ietf.org/doc/html/draft-ietf-vcon-vcon-core-00) for full specification

