# REST API Reference

HTTP REST API for vCon ingestion and operations.

## Overview

The vCon MCP Server exposes a RESTful HTTP API alongside the MCP transport layer. This API provides endpoints for vCon CRUD operations, designed for programmatic integration with external systems.

### Key Features

- **HTTP/JSON** - Standard REST conventions
- **API Key Authentication** - Full-access and read-only keys, with optional anonymous read-only access
- **CORS Support** - Configurable cross-origin resource sharing
- **Plugin Hooks** - Lifecycle hooks on create, read, update, delete, and list (see [Plugin Integration](#plugin-integration))
- **Batch Operations** - Ingest up to 100 vCons in a single request
- **Discovery-Backed Reads** - Discover live attachment and analysis categories, then read by `type` or `purpose`
- **Health Checks** - Built-in health endpoint for monitoring

---

## Configuration

### REST API Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REST_API_BASE_PATH` | `/api/v1` | Base path for REST API endpoints |
| `REST_API_ENABLED` | `true` | Enable/disable REST API |

### Authentication Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEYS` | (none) | Comma-separated API keys with full read/write/delete access |
| `API_KEYS_READONLY` | (none) | Comma-separated read-only API keys. They authenticate, but any request other than `GET`, `HEAD`, or `OPTIONS` returns `403 Forbidden`. A key listed in both variables is read-only |
| `API_ANONYMOUS_READONLY` | `false` | Set to `true` to let requests with no token through as read-only, for public datasets |
| `API_KEY_HEADER` | `authorization` | Header for API key; default expects `Authorization: Bearer <token>`. Set to `x-api-key` to use that header instead. |
| `API_AUTH_REQUIRED` | `true` | Set to `false` to disable authentication |

### HTTP Transport Variables

The REST API requires HTTP transport mode to be enabled:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | Set to `http` to enable HTTP server |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP host to bind |
| `MCP_HTTP_PORT` | `3000` | HTTP port to listen on |
| `CORS_ORIGIN` | `*` | CORS allowed origin |

### Example Configuration

```bash
# Enable HTTP transport
MCP_TRANSPORT=http
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3000

# Configure REST API (optional - defaults work for most cases)
REST_API_BASE_PATH=/api/v1
REST_API_ENABLED=true

# Configure authentication
API_KEYS=key1-abc123,key2-def456
API_KEYS_READONLY=readonly-key-xyz789
API_AUTH_REQUIRED=true
```

---

## Authentication

All REST API endpoints require an API key except `/health`, `/version`, `/schema`, and `/examples/:type`.

### Request Headers

By default, send your API key in the `Authorization` header:

```http
Authorization: Bearer your-api-key-here
```

An `Authorization: Bearer` token is accepted whatever `API_KEY_HEADER` says. When you set `API_KEY_HEADER` to another name (for example `x-api-key`), the server also reads the key from that header.

The curl examples below read the key from `$VCON_API_KEY`, for example `export VCON_API_KEY=<your key>`.

### Key Scopes

| Key | Allowed methods |
|-----|-----------------|
| Listed in `API_KEYS` | All |
| Listed in `API_KEYS_READONLY` | `GET`, `HEAD`, `OPTIONS` |
| None, with `API_ANONYMOUS_READONLY=true` | `GET`, `HEAD`, `OPTIONS` |

With `API_ANONYMOUS_READONLY=true`, a request that sends no token is treated as a read-only request. A request that sends an unknown token is still rejected with `401`.

### Authentication Responses

Authentication errors come from the auth middleware and use a smaller body than route errors: `error` and `message`, with no `success` field.

**401 Unauthorized - Missing API Key:**

```json
{
  "error": "Unauthorized",
  "message": "Missing Authorization: Bearer <token> header"
}
```

With a custom `API_KEY_HEADER`, the message reads `Missing <header> header`. Both 401 responses carry a `WWW-Authenticate: Bearer realm="vCon API"` header.

**401 Unauthorized - Invalid API Key:**

```json
{
  "error": "Unauthorized",
  "message": "Invalid API key"
}
```

**403 Forbidden - Read-only key or anonymous access used for a write:**

```json
{
  "error": "Forbidden",
  "message": "Read-only API key cannot POST /api/v1/vcons. Read-only keys are limited to GET requests."
}
```

Anonymous requests get `Anonymous access is read-only and cannot <METHOD> <path>. Send a full-access token to write.`

**503 Service Unavailable - Auth Not Configured:**

```json
{
  "error": "Service Unavailable",
  "message": "API authentication is required but not configured. Please contact the administrator.",
  "hint": "Set API_KEYS env var, or set API_AUTH_REQUIRED=false"
}
```

> **Note:** The `hint` field is only included in non-production environments. The 503 applies when auth is required and neither `API_KEYS` nor `API_KEYS_READONLY` holds a key, even if `API_ANONYMOUS_READONLY` is set.

---

## Endpoints

### Discovery-First Reads

When a classification is stored in attachments or analysis, prefer this sequence:

1. Discover available values first. For attachments, prefer `purpose`; use attachment `type` only for legacy compatibility. For analysis, use `type`.
2. Read the matching filtered vCon subresource.
3. Use tags when the classification genuinely lives in the tags attachment.

Examples:

```bash
# Discover live attachment purposes
curl "http://localhost:3000/api/v1/discovery/attachments/purposes" \
  -H "Authorization: Bearer $VCON_API_KEY"

# Read one vCon's dealer info attachments
curl "http://localhost:3000/api/v1/vcons/123e4567-e89b-12d3-a456-426614174000/attachments?purpose=dealer_info" \
  -H "Authorization: Bearer $VCON_API_KEY"

# Read one vCon's summary analysis through the generic type filter
curl "http://localhost:3000/api/v1/vcons/123e4567-e89b-12d3-a456-426614174000/analysis?type=summary" \
  -H "Authorization: Bearer $VCON_API_KEY"
```

**Discovery endpoints:** `GET /discovery/attachments/purposes`, `GET /discovery/attachments/types` (legacy), and `GET /discovery/analysis/types`.

| Query parameter | Default | Description |
|-----------------|---------|-------------|
| `include_counts` | `true` | Set to `false` to omit per-value counts |
| `min_count` | `1` | Integer of 1 or more; smaller or non-numeric values return `400` |

**Response (200 OK):**

```json
{
  "success": true,
  "count": 2,
  "total_vcons": 1200,
  "attachment_purposes": [
    { "value": "dealer_info", "count": 400 },
    { "value": "tags", "count": 900 }
  ]
}
```

The list key is `attachment_purposes`, `attachment_types`, or `analysis_types`, matching the endpoint.

---

### Health Check

Check API and database health status.

**Endpoint:** `GET /api/v1/health`

**Authentication:** Not required. An unauthenticated caller gets status only. A request that presents a valid key (or any request when `API_AUTH_REQUIRED=false`) also gets database details.

**Response (200 OK), unauthenticated:**

```json
{
  "status": "healthy",
  "timestamp": "2025-01-02T10:30:00.000Z",
  "database": "connected",
  "version": "1.9.2",
  "gitCommit": "abc1234",
  "buildTime": "2025-01-02T09:00:00.000Z"
}
```

**Response (200 OK), authenticated:** the same fields plus `instance` (from `VCON_INSTANCE_LABEL`, or `null`), `schema` (from `SUPABASE_DB_SCHEMA`, default `public`), and the database connection details: `database_name`, `current_schema`, `postgres_version`, and `database_size`.

**Response (503 Service Unavailable):**

```json
{
  "status": "unhealthy",
  "timestamp": "2025-01-02T10:30:00.000Z",
  "database": "error",
  "version": "1.9.2",
  "gitCommit": "abc1234",
  "buildTime": "2025-01-02T09:00:00.000Z"
}
```

An authenticated caller also receives `instance`, `schema`, and the raw `error` text. Unauthenticated callers never see the error text.

**Example:**

```bash
curl http://localhost:3000/api/v1/health
```

---

### Version, Schema, and Examples

These three endpoints need no authentication.

**`GET /api/v1/version`** returns `{ version, gitCommit, buildTime, isDev }`.

**`GET /api/v1/schema`** returns a pointer to the specification, not a JSON Schema document:

```json
{
  "success": true,
  "format": "json_schema",
  "spec_version": "0.4.0",
  "ietf_draft": "draft-ietf-vcon-vcon-core-02",
  "message": "Full JSON Schema is available in the vCon IETF specification",
  "reference": "https://datatracker.ietf.org/doc/draft-ietf-vcon-vcon-core/"
}
```

With `?format=typescript` it returns `{ success, format: "typescript", message, reference }` pointing at `src/types/vcon.ts` in the repository. For the actual schema or the TypeScript source, call the MCP tool `get_schema`.

**`GET /api/v1/examples/:type`** returns `{ success: true, type, vcon }` where `type` is one of `minimal`, `phone_call`, `chat`, `email`, `video`, or `full_featured`. The bodies are small skeletons: a version, a fresh `uuid`, `created_at`, a `subject`, a couple of parties, and empty `dialog`, `analysis`, or `attachments` arrays. They are JSON only. For the richer examples and YAML output, call the MCP tool `get_examples`. Any other type returns `400`.

---

### Create vCon

Create/ingest a single vCon.

**Endpoint:** `POST /api/v1/vcons`

**Authentication:** Required (full-access key)

**Request Headers:**

```http
Content-Type: application/json
Authorization: Bearer your-api-key
```

**Request Body:**

The request body should be the vCon object directly. `uuid` and `created_at` are generated when absent, and `vcon` defaults to `"0.4.0"`. The legacy names `must_support`, `appended`, and `mimetype` are mapped to `critical`, `amended`, and `mediatype`.

```json
{
  "vcon": "0.4.0",
  "uuid": "optional-custom-uuid",
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
      "start": "2025-01-02T10:00:00Z",
      "parties": [0, 1],
      "originator": 1,
      "body": "Hello, I need help with my account.",
      "encoding": "none"
    }
  ],
  "analysis": [],
  "attachments": []
}
```

**Response (201 Created):**

```json
{
  "success": true,
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "id": "42",
  "message": "vCon created successfully",
  "duration_ms": 45,
  "warnings": [
    "no lawful_basis attachment: this vCon carries no record of the lawful basis for processing"
  ]
}
```

`warnings` reports lawful basis findings and never blocks the write. It is an empty array when the vCon carries a well-formed `lawful_basis` attachment. The server does not add one.

**Response (400 Bad Request - Validation Error):**

```json
{
  "success": false,
  "error": "Error",
  "message": "vCon must have at least one party"
}
```

Multiple problems are joined with `; ` in `message`.

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/vcons \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VCON_API_KEY" \
  -d '{
    "vcon": "0.4.0",
    "subject": "Sales Call",
    "parties": [
      {"name": "Sales Rep", "mailto": "rep@company.com"},
      {"name": "Customer", "tel": "+1-555-9876"}
    ]
  }'
```

---

### Batch Create vCons

Ingest multiple vCons in a single request (up to 100). Up to 10 are written concurrently, and a failure on one does not stop the others.

**Endpoint:** `POST /api/v1/vcons/batch`

**Authentication:** Required (full-access key)

**Request Headers:**

```http
Content-Type: application/json
Authorization: Bearer your-api-key
```

**Request Body:**

Array of vCon objects:

```json
[
  {
    "vcon": "0.4.0",
    "subject": "Call 1",
    "parties": [{"name": "Agent A", "mailto": "a@example.com"}]
  },
  {
    "vcon": "0.4.0",
    "subject": "Call 2",
    "parties": [{"name": "Agent B", "mailto": "b@example.com"}]
  }
]
```

**Response (201 Created - All Successful):**

```json
{
  "success": true,
  "total": 2,
  "created": 2,
  "failed": 0,
  "results": [
    {
      "uuid": "uuid-1",
      "success": true,
      "id": "42",
      "warnings": ["no lawful_basis attachment: this vCon carries no record of the lawful basis for processing"]
    },
    {
      "uuid": "uuid-2",
      "success": true,
      "id": "43",
      "warnings": ["no lawful_basis attachment: this vCon carries no record of the lawful basis for processing"]
    }
  ],
  "duration_ms": 120
}
```

`results` matches the order of the request array. Each successful entry carries its own `warnings` array, as for a single create.

**Response (207 Multi-Status - Partial Success):**

```json
{
  "success": false,
  "total": 3,
  "created": 2,
  "failed": 1,
  "results": [
    {
      "uuid": "uuid-1",
      "success": true,
      "id": "42",
      "warnings": []
    },
    {
      "uuid": "uuid-2",
      "success": true,
      "id": "43",
      "warnings": []
    },
    {
      "uuid": "unknown",
      "success": false,
      "error": "Validation failed: vCon must have at least one party"
    }
  ],
  "duration_ms": 150
}
```

A failed entry reports the input `uuid`, or `"unknown"` when the input had none.

**Response (400 Bad Request):**

```json
{
  "success": false,
  "error": "Error",
  "message": "Request body must be an array of vCons"
}
```

The other 400 messages are `Empty vCons array` and `Maximum 100 vCons per batch`.

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/vcons/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VCON_API_KEY" \
  -d '[
    {"vcon": "0.4.0", "subject": "Call 1", "parties": [{"name": "A", "tel": "+1111"}]},
    {"vcon": "0.4.0", "subject": "Call 2", "parties": [{"name": "B", "tel": "+2222"}]}
  ]'
```

---

### Get vCon

Retrieve a vCon by UUID.

**Endpoint:** `GET /api/v1/vcons/:uuid`

**Authentication:** Required

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `uuid` | string | vCon UUID (required) |

**Query Parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `format` | `full` | `full`, `summary` (top-level fields, parties, and `summary`-type analysis only), or `metadata` (top-level fields and parties). Any other value returns `400` |

**Response (200 OK):**

```json
{
  "success": true,
  "vcon": {
    "vcon": "0.4.0",
    "uuid": "123e4567-e89b-12d3-a456-426614174000",
    "created_at": "2025-01-02T10:00:00.000Z",
    "subject": "Customer Support Call",
    "parties": [...],
    "dialog": [...],
    "analysis": [...],
    "attachments": [...]
  }
}
```

**Response (404 Not Found):**

```json
{
  "success": false,
  "error": "Error",
  "message": "vCon with UUID 123e4567-e89b-12d3-a456-426614174000 not found"
}
```

A UUID that is not well formed returns `400`.

**Example:**

```bash
curl http://localhost:3000/api/v1/vcons/123e4567-e89b-12d3-a456-426614174000 \
  -H "Authorization: Bearer $VCON_API_KEY"
```

---

### Read Analysis and Attachments

**`GET /api/v1/vcons/:uuid/analysis`** returns `{ success, count, type?, analysis }`. Filter with `?type=`.

**`GET /api/v1/vcons/:uuid/attachments`** returns `{ success, count, type?, purpose?, attachments }`. Filter with `?purpose=` (the spec field) or `?type=` (legacy). When both are given, an attachment must match both.

Both return `404` for an unknown vCon.

---

### List vCons

List and filter vCons. Results are paginated with `limit` and `offset`.

**Endpoint:** `GET /api/v1/vcons`

**Authentication:** Required

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 20 | Page size, 1 to 1000 |
| `offset` | integer | 0 | Rows to skip |
| `format` | string | `metadata` | `metadata`, `ids_only`, or `full` |
| `include_count` | boolean | `false` | `true` or `1` adds `pagination.total` and the `X-Total-Count` header. Costs an extra count query |
| `subject` | string | | Case-insensitive partial match |
| `party_name` | string | | Case-insensitive partial match |
| `party_email` | string | | Party email |
| `party_tel` | string | | Party telephone number |
| `start_date` | string | | On or after. `YYYY-MM-DD` is read as midnight UTC |
| `end_date` | string | | On or before |
| `date_field` | string | `created` | Date the window applies to: `created` (`created_at`) or `conversation` (earliest dialog or attachment start, else `created_at`) |
| `tags` | JSON string | | URL-encoded JSON object, for example `{"department":"sales"}` |

An invalid `limit`, `offset`, `format`, `tags`, or `date_field` value returns `400`.

**Response (200 OK):**

```json
{
  "success": true,
  "data": [
    {
      "uuid": "uuid-1",
      "subject": "Call 1",
      "created_at": "2025-01-02T10:00:00.000Z",
      "parties_count": 2,
      "dialog_count": 1,
      "analysis_count": 0,
      "attachments_count": 0
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 187,
    "has_more": true
  },
  "response_format": "metadata"
}
```

- `format=ids_only` makes `data` an array of UUID strings. `format=full` makes it an array of complete vCons.
- `pagination.total` appears only with `include_count`.
- `has_more` is decided from the database result before the `afterSearch` plugin hook runs, so a filtering plugin cannot make it wrong.

**Example:**

```bash
# First page of 20 (default)
curl http://localhost:3000/api/v1/vcons \
  -H "Authorization: Bearer $VCON_API_KEY"

# Second page of 50, with a total count and a tag filter
curl -G http://localhost:3000/api/v1/vcons \
  --data-urlencode 'limit=50' --data-urlencode 'offset=50' \
  --data-urlencode 'include_count=true' \
  --data-urlencode 'tags={"department":"support"}' \
  -H "Authorization: Bearer $VCON_API_KEY"
```

---

### Update vCon

Update top-level vCon fields.

**Endpoint:** `PATCH /api/v1/vcons/:uuid`

**Authentication:** Required (full-access key)

**Request Body:** a JSON object. Only `subject`, `extensions`, and `critical` (or the legacy `must_support`, used when `critical` is absent) are applied. Other keys are dropped without an error.

**Response (200 OK):** `{ "success": true, "vcon": { ... } }` with the updated vCon.

Returns `400` when the body is not an object, and `404` for an unknown vCon.

---

### Delete vCon

Delete a vCon by UUID.

**Endpoint:** `DELETE /api/v1/vcons/:uuid`

**Authentication:** Required (full-access key)

**URL Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `uuid` | string | vCon UUID (required) |

**Response (200 OK):**

```json
{
  "success": true,
  "message": "vCon 123e4567-e89b-12d3-a456-426614174000 deleted successfully"
}
```

**Response (404 Not Found):**

```json
{
  "success": false,
  "error": "Error",
  "message": "vCon with UUID 123e4567-e89b-12d3-a456-426614174000 not found"
}
```

**Example:**

```bash
curl -X DELETE http://localhost:3000/api/v1/vcons/123e4567-e89b-12d3-a456-426614174000 \
  -H "Authorization: Bearer $VCON_API_KEY"
```

---

### Parties, Dialog, Analysis, and Attachments

Child objects are added with `POST` and addressed by zero-based `index` for replacement and removal. Request bodies are the child object itself, using the same fields and rules as the MCP tools. See [Child object fields](./tools.md#child-object-fields).

| Method | Path | Body | Success |
|--------|------|------|---------|
| POST | `/vcons/:uuid/parties` | Party | `201`, `{ success, message, index, party }` |
| POST | `/vcons/:uuid/dialog` | Dialog | `201`, `{ success, message, dialog }` |
| POST | `/vcons/:uuid/analysis` | Analysis (`vendor` required) | `201`, `{ success, message, analysis }` |
| POST | `/vcons/:uuid/attachments` | Attachment | `201`, `{ success, message, attachment }` |
| PATCH | `/vcons/:uuid/{parties,dialog,analysis,attachments}/:index` | Replacement object | `200`, `{ success, message, <object> }` |
| DELETE | `/vcons/:uuid/{parties,dialog,analysis,attachments}/:index` | none | `200`, `{ success, message }` |

- `PATCH` replaces the element at `index` with PUT semantics: fields you omit are cleared.
- `DELETE` follows IETF core-02 section 4.1.8. Removing a party or a dialog keeps the slot as a placeholder, so positional references do not shift. Removing an analysis or an attachment deletes it and renumbers the rest. Removing a `tags` attachment clears the vCon's tags.
- `DELETE /vcons/:uuid/parties/:index?anonymize=true` (or `anonymize=1`) writes `{ "name": "anonymous" }` into the slot instead of an empty party.
- A failed shape or validation check returns `400`. A bad `index` (not a non-negative integer) returns `400`. An unknown vCon, or an `index` outside the array, returns `404`.

```bash
# Replace the second analysis
curl -X PATCH http://localhost:3000/api/v1/vcons/123e4567-e89b-12d3-a456-426614174000/analysis/1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VCON_API_KEY" \
  -d '{"type": "summary", "vendor": "OpenAI", "body": "Updated summary.", "encoding": "none"}'
```

---

### Tags

| Method | Path | Notes |
|--------|------|-------|
| GET | `/vcons/:uuid/tags` | `{ success, tags }`. With `?key=` returns `{ success, key, value }`, using `?default=` (or `null`) when the tag is absent |
| PUT | `/vcons/:uuid/tags/:key` | Body `{ "value": ... }`; the value is stored as a string. Returns `{ success, key, value, message }` |
| DELETE | `/vcons/:uuid/tags/:key` | `204 No Content` |
| DELETE | `/vcons/:uuid/tags` | `204 No Content` |
| GET | `/tags` | Unique tag keys and values. Query: `include_counts` (`true` to enable), `key_filter`, `min_count` (1 to 100000, default 1). Returns `{ success, keys, tagsByKey, countsPerValue?, totalVCons }` |
| GET | `/tags/search` | Query: `tags` (URL-encoded JSON object, non-empty, required), `limit` (1 to 100, default 50). Returns `{ success, count, uuids }`: UUIDs only |

The `/tags` response uses camelCase keys (`tagsByKey`, `countsPerValue`, `totalVCons`), unlike the snake_case `get_unique_tags` MCP tool.

---

### Search

Search routes sit under `/vcons/search/` and are matched before `/vcons/:uuid`.

| Endpoint | Query parameters | Response |
|----------|------------------|----------|
| `GET /vcons/search/content` | `q` (required), `format` (`snippets` default, `metadata`, `ids_only`, `full`), `limit` (1 to 1000, default 50), `tags`, `start_date`, `end_date`, `date_field`, `include_count=true` | `{ success, count, response_format, results, total_count? }`, with the same row shapes as `search_vcons_content` |
| `GET /vcons/search/semantic` | `q` or `embedding` (URL-encoded JSON array of 384 numbers), `threshold` (0 to 1, default 0.7), `limit` (1 to 1000, default 50), `tags` | `{ success, count, results }` with rows `{ vcon_id, content_type, content_reference, content_text, similarity_score }` |
| `GET /vcons/search/hybrid` | `q` (required), `semantic_weight` (0 to 1, default 0.6), `limit` (1 to 1000, default 50), `tags` | `{ success, count, results }` with rows `{ vcon_id, combined_score, semantic_score, keyword_score }` |

- Semantic and hybrid take no `format` parameter. Hybrid always embeds `q` itself, and falls back to keyword-only ranking when the embedding fails.
- Semantic search returns `422` when the query embedding cannot be generated (provider misconfigured or unreachable). It returns `400` when neither `q` nor `embedding` is given, or the embedding is not 384 dimensions.
- None of the three has an `offset`.

---

### Database and Analytics

All are `GET` except `POST /database/analyze`. Responses are `{ success: true, data }`. Boolean parameters accept `true`, `false`, `1`, and `0`; absent or other values keep the default.

| Endpoint | Query parameters (default) |
|----------|----------------------------|
| `GET /database/shape` | `include_counts` (true), `include_sizes` (true), `include_indexes` (true), `include_columns` (false) |
| `GET /database/stats` | `include_query_stats` (true), `include_index_usage` (true), `include_cache_stats` (true), `table` |
| `GET /database/size` | `include_recommendations` (true) |
| `GET /database/health` | `include_performance`, `include_storage`, `include_index_health`, `include_connections`, `include_recommendations` (all true) |
| `POST /database/analyze` | Body `{ "query": "SELECT ...", "mode": "explain" \| "explain_analyze" }`. Only `SELECT` is accepted; anything else returns `400` |
| `GET /analytics` | `months_back` (1 to 60, default 12), `include_growth`, `include_content`, `include_attachments`, `include_tags`, `include_health` (all true) |
| `GET /analytics/growth` | `months_back` (1 to 60, default 12), `granularity` (`monthly` default, `weekly`, `daily`), `include_projections` (true) |
| `GET /analytics/content` | `start_date`, `end_date`, `date_field`, `include_dialog`, `include_analysis`, `include_parties`, `include_metrics` (true), `include_temporal` (false) |
| `GET /analytics/tags` | `top_n` (1 to 100, default 20), `min_count` (1 to 100000, default 1), `include_frequency` (true), `include_distribution` (true), `include_trends` (false) |
| `GET /analytics/attachments` | `top_n` (1 to 50, default 10), `include_sizes` (true), `include_types` (true), `include_temporal` (false) |

The parameter names differ from the MCP tools of the same purpose. For example, `table` here is `table_name` in `get_database_stats`, and `mode` is `analyze_mode` in `analyze_query`.

---

## Error Handling

Errors take one of three shapes, depending on where they arise.

**Route errors** (validation, not found, embedding failure) come from the route handlers:

```json
{
  "success": false,
  "error": "Error",
  "message": "Human-readable error description"
}
```

`error` is `"Error"` for 4xx and `"Internal Server Error"` for 5xx. An optional `details` field may appear. Invalid `limit` and `offset` values on `GET /vcons` use this shape too.

**Authentication errors** (401, 403, 503) come from the auth middleware and have no `success` field. See [Authentication Responses](#authentication-responses).

**Unhandled errors** come from the global error handler and add a timestamp:

```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred",
  "timestamp": "2025-01-02T10:30:00.000Z"
}
```

This handler also covers failures raised by the framework, such as a request body that is not valid JSON (`400`). Its `error` is `"Error"` for status codes below 500.

> **Note:** In production the `message` of a 5xx response is replaced with `An unexpected error occurred`. In other environments it carries the real error text.

### HTTP Status Codes

| Status | Description |
|--------|-------------|
| `200` | Success |
| `201` | Created (vCon, batch with no failures, or child object) |
| `204` | No content (tag removal) |
| `207` | Multi-Status (batch with partial success) |
| `400` | Bad Request: invalid body, UUID, `index`, or query parameter (`limit`, `offset`, `format`, `tags`, `threshold`, `min_count`, and others), or a failed validation |
| `401` | Unauthorized: missing or invalid API key |
| `403` | Forbidden: a read-only key or anonymous request used a write method |
| `404` | Not Found: no such vCon, or a child `index` outside the array |
| `422` | Unprocessable: the query embedding for semantic search could not be generated |
| `500` | Internal Server Error |
| `503` | Service Unavailable: auth required but no keys configured, or `/health` found the database unreachable |

Unknown paths get the framework's plain `404 Not Found`, and a known path with an unsupported method gets `405`.

---

## Plugin Integration

The REST API shares the plugin system with the MCP tools. Only some routes run lifecycle hooks:

| Operation | Hooks Triggered |
|-----------|-----------------|
| Create vCon, and each vCon in a batch | `beforeCreate`, `afterCreate` |
| Get vCon, read analysis, read attachments | `beforeRead`, `afterRead` |
| Update vCon (`PATCH /vcons/:uuid`) | `beforeUpdate`, `afterUpdate` |
| List vCons (`GET /vcons`) | `beforeSearch`, `afterSearch` |
| Delete vCon | `beforeDelete`, `afterDelete` |

These do **not** run hooks: the content, semantic, and hybrid search routes, the tag routes, the child object routes (add, replace, and remove for parties, dialog, analysis, and attachments), discovery, and the database and analytics routes. A plugin that enforces access control or privacy filtering must not assume it sees every read or write through these routes. The MCP tools have the same gaps: for example `vcon_fetch`, `vcon_search`, and the add, update, and remove tools for child objects skip the hooks.

See the [Plugin Development Guide](../development/plugins.md) for more information.

---

## Request Logging

All requests are logged with the following information:

```json
{
  "level": "info",
  "msg": "REST API request",
  "method": "POST",
  "path": "/api/v1/vcons",
  "remote_address": "192.168.1.100",
  "user_agent": "curl/7.79.1"
}
```

Response logging includes duration:

```json
{
  "level": "info",
  "msg": "REST API response",
  "method": "POST",
  "path": "/api/v1/vcons",
  "status": 201,
  "duration_ms": 45
}
```

---

## CORS Configuration

The REST API supports CORS with a configurable origin. `CORS_ORIGIN` takes a single origin value.

**Allowed Methods:** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`

**Allowed Headers:** `Content-Type`, `Authorization`, `x-api-key`

**Exposed Headers:** `X-Version`, `X-Git-Commit`, `X-Build-Time`, `X-Total-Count`

**Configure CORS Origin:**

```bash
# Allow all origins (default)
CORS_ORIGIN=*

# Allow specific origin
CORS_ORIGIN=https://myapp.com
```

---

## Usage Examples

### JavaScript/Node.js

```javascript
const API_URL = 'http://localhost:3000/api/v1';
const API_KEY = 'your-api-key';

// Create a vCon
async function createVCon(vcon) {
  const response = await fetch(`${API_URL}/vcons`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(vcon),
  });
  return response.json();
}

// Get a vCon
async function getVCon(uuid) {
  const response = await fetch(`${API_URL}/vcons/${uuid}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  });
  return response.json();
}

// Batch create
async function batchCreate(vcons) {
  const response = await fetch(`${API_URL}/vcons/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(vcons),
  });
  return response.json();
}

// Example usage
const result = await createVCon({
  vcon: '0.4.0',
  subject: 'Support Call',
  parties: [
    { name: 'Agent', mailto: 'agent@company.com' },
    { name: 'Customer', tel: '+1-555-1234' },
  ],
});

console.log('Created vCon:', result.uuid);
```

### Python

```python
import requests

API_URL = 'http://localhost:3000/api/v1'
API_KEY = 'your-api-key'

headers = {
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {API_KEY}',
}

# Create a vCon
def create_vcon(vcon):
    response = requests.post(f'{API_URL}/vcons', json=vcon, headers=headers)
    return response.json()

# Get a vCon
def get_vcon(uuid):
    response = requests.get(f'{API_URL}/vcons/{uuid}', headers=headers)
    return response.json()

# Batch create
def batch_create(vcons):
    response = requests.post(f'{API_URL}/vcons/batch', json=vcons, headers=headers)
    return response.json()

# Example usage
result = create_vcon({
    'vcon': '0.4.0',
    'subject': 'Support Call',
    'parties': [
        {'name': 'Agent', 'mailto': 'agent@company.com'},
        {'name': 'Customer', 'tel': '+1-555-1234'},
    ],
})

print(f"Created vCon: {result['uuid']}")
```

### cURL Examples

```bash
# Health check
curl http://localhost:3000/api/v1/health

# Create vCon
curl -X POST http://localhost:3000/api/v1/vcons \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-key" \
  -d '{"vcon":"0.4.0","subject":"Test","parties":[{"name":"Test","tel":"+1111"}]}'

# Get vCon
curl http://localhost:3000/api/v1/vcons/UUID-HERE \
  -H "Authorization: Bearer your-key"

# List vCons
curl "http://localhost:3000/api/v1/vcons?limit=20" \
  -H "Authorization: Bearer your-key"

# Delete vCon
curl -X DELETE http://localhost:3000/api/v1/vcons/UUID-HERE \
  -H "Authorization: Bearer your-key"

# Batch create
curl -X POST http://localhost:3000/api/v1/vcons/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-key" \
  -d '[{"vcon":"0.4.0","parties":[{"name":"A","tel":"+1"}]},{"vcon":"0.4.0","parties":[{"name":"B","tel":"+2"}]}]'
```

---

## Full Endpoint Reference

All endpoints use `/api/v1` as the default base path. The REST API has 46 routes.

### vCon CRUD & Sub-resources

| Method | Path | Description |
|--------|------|-------------|
| POST | `/vcons` | Create a vCon |
| POST | `/vcons/batch` | Batch create (up to 100) |
| GET | `/vcons` | List vCons with filters (`limit`, `offset`, `format`, `include_count`) |
| GET | `/vcons/:uuid` | Get vCon by UUID (`?format=full\|summary\|metadata`) |
| GET | `/vcons/:uuid/analysis` | Read analysis, optionally filtered by `?type=` |
| GET | `/vcons/:uuid/attachments` | Read attachments, preferably filtered by `?purpose=`; `?type=` remains for legacy compatibility |
| PATCH | `/vcons/:uuid` | Update vCon metadata (subject, extensions, critical) |
| DELETE | `/vcons/:uuid` | Delete a vCon |
| POST | `/vcons/:uuid/parties` | Append a party |
| POST | `/vcons/:uuid/dialog` | Add dialog to a vCon |
| POST | `/vcons/:uuid/analysis` | Add analysis to a vCon |
| POST | `/vcons/:uuid/attachments` | Add attachment to a vCon |
| PATCH | `/vcons/:uuid/{parties,dialog,analysis,attachments}/:index` | Replace the child at `index` (PUT semantics); four routes |
| DELETE | `/vcons/:uuid/{parties,dialog,analysis,attachments}/:index` | Remove the child at `index`; four routes. Parties and dialog leave a placeholder, analysis and attachments renumber. `?anonymize=true` on parties |

### Discovery

| Method | Path | Description |
|--------|------|-------------|
| GET | `/discovery/attachments/purposes` | Discover live attachment purposes (`?include_counts=false`, `?min_count=2`) |
| GET | `/discovery/attachments/types` | Discover legacy attachment types (`?include_counts=false`, `?min_count=2`) |
| GET | `/discovery/analysis/types` | Discover live analysis types (`?include_counts=false`, `?min_count=2`) |

### Tags

| Method | Path | Description |
|--------|------|-------------|
| GET | `/vcons/:uuid/tags` | Get all tags (or single via `?key=`) |
| PUT | `/vcons/:uuid/tags/:key` | Set a tag (body: `{"value": "..."}`) |
| DELETE | `/vcons/:uuid/tags/:key` | Remove a tag |
| DELETE | `/vcons/:uuid/tags` | Remove all tags |
| GET | `/tags` | Discover unique tags across DB |
| GET | `/tags/search` | Search vCons by tags (`?tags={"key":"value"}`), UUIDs only |

### Search

| Method | Path | Description |
|--------|------|-------------|
| GET | `/vcons/search/content` | Keyword/full-text search (`?q=`) |
| GET | `/vcons/search/semantic` | Semantic/embedding search (`?q=`) |
| GET | `/vcons/search/hybrid` | Combined keyword + semantic search (`?q=`) |

### Database & Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/database/shape` | Database schema shape |
| GET | `/database/stats` | Performance statistics |
| GET | `/database/size` | Size info and recommendations |
| GET | `/database/health` | Health metrics |
| POST | `/database/analyze` | Analyze a SQL query plan |
| GET | `/analytics` | Full analytics dashboard |
| GET | `/analytics/growth` | Growth trends |
| GET | `/analytics/content` | Content analytics |
| GET | `/analytics/tags` | Tag analytics |
| GET | `/analytics/attachments` | Attachment analytics |

### Infrastructure

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (no auth; details only for authenticated callers) |
| GET | `/version` | Version info (no auth) |
| GET | `/schema` | Pointer to the vCon specification, not a schema document (no auth) |
| GET | `/examples/:type` | Skeleton example vCons (no auth) |

---

## Comparison: REST API vs MCP Tools

The REST API does not mirror the MCP tools one for one. Both share the `VConService` business logic layer and database queries, but each has capabilities the other lacks.

| Feature | REST API | MCP Tools |
|---------|----------|-----------|
| Protocol | HTTP/JSON | MCP (stdio/HTTP) |
| Auth | API Key (Bearer), read-only keys, optional anonymous read-only | MCP client auth (over HTTP, the same API keys) |
| Best for | External integrations, scripts | AI assistants |
| Operations | CRUD + child objects | 46 tools |
| Search | List filters plus keyword, semantic, and hybrid routes | `search_vcons` plus the content, semantic, and hybrid tools, and the unified `vcon_search` |
| Tags | Per-vCon set, get, remove, plus discovery and UUID search | Five tag tools |
| Analytics | Per-area routes with their own parameter names | Six analytics tools |
| Batch | Yes (100 max) | No |
| Streaming | No | Yes (SSE) |

### MCP tools with no REST route

- `create_vcon_from_template`
- The contract tools: `vcon_capabilities`, `vcon_taxonomy`, `vcon_search`, `vcon_fetch`, `vcon_aggregate`, `vcon_graph_shape`, `describe_response_shape`
- `get_smart_search_limits`

### MCP tools whose REST counterpart does less

- `get_schema` and `get_examples`: REST returns a pointer to the specification and skeleton examples. There is no YAML output.
- `search_by_tags`: `GET /tags/search` returns UUIDs only, with no `return_full_vcons`.
- `search_vcons_semantic` and `search_vcons_hybrid`: REST has no `response_format`. The hybrid route cannot take a precomputed embedding.
- `get_tags`: REST returns no `exists` flag or `count`.

### REST-only routes

- `POST /vcons/batch`
- The three `/discovery/...` routes (the MCP side offers the same data as resources)
- `GET /vcons/:uuid/analysis` and `GET /vcons/:uuid/attachments`
- `/health`, `/version`

---

## Next Steps

- See [MCP Tools](./tools.md) for the full MCP toolkit
- See [Resources](./resources.md) for URI-based access
- See [Docker Deployment](../deployment/docker.md) for production setup
- See [Plugin Development](../development/plugins.md) for extending the API
