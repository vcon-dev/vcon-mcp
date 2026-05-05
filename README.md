# vCon MCP Server

> A Model Context Protocol (MCP) server for storing, managing, and analyzing IETF vCon (Virtual Conversation) data with AI assistants.

![Version](https://img.shields.io/npm/v/vcon-mcp?label=version)
![IETF Spec](https://img.shields.io/badge/IETF%20vCon-draft--02%20v0.4.0-green)
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

- ✅ **IETF vCon Compliant** - Implements `draft-ietf-vcon-vcon-core-02` specification (v0.4.0)
- ✅ **MCP Integration** - 30 tools for AI assistants to manage conversation data
- ✅ **REST API** - Full HTTP REST API with parity to all MCP tools (CRUD, search, tags, analytics)
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
- ✅ **Real-time-ready** - Supabase realtime subscriptions are available at the database layer (not yet exposed via MCP tools)
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
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "SUPABASE_ANON_KEY": "your-anon-key",
        "OPENAI_API_KEY": "your-openai-key"
      }
    }
  }
}
```

**Note**: `REDIS_URL` is optional. If provided, enables high-performance caching for 20-50x faster reads. See [Redis-Supabase Integration Guide](docs/guide/redis-supabase-integration.md).

**Database backend**: Defaults to Supabase (`DB_TYPE=supabase`). MongoDB is also supported via `DB_TYPE=mongodb` — see [docs/mongodb/setup.md](docs/mongodb/setup.md).

Restart Claude Desktop and start using vCon tools!

## Docker Deployment

The vCon MCP Server is available as a Docker image for easy deployment.

### Quick Start with Docker

```bash
# Pull the image
docker pull public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main

# Run the server (using service role key for full access)
docker run -p 3000:3000 \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e SUPABASE_ANON_KEY=your-anon-key \
  -e MCP_HTTP_STATELESS=true \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
```

> **Note:** You need either `SUPABASE_SERVICE_ROLE_KEY` (recommended for full access) or `SUPABASE_ANON_KEY` (for restricted access). The service role key bypasses Row Level Security.

### Image Tags

| Tag | Description |
|-----|-------------|
| `main` | Latest stable build from main branch |
| `main-<sha>` | Specific commit (e.g., `main-abc1234`) |
| `1.2.3` | Semantic version release |

### Running Scripts

The Docker image includes all utility scripts:

```bash
# Show available commands
docker run --rm public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main help

# Check database status
docker run --rm \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e SUPABASE_ANON_KEY=your-anon-key \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main script check-db-status

# Run embeddings with OpenAI
docker run --rm \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e SUPABASE_ANON_KEY=your-anon-key \
  -e OPENAI_API_KEY=your-openai-key \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main script embed-vcons --provider=openai

# Run embeddings with Azure OpenAI
docker run --rm \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e SUPABASE_ANON_KEY=your-anon-key \
  -e AZURE_OPENAI_EMBEDDING_ENDPOINT=https://your-resource.openai.azure.com \
  -e AZURE_OPENAI_EMBEDDING_API_KEY=your-azure-key \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main script embed-vcons --provider=azure
```

### Docker Compose

```yaml
version: '3.8'
services:
  vcon-mcp:
    image: public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
    ports:
      - "3000:3000"
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
      - MCP_HTTP_STATELESS=true
```

### Multi-Client Support

Enable stateless mode for multiple simultaneous client connections:

```bash
-e MCP_HTTP_STATELESS=true
```

### Connecting to Local Services

When connecting to services on your host machine (like local Supabase), use `host.docker.internal`:

```bash
-e SUPABASE_URL=http://host.docker.internal:54321
```

See [Docker Deployment Guide](docs/deployment/docker.md) for complete documentation.

## Common Operations

The project includes npm scripts for common database and data management operations:

### Database Status & Analysis

```bash
# Comprehensive database status (recommended)
npm run db:status

# Quick vCon count check
npm run db:check

