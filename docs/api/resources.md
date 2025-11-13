# MCP Resources Reference

Resources provide URI-based access to vCon data through the Model Context Protocol. They offer a simpler alternative to tools for common data access patterns.

## Overview

Resources use a versioned URI scheme (`vcon://v1/vcons/...`) to access vCon data:

- **Browsing** - List recent conversations
- **Lookup** - Fetch specific vCons by UUID
- **Discovery** - Get lightweight ID lists for navigation
- **Subresources** - Access specific vCon components (parties, dialog, analysis, attachments)
- **Derived** - Get filtered data (transcripts, summaries, tags)

For complex operations like filtering, searching, and modifications, use [MCP Tools](./tools.md) instead.

---

## Resource Namespace

All resources use the versioned namespace:

```
vcon://v1/vcons/...
```

This allows for future schema evolution without breaking existing clients.

---

## Collection Resources

### vcon://v1/vcons/recent

Get the most recently created vCons with full data.

**URI Patterns:**
- `vcon://v1/vcons/recent` - Get 10 most recent vCons (default)
- `vcon://v1/vcons/recent/25` - Get custom number (max 100)

**Response:**

```json
{
  "count": 10,
  "limit": 10,
  "vcons": [
    {
      "vcon": "0.3.0",
      "uuid": "123e4567-e89b-12d3-a456-426614174000",
      "created_at": "2025-10-14T10:30:00Z",
      "subject": "Customer Support Call",
      "parties": [...],
      "dialog": [...],
      "analysis": [...],
      "attachments": [...]
    }
  ]
}
```

**Use Cases:**
- Dashboard views
- Recent activity monitoring
- Quick access to latest conversations

---

### vcon://v1/vcons/recent/ids

Get lightweight list of recent vCon IDs for efficient browsing.

**URI Patterns:**
- `vcon://v1/vcons/recent/ids` - Get 10 most recent IDs (default)
- `vcon://v1/vcons/recent/ids/25` - Get custom number (max 100)

**Response:**

```json
{
  "count": 10,
  "limit": 10,
  "vcons": [
    {
      "uuid": "123e4567-e89b-12d3-a456-426614174000",
      "created_at": "2025-10-14T10:30:00Z",
      "subject": "Customer Support Call"
    }
  ]
}
```

**Use Cases:**
- Navigation menus
- Autocomplete suggestions
- Performance-sensitive displays

---

### vcon://v1/vcons/ids

Browse all vCon IDs with cursor-based pagination.

**URI Patterns:**
- `vcon://v1/vcons/ids` - Get first 100 IDs (default)
- `vcon://v1/vcons/ids/500` - Get custom number (max 1000)
- `vcon://v1/vcons/ids/100/after/{timestamp}` - Get next page

**Response:**

```json
{
  "count": 100,
  "limit": 100,
  "has_more": true,
  "next_cursor": "2025-10-14T09:30:00Z",
  "vcons": [
    {
      "uuid": "123e4567-e89b-12d3-a456-426614174000",
      "created_at": "2025-10-14T10:30:00Z",
      "subject": "Customer Support Call"
    }
  ]
}
```

**Pagination Example:**

