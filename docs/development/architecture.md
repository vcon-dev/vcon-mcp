# Architecture

Deep dive into the vCon MCP Server architecture, design patterns, and implementation details.

## Overview

The vCon MCP Server is built as a layered architecture connecting AI assistants to conversation data through the Model Context Protocol (MCP).

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Assistants                          │
│              (Claude Desktop, Custom Clients)               │
└────────────────────┬────────────────────────────────────────┘
                     │ MCP Protocol (stdio/HTTP)
┌────────────────────▼────────────────────────────────────────┐
│                  MCP Server Layer                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │  Tools   │  │Resources │  │ Prompts  │                 │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                 │
└───────┼─────────────┼─────────────┼────────────────────────┘
        │             │             │
┌───────▼─────────────▼─────────────▼────────────────────────┐
│                 Business Logic Layer                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │  Query   │  │Validation│  │  Plugin  │                 │
│  │  Engine  │  │  Engine  │  │  System  │                 │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                 │
└───────┼─────────────┼─────────────┼────────────────────────┘
        │             │             │
┌───────▼─────────────▼─────────────▼────────────────────────┐
│                  Database Layer                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │Supabase  │  │PostgreSQL│  │ pgvector │                 │
│  │  Client  │  │   Core   │  │ Extension│                 │
│  └──────────┘  └──────────┘  └──────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Principles

### 1. Spec Compliance First
- **IETF vCon Core** (`draft-ietf-vcon-vcon-core-00`) compliance
- Strict validation of all vCon objects
- Corrected field names (`schema` not `schema_version`, etc.)
- Required fields enforced (e.g., `vendor` in Analysis)

### 2. Type Safety
- **TypeScript** for compile-time type checking
- **Zod** for runtime validation
- Complete type definitions for all vCon objects
- No `any` types in core code

### 3. Extensibility
- **Plugin system** for custom functionality
- Lifecycle hooks at all operation points
- Custom tools and resources registration
- Minimal core, maximal flexibility

### 4. Performance
- **Efficient database** queries with proper indexing
- Vector search with HNSW indexing
- Materialized views for tag queries
- Caching strategies

### 5. Developer Experience
- Clear error messages
- Comprehensive documentation
- Example code for all features
- Testing utilities and fixtures

---

## Component Architecture

### MCP Server Layer

#### Server Initialization
```typescript
const server = new Server(
  {
    name: 'vcon-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);
```

The server implements three MCP interfaces:

1. **Tools** - Operations (create, read, update, delete, search)
2. **Resources** - URI-based data access (`vcon://uuid/...`)
3. **Prompts** - Query templates and guidance

#### Request Flow
```
1. Client Request → stdio transport
2. MCP Protocol Parsing → JSON-RPC
3. Request Handler → Tool/Resource/Prompt
4. Plugin Hooks → beforeCreate, afterRead, etc.
5. Business Logic → Validation, queries
6. Database Operations → Supabase client
7. Response Formatting → MCP protocol
8. Plugin Hooks → afterCreate, afterUpdate, etc.
9. Response → stdio transport
```

---

### Business Logic Layer

#### Query Engine (`src/db/queries.ts`)

Handles all database operations with a focus on correctness and performance.

```typescript
export class VConQueries {
  constructor(private supabase: SupabaseClient) {}

  // CRUD operations
  async createVCon(vcon: VCon): Promise<{ uuid: string }>
  async getVCon(uuid: string): Promise<VCon>
  async updateVCon(uuid: string, updates: any): Promise<void>
  async deleteVCon(uuid: string): Promise<void>

  // Search operations
  async searchVCons(criteria: SearchCriteria): Promise<VCon[]>
  async searchVConsContent(query: string, options: SearchOptions): Promise<SearchResult[]>
  async searchVConsSemantic(query: string, options: SemanticOptions): Promise<SemanticResult[]>
  async searchVConsHybrid(query: string, options: HybridOptions): Promise<HybridResult[]>

  // Component operations
  async addDialog(vconUuid: string, dialog: Dialog): Promise<number>
  async addAnalysis(vconUuid: string, analysis: Analysis): Promise<number>
  async addAttachment(vconUuid: string, attachment: Attachment): Promise<number>

  // Tag operations
  async getTags(vconUuid: string): Promise<Record<string, string>>
  async setTag(vconUuid: string, key: string, value: string): Promise<void>
  async removeTag(vconUuid: string, key: string): Promise<void>
  async searchByTags(tags: Record<string, string>): Promise<VCon[]>
}
```

**Design Decisions:**

- **Transactional** - Uses database transactions for multi-step operations
- **Normalized** - Stores vCons in normalized form for efficient querying
- **Denormalized responses** - Returns complete vCon objects to clients
- **Error handling** - Wraps database errors with context

#### Validation Engine (`src/utils/validation.ts`)

Ensures all vCons comply with IETF spec before storage.

