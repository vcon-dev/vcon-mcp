# API Reference

API documentation for the vCon MCP Server.

## Overview

The vCon MCP Server provides an API for managing virtual conversations through the Model Context Protocol (MCP) and an HTTP REST API. Both follow the [IETF vCon Core](https://datatracker.ietf.org/doc/html/draft-ietf-vcon-vcon-core-02) specification (syntax 0.4.0).

For new MCP clients, start with the redesigned contract surface: `vcon_capabilities`, `vcon_taxonomy`, `vcon_search`, `vcon_fetch`, and `describe_response_shape`. The older tools remain available for backward compatibility and specialized workflows.

---

## API Components

### 🌐 [REST API](./rest-api.md)

HTTP REST API for ingestion and operations (46 routes). It covers most MCP functions but is not a full mirror: the contract tools (`vcon_search`, `vcon_fetch`, and the rest), `create_vcon_from_template`, and `get_smart_search_limits` have no REST route, and `POST /vcons/batch` and the discovery routes have no MCP tool. See the [comparison](./rest-api.md#comparison-rest-api-vs-mcp-tools).

- **vCon CRUD** - Create, read, update, delete + batch ingest
- **Discovery + Filtered Reads** - Discover live categories, then read by attachment `purpose` or analysis `type`
- **Sub-resources** - Read analysis and attachments; add, replace, and remove parties, dialog, analysis, and attachments
- **Tags** - Per-vCon tag management + tag discovery
- **Search** - Filtered list, plus keyword, semantic, and hybrid search
- **Database** - Schema shape, stats, size, health monitoring
- **Analytics** - Growth, content, tag, and attachment analytics
- **Infrastructure** - Health, version, schema, examples

[View REST API Reference →](./rest-api.md)

---

### 🛠️ [Tools](./tools.md)

46 MCP tools for vCon operations:

- **Redesigned Contract Tools** - Discovery-first search, fetch, and aggregation with predictable envelopes
- **Core Operations** - Create, read, update, delete vCons
- **Component Management** - Add, update, and remove parties, dialog, analysis, attachments
- **Search & Query** - Metadata, keyword, semantic, and hybrid search
- **Tag Management** - Organize with key-value metadata
- **Database Tools** - Inspect and optimize database
- **Database Analytics and Size Tools** - Growth, content, tag, and health reporting; size-aware limits
- **Schema & Examples** - Get schemas and example vCons

[View Tools Reference →](./tools.md)

---

### 🔗 [Resources](./resources.md)

URI-based access to vCon data:

- `vcon://v1/discovery/attachments/purposes` - Discover live attachment purposes
- `vcon://v1/discovery/attachments/types` - Discover legacy attachment types
- `vcon://v1/discovery/analysis/types` - Discover live analysis types
- `vcon://v1/vcons/recent` - Get recent vCons
- `vcon://v1/vcons/recent/ids` - Lightweight ID lists
- `vcon://v1/vcons/ids` - Paginated ID browsing
- `vcon://v1/vcons/{uuid}` - Get specific vCon
- `vcon://v1/vcons/{uuid}/metadata` - Get metadata only
- `vcon://v1/vcons/{uuid}/attachments/purpose/{purpose}` - Read attachments by purpose
- `vcon://v1/vcons/{uuid}/attachments/type/{type}` - Read attachments by legacy type
- `vcon://v1/vcons/{uuid}/analysis/type/{type}` - Read analysis by type

[View Resources Reference →](./resources.md)

---

### 💬 [Prompts](./prompts.md)

9 query template prompts:

- **find_by_exact_tags** - Exact tag matching
- **find_by_semantic_search** - AI-powered meaning search
- **find_by_keywords** - Keyword/phrase search
- **find_recent_by_topic** - Recent conversations by topic
- **find_by_party** - Search by party
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
});

console.log("Created vCon:", result.uuid);
// result.warnings lists lawful basis findings; it is never blocking
```

### Search vCons

```typescript
// Discover search modes and include groups first
const capabilities = await callTool("vcon_capabilities", {});

// Unified keyword search
const results = await callTool("vcon_search", {
  mode: "keyword",
  query: "billing issue refund",
  tags: {
    department: "support",
    priority: "high"
  },
  include: ["core", "summary", "dealer", "tags"],
  limit: 20
});
```

### Access via Resources

```typescript
// Get recent vCons
const recent = await readResource("vcon://v1/vcons/recent/10");

// Get specific vCon
const vcon = await readResource(
  "vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000"
);

// Discover live attachment purposes first
const purposes = await readResource("vcon://v1/discovery/attachments/purposes");

// Then read a specific category-backed view
const dealerInfo = await readResource(
  "vcon://v1/vcons/123e4567-e89b-12d3-a456-426614174000/attachments/purpose/dealer_info"
);

// List IDs for navigation
const ids = await readResource("vcon://v1/vcons/recent/ids/50");
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

### Protocol Flow

