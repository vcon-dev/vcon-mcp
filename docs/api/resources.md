# MCP Resources Reference

Resources provide URI-based access to vCon data through the Model Context Protocol. They offer a simpler alternative to tools for common data access patterns.

## Overview

Resources use a URI scheme (`vcon://`) to access vCon data:

- **Browsing** - List recent conversations
- **Lookup** - Fetch specific vCons by UUID
- **Discovery** - Get lightweight ID lists for navigation

For complex operations like filtering, searching, and modifications, use [MCP Tools](./tools.md) instead.

---

## Resource URIs

### vcon://recent

Get the most recently created vCons with full data.

**URI Patterns:**
- `vcon://recent` - Get 10 most recent vCons (default)
- `vcon://recent/25` - Get custom number (max 100)

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

### vcon://recent/ids

Get lightweight list of recent vCon IDs for efficient browsing.

**URI Patterns:**
- `vcon://recent/ids` - Get 10 most recent IDs (default)
- `vcon://recent/ids/25` - Get custom number (max 100)

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

### vcon://list/ids

Browse all vCon IDs with cursor-based pagination.

**URI Patterns:**
- `vcon://list/ids` - Get first 100 IDs (default)
- `vcon://list/ids/500` - Get custom number (max 1000)
- `vcon://list/ids/100/after/{timestamp}` - Get next page

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
const page1 = await readResource("vcon://list/ids/100");

// Next page
if (page1.has_more) {
  const page2 = await readResource(
    `vcon://list/ids/100/after/${encodeURIComponent(page1.next_cursor)}`
  );
}
```

**Use Cases:**
- Full database exports
- Bulk operations
- Data migration

---

### vcon://uuid/{uuid}

Retrieve a complete vCon object by UUID.

**URI Pattern:**
- `vcon://uuid/123e4567-e89b-12d3-a456-426614174000`

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

### vcon://uuid/{uuid}/metadata

Get only metadata fields, excluding conversation content arrays.

**URI Pattern:**
- `vcon://uuid/123e4567-e89b-12d3-a456-426614174000/metadata`

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

## Resources vs. Tools

### Use Resources When:

✅ **Browsing** - Viewing recent or all vCons  
✅ **Lookup** - Fetching specific vCon by UUID  
✅ **Simple** - No filtering or complex queries  
✅ **Read-only** - Just retrieving data  

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
const recent = await readResource("vcon://recent/20");

// Get specific conversation
const vcon = await readResource("vcon://uuid/123e4567-e89b-12d3-a456-426614174000");

// List IDs for navigation
const ids = await readResource("vcon://recent/ids/50");
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
  uri: 'vcon://recent/10'
});

console.log(result.contents[0].text);
```

### cURL (via MCP HTTP Bridge)

```bash
# Get recent vCons
curl http://localhost:3000/resources/vcon%3A%2F%2Frecent%2F10

# Get specific vCon
curl http://localhost:3000/resources/vcon%3A%2F%2Fuuid%2F123e4567-e89b-12d3-a456-426614174000
```

---

## Performance Characteristics

### Resource Efficiency

| Resource | Typical Response Time | Network Size | Database Queries |
|----------|----------------------|--------------|------------------|
| `vcon://recent/ids` | ~50ms | ~5KB | 1 |
| `vcon://recent` | ~200ms | ~50KB | 1-3 |
| `vcon://uuid/{uuid}` | ~100ms | ~20KB | 1-2 |
| `vcon://uuid/{uuid}/metadata` | ~50ms | ~2KB | 1 |
| `vcon://list/ids/1000` | ~500ms | ~100KB | 1 |

### Optimization Tips

1. **Use IDs resources** for navigation and lists
2. **Use metadata** when you don't need conversation content
3. **Paginate** large lists with cursor-based pagination
4. **Cache** frequently accessed vCons client-side
5. **Batch** requests when possible

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
  const vcon = await readResource("vcon://uuid/invalid-uuid");
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

### Deprecated URIs:

The following URI patterns are **no longer supported**:

- `vcon://uuid/{uuid}/parties` - Access from full vCon object
- `vcon://uuid/{uuid}/dialog` - Access from full vCon object
- `vcon://uuid/{uuid}/analysis` - Access from full vCon object
- `vcon://uuid/{uuid}/attachments` - Access from full vCon object

**Migration:**

```typescript
// OLD (deprecated)
const parties = await readResource("vcon://uuid/123.../parties");

// NEW (recommended)
const vcon = await readResource("vcon://uuid/123...");
const parties = vcon.parties;
```

---

## Next Steps

- See [Tools Reference](./tools.md) for complex operations
- See [Prompts Reference](./prompts.md) for query templates
- See [Examples](/examples/resources.md) for practical usage
- See [Getting Started](/guide/getting-started.md) for setup

