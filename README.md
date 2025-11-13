# vCon MCP Server

> A Model Context Protocol (MCP) server for storing, managing, and analyzing IETF vCon (Virtual Conversation) data with AI assistants.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![IETF Spec](https://img.shields.io/badge/IETF%20vCon-draft--00-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Overview

This MCP server provides a standardized way for AI assistants like Claude to interact with conversation data using the IETF vCon (Virtual Conversation) format. It combines the Model Context Protocol's tool-based interaction model with Supabase's powerful PostgreSQL backend to create a fully spec-compliant conversation data management system.

### What is vCon?

vCon (Virtual Conversation) is an IETF standard for representing conversations in a portable, interoperable format. Think of it as "PDF for conversations" - a standardized container for:

- **Conversations** from any medium (voice, video, text, email)
- **Participants** with identity and privacy controls
- **AI Analysis** from transcription, sentiment, summarization, etc.
- **Attachments** like documents, images, or related files
- **Privacy markers** for consent and redaction

### What is MCP?

The Model Context Protocol (MCP) enables AI assistants to use external tools and data sources. This server implements MCP to give AI assistants the ability to create, search, analyze, and manage conversation data.

## Key Features

- ✅ **IETF vCon Compliant** - Implements `draft-ietf-vcon-vcon-core-00` specification
- ✅ **MCP Integration** - 27+ tools for AI assistants to manage conversation data
- ✅ **Database Analytics** - Comprehensive analytics for size, growth, content patterns, and health monitoring
- ✅ **Large Database Support** - Smart response limiting, metadata-only options, and memory-safe queries
- ✅ **OpenTelemetry Observability** - Full traces, metrics, and structured logs with console or OTLP export
- ✅ **Query Prompts** - 9 pre-built prompts to guide effective searching and retrieval:
  - Exact tag matching (e.g., "find angry customers from June")
  - Semantic search (e.g., "find frustrated users")
  - Keyword search (e.g., "find conversations mentioning refund")
  - Multi-criteria queries with step-by-step guidance
- ✅ **Supabase Backend** - Powerful PostgreSQL database with REST API
- ✅ **Redis Caching** - Optional high-performance cache layer for 20-50x faster reads
- ✅ **Type-Safe** - Full TypeScript implementation with Zod validation
- ✅ **Plugin Architecture** - Extensible plugin system for custom functionality
- ✅ **Privacy-Ready** - Plugin hooks for implementing consent, redaction, and compliance
- ✅ **Advanced Search** - Four search tools for different use cases:
  - Basic filtering (subject, parties, dates)
  - Full-text keyword search (dialog, analysis, parties)
  - Semantic search (AI embeddings for meaning-based search)
  - Hybrid search (combines keyword and semantic)
- ✅ **Tag Filtering** - Filter search results by tags via `attachments` of type `tags`
- ✅ **Content Indexing** - Searches dialog bodies and analysis content (encoding='none')
- ✅ **Real-time** - Supabase realtime subscriptions for live updates
- ✅ **Conserver Integration** - Compatible with vCon conserver for chain processing

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account ([sign up free](https://supabase.com))

### Installation

```bash
# Clone the repository
git clone https://github.com/vcon-dev/vcon-mcp.git
cd vcon-mcp

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your Supabase credentials

# Build the project
npm run build

# Run tests
npm test

# Start the server
npm run dev
```

### Configure with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vcon": {
      "command": "node",
      "args": ["/path/to/vcon-mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "your-project-url",
        "SUPABASE_ANON_KEY": "your-anon-key",
        "REDIS_URL": "redis://localhost:6379"
      }
    }
  }
}
```

**Note**: `REDIS_URL` is optional. If provided, enables high-performance caching for 20-50x faster reads. See [Redis-Supabase Integration Guide](docs/guide/redis-supabase-integration.md).

Restart Claude Desktop and start using vCon tools!

## Transport Options

The vCon MCP Server supports multiple transport mechanisms for connecting AI assistants:

### stdio Transport (Default)

Standard input/output transport for CLI-based AI assistants like Claude Desktop.

```bash
# Default mode - no configuration needed
npm run dev
```

Or explicitly in `.env`:
```bash
MCP_TRANSPORT=stdio
```

### HTTP Transport with Streamable HTTP

HTTP server mode enables browser-based clients and remote connections using the MCP Streamable HTTP specification (2025-03-26).

**Features:**
- ✅ **Stateful or stateless** session management
- ✅ **SSE streaming** for real-time responses
- ✅ **JSON-only mode** for simple request/response
- ✅ **CORS support** for browser clients
- ✅ **DNS rebinding protection** for security
- ✅ **Session resumability** (optional)

**Configuration:**

```bash
# .env
MCP_TRANSPORT=http
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000