# Daily count analysis to identify gaps
npm run db:analyze
```

### Data Loading

```bash
# Sync vCons from S3/legacy sources
npm run sync:vcons

# Full sync (vCons + embeddings + tags)
npm run sync

# Continuous sync (watches for new data)
npm run sync:continuous
```

### Backup & Restore

```bash
# Backup database
npm run db:backup

# Restore from backup
npm run db:restore
```

### Embeddings Management

```bash
# Continuously generate embeddings for vCons missing them
npm run sync:embeddings

# Check embedding coverage
npm run embeddings:check
```

### Testing

```bash
# Test database tools
npm run test:db

# Test search functionality
npm run test:search

# Test tag system
npm run test:tags
```

For more details on scripts and advanced options, see [scripts/README.md](scripts/README.md).

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

## REST API

When running in HTTP transport mode, the server exposes a full RESTful HTTP API with parity to all MCP tools. Both interfaces share the same `VConService` business logic, plugin hooks, and database queries.

> **Path layout:** the MCP HTTP endpoint is mounted at `/` (root), and the REST API is mounted at `REST_API_BASE_PATH` (default `/api/v1`). They share the same port — that's why the curl examples above hit `/` for MCP but `/api/v1/...` for REST.

### Endpoints (30+)

| Category | Endpoints | Description |
|----------|-----------|-------------|
| **CRUD** | `POST/GET/PATCH/DELETE /vcons` | Create, read, update, delete vCons |
| **Batch** | `POST /vcons/batch` | Batch ingest up to 100 vCons |
| **Sub-resources** | `POST /vcons/:uuid/{dialog,analysis,attachments}` | Append dialog, analysis, attachments |
| **Tags** | `GET/PUT/DELETE /vcons/:uuid/tags` | Per-vCon tag management |
| **Tag Discovery** | `GET /tags`, `GET /tags/search` | Discover and search by tags |
| **Search** | `GET /vcons/search/{content,semantic,hybrid}` | Keyword, semantic, and hybrid search |
| **Database** | `GET /database/{shape,stats,size,health}` | Operational monitoring |
| **Analytics** | `GET /analytics/{growth,content,tags,attachments}` | Business intelligence |
| **Infrastructure** | `GET /health`, `/version`, `/schema`, `/examples/:type` | Health, docs |

### Configuration

```bash
# REST API settings (optional - defaults work for most cases)
REST_API_BASE_PATH=/api/v1     # Base path for endpoints
REST_API_ENABLED=true          # Enable/disable REST API
CORS_ORIGIN=*                  # CORS allowed origins

# API Key Authentication
API_KEYS=key1,key2             # Comma-separated valid API keys
API_AUTH_REQUIRED=true         # Set to false to disable auth
```

### Quick Example

```bash
# Health check
curl http://localhost:3000/api/v1/health

# Create a vCon (requires API key)
curl -X POST http://localhost:3000/api/v1/vcons \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"vcon":"0.4.0","subject":"Support Call","parties":[{"name":"Agent","tel":"+1111"}]}'

# Search by keyword
curl "http://localhost:3000/api/v1/vcons/search/content?q=billing+issue" \
  -H "Authorization: Bearer your-api-key"