```typescript
export class VConValidator {
  validate(vcon: VCon): ValidationResult {
    // Core validation
    this.validateVersion(vcon)
    this.validateUUID(vcon.uuid)
    this.validateParties(vcon.parties)
    
    // Component validation
    if (vcon.dialog) this.validateDialogs(vcon.dialog)
    if (vcon.analysis) this.validateAnalysis(vcon.analysis)
    if (vcon.attachments) this.validateAttachments(vcon.attachments)
    
    // Relationship validation
    this.validateReferences(vcon)
    
    return this.result
  }
}
```

**Validation Checks:**

- ✅ vCon version is `0.3.0`
- ✅ UUID is valid RFC 4122 format
- ✅ At least one party exists
- ✅ Dialog types are valid
- ✅ Analysis has required `vendor` field
- ✅ References (party indexes, dialog indexes) are valid
- ✅ Encoding values are valid
- ✅ Dates are ISO 8601 format

#### Plugin System (`src/hooks/`)

Allows extending functionality without modifying core code.

```typescript
export interface VConPlugin {
  name: string
  version: string

  // Lifecycle
  initialize?(config: PluginConfig): Promise<void>
  shutdown?(): Promise<void>

  // Operation hooks
  beforeCreate?(vcon: VCon, context: RequestContext): Promise<VCon>
  afterCreate?(vcon: VCon, context: RequestContext): Promise<void>
  beforeRead?(uuid: string, context: RequestContext): Promise<void>
  afterRead?(vcon: VCon, context: RequestContext): Promise<VCon>
  beforeUpdate?(uuid: string, updates: any, context: RequestContext): Promise<void>
  afterUpdate?(vcon: VCon, context: RequestContext): Promise<void>
  beforeDelete?(uuid: string, context: RequestContext): Promise<void>
  afterDelete?(uuid: string, context: RequestContext): Promise<void>
  beforeSearch?(criteria: any, context: RequestContext): Promise<any>
  afterSearch?(results: VCon[], context: RequestContext): Promise<VCon[]>

  // Registration
  registerTools?(): Tool[]
  registerResources?(): Resource[]
  registerPrompts?(): Prompt[]
}
```

**Plugin Lifecycle:**

```
1. Server Start
   ↓
2. Load Plugins (from VCON_PLUGINS_PATH)
   ↓
3. Call plugin.initialize()
   ↓
4. Register tools/resources/prompts
   ↓
5. Hook into request handlers
   ↓
6. Process requests with hooks
   ↓
7. On shutdown, call plugin.shutdown()
```

---

### Database Layer

#### Schema Design

**Normalized Storage:**

```sql
vcons (main table)
  ├── parties (1:N)
  ├── dialog (1:N)
  ├── analysis (1:N)
  ├── attachments (1:N)
  │   └── tags (special attachment type)
  └── groups (1:N)
```

**Benefits:**

- Efficient querying by component
- Easy to add/remove components
- Proper foreign key constraints
- Scalable to millions of vCons

#### Supabase Client (`src/db/client.ts`)

Manages database connection with retry logic and error handling.

```typescript
let supabase: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_ANON_KEY
    
    if (!url || !key) {
      throw new Error('Missing Supabase credentials')
    }
    
    supabase = createClient(url, key, {
      auth: {
        persistSession: false
      },
      db: {
        schema: 'public'
      }
    })
  }
  
  return supabase
}
```

#### Search Architecture

**Three Search Modes:**

1. **Metadata Search** (`searchVCons`)
   - Filters by subject, party, dates
   - Uses B-tree indexes
   - ~50ms response time

2. **Content Search** (`searchVConsContent`)
   - Full-text search with trigram matching
   - Uses GIN indexes
   - ~100ms response time

3. **Semantic Search** (`searchVConsSemantic`)
   - Vector similarity with embeddings
   - Uses HNSW index
   - ~200ms response time

4. **Hybrid Search** (`searchVConsHybrid`)
   - Combines keyword + semantic
   - Weighted scoring
   - ~300ms response time

**Search RPC Functions:**

```sql
-- Keyword search
search_vcons_keyword(query_text, start_date, end_date, tag_filter, max_results)

-- Semantic search
search_vcons_semantic(query_embedding, tag_filter, match_threshold, match_count)

-- Hybrid search
search_vcons_hybrid(keyword_query, query_embedding, tag_filter, semantic_weight, limit_results)
```

#### Tag Management

**Storage:** Tags are stored as special attachments:

```json
{
  "type": "tags",
  "encoding": "json",
  "body": "[\"department:sales\", \"priority:high\", \"status:open\"]"
}
```

**Materialized View:**

```sql
CREATE MATERIALIZED VIEW vcon_tags_mv AS
SELECT 
  vcon_id,
  split_part(elem, ':', 1) AS key,
  split_part(elem, ':', 2) AS value
FROM attachments
CROSS JOIN LATERAL jsonb_array_elements_text(body::jsonb) AS elem
WHERE type = 'tags' AND encoding = 'json'
```

**Benefits:**

- Fast tag searches (indexed materialized view)
- No schema changes needed for new tags
- Easy to query and update
- Compatible with vCon spec (as attachments)

---

## Data Flow Examples

### Creating a vCon