# Optional: Stateless mode (no session tracking)
# MCP_HTTP_STATELESS=true

# Optional: JSON-only responses (no SSE streaming)
# MCP_HTTP_JSON_ONLY=true

# Optional: CORS for browser clients
# MCP_HTTP_CORS=true
# MCP_HTTP_CORS_ORIGIN=*

# Optional: DNS rebinding protection
# MCP_HTTP_DNS_PROTECTION=true
# MCP_HTTP_ALLOWED_HOSTS=localhost,127.0.0.1
# MCP_HTTP_ALLOWED_ORIGINS=http://localhost:3000
```

**Starting the HTTP Server:**

```bash
npm run dev
```

The server will start on `http://127.0.0.1:3000` (default) and log:
```
✅ vCon MCP Server running on HTTP
🌐 Listening on: http://127.0.0.1:3000
📡 Mode: Stateful
```

**Client Connection:**

```bash
# Step 1: Initialize MCP connection
curl -i -X POST http://127.0.0.1:3000 \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-client","version":"1.0.0"}}}'

# Extract the Mcp-Session-Id from response headers

# Step 2: Send MCP requests with session ID
curl -X POST http://127.0.0.1:3000 \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: <session-id-from-step-1>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# GET request to establish SSE stream (for notifications)
curl -X GET http://127.0.0.1:3000 \
  -H "Mcp-Session-Id: <your-session-id>"

# DELETE request to close session
curl -X DELETE http://127.0.0.1:3000 \
  -H "Mcp-Session-Id: <your-session-id>"
```

**Session Management:**

- **Stateful mode** (default): Server generates and tracks session IDs
- **Stateless mode** (`MCP_HTTP_STATELESS=true`): No session tracking, each request is independent

See [MCP Streamable HTTP Specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) for protocol details.

## Available MCP Tools

### 1. **create_vcon**

Create a new vCon with parties and optional initial data.

```
Create a vCon for a customer support call between Alice and Bob
```

### 2. **get_vcon**

Retrieve a complete vCon by UUID.

```
Get the vCon with UUID abc-123-def
```

### 3. **search_vcons**

Search vCons by subject, party name, or date range (basic filtering).

```
Find all vCons from last week about billing
```

### 3a. **search_vcons_content**

Full-text keyword search across dialog, analysis, and party content.

```
Search for conversations mentioning "refund request"
```

### 3b. **search_vcons_semantic**

AI-powered semantic search to find conversations by meaning (requires embeddings).

```
Find conversations where customers were frustrated with delivery times
```

### 3c. **search_vcons_hybrid**

Combined keyword and semantic search for comprehensive results.

```
Search for billing disputes using both exact matches and similar concepts
```

### 4. **add_analysis**

Add AI/ML analysis results to a vCon.

```
Add sentiment analysis showing positive sentiment to vCon abc-123
```

### 5. **add_dialog**

Add a conversation segment (recording, text, video, etc.).

```
Add a text dialog from Alice saying "Hello, how can I help you?"
```

### 6. **add_attachment**

