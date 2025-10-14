# API Reference

Complete API documentation for the vCon MCP Server.

## Overview

The vCon MCP Server provides a comprehensive API for managing virtual conversations through the Model Context Protocol (MCP). All interfaces are fully compliant with [IETF vCon Core](https://datatracker.ietf.org/doc/html/draft-ietf-vcon-vcon-core-00) specification.

---

## API Components

### 🛠️ [Tools](./tools.md)

20+ MCP tools for vCon operations:

- **Core Operations** - Create, read, update, delete vCons
- **Component Management** - Add dialog, analysis, attachments
- **Search & Query** - Keyword, semantic, and hybrid search
- **Tag Management** - Organize with key-value metadata
- **Database Tools** - Inspect and optimize database
- **Schema & Examples** - Get schemas and example vCons

[View Tools Reference →](./tools.md)

---

### 🔗 [Resources](./resources.md)

URI-based access to vCon data:

- `vcon://recent` - Get recent vCons
- `vcon://recent/ids` - Lightweight ID lists
- `vcon://list/ids` - Paginated ID browsing
- `vcon://uuid/{uuid}` - Get specific vCon
- `vcon://uuid/{uuid}/metadata` - Get metadata only

[View Resources Reference →](./resources.md)

---

### 💬 [Prompts](./prompts.md)

9 query template prompts:

- **find_by_exact_tags** - Exact tag matching
- **find_by_semantic_search** - AI-powered meaning search
- **find_by_keywords** - Keyword/phrase search
- **find_recent_by_topic** - Recent conversations by topic
- **find_by_customer** - Search by party/customer
- **discover_available_tags** - Explore available tags
- **complex_search** - Multi-criteria searches
- **find_similar_conversations** - Find similar vCons
- **help_me_search** - Query strategy guidance

[View Prompts Reference →](./prompts.md)

---

### 📘 [Types](./types.md)

TypeScript type definitions:

- **VCon** - Main conversation object
- **Party** - Conversation participants
- **Dialog** - Conversation segments
- **Analysis** - AI/ML analysis results
- **Attachment** - Additional files/data
- **Input/Output Types** - Tool parameters and responses

[View Types Reference →](./types.md)

---

### 🗄️ [Database Schema](./schema.md)

PostgreSQL/Supabase schema:

- **Core Tables** - vcons, parties, dialog, analysis, attachments
- **Search Tables** - vcon_embeddings, vcon_tags_mv
- **Privacy Tables** - privacy_requests (GDPR/CCPA)
- **RPC Functions** - search_vcons_keyword, search_vcons_semantic, search_vcons_hybrid
- **Indexes** - Performance optimization

[View Schema Reference →](./schema.md)

---

## Quick Start Examples

### Create a vCon

```typescript
const result = await callTool("create_vcon", {
  vcon_data: {
    vcon: "0.3.0",
    subject: "Customer Support Call",
    parties: [
      {
        name: "Agent Smith",
        mailto: "smith@company.com"
      },
      {
        name: "John Doe",
        tel: "+1-555-1234"
      }
    ]
  }
});

console.log("Created vCon:", result.uuid);
```

### Search vCons

```typescript
// Keyword search
const keywordResults = await callTool("search_vcons_content", {
  query: "billing issue refund",
  limit: 20
});

// Semantic search
const semanticResults = await callTool("search_vcons_semantic", {
  query: "frustrated customers complaining about delays",
  threshold: 0.75,
  limit: 20
});

// Tag search
const tagResults = await callTool("search_by_tags", {
  tags: {
    department: "support",
    priority: "high"
  },
  limit: 50
});
```

### Access via Resources

```typescript
// Get recent vCons
const recent = await readResource("vcon://recent/10");

// Get specific vCon
const vcon = await readResource(
  "vcon://uuid/123e4567-e89b-12d3-a456-426614174000"
);

// List IDs for navigation
const ids = await readResource("vcon://recent/ids/50");
```

### Use Query Prompts

```typescript
// Get query guidance
const prompt = await getPrompt("find_by_exact_tags", {
  tag_criteria: "angry customers",
  date_range: "June 2024"
});

// Follow the prompt's strategy to execute search
```

---

## Architecture

### MCP Protocol Flow

```
┌─────────────┐
│   Client    │ (Claude Desktop, Custom Client)
│  (MCP SDK)  │
└──────┬──────┘
       │ MCP Protocol (stdio/HTTP)
       │
┌──────▼──────┐
│   vCon MCP  │
│    Server   │
└──────┬──────┘
       │
       ├─── Tools ────────┐
       │                  │
       ├─── Resources ────┤
       │                  │
       ├─── Prompts ──────┤
       │                  │
       └─── Database ─────┘
              │
       ┌──────▼───────┐
       │  PostgreSQL  │
       │  (Supabase)  │
       └──────────────┘
```

### Data Flow

1. **Client Request** - Client calls MCP tool/resource
2. **Validation** - Zod schema validation
3. **Database Query** - PostgreSQL operations
4. **Processing** - Business logic, search, embeddings
5. **Response** - Formatted JSON response

---

## API Capabilities

### Search Modes

| Mode | Best For | Performance | Accuracy |
|------|----------|-------------|----------|
| **Metadata** | Exact filters | Fast (~50ms) | Exact match |
| **Keyword** | Specific words | Medium (~100ms) | High precision |
| **Semantic** | Concepts/meaning | Slower (~200ms) | Contextual |
| **Hybrid** | Best of both | Slower (~300ms) | Balanced |
| **Tag** | Categories | Fast (~50ms) | Exact match |

### Operations

| Operation | Tool | Resource | Prompt |
|-----------|------|----------|--------|
| **Create** | ✅ | ❌ | ❌ |
| **Read** | ✅ | ✅ | ❌ |
| **Update** | ✅ | ❌ | ❌ |
| **Delete** | ✅ | ❌ | ❌ |
| **Search** | ✅ | ❌ | ✅ |
| **Browse** | ❌ | ✅ | ❌ |

---

## Standards Compliance

### vCon Specification

✅ **Draft IETF vCon Core 00**
- All required fields supported
- Optional extensions available
- Group references implemented
- Redaction/appending supported

### MCP Protocol

✅ **Model Context Protocol 1.0**
- Tools interface
- Resources interface
- Prompts interface
- Standard error handling

### Database

✅ **PostgreSQL 15+**
- Full SQL compliance
- JSONB support
- Array operations
- GIN/GiST/HNSW indexes

✅ **pgvector Extension**
- Vector similarity search
- Cosine distance
- HNSW indexing

---

## Authentication & Security

### Supabase Authentication

The server uses Supabase authentication:

```typescript
// Environment variables required
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key-here
```

### Row Level Security (RLS)

Optional RLS policies can be enabled:

```sql
-- Enable RLS on vcons table
ALTER TABLE vcons ENABLE ROW LEVEL SECURITY;

-- Example policy: Users can only see their own vCons
CREATE POLICY "Users can view own vCons"
  ON vcons FOR SELECT
  USING (auth.uid() = user_id);
```

### API Key Management

For production deployments:

1. Use service role key for server
2. Use anon key for clients
3. Implement RLS policies
4. Enable database audit logging

---

## Rate Limits

Default rate limits (configurable):

| Operation Type | Limit |
|---------------|-------|
| Search operations | 100/min |
| Create operations | 50/min |
| Other operations | 200/min |
| Embedding generation | 10/min |

---

## Error Handling

All API responses include error information:

```typescript
interface ErrorResponse {
  success: false;
  error: string;
  details?: any;
}
```

### Common Error Codes

- `VALIDATION_ERROR` - Invalid input parameters
- `NOT_FOUND` - vCon or resource not found
- `DATABASE_ERROR` - Database operation failed
- `PERMISSION_DENIED` - Insufficient permissions
- `RATE_LIMIT_EXCEEDED` - Too many requests

---

## Versioning

### API Version

Current: **1.0.0**

The API follows semantic versioning:
- **Major** - Breaking changes
- **Minor** - New features (backward compatible)
- **Patch** - Bug fixes

### vCon Version

Current: **0.3.0**

Follows IETF vCon specification versions.

---

## Next Steps

### For Users

1. [Getting Started Guide](/guide/getting-started.md)
2. [Search Guide](/guide/search.md)
3. [Tag Management Guide](/guide/tags.md)
4. [Examples](/examples/)

### For Developers

1. [Development Guide](/development/)
2. [Plugin Development](/development/plugins.md)
3. [Testing Guide](/development/testing.md)
4. [Contributing](https://github.com/vcon-dev/vcon-mcp)

### Resources

- [IETF vCon Spec](https://datatracker.ietf.org/doc/html/draft-ietf-vcon-vcon-core-00)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Supabase Docs](https://supabase.com/docs)
- [pgvector Docs](https://github.com/pgvector/pgvector)