```
User: "Create a vCon for a support call"
  ↓
Claude calls: create_vcon tool
  ↓
MCP Server receives request
  ↓
Plugin: beforeCreate hook (add metadata)
  ↓
Validation: Check vCon structure
  ↓
Database: Transaction starts
  ├── Insert into vcons table
  ├── Insert parties
  ├── Insert dialog (if provided)
  └── Insert analysis (if provided)
  ↓
Database: Transaction commits
  ↓
Plugin: afterCreate hook (log, webhook)
  ↓
Response: { success: true, uuid: "..." }
  ↓
Claude receives response
```

### Semantic Search

```
User: "Find frustrated customers from last week"
  ↓
Claude calls: search_vcons_semantic tool
  ↓
MCP Server receives request
  ↓
Plugin: beforeSearch hook (add tenant filter)
  ↓
Generate embedding for query
  ├── Call OpenAI API (or local model)
  └── Get 384-dimensional vector
  ↓
Database: Call search_vcons_semantic RPC
  ├── Vector similarity search (HNSW index)
  ├── Filter by tags (materialized view)
  ├── Apply threshold
  └── Order by similarity
  ↓
Reconstruct full vCon objects
  ├── Join with parties table
  ├── Join with dialog table
  └── Join with analysis table
  ↓
Plugin: afterSearch hook (filter sensitive)
  ↓
Response: { count: N, results: [...] }
  ↓
Claude receives results
```

---

## Performance Considerations

### Database Optimization

1. **Indexes**
   - B-tree on UUIDs, dates
   - GIN on text fields (trigram)
   - HNSW on embeddings (vector)
   - Composite indexes on common queries

2. **Query Patterns**
   - Use prepared statements
   - Batch operations where possible
   - Limit result sets
   - Use cursors for large result sets

3. **Caching**
   - Materialize frequently accessed views
   - Cache embeddings
   - Use connection pooling

### Memory Management

- Streaming large responses
- Limit result set sizes
- Clean up plugin resources
- Close database connections properly

### Scalability

**Horizontal Scaling:**
- Stateless server design
- Multiple server instances behind load balancer
- Read replicas for queries

**Vertical Scaling:**
- Increase database resources
- Optimize queries and indexes
- Use faster embedding models

---

## Security Architecture

### Authentication
- Supabase Row Level Security (RLS)
- API key validation
- User context in plugin hooks

### Authorization
- RLS policies on all tables
- Plugin-based access control
- Audit logging via plugins

### Data Protection
- Encryption at rest (Supabase)
- Encryption in transit (TLS)
- Redaction via plugins
- PII handling compliance

---

## Testing Architecture

### Unit Tests
- Individual function testing
- Mocked dependencies
- Zod schema validation

### Integration Tests
- Full request/response cycle
- Real database (test instance)
- Plugin integration

### Compliance Tests
- IETF spec validation
- Field name correctness
- Required field enforcement

### Load Tests
- Concurrent requests
- Large result sets
- Search performance

---

## Deployment Architecture

### Development
```
Local Machine
├── Node.js runtime
├── TypeScript compiler
├── Supabase local (Docker)
└── Environment variables
```

### Production
```
Cloud Provider (AWS, GCP, Azure)
├── Node.js runtime (18+)
├── Process manager (PM2, systemd)
├── Reverse proxy (nginx)
├── SSL termination
└── Supabase managed instance
```

### Monitoring
- Health check endpoint
- Performance metrics
- Error tracking
- Query performance

---

## Extension Points

### Adding New Tools

1. Define tool schema (`src/tools/`)
2. Implement handler in server
3. Add validation
4. Write tests
5. Document in API reference

### Adding New Search Modes

1. Create RPC function in database
2. Add method to VConQueries
3. Create MCP tool definition
4. Implement in tool handler
5. Add performance tests

### Creating Plugins

1. Implement VConPlugin interface
2. Register lifecycle hooks
3. Add custom tools/resources
4. Package as npm module
5. Publish and document

---

## Best Practices

### Code Organization
- One tool per file
- Shared types in `types/`
- Database logic in `db/`
- Utilities in `utils/`
- Tests alongside code

### Error Handling
- Use typed errors
- Provide context
- Log errors properly
- Return user-friendly messages

### Performance
- Profile before optimizing
- Use indexes effectively
- Cache when appropriate
- Monitor query performance

### Documentation
- JSDoc for all public APIs
- README for each directory
- Architecture decisions recorded
- Examples for complex features

---

## Future Architecture

### Planned Enhancements

1. **Streaming Responses** - For large result sets
2. **GraphQL API** - Alternative to RPC
3. **Real-time Subscriptions** - WebSocket support
4. **Distributed Tracing** - OpenTelemetry integration
5. **Multi-tenant** - Tenant isolation patterns

---

## Additional Resources

- [IETF vCon Spec](https://datatracker.ietf.org/doc/html/draft-ietf-vcon-vcon-core-00)
- [MCP Protocol](https://modelcontextprotocol.io/)
- [Supabase Architecture](https://supabase.com/docs/guides/platform/architecture)
- [pgvector](https://github.com/pgvector/pgvector)
- [TypeScript Best Practices](https://google.github.io/styleguide/tsguide.html)