Attach files, documents, or supporting materials.

```
Attach the customer's invoice PDF to this vCon
```

### 7. **delete_vcon**

Delete a vCon and all related data.

```
Delete the vCon abc-123
```

### 8. **get_database_analytics**

Get comprehensive database analytics including size, growth trends, and content distribution.

```
Get database analytics for the last 6 months
```

### 9. **get_monthly_growth_analytics**

Get detailed monthly growth patterns and projections.

```
Show me monthly growth trends for the past year
```

### 10. **get_attachment_analytics**

Analyze attachment types, sizes, and storage patterns.

```
What types of files are being stored and how much space do they use?
```

### 11. **get_tag_analytics**

Analyze tag usage patterns and value distribution.

```
Show me the most commonly used tags and their values
```

### 12. **get_content_analytics**

Get insights into conversation content, dialog types, and party patterns.

```
Analyze the types of conversations and content being stored
```

### 13. **get_database_health_metrics**

Monitor database performance and get optimization recommendations.

```
Check database health and performance metrics
```

### 14. **get_database_size_info**

Get database size information and smart recommendations for large datasets.

```
Get database size info and recommendations for query limits
```

### 15. **get_smart_search_limits**

Get smart search limits based on database size to prevent memory issues.

```
Get recommended limits for content search on this large database
```

### 16. **update_vcon**

Update top-level vCon metadata (subject, extensions, must_support).

```
Update vCon 01f3-... with subject "Updated Subject"
```

### 9. **create_vcon_from_template**

Create a new vCon from a predefined template (phone_call, chat_conversation, email_thread, video_meeting, custom).

```
Create a phone_call vCon with two parties and subject "Onboarding"
```

### 10. **get_schema**

Get vCon schema (json_schema or typescript).

```
Get the vCon JSON Schema
```

### 11. **get_examples**

Get example vCons (minimal, phone_call, chat, email, video, full_featured) in JSON or YAML.

## Database Inspection Tools

### 12. **get_database_shape**

Get comprehensive database structure information including tables, indexes, sizes, and relationships. Useful for debugging and understanding your database schema.

### 13. **get_database_stats**

Get database performance and usage statistics including cache hit ratios, table access patterns, and index usage. Essential for performance monitoring and optimization.

### 14. **analyze_query**

Analyze SQL query execution plans for performance optimization (limited support).

```
Show a minimal example vCon as JSON
```

## Available MCP Resources

The server exposes URI-based resources for direct reads:

- `vcon://v1/vcons/{uuid}` – full vCon JSON
- `vcon://v1/vcons/{uuid}/metadata` – metadata only
- `vcon://v1/vcons/{uuid}/parties` – parties array
- `vcon://v1/vcons/{uuid}/dialog` – dialog array
- `vcon://v1/vcons/{uuid}/attachments` – attachments array
- `vcon://v1/vcons/{uuid}/analysis` – analysis array
- `vcon://v1/vcons/{uuid}/transcript` – transcript analysis (filtered)
- `vcon://v1/vcons/{uuid}/summary` – summary analysis (filtered)
- `vcon://v1/vcons/{uuid}/tags` – tags as object (parsed)

## Use Cases

### Contact Centers

- Capture and analyze customer calls
- Generate automatic transcripts
- Track agent performance and sentiment
- Maintain compliance audit trails

### Sales Teams

- Record sales conversations
- Extract action items and follow-ups
- Analyze conversation patterns
- Generate meeting summaries

### Research

- Collect conversation datasets
- Analyze communication patterns
- Generate insights from dialogue
- Build ML training data

### Compliance & Legal

- Maintain conversation archives
- Apply redaction for privacy
- Track consent and permissions
- Generate audit reports

## Architecture

### Basic Architecture