```typescript
// First page
const page1 = await readResource("vcon://v1/vcons/ids/100");

// Next page
if (page1.has_more) {
  const page2 = await readResource(
    `vcon://v1/vcons/ids/100/after/${encodeURIComponent(page1.next_cursor)}`
  );
}
```

**Use Cases:**
- Full database exports
- Bulk operations
- Data migration

---

## Entity Resources

### vcon://v1/vcons/{uuid}

Retrieve a complete vCon object by UUID.

**URI Pattern:**
- `vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000`

**Response:**

```json
{
  "vcon": "0.3.0",
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "created_at": "2025-10-14T10:30:00Z",
  "updated_at": "2025-10-14T11:00:00Z",
  "subject": "Customer Support Call",
  "parties": [
    {
      "name": "Agent Smith",
      "mailto": "smith@company.com"
    },
    {
      "name": "John Doe",
      "tel": "+1-555-1234"
    }
  ],
  "dialog": [
    {
      "type": "text",
      "start": "2025-10-14T10:30:00Z",
      "parties": [0, 1],
      "body": "Hello, how can I help you?"
    }
  ],
  "analysis": [
    {
      "type": "sentiment",
      "vendor": "OpenAI",
      "body": "{\"sentiment\": \"positive\"}"
    }
  ],
  "attachments": [
    {
      "type": "tags",
      "encoding": "json",
      "body": "[\"department:support\", \"priority:high\"]"
    }
  ]
}
```

**Use Cases:**
- Display full conversation details
- Export single conversation
- Reference lookup

---

### vcon://v1/vcons/{uuid}/metadata

Get only metadata fields, excluding conversation content arrays.

**URI Pattern:**
- `vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000/metadata`

**Response:**

```json
{
  "vcon": "0.3.0",
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "created_at": "2025-10-14T10:30:00Z",
  "updated_at": "2025-10-14T11:00:00Z",
  "subject": "Customer Support Call",
  "extensions": [],
  "must_support": []
}
```

**Excluded Fields:**
- `parties`
- `dialog`
- `analysis`
- `attachments`

**Use Cases:**
- Quick metadata checks
- Performance-sensitive queries
- Metadata-only displays

---

## Subresources

These resources provide direct access to specific components of a vCon.

### vcon://v1/vcons/{uuid}/parties

Get only the parties array from a vCon.

**URI Pattern:**
- `vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000/parties`

**Response:**

```json
{
  "parties": [
    {
      "name": "Agent Smith",
      "mailto": "smith@company.com"
    },
    {
      "name": "John Doe",
      "tel": "+1-555-1234"
    }
  ]
}
```

**Use Cases:**
- Display participant lists
- Contact information extraction
- Party-specific queries

---

### vcon://v1/vcons/{uuid}/dialog

Get only the dialog array from a vCon.

**URI Pattern:**
- `vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000/dialog`

**Response:**

```json
{
  "dialog": [
    {
      "type": "text",
      "start": "2025-10-14T10:30:00Z",
      "parties": [0, 1],
      "body": "Hello, how can I help you?"
    },
    {
      "type": "text",
      "start": "2025-10-14T10:31:00Z",
      "parties": [1],
      "body": "I need help with my account."
    }
  ]
}
```

**Use Cases:**
- Display conversation history
- Timeline views
- Dialog-specific processing

---

### vcon://v1/vcons/{uuid}/analysis

Get only the analysis array from a vCon.

**URI Pattern:**
- `vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000/analysis`

**Response:**

```json
{
  "analysis": [
    {
      "type": "sentiment",
      "vendor": "OpenAI",
      "product": "GPT-4",
      "body": "{\"sentiment\": \"positive\", \"score\": 0.85}",
      "encoding": "json"
    },
    {
      "type": "summary",
      "vendor": "Anthropic",
      "product": "Claude-3.5",
      "body": "Customer inquired about account access.",
      "encoding": "none"
    }
  ]
}
```

**Use Cases:**
- Display AI analysis results
- Analytics dashboards
- Insights extraction

---

### vcon://v1/vcons/{uuid}/attachments

Get only the attachments array from a vCon.

**URI Pattern:**
- `vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000/attachments`

**Response:**

```json
{
  "attachments": [
    {
      "type": "tags",
      "encoding": "json",
      "body": "[\"department:support\", \"priority:high\"]"
    },
    {
      "type": "document",
      "filename": "invoice.pdf",
      "mediatype": "application/pdf",
      "url": "https://storage.example.com/invoice.pdf"
    }
  ]
}
```

**Use Cases:**
- Display attached files
- Download documents
- Metadata extraction

---

## Derived Resources

These resources filter and transform vCon data for specific use cases.

### vcon://v1/vcons/{uuid}/transcript

Get transcript analysis from a vCon (filters analysis where type='transcript').

**URI Pattern:**
- `vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000/transcript`

**Response:**

```json
{
  "count": 1,
  "transcripts": [
    {
      "type": "transcript",
      "vendor": "Google Cloud",
      "product": "Speech-to-Text",
      "dialog": [0],
      "body": "{\"transcript\": \"Hello, how can I help you?\", \"confidence\": 0.98}",
      "encoding": "json"
    }
  ]
}
```

**Use Cases:**
- Display transcriptions
- Text analysis
- Speech-to-text results

---

### vcon://v1/vcons/{uuid}/summary

Get summary analysis from a vCon (filters analysis where type='summary').

**URI Pattern:**
- `vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000/summary`

**Response:**

```json
{
  "count": 1,
  "summaries": [
    {
      "type": "summary",
      "vendor": "Anthropic",
      "product": "Claude-3.5",
      "body": "Customer called about billing issue. Agent provided refund and apology.",
      "encoding": "none"
    }
  ]
}
```

**Use Cases:**
- Display conversation summaries
- Quick overview
- Report generation

---

### vcon://v1/vcons/{uuid}/tags

Get tags from a vCon (filters attachments where type='tags' and parses as object).

**URI Pattern:**
- `vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000/tags`

**Response:**

```json
{
  "tags": {
    "department": "support",
    "priority": "high",
    "status": "resolved",
    "customer_id": "12345"
  }
}
```

**Note:** If no tags exist, returns `{"tags": {}}`

**Use Cases:**
- Display metadata tags
- Filter by categories
- Custom organization

---

## Resources vs. Tools

### Use Resources When:

✅ **Browsing** - Viewing recent or all vCons  
✅ **Lookup** - Fetching specific vCon by UUID  
✅ **Simple** - No filtering or complex queries  
✅ **Read-only** - Just retrieving data  
✅ **Subcomponents** - Accessing specific vCon arrays  

### Use Tools When:

🔧 **Searching** - Filtering by tags, dates, content  
🔧 **Modifying** - Creating, updating, deleting  
🔧 **Complex** - Multi-criteria queries  
🔧 **Operations** - Adding dialog, analysis, attachments  

---

## Usage Examples

### Claude Desktop

Resources are automatically available in Claude Desktop when the MCP server is configured:

```typescript
// Browse recent conversations
const recent = await readResource("vcon://v1/vcons/recent/20");

