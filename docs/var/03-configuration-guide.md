# VCONIC MCP Server — Configuration Guide

**Document ID:** VCONIC-MCP-CFG-001  
**Product:** VCONIC MCP Server  
**Version:** 1.2.0  
**Audience:** Value Added Reseller (VAR) / Systems Integrator  
**Last Updated:** April 2026

---

## 1. Overview

The MCP Server is configured entirely through environment variables. There is no separate configuration file. All settings can be passed via:

- A `.env` file (local or Docker `--env-file`)
- Docker `-e` flags
- System environment variables

Configuration changes require a container restart.

---

## 2. Environment Variables Reference

### 2.1 Database Connection (Required)

| Variable | Default | Description |
|----------|---------|-------------|
| `SUPABASE_URL` | *(required)* | Supabase project URL (`https://<project>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | *(required)* | Service role key (full access, bypasses RLS) |
| `SUPABASE_ANON_KEY` | *(empty)* | Anonymous key (read-only, respects RLS) |
| `SUPABASE_DB_URL` | *(empty)* | Direct PostgreSQL connection string (for migrations only) |

> **NOTE:** Use `SUPABASE_SERVICE_ROLE_KEY` for server-side operations. Use `SUPABASE_ANON_KEY` only for client-side applications where RLS enforcement is desired.

### 2.2 Transport Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind address |
| `MCP_HTTP_PORT` | `3000` | HTTP port |
| `MCP_HTTP_STATELESS` | `false` | Enable stateless mode for multi-client support |
| `MCP_HTTP_JSON_ONLY` | `false` | JSON-only responses (disable SSE streaming) |
| `MCP_HTTP_CORS` | `false` | Enable CORS headers |
| `MCP_HTTP_DNS_PROTECTION` | `false` | Enable DNS rebinding protection |
| `MCP_HTTP_ALLOWED_HOSTS` | *(empty)* | Comma-separated allowed Host header values |
| `MCP_HTTP_ALLOWED_ORIGINS` | *(empty)* | Comma-separated allowed Origin header values |

**Transport mode selection:**

| Mode | Use Case |
|------|----------|
| `stdio` | Claude Desktop, local CLI tools, pipe-based MCP clients |
| `http` | Remote clients, web applications, multi-client deployments |

### 2.3 API Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `API_AUTH_REQUIRED` | `true` | Require API key authentication |
| `API_KEYS` | *(empty)* | Comma-separated list of valid API keys |
| `API_KEY_HEADER` | `authorization` | Header name for API key (uses Bearer token format) |
| `REST_API_BASE_PATH` | `/api/v1` | Base path for REST API endpoints |

**Authentication example:**

```bash
# Request with Bearer token
curl -H "Authorization: Bearer my-api-key" http://localhost:3000/api/v1/vcons
```

### 2.4 Tool Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TOOLS_PROFILE` | `full` | Tool preset profile |
| `MCP_ENABLED_CATEGORIES` | *(all)* | Comma-separated categories to enable |
| `MCP_DISABLED_CATEGORIES` | *(none)* | Comma-separated categories to disable |
| `MCP_DISABLED_TOOLS` | *(none)* | Comma-separated individual tools to disable |

**Tool profiles:**

| Profile | Description | Included Categories |
|---------|-------------|-------------------|
| `full` | All tools enabled | read, write, schema, analytics, infra |
| `readonly` | Search and retrieve only | read, schema |
| `user` | Standard user operations | read, write, schema |
| `admin` | Administrative operations | read, write, schema, analytics |
| `minimal` | Basic vCon operations only | read, schema |

**Tool categories:**

| Category | Tools Included |
|----------|---------------|
| `read` | `get_vcon`, `search_vcons`, `search_vcons_content`, `search_vcons_semantic`, `search_vcons_hybrid`, `get_tags`, `search_by_tags`, `get_unique_tags` |
| `write` | `create_vcon`, `update_vcon`, `delete_vcon`, `add_dialog`, `add_analysis`, `add_attachment`, `manage_tag`, `remove_all_tags`, `create_vcon_from_template` |
| `schema` | `get_schema`, `get_examples` |
| `analytics` | `get_database_analytics`, `get_monthly_growth_analytics`, `get_attachment_analytics`, `get_tag_analytics`, `get_content_analytics`, `get_database_health_metrics` |
| `infra` | `get_database_shape`, `get_database_stats`, `get_database_size_info`, `get_smart_search_limits`, `analyze_query` |

**Restricting tools example:**

```bash
# Read-only deployment
MCP_TOOLS_PROFILE=readonly

# Full profile but disable dangerous tools
MCP_TOOLS_PROFILE=full
MCP_DISABLED_TOOLS=delete_vcon

# Only enable specific categories
MCP_ENABLED_CATEGORIES=read,schema
```

### 2.5 Caching (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | *(empty)* | Redis connection URL. If set, enables caching. |
| `VCON_REDIS_EXPIRY` | `3600` | Cache TTL in seconds |

**Performance impact of caching:**

| Operation | Without Cache | With Cache |
|-----------|--------------|------------|
| Get vCon by UUID | ~50ms | ~2ms |
| Search (first query) | ~200ms | ~200ms |
| Search (cached) | ~200ms | ~10ms |

### 2.6 Multi-Tenancy (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `RLS_ENABLED` | `false` | Enable Row-Level Security |
| `CURRENT_TENANT_ID` | *(empty)* | Current tenant UUID for RLS filtering |
| `TENANT_ATTACHMENT_TYPE` | `tenant` | Attachment type that contains tenant ID |
| `TENANT_JSON_PATH` | `id` | JSON path within the attachment body for tenant ID |
| `RLS_DEBUG` | `false` | Log RLS query filters for debugging |

### 2.7 Plugin System (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `VCON_PLUGINS_PATH` | *(empty)* | Comma-separated paths to plugin modules |
| `VCON_LICENSE_KEY` | *(empty)* | License key for proprietary plugins |
| `VCON_OFFLINE_MODE` | `false` | Enable offline license validation (air-gapped deployments) |

### 2.8 Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Log level: `debug`, `info`, `warn`, `error` |
| `NODE_ENV` | `development` | Environment: `development` or `production` |
| `OTEL_ENABLED` | `true` | Enable OpenTelemetry instrumentation |
| `OTEL_EXPORTER_TYPE` | `console` | Exporter type: `console` (JSON to stderr) or `otlp` |
| `OTEL_ENDPOINT` | `http://localhost:4318` | OTLP collector HTTP endpoint |
| `OTEL_SERVICE_NAME` | `vcon-mcp-server` | Service name in telemetry data |
| `OTEL_SERVICE_VERSION` | *(auto)* | Service version |
| `OTEL_LOG_LEVEL` | *(auto)* | OpenTelemetry diagnostic log level |
| `MCP_DEBUG` | `false` | Enable MCP protocol-level debug logging |

### 2.9 Build Metadata

| Variable | Default | Description |
|----------|---------|-------------|
| `VCON_MCP_VERSION` | *(auto)* | CalVer version (e.g., `2026.04.08`) |
| `VCON_MCP_GIT_COMMIT` | *(auto)* | Git commit hash |
| `VCON_MCP_BUILD_TIME` | *(auto)* | ISO 8601 build timestamp |

---

## 3. Common Configuration Scenarios

### 3.1 Production HTTP Deployment

```bash
SUPABASE_URL=https://project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

MCP_TRANSPORT=http
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3000
MCP_HTTP_DNS_PROTECTION=true
MCP_HTTP_ALLOWED_HOSTS=mcp.example.com

API_AUTH_REQUIRED=true
API_KEYS=key-for-portal,key-for-admin

MCP_TOOLS_PROFILE=full
MCP_DISABLED_TOOLS=delete_vcon

REDIS_URL=redis://redis:6379
VCON_REDIS_EXPIRY=3600

LOG_LEVEL=info
NODE_ENV=production
OTEL_ENABLED=true
OTEL_EXPORTER_TYPE=otlp
OTEL_ENDPOINT=http://otel-collector:4318
```

### 3.2 Claude Desktop (stdio) Deployment

```bash
SUPABASE_URL=https://project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

MCP_TRANSPORT=stdio
MCP_TOOLS_PROFILE=user
LOG_LEVEL=warn
NODE_ENV=production
```

### 3.3 Read-Only Analytics Endpoint

```bash
SUPABASE_URL=https://project.supabase.co
SUPABASE_ANON_KEY=eyJ...

MCP_TRANSPORT=http
MCP_HTTP_HOST=0.0.0.0
MCP_TOOLS_PROFILE=readonly

API_AUTH_REQUIRED=true
API_KEYS=analytics-readonly-key

RLS_ENABLED=true
CURRENT_TENANT_ID=550e8400-e29b-41d4-a716-446655440000
```

### 3.4 Multi-Tenant Deployment

```bash
SUPABASE_URL=https://project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

RLS_ENABLED=true
TENANT_ATTACHMENT_TYPE=tenant
TENANT_JSON_PATH=id

# The CURRENT_TENANT_ID is typically set dynamically per request
# via plugin or middleware
```

---

## 4. Configuration Change Procedures

### 4.1 Changing Environment Variables

1. Update the `.env.mcp` file (or Docker environment)
2. Restart the container:

```bash
docker stop vcon-mcp
docker rm vcon-mcp
docker run -d --name vcon-mcp ... --env-file .env.mcp ...
```

Or with Docker Compose:

```bash
docker compose restart vcon-mcp
```

### 4.2 Upgrading Tool Profiles

Changes to tool profiles take effect on restart. Connected MCP clients may need to refresh their tool list:

1. Update `MCP_TOOLS_PROFILE` or `MCP_DISABLED_TOOLS`
2. Restart the MCP Server
3. Reconnect MCP clients (they will receive the updated tool list)

### 4.3 Validation After Changes

```bash
# Health check
curl http://localhost:3000/api/v1/health

# Check logs for errors
docker logs vcon-mcp --tail 30

# Verify tool availability (via an MCP client)
# The get_schema tool should always be available
```

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | April 2026 | VCONIC Engineering | Initial release |
