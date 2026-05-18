# VCONIC Configuration Guide

**Audience:** Reseller deployment leads and support engineers configuring
VCONIC for a customer environment.

## Reseller lens

VCONIC is configured entirely via environment variables. Every variable
documented here exists in [`.env.example`](https://github.com/vcon-dev/vcon-mcp/blob/main/.env.example)
on `main` — no invented flags. Treat that file as the source of truth and
this guide as the reseller-lens grouping with one-line meanings.

## Database

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `SUPABASE_URL` | yes | — | Supabase project URL |
| `SUPABASE_ANON_KEY` | yes | — | Anon key from project API settings |
| `SUPABASE_SERVICE_ROLE_KEY` | no | — | Service role (use sparingly; bypasses RLS) |
| `DB_TYPE` | no | `supabase` | Backend: `supabase` or `mongodb` |
| `MONGO_URL` | no | — | Only when `DB_TYPE=mongodb` |
| `MONGO_DB_NAME` | no | `vcon` | Only when `DB_TYPE=mongodb` |

## MCP transport

| Variable | Default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HTTP_HOST` | `127.0.0.1` | Use `0.0.0.0` in containers |
| `MCP_HTTP_PORT` | `3000` | |
| `MCP_HTTP_STATELESS` | `false` | Set `true` to disable session tracking |
| `MCP_HTTP_JSON_ONLY` | `false` | Set `true` to disable SSE streaming |
| `MCP_HTTP_CORS` | `false` | Enable CORS for browser clients |
| `MCP_HTTP_CORS_ORIGIN` | `*` | Allowed origin |
| `MCP_HTTP_DNS_PROTECTION` | `false` | DNS rebinding protection |
| `MCP_HTTP_ALLOWED_HOSTS` | — | Comma-separated whitelist |
| `MCP_HTTP_ALLOWED_ORIGINS` | — | Comma-separated whitelist |

## REST API (HTTP transport only)

| Variable | Default | Meaning |
|---|---|---|
| `REST_API_ENABLED` | `true` | Enable REST endpoints alongside MCP |
| `REST_API_BASE_PATH` | `/api/v1` | Endpoint prefix |
| `CORS_ORIGIN` | `*` | REST API CORS |

## Authentication

API key auth covers both REST and MCP HTTP endpoints.

| Variable | Default | Meaning |
|---|---|---|
| `API_AUTH_REQUIRED` | `true` | Require auth on REST + MCP HTTP |
| `API_KEYS` | — | Comma-separated valid keys |
| `API_KEY_HEADER` | `authorization` | Header to read key from |

Default header `authorization` accepts `Authorization: Bearer <key>`. Set
`API_KEY_HEADER=x-api-key` to use a plain custom header.

**Misconfiguration trap:** `API_AUTH_REQUIRED=true` with empty `API_KEYS`
returns `503 Service Unavailable` until a key is set.

## Multi-tenant (RLS)

| Variable | Default | Meaning |
|---|---|---|
| `RLS_ENABLED` | `false` | Enable Row-Level Security policies |
| `RLS_DEBUG` | `false` | Log RLS decisions (verbose) |
| `CURRENT_TENANT_ID` | — | Tenant ID applied to service-role queries |
| `TENANT_ATTACHMENT_TYPE` | `tenant` | Attachment type extracted as tenant marker |
| `TENANT_JSON_PATH` | `id` | Dot-path inside attachment body for the tenant id |

Deep dive: [RLS Multi-Tenant](../guide/rls-multi-tenant.md).

## Tool surface

Restrict the tool catalog exposed to clients.

| Variable | Default | Meaning |
|---|---|---|
| `MCP_TOOLS_PROFILE` | `full` | One of `full`, `readonly`, `user`, `admin`, `minimal` |
| `MCP_ENABLED_CATEGORIES` | — | Comma-separated: e.g. `read,write` |
| `MCP_DISABLED_CATEGORIES` | — | Comma-separated: e.g. `analytics` |
| `MCP_DISABLED_TOOLS` | — | Specific tool names: e.g. `delete_vcon` |

## Embeddings

Semantic and hybrid search require an embeddings provider.

| Variable | Required | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | for OpenAI direct | Key for embedding generation |
| `LITELLM_PROXY_URL` | for LiteLLM | Proxy endpoint, e.g. `http://localhost:4000` |
| `LITELLM_MASTER_KEY` | for LiteLLM | LiteLLM master key |

If neither is set, content search and tag search still work; semantic
search returns no results.

## Caching

| Variable | Default | Meaning |
|---|---|---|
| `REDIS_URL` | — | e.g. `redis://localhost:6379` |
| `VCON_REDIS_EXPIRY` | `3600` | TTL in seconds |

## Plugins

The plugin loader accepts module paths. The license variables apply only
to plugins that opt in to license-key gating; the core server runs without
them.

| Variable | Default | Meaning |
|---|---|---|
| `VCON_PLUGINS_PATH` | — | Comma-separated module paths |
| `VCON_LICENSE_KEY` | — | Optional, plugin-defined |
| `VCON_OFFLINE_MODE` | `false` | Optional, plugin-defined |

Architecture: [Plugin reference](../reference/plugin-architecture.md),
[Plugin development](../development/plugins.md).

## Observability

| Variable | Default | Meaning |
|---|---|---|
| `OTEL_ENABLED` | `true` | Enable OpenTelemetry |
| `OTEL_EXPORTER_TYPE` | `console` | `console` (no-op) or `otlp` |
| `OTEL_ENDPOINT` | `http://localhost:4318` | OTLP collector |
| `OTEL_SERVICE_NAME` | `vcon-mcp-server` | Span service name |
| `LOG_LEVEL` | `info` | Pino log level |
| `MCP_DEBUG` | `false` | MCP protocol-level debug logging |

Deep dive: [Observability](../guide/observability.md).

## Worked scenarios

### Claude Desktop (stdio)

Minimum env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`. Everything else default.

### Shared HTTP deployment

```
MCP_TRANSPORT=http
MCP_HTTP_HOST=0.0.0.0
API_AUTH_REQUIRED=true
API_KEYS=key-a,key-b
OPENAI_API_KEY=sk-...
REDIS_URL=redis://redis:6379
```

### Read-only analytics user

```
MCP_TOOLS_PROFILE=readonly
API_KEYS=analytics-only-key
```

## See also

- [Configuration (developer view)](../guide/configuration.md)
- [RLS Multi-Tenant](../guide/rls-multi-tenant.md)
- [Plugin architecture](../reference/plugin-architecture.md)
- [Observability](../guide/observability.md)