// Get specific conversation
const vcon = await readResource("vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000");

// Get just parties
const parties = await readResource("vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000/parties");

// Get summary
const summary = await readResource("vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000/summary");

// Get tags
const tags = await readResource("vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000/tags");
```

### Custom MCP Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const client = new Client({
  name: 'my-client',
  version: '1.0.0'
});

// List available resources
const resources = await client.listResources();

// Read a resource
const result = await client.readResource({
  uri: 'vcon://v1/vcons/recent/10'
});

console.log(result.contents[0].text);
```

### cURL (via MCP HTTP Bridge)

```bash
# Get recent vCons
curl http://localhost:3000/resources/vcon%3A%2F%2Fv1%2Fvcons%2Frecent%2F10

# Get specific vCon
curl http://localhost:3000/resources/vcon%3A%2F%2Fv1%2Fvcons%2F123e4567-e89b-12d3-a456-426614174000

# Get transcript
curl http://localhost:3000/resources/vcon%3A%2F%2Fv1%2Fvcons%2F123e4567-e89b-12d3-a456-426614174000%2Ftranscript
```

---

## Performance Characteristics

### Resource Efficiency

| Resource | Typical Response Time | Network Size | Database Queries |
|----------|----------------------|--------------|------------------|
| `vcon://v1/vcons/recent/ids` | ~50ms | ~5KB | 1 |
| `vcon://v1/vcons/recent` | ~200ms | ~50KB | 1-3 |
| `vcon://v1/vcons/{uuid}` | ~100ms | ~20KB | 1-2 |
| `vcon://v1/vcons/{uuid}/metadata` | ~50ms | ~2KB | 1 |
| `vcon://v1/vcons/{uuid}/parties` | ~75ms | ~3KB | 1 |
| `vcon://v1/vcons/{uuid}/transcript` | ~100ms | ~10KB | 1 |
| `vcon://v1/vcons/ids/1000` | ~500ms | ~100KB | 1 |