```

See the complete [REST API Reference](docs/api/rest-api.md) for detailed documentation.

## Available MCP Tools

The server exposes 30 MCP tools, grouped by purpose. See [docs/api/tools.md](docs/api/tools.md) for full schemas.

### CRUD

| Tool | Description |
|------|-------------|
| `create_vcon` | Create a new vCon with parties and optional initial data |
| `create_vcon_from_template` | Create a vCon from a template (phone_call, chat_conversation, email_thread, video_meeting, custom) |
| `get_vcon` | Retrieve a complete vCon by UUID |
| `update_vcon` | Update top-level vCon metadata (subject, extensions, critical) |
| `delete_vcon` | Delete a vCon and all related data |
| `add_dialog` | Add a conversation segment (recording, text, transfer, incomplete) |
| `add_analysis` | Add AI/ML analysis results (vendor required) |
| `add_attachment` | Attach files, documents, or supporting materials |

### Search

| Tool | Description |
|------|-------------|
| `search_vcons` | Filter by subject, party, date range |
| `search_vcons_content` | Full-text keyword search across dialog, analysis, parties |
| `search_vcons_semantic` | AI embedding similarity search (requires embeddings) |
| `search_vcons_hybrid` | Combined keyword + semantic |

### Tags

| Tool | Description |
|------|-------------|
| `manage_tag` | Add, update, or remove a single tag |
| `get_tags` | Get one or all tags for a vCon |
| `remove_all_tags` | Clear all tags from a vCon |
| `search_by_tags` | Find vCons by tag values |
| `get_unique_tags` | Discover available tag keys/values |

### Analytics

| Tool | Description |
|------|-------------|
| `get_database_analytics` | Size, growth trends, content distribution |
| `get_monthly_growth_analytics` | Monthly growth patterns and projections |
| `get_attachment_analytics` | Attachment types, sizes, storage patterns |
| `get_tag_analytics` | Tag usage patterns and value distribution |
| `get_content_analytics` | Dialog types, party patterns, content insights |
| `get_database_health_metrics` | Performance and optimization recommendations |

### Schema & Examples

| Tool | Description |
|------|-------------|
| `get_schema` | Get vCon schema (json_schema or typescript) |
| `get_examples` | Get example vCons (minimal, phone_call, chat, email, video, full_featured) |

### Database Inspection

| Tool | Description |
|------|-------------|
| `get_database_shape` | Tables, indexes, sizes, relationships |
| `get_database_stats` | Cache hit ratios, table access, index usage |
| `analyze_query` | SQL query execution plan analysis (limited support) |
| `get_database_size_info` | Size info and smart recommendations for large datasets |
| `get_smart_search_limits` | Recommended search limits to prevent memory issues |

## Tool Categories & Configuration

Tools are organized into categories that can be enabled or disabled for different deployment scenarios. By default, all categories are enabled.

### Categories

| Category | Tools | Description |
|----------|-------|-------------|
| `read` | `get_vcon`, `search_vcons`, `search_vcons_content`, `search_vcons_semantic`, `search_vcons_hybrid`, `get_tags`, `search_by_tags`, `get_unique_tags` | All read operations |
| `write` | `create_vcon`, `update_vcon`, `delete_vcon`, `add_analysis`, `add_dialog`, `add_attachment`, `create_vcon_from_template`, `manage_tag`, `remove_all_tags` | All mutating operations |
| `schema` | `get_schema`, `get_examples` | Documentation helpers |
| `analytics` | `get_database_analytics`, `get_monthly_growth_analytics`, `get_attachment_analytics`, `get_tag_analytics`, `get_content_analytics`, `get_database_health_metrics` | Business intelligence |
| `infra` | `get_database_shape`, `get_database_stats`, `analyze_query`, `get_database_size_info`, `get_smart_search_limits` | Admin/debugging |

### Configuration Options

Configure via environment variables:

```bash
# Option 1: Use a preset profile
MCP_TOOLS_PROFILE=readonly   # Options: full, readonly, user, admin, minimal

# Option 2: Enable specific categories only
MCP_ENABLED_CATEGORIES=read,write,schema

# Option 3: Disable specific categories (starts with all enabled)
MCP_DISABLED_CATEGORIES=analytics,infra

# Option 4: Disable individual tools
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

### Example: Read-Only Deployment