```
┌─────────────────────┐
│   AI Assistant      │  (Claude, ChatGPT, etc.)
│   (Client)          │
└──────────┬──────────┘
           │ MCP Protocol (stdio)
           │
┌──────────▼──────────┐
│   vCon MCP Server   │  (This project)
│                     │
│  ┌───────────────┐  │
│  │ MCP Tools     │  │  - create_vcon
│  │               │  │  - add_analysis
│  └───────┬───────┘  │  - search_vcons
│          │          │  - etc.
│  ┌───────▼───────┐  │
│  │ vCon Queries  │  │  - CRUD operations
│  │               │  │  - Validation
│  └───────┬───────┘  │  - Type checking
│          │          │
└──────────┼──────────┘
           │ Supabase Client
           │
┌──────────▼──────────┐
│    Supabase         │
│  (PostgreSQL)       │
│                     │
│  ┌───────────────┐  │
│  │ vCon Tables   │  │  - vcons
│  │               │  │  - parties
│  └───────────────┘  │  - dialog
│  ┌───────────────┐  │  - analysis
│  │ pgvector      │  │  - attachments
│  │ (embeddings)  │  │
│  └───────────────┘  │
└─────────────────────┘
```

### With Redis Caching (Optional)

For high-performance deployments, add Redis as a cache layer:

```
┌─────────────────────────────────────────────────┐
│                  AI Assistant                    │
└─────────────────────┬───────────────────────────┘
                      │ MCP Protocol
┌─────────────────────▼───────────────────────────┐
│              vCon MCP Server                     │
│                                                   │
│  ┌───────────────────────────────────────────┐  │
│  │         Cache-First Reads                  │  │
│  │  Redis (hot) → Supabase (cold fallback)   │  │
│  └───────────────────────────────────────────┘  │
└─────────────┬───────────────────┬───────────────┘
              │                   │
      ┌───────▼───────┐   ┌───────▼───────┐
      │  Redis Cache  │   │   Supabase    │
      │  (Optional)   │   │  (Permanent)  │
      │               │   │               │
      │ - Fast reads  │   │ - Source of   │
      │ - TTL expiry  │   │   truth       │
      │ - Auto cache  │   │ - Full CRUD   │
      └───────────────┘   └───────────────┘
```

**Enable caching** by setting `REDIS_URL` environment variable. See [Redis-Supabase Integration Guide](docs/guide/redis-supabase-integration.md) for details.

**Performance**: Redis caching provides 20-50x faster reads for frequently accessed vCons.

## Observability

Built-in OpenTelemetry instrumentation provides production-ready monitoring:

### Features

- **Distributed Tracing**: Full request lifecycle tracing with spans for every operation
- **Business Metrics**: Track vCon operations, search patterns, and usage
- **Performance Metrics**: Monitor query duration, cache hit rates, and latency
- **Structured Logging**: JSON logs with automatic trace context correlation
- **Flexible Export**: Console (development) or OTLP (production) exporters

### Quick Start

```bash
# Development (console export)
OTEL_ENABLED=true
OTEL_EXPORTER_TYPE=console

# Production (OTLP collector)
OTEL_ENABLED=true
OTEL_EXPORTER_TYPE=otlp
OTEL_ENDPOINT=http://localhost:4318
```

### Key Metrics

- `vcon.created.count` - vCons created
- `vcon.deleted.count` - vCons deleted
- `vcon.search.count` - Searches performed (by type)
- `tool.execution.duration` - Tool execution time
- `db.query.count` - Database queries
- `cache.hit` / `cache.miss` - Cache performance

### Collector Examples

**Testing Setup (Recommended):**

```bash
# Start Jaeger backend using docker-compose
./jaeger/start-jaeger.sh

# Configure .env
OTEL_ENABLED=true
OTEL_EXPORTER_TYPE=otlp
OTEL_ENDPOINT=http://localhost:4318

# View traces at http://localhost:16686
```

**Manual Docker Setup:**

```bash
# Jaeger (all-in-one)
docker run -d -p 4318:4318 -p 16686:16686 jaegertracing/all-in-one:latest

# View traces at http://localhost:16686
```