```
┌──────────────────────────────────────────────────────────────┐
│                        Clients                               │
├─────────────────────────────────┬────────────────────────────┤
│   AI Assistants (MCP)           │   External Systems (REST)  │
│   (Claude Desktop, Custom)      │   (Integrations, Pipelines)│
└───────────────┬─────────────────┴──────────────┬─────────────┘
                │ MCP (stdio/HTTP)                │ HTTP/JSON
                │                                 │
┌───────────────▼─────────────────────────────────▼────────────┐
│                     vCon MCP Server                          │
│  ┌──────────────────────────┬───────────────────────────┐    │
│  │   MCP Handlers           │   REST API (46 routes)    │    │
│  │  - Tools (46)            │  - CRUD + sub-resources   │    │
│  │  - Resources             │  - Tags + tag discovery   │    │
│  │  - Prompts               │  - Search (list + 3 modes)│    │
│  │                          │  - Database + analytics   │    │
│  │                          │  - Health, schema, docs   │    │
│  └────────────┬─────────────┴────────────┬──────────────┘    │
│               │                          │                   │
│  ┌────────────▼──────────────────────────▼──────────────┐    │
│  │               VCon Service                           │    │
│  │  - Lifecycle hooks (beforeCreate, afterCreate, ...)  │    │
│  │  - Validation                                        │    │
│  │  - Metrics                                           │    │
│  └────────────────────────┬─────────────────────────────┘    │
│                           │                                  │
│  ┌────────────────────────▼─────────────────────────────┐    │
│  │               Plugin Manager                         │    │
│  │  - Privacy plugins                                   │    │
│  │  - Access control                                    │    │
│  │  - Custom extensions                                 │    │
│  └────────────────────────┬─────────────────────────────┘    │
│                           │                                  │
└───────────────────────────┼──────────────────────────────────┘
                            │ Supabase Client
                            │
                 ┌──────────▼───────────┐
                 │      PostgreSQL      │
                 │      (Supabase)      │
                 │                      │
                 │  - vCon Tables       │
                 │  - pgvector          │
                 │  - GIN/GiST Indexes  │
                 └──────────────────────┘
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

`vcon_search` takes four `mode` values. Tag filtering is a parameter on every mode, not a mode of its own.

| Mode | Best For | Notes |
|------|----------|-------|
| **Metadata** | Exact filters on subject, parties, dates, dealer | Supports `filters` and `tags`; reports `page.total` |
| **Keyword** | Specific words | Full-text; honours `tags` and the date filters |
| **Semantic** | Concepts/meaning | Needs embeddings; honours `tags` and `threshold` |
| **Hybrid** | Best of both | Keyword plus semantic, weighted by `semantic_weight` |

For tag-only lookups, pass `tags` to `vcon_search` or call `search_by_tags`.

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

✅ **IETF vCon Core, draft -02 (syntax 0.4.0)**
- All required fields supported
- Optional extensions available
- Group references implemented
- Redaction and amendment supported (`redacted`, `amended`)

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

### HTTP API Keys

The REST API and the MCP HTTP endpoint share one set of API keys. `API_KEYS` grants full access, `API_KEYS_READONLY` grants read-only access, and `API_ANONYMOUS_READONLY=true` lets requests with no token read. Send the key as `Authorization: Bearer <token>`. See [REST API authentication](./rest-api.md#authentication).

### API Key Management

For production deployments:

1. Use service role key for server
2. Use anon key for clients
3. Implement RLS policies
4. Enable database audit logging

---

## Error Handling

Error format depends on the interface.

**MCP legacy and CRUD tools** throw MCP protocol errors. The client receives a JSON-RPC error with a code and a message:

| Code | Meaning |
|------|---------|
| `InvalidParams` | Bad or missing input, including schema and validation failures |
| `InvalidRequest` | `delete_vcon` on a UUID that does not exist |
| `MethodNotFound` | Unknown tool, or a tool disabled by configuration or a read-only key |
| `InternalError` | Any other failure, reported as `Tool execution failed: <cause>` |

**MCP contract tools** (`vcon_fetch`, `vcon_search`, `vcon_aggregate`, `vcon_graph_shape`, `describe_response_shape`) return failures as a normal result:

```typescript
interface ContractErrorResponse {
  ok: false;
  error: {
    code: string;     // INVALID_ARGUMENT, NOT_FOUND, FETCH_FAILED, SEARCH_FAILED,
                      // AGGREGATE_FAILED, SHAPE_GRAPH_FAILED, RESPONSE_TOO_LARGE, UNKNOWN_TOOL
    message: string;
  };
}
```

**REST API** errors use an HTTP status plus a JSON body, usually:

```typescript
interface RestErrorResponse {
  success: false;
  error: string;     // "Error" or "Internal Server Error"
  message: string;
  details?: any;
}
```

Authentication failures (401, 403, 503) return `{ error, message }` without `success`. See [Tools: Error Responses](./tools.md#error-responses) and [REST API: Error Handling](./rest-api.md#error-handling).

---

## Versioning

### API Version

The server version is reported by `GET /api/v1/version`, the `X-Version` response header, and `/api/v1/health`.

The API follows semantic versioning:
- **Major** - Breaking changes
- **Minor** - New features (backward compatible)
- **Patch** - Bug fixes

### vCon Version

Current: **0.4.0**

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

- [IETF vCon Spec](https://datatracker.ietf.org/doc/html/draft-ietf-vcon-vcon-core-02)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Supabase Docs](https://supabase.com/docs)
- [pgvector Docs](https://github.com/pgvector/pgvector)