### Optimization Tips

1. **Use IDs resources** for navigation and lists
2. **Use metadata** when you don't need conversation content
3. **Use subresources** to fetch only what you need
4. **Use derived resources** for filtered data
5. **Paginate** large lists with cursor-based pagination
6. **Cache** frequently accessed vCons client-side
7. **Batch** requests when possible

---

## Error Handling

Resources return errors in standard MCP format:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "vCon with UUID 123... not found"
  }
}
```

**Common Error Codes:**

- `RESOURCE_NOT_FOUND` - Invalid URI or UUID doesn't exist
- `INVALID_URI` - Malformed URI pattern
- `DATABASE_ERROR` - Database connection or query failed
- `PERMISSION_DENIED` - Insufficient permissions

**Error Handling Example:**

```typescript
try {
  const vcon = await readResource("vcon://v1/vcons/invalid-uuid");
} catch (error) {
  if (error.code === 'RESOURCE_NOT_FOUND') {
    console.log('vCon not found');
  } else {
    console.error('Unexpected error:', error);
  }
}
```

---

## Limitations

### Not Supported via Resources:

❌ **Filtering** - Use `search_vcons` or `search_by_tags` tools  
❌ **Sorting** - Use tools with custom ordering  
❌ **Tag filtering** - Use `search_by_tags` tool  
❌ **Content search** - Use `search_vcons_content` tool  
❌ **Semantic search** - Use `search_vcons_semantic` tool  
❌ **Modifications** - Use CRUD tools  
❌ **Complex queries** - Use appropriate search tools  

---

## Migration Guide

### Breaking Changes in v1

All resource URIs have changed from `vcon://` to `vcon://v1/vcons/`:

**Old Namespace:**
```
vcon://recent
vcon://recent/ids
vcon://list/ids
vcon://uuid/{uuid}
vcon://uuid/{uuid}/metadata
```

**New Namespace:**
```
vcon://v1/vcons/recent
vcon://v1/vcons/recent/ids
vcon://v1/vcons/ids
vcon://v1/vcons/{uuid}
vcon://v1/vcons/{uuid}/metadata
```

### Migration Steps

1. **Update all resource URIs** in your code to use `vcon://v1/vcons/` prefix
2. **Replace `vcon://list/ids`** with `vcon://v1/vcons/ids`
3. **Replace `vcon://uuid/`** with `vcon://v1/vcons/`
4. **Use new subresources** instead of accessing nested fields
5. **Use derived resources** for common filtered queries

### Example Migration

```typescript
// OLD
const recent = await readResource("vcon://recent/10");
const vcon = await readResource("vcon://uuid/123.../");
const ids = await readResource("vcon://list/ids");

// NEW
const recent = await readResource("vcon://v1/vcons/recent/10");
const vcon = await readResource("vcon://v1/vcons/123.../");
const ids = await readResource("vcon://v1/vcons/ids");

// NEW CAPABILITIES
const parties = await readResource("vcon://v1/vcons/123.../parties");
const transcript = await readResource("vcon://v1/vcons/123.../transcript");
const tags = await readResource("vcon://v1/vcons/123.../tags");
```

---

## Next Steps

- See [Tools Reference](./tools.md) for complex operations
- See [Prompts Reference](./prompts.md) for query templates
- See [Examples](/examples/resources.md) for practical usage
- See [Getting Started](/guide/getting-started.md) for setup