See [Observability Guide](docs/guide/observability.md) for complete documentation.

## Project Structure

```
vcon-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── types/
│   │   └── vcon.ts          # IETF vCon type definitions
│   ├── db/
│   │   ├── client.ts        # Supabase client
│   │   └── queries.ts       # Database operations
│   ├── tools/
│   │   └── vcon-crud.ts     # MCP tool definitions
│   └── utils/
│       └── validation.ts    # vCon validation
├── supabase/
│   └── migrations/          # Database migrations
├── tests/
│   └── vcon-compliance.test.ts
├── docs/
│   └── reference/           # Technical reference docs
│       ├── QUICK_REFERENCE.md
│       ├── IMPLEMENTATION_CORRECTIONS.md
│       ├── CORRECTED_SCHEMA.md
│       └── MIGRATION_GUIDE.md
├── background_docs/         # IETF specs & references
├── BUILD_GUIDE.md          # Step-by-step implementation guide
├── GETTING_STARTED.md      # Quick start for developers
├── OPEN_SOURCE_FEATURES.md # Open source feature set
├── PORPRIETARY_FEATURES.md # Enterprise features
├── SUPABASE_SEMANTIC_SEARCH_GUIDE.md
└── README.md               # This file
```

## Documentation

### For Users

- **[Getting Started](GETTING_STARTED.md)** - Quick start guide for using the server
- **[Query Prompts Guide](docs/guide/prompts.md)** - How to use search and retrieval prompts
- **[Search Tools Guide](docs/guide/search.md)** - Search strategies and tools
- **[Tag Management Guide](docs/guide/tags.md)** - Tagging and organization
- **[RLS Multi-Tenant Guide](docs/guide/rls-multi-tenant.md)** - Row Level Security setup for multi-tenant isolation
- **[Open Source Features](OPEN_SOURCE_FEATURES.md)** - Complete feature reference
- **[Proprietary Features](PORPRIETARY_FEATURES.md)** - Enterprise and advanced features

### For Developers

- **[Build Guide](BUILD_GUIDE.md)** - Step-by-step implementation from scratch
- **[Supabase Semantic Search](SUPABASE_SEMANTIC_SEARCH_GUIDE.md)** - Vector search setup
- **[Plugin Development](docs/development/plugins.md)** - Creating custom plugins

### API Reference

- **[Tools API](docs/api/tools.md)** - MCP tools reference
- **[Prompts API](docs/api/prompts.md)** - MCP prompts reference
- **[Resources API](docs/api/resources.md)** - MCP resources reference
- **[Types](docs/api/types.md)** - TypeScript type definitions

### Technical Reference

- **[Quick Reference](docs/reference/QUICK_REFERENCE.md)** - Critical spec corrections checklist
- **[Implementation Corrections](docs/reference/IMPLEMENTATION_CORRECTIONS.md)** - Detailed spec compliance guide
- **[Corrected Schema](docs/reference/CORRECTED_SCHEMA.md)** - Database schema reference
- **[Migration Guide](docs/reference/MIGRATION_GUIDE.md)** - Migrating existing code

### IETF Specifications

- **[IETF vCon Core Spec](background_docs/draft-ietf-vcon-vcon-core-00.txt)** - Official specification
- **[vCon Consent Draft](background_docs/draft-howe-vcon-consent-00.txt)** - Privacy and consent
- **[vCon Lifecycle Draft](background_docs/draft-howe-vcon-lifecycle-00.txt)** - Lifecycle management
- **[vCon Quick Start](background_docs/vcon_quickstart_guide.md)** - vCon basics
- **[vCon Adapter Guide](background_docs/vcon_adapter_guide.md)** - Building adapters

## Development

### Running Locally