```json
{
  "mcpServers": {
    "vcon": {
      "command": "node",
      "args": ["/path/to/vcon-mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "your-project-url",
        "SUPABASE_ANON_KEY": "your-anon-key",
        "MCP_TOOLS_PROFILE": "readonly"
      }
    }
  }
}
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

For the authoritative source layout (including `src/api/`, `src/server/`, `src/services/`, `src/prompts/`, `src/hooks/` and the route/handler split), see the **File Structure** section in [CLAUDE.md](CLAUDE.md). That document is kept in sync with the code; this README intentionally does not duplicate the tree.

## Documentation

### For Users

- **[Getting Started](docs/guide/getting-started.md)** - Quick start guide for using the server
- **[Docker Deployment](docs/deployment/docker.md)** - Complete Docker deployment guide
- **[Query Prompts Guide](docs/guide/prompts.md)** - How to use search and retrieval prompts
- **[Search Tools Guide](docs/guide/search.md)** - Search strategies and tools
- **[Tag Management Guide](docs/guide/tags.md)** - Tagging and organization
- **[RLS Multi-Tenant Guide](docs/guide/rls-multi-tenant.md)** - Row Level Security setup for multi-tenant isolation

### For Developers

- **[Building Guide](docs/development/building.md)** - Step-by-step implementation from scratch
- **[Search Optimization](docs/SEARCH_OPTIMIZATION_GUIDE.md)** - Vector search performance
- **[Plugin Development](docs/development/plugins.md)** - Creating custom plugins

### For LLMs and AI Systems

- **[Database Documentation Index](DATABASE_DOCUMENTATION_INDEX.md)** - Start here - Overview of all LLM documentation
- **[Database Architecture for LLMs](DATABASE_ARCHITECTURE_FOR_LLMS.md)** - Complete database design and structure
- **[Database Quick Start for LLMs](DATABASE_QUICKSTART_FOR_LLMS.md)** - Practical code examples and patterns
- **[Database Schema Visual Reference](DATABASE_SCHEMA_VISUAL.md)** - Visual entity relationship diagrams

### API Reference

- **[REST API](docs/api/rest-api.md)** - Full HTTP REST API with parity to all MCP tools
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

- **[IETF vCon Core Spec (-00, in repo)](background_docs/draft-ietf-vcon-vcon-core-00.txt)** - v0.3.0 baseline shipped with this repo
- **[IETF vCon Core Spec (current draft)](https://datatracker.ietf.org/doc/draft-ietf-vcon-vcon-core/)** - Latest `-02` (v0.4.0) on the IETF datatracker
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

See the [Building Guide](docs/development/building.md) for complete database setup instructions.
See [RLS Multi-Tenant Guide](docs/guide/rls-multi-tenant.md) for enabling multi-tenant isolation.

## IETF vCon Specification Compliance

This implementation targets `draft-ietf-vcon-vcon-core-02` (vCon v0.4.0), including:

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
import { VConPlugin, RequestContext } from 'vcon-mcp/hooks';

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

- **GitHub**: [vcon-mcp](https://github.com/vcon-dev/vcon-mcp)
- **Issues**: [Bug reports &amp; feature requests](https://github.com/vcon-dev/vcon-mcp/issues)
- **Discussions**: [Community discussions](https://github.com/vcon-dev/vcon-mcp/discussions)

### External Links

- **IETF vCon Working Group**: [datatracker.ietf.org/wg/vcon](https://datatracker.ietf.org/wg/vcon/)
- **Model Context Protocol**: [modelcontextprotocol.io](https://modelcontextprotocol.io/)
- **Supabase**: [supabase.com](https://supabase.com/)
- **vCon GitHub**: [github.com/vcon-dev](https://github.com/vcon-dev)

## Support

- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/vcon-dev/vcon-mcp/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/vcon-dev/vcon-mcp/discussions)
- 📖 **Documentation**: [mcp.conserver.io](https://mcp.conserver.io/)

## Acknowledgments

- **IETF vCon Working Group** for the specification
- **Anthropic** for the Model Context Protocol
- **Supabase** for the amazing PostgreSQL platform
- **Contributors** who helped build and improve this project

---

**Built with ❤️ for the conversation intelligence community**

*Making conversations accessible, analyzable, and actionable with AI*