```bash
# Start Supabase (if using local)
supabase start

# Run in development mode
npm run dev

# Run tests
npm test

# Run spec compliance tests
npm run test:compliance

# Launch MCP test console (interactive)
npm run test:console

# Build for production
npm run build

# Lint code
npm run lint
```

### Testing

The project includes comprehensive tests:

- **Unit tests** - Type validation, query functions
- **Integration tests** - End-to-end vCon operations
- **Compliance tests** - IETF spec conformance

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test tests/vcon-compliance.test.ts
```

### Database Setup

The project uses Supabase with a carefully designed schema:

- **8 tables** for vCon data model
- **25 indexes** for query performance
- **Row Level Security** for multi-tenancy (configurable tenant extraction from attachments)
- **pgvector** for semantic search
- **Realtime** subscriptions enabled

See [BUILD_GUIDE.md](BUILD_GUIDE.md) for complete database setup instructions.
See [RLS Multi-Tenant Guide](docs/guide/rls-multi-tenant.md) for enabling multi-tenant isolation.

## IETF vCon Specification Compliance

This implementation is fully compliant with `draft-ietf-vcon-vcon-core-00`, including:

### Core Objects

- ✅ vCon container with all required fields
- ✅ Party objects with complete metadata
- ✅ Dialog objects (recording, text, transfer, incomplete)
- ✅ Analysis objects with vendor and schema fields
- ✅ Attachment objects with proper references
- ✅ Group objects for multi-party conversations

### Data Types

- ✅ Correct field names (e.g., `schema` not `schema_version`)
- ✅ Required vs optional fields properly enforced
- ✅ String-based body fields (not object types)
- ✅ No default encoding values
- ✅ Proper type constraints

### Privacy & Security

- ✅ Redaction support
- ✅ Consent tracking
- ✅ Party privacy markers
- ✅ Secure attachment handling

## API Examples

### Creating a vCon

```typescript
const vcon = await createVCon({
  subject: "Customer Support Call",
  parties: [
    {
      name: "Alice Agent",
      mailto: "alice@support.example.com",
      role: "agent"
    },
    {
      name: "Bob Customer",
      tel: "+1-555-0100",
      role: "customer"
    }
  ]
});
```

### Adding Analysis

```typescript
await addAnalysis(vconUuid, {
  type: "transcript",
  vendor: "OpenAI",
  product: "Whisper-1",
  schema: "v1.0",
  body: "Full transcript text...",
  encoding: "none",
  dialog: [0]  // References first dialog
});
```

### Searching vCons

```typescript
const results = await searchVCons({
  subject: "billing",
  partyName: "Alice",
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});
```

## Roadmap

### Phase 1: Core Implementation ✅

- [X] IETF vCon type definitions
- [X] Supabase database schema
- [X] Basic CRUD operations
- [X] MCP server implementation
- [X] Validation and testing

### Phase 2: Advanced Features 🚧

- [X] Semantic search with pgvector
- [ ] Real-time subscriptions
- [ ] Batch operations
- [ ] Export/import formats

### Phase 3: Enterprise Features 📋

- [X] Multi-tenant support (RLS with configurable tenant extraction)
- [ ] Advanced privacy controls
- [ ] Audit logging
- [ ] Performance optimization

### Phase 4: Integrations 📋

- [ ] Twilio adapter
- [ ] Zoom adapter
- [ ] Slack adapter
- [ ] Microsoft Teams adapter

## Extending the Server

The vCon MCP Server is highly extensible, supporting multiple ways to add custom functionality:

### Extension Options

| Extension Type      | Purpose                   | Use Case                            | Packaging        |
| ------------------- | ------------------------- | ----------------------------------- | ---------------- |
| **Resources** | Discoverable data access  | Browse recent vCons, statistics     | Direct or plugin |
| **Prompts**   | Guided query templates    | Help users search effectively       | Direct only      |
| **Tools**     | Executable operations     | Analytics, exports, custom searches | Direct or plugin |
| **Plugins**   | Package multiple features | Privacy suite, compliance module    | Plugin           |
| **Hooks**     | Modify core behavior      | Audit logging, access control       | Plugin only      |

### Quick Start: Add a Custom Resource

```typescript
// src/resources/index.ts
export function getCoreResources(): ResourceDescriptor[] {
  return [
    // ... existing resources ...
    {
      uri: 'vcon://v1/analytics/summary',
      name: 'Analytics Summary',
      description: 'Overall conversation analytics',
      mimeType: 'application/json'
    }
  ];
}
```

### Quick Start: Add a Custom Tool

```typescript
// src/tools/analytics-tools.ts
export const analyticsTool = {
  name: 'get_analytics',
  description: 'Get conversation analytics',
  inputSchema: {
    type: 'object' as const,
    properties: {
      period: { type: 'string', enum: ['7d', '30d', '90d'] }
    },
    required: ['period']
  }
};

export async function handleGetAnalytics(input: any): Promise<ToolResponse> {
  // Implementation
}
```

### Quick Start: Create a Plugin

```typescript
import { VConPlugin, RequestContext } from '@vcon/mcp-server/hooks';

export default class MyPlugin implements VConPlugin {
  name = 'my-plugin';
  version = '1.0.0';
  
  // Register custom tools
  registerTools(): Tool[] {
    return [/* your tools */];
  }
  
  // Register custom resources
  registerResources(): Resource[] {
    return [/* your resources */];
  }
  
  // Lifecycle hook example
  async afterCreate(vcon: VCon, context: RequestContext): Promise<void> {
    console.log(`Created vCon: ${vcon.uuid}`);
  }
}
```

### Loading Plugins

```bash
# Set environment variable
VCON_PLUGINS_PATH=@mycompany/vcon-plugin,./local-plugin.js
VCON_LICENSE_KEY=your-license-key-if-required

# Run server with plugins
npm run dev
```

### Complete Extension Documentation

- **[Extension Guide](docs/development/extending.md)** - Comprehensive guide with examples
- **[Extension Quick Reference](docs/development/extension-quick-reference.md)** - Fast lookup and decision guide
- **[Plugin Development](docs/development/plugins.md)** - Complete plugin documentation
- **[Custom Tools](docs/development/custom-tools.md)** - Tool development guide

## Contributing

We welcome contributions! Here's how to get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Contribution Guidelines

- Follow the existing code style
- Add tests for new features
- Update documentation
- Ensure IETF spec compliance
- Reference spec sections in comments

## License

MIT License - see [LICENSE](LICENSE) file for details

## Resources

### Project Links

- **GitHub**: [vcon-mcp](https://github.com/yourusername/vcon-mcp)
- **Issues**: [Bug reports &amp; feature requests](https://github.com/yourusername/vcon-mcp/issues)
- **Discussions**: [Community discussions](https://github.com/yourusername/vcon-mcp/discussions)

### External Links

- **IETF vCon Working Group**: [datatracker.ietf.org/wg/vcon](https://datatracker.ietf.org/wg/vcon/)
- **Model Context Protocol**: [modelcontextprotocol.io](https://modelcontextprotocol.io/)
- **Supabase**: [supabase.com](https://supabase.com/)
- **vCon GitHub**: [github.com/vcon-dev](https://github.com/vcon-dev)

## Support

- 📧 **Email**: ohjesus@doesanyoneemail.anymore
- 💬 **Discord**: [Join our community](https://discord.gg/example)
- 📖 **Documentation**: [Full docs](https://docs.example.com)
- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/yourusername/vcon-mcp/issues)

## Acknowledgments

- **IETF vCon Working Group** for the specification
- **Anthropic** for the Model Context Protocol
- **Supabase** for the amazing PostgreSQL platform
- **Contributors** who helped build and improve this project

---

**Built with ❤️ for the conversation intelligence community**

*Making conversations accessible, analyzable, and actionable with AI*
