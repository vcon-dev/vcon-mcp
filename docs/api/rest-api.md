# REST API Reference

HTTP REST API for vCon ingestion and operations.

## Overview

The vCon MCP Server exposes a RESTful HTTP API alongside the MCP transport layer. This API provides endpoints for vCon CRUD operations, designed for programmatic integration with external systems.

### Key Features

- **HTTP/JSON** - Standard REST conventions
- **API Key Authentication** - Secure access with configurable API keys
- **CORS Support** - Configurable cross-origin resource sharing
- **Plugin Integration** - Full lifecycle hooks (beforeCreate, afterCreate, etc.)
- **Batch Operations** - Ingest up to 100 vCons in a single request
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
| `VCON_API_KEYS` | (none) | Comma-separated list of valid API keys |
| `API_KEYS` | (none) | Alternative to `VCON_API_KEYS` |
| `API_KEY_HEADER` | `x-api-key` | Header name for API key |
| `API_AUTH_REQUIRED` | `true` | Set to `false` to disable authentication |

### HTTP Transport Variables

The REST API requires HTTP transport mode to be enabled:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | Set to `http` to enable HTTP server |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP host to bind |
| `MCP_HTTP_PORT` | `3000` | HTTP port to listen on |
| `CORS_ORIGIN` | `*` | CORS allowed origins |

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
VCON_API_KEYS=key1-abc123,key2-def456
API_AUTH_REQUIRED=true
```

---

## Authentication

All REST API endpoints (except `/health`) require API key authentication.

### Request Headers

```http
x-api-key: your-api-key-here
```

### Authentication Responses

**401 Unauthorized - Missing API Key:**

```json
{
  "error": "Unauthorized",
  "message": "Missing x-api-key header"
}
```

**401 Unauthorized - Invalid API Key:**

```json
{
  "error": "Unauthorized",
  "message": "Invalid API key"
}
```

**503 Service Unavailable - Auth Not Configured:**

```json
{
  "error": "Service Unavailable",
  "message": "API authentication is required but not configured. Please contact the administrator.",
  "hint": "Set VCON_API_KEYS or API_KEYS env var, or set API_AUTH_REQUIRED=false"
}
```

> **Note:** The `hint` field is only included in non-production environments.

---

## Endpoints

### Health Check

Check API and database health status.

**Endpoint:** `GET /api/v1/health`

**Authentication:** Not required

**Response (200 OK):**

```json
{
  "status": "healthy",
  "timestamp": "2025-01-02T10:30:00.000Z",
  "database": "connected"
}
```

**Response (503 Service Unavailable):**

```json
{
  "status": "unhealthy",
  "timestamp": "2025-01-02T10:30:00.000Z",
  "database": "error",
  "error": "Connection refused"
}
```

**Example:**

```bash
curl http://localhost:3000/api/v1/health
```

---

### Create vCon

Create/ingest a single vCon.

**Endpoint:** `POST /api/v1/vcons`

**Authentication:** Required

**Request Headers:**

```http
Content-Type: application/json
x-api-key: your-api-key
```

**Request Body:**

The request body should be the vCon object directly:

```json
{
  "vcon": "0.3.0",
  "uuid": "optional-custom-uuid",
  "subject": "Customer Support Call",
  "parties": [
    {
      "name": "Agent Smith",
      "mailto": "smith@company.com",
      "role": "agent"
    },
    {
      "name": "John Doe",
      "tel": "+1-555-1234",
      "role": "customer"
    }
  ],
  "dialog": [
    {
      "type": "text",
      "start": "2025-01-02T10:00:00Z",
      "parties": [0, 1],
      "originator": 1,
      "body": "Hello, I need help with my account."
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
  "duration_ms": 45
}
```

**Response (400 Bad Request - Validation Error):**

```json
{
  "error": "Validation Error",
  "message": "Missing required field: parties; Invalid party: must have at least one identifier"
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/vcons \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "vcon": "0.3.0",
    "subject": "Sales Call",
    "parties": [
      {"name": "Sales Rep", "mailto": "rep@company.com"},
      {"name": "Customer", "tel": "+1-555-9876"}
    ]
  }'
```

---

### Batch Create vCons

Ingest multiple vCons in a single request (up to 100).

**Endpoint:** `POST /api/v1/vcons/batch`

**Authentication:** Required

**Request Headers:**

```http
Content-Type: application/json
x-api-key: your-api-key
```

**Request Body:**

Array of vCon objects:

```json
[
  {
    "vcon": "0.3.0",
    "subject": "Call 1",
    "parties": [{"name": "Agent A", "mailto": "a@example.com"}]
  },
  {
    "vcon": "0.3.0",
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
      "id": "42"
    },
    {
      "uuid": "uuid-2",
      "success": true,
      "id": "43"
    }
  ],
  "duration_ms": 120
}
```

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
      "id": "42"
    },
    {
      "uuid": "uuid-2",
      "success": true,
      "id": "43"
    },
    {
      "uuid": "unknown",
      "success": false,
      "error": "Validation failed: Missing required field: parties"
    }
  ],
  "duration_ms": 150
}
```

**Response (400 Bad Request):**

```json
{
  "error": "Validation Error",
  "message": "Request body must be an array of vCons"
}
```

```json
{
  "error": "Validation Error",
  "message": "Maximum 100 vCons per batch"
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/vcons/batch \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '[
    {"vcon": "0.3.0", "subject": "Call 1", "parties": [{"name": "A", "tel": "+1111"}]},
    {"vcon": "0.3.0", "subject": "Call 2", "parties": [{"name": "B", "tel": "+2222"}]}
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

**Response (200 OK):**

```json
{
  "success": true,
  "vcon": {
    "vcon": "0.3.0",
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
  "error": "Not Found",
  "message": "vCon with UUID 123e4567-e89b-12d3-a456-426614174000 not found"
}
```

**Example:**

```bash
curl http://localhost:3000/api/v1/vcons/123e4567-e89b-12d3-a456-426614174000 \
  -H "x-api-key: your-api-key"
```

---

### List vCons

List recent vCons with optional limit.

**Endpoint:** `GET /api/v1/vcons`

**Authentication:** Required

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 10 | Number of vCons to return (max: 100) |

**Response (200 OK):**

```json
{
  "success": true,
  "count": 10,
  "limit": 10,
  "vcons": [
    {
      "vcon": "0.3.0",
      "uuid": "uuid-1",
      "created_at": "2025-01-02T10:00:00.000Z",
      "subject": "Call 1",
      "parties": [...]
    },
    {
      "vcon": "0.3.0",
      "uuid": "uuid-2",
      "created_at": "2025-01-02T09:00:00.000Z",
      "subject": "Call 2",
      "parties": [...]
    }
  ]
}
```

**Example:**

```bash
# Get last 10 vCons (default)
curl http://localhost:3000/api/v1/vcons \
  -H "x-api-key: your-api-key"

# Get last 50 vCons
curl "http://localhost:3000/api/v1/vcons?limit=50" \
  -H "x-api-key: your-api-key"
```

---

### Delete vCon

Delete a vCon by UUID.

**Endpoint:** `DELETE /api/v1/vcons/:uuid`

**Authentication:** Required

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
  "error": "Not Found",
  "message": "vCon with UUID 123e4567-e89b-12d3-a456-426614174000 not found"
}
```

**Example:**

```bash
curl -X DELETE http://localhost:3000/api/v1/vcons/123e4567-e89b-12d3-a456-426614174000 \
  -H "x-api-key: your-api-key"
```

---

## Error Handling

All errors follow a consistent format:

```json
{
  "error": "Error Type",
  "message": "Human-readable error description",
  "timestamp": "2025-01-02T10:30:00.000Z"
}
```

### HTTP Status Codes

| Status | Description |
|--------|-------------|
| `200` | Success |
| `201` | Created (new vCon) |
| `207` | Multi-Status (batch with partial success) |
| `400` | Bad Request (validation error) |
| `401` | Unauthorized (authentication failed) |
| `404` | Not Found |
| `500` | Internal Server Error |
| `503` | Service Unavailable |

### Error Examples

**Internal Server Error (500):**

```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred",
  "timestamp": "2025-01-02T10:30:00.000Z"
}
```

> **Note:** In non-production environments, more detailed error messages are included.

---

## Plugin Integration

The REST API integrates with the vCon MCP Server's plugin system. All vCon operations trigger the appropriate lifecycle hooks:

| Operation | Hooks Triggered |
|-----------|-----------------|
| Create vCon | `beforeCreate`, `afterCreate` |
| Get vCon | `beforeRead`, `afterRead` |
| List vCons | `beforeSearch`, `afterSearch` |
| Delete vCon | `beforeDelete`, `afterDelete` |

This ensures consistent behavior between MCP tools and REST API operations, including:

- Privacy filtering
- Access control
- Audit logging
- Data transformation

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

The REST API supports CORS with configurable options:

**Allowed Methods:** `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`

**Allowed Headers:** `Content-Type`, `x-api-key`, `Authorization`

**Configure CORS Origin:**

```bash
# Allow all origins (default)
CORS_ORIGIN=*

# Allow specific origin
CORS_ORIGIN=https://myapp.com

# Allow multiple origins (comma-separated)
CORS_ORIGIN=https://app1.com,https://app2.com
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
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(vcon),
  });
  return response.json();
}

// Get a vCon
async function getVCon(uuid) {
  const response = await fetch(`${API_URL}/vcons/${uuid}`, {
    headers: { 'x-api-key': API_KEY },
  });
  return response.json();
}

// Batch create
async function batchCreate(vcons) {
  const response = await fetch(`${API_URL}/vcons/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(vcons),
  });
  return response.json();
}

// Example usage
const result = await createVCon({
  vcon: '0.3.0',
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
    'x-api-key': API_KEY,
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
    'vcon': '0.3.0',
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
  -H "x-api-key: your-key" \
  -d '{"vcon":"0.3.0","subject":"Test","parties":[{"name":"Test","tel":"+1111"}]}'

# Get vCon
curl http://localhost:3000/api/v1/vcons/UUID-HERE \
  -H "x-api-key: your-key"

# List vCons
curl "http://localhost:3000/api/v1/vcons?limit=20" \
  -H "x-api-key: your-key"

# Delete vCon
curl -X DELETE http://localhost:3000/api/v1/vcons/UUID-HERE \
  -H "x-api-key: your-key"

# Batch create
curl -X POST http://localhost:3000/api/v1/vcons/batch \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '[{"vcon":"0.3.0","parties":[{"name":"A","tel":"+1"}]},{"vcon":"0.3.0","parties":[{"name":"B","tel":"+2"}]}]'
```

---

## Comparison: REST API vs MCP Tools

| Feature | REST API | MCP Tools |
|---------|----------|-----------|
| Protocol | HTTP/JSON | MCP (stdio/HTTP) |
| Auth | API Key | MCP client auth |
| Best for | External integrations | AI assistants |
| Operations | CRUD only | Full toolkit (30+ tools) |
| Search | List only | 4 search modes |
| Batch | Yes (100 max) | No |
| Streaming | No | Yes (SSE) |

Use the **REST API** for:
- External system integrations
- Batch ingestion pipelines
- Simple CRUD operations
- Webhook receivers

Use **MCP Tools** for:
- AI assistant integrations
- Advanced search (semantic, hybrid)
- Tag management
- Database analytics
- Schema/examples

---

## Next Steps

- See [MCP Tools](./tools.md) for the full MCP toolkit
- See [Resources](./resources.md) for URI-based access
- See [Docker Deployment](../deployment/docker.md) for production setup
- See [Plugin Development](../development/plugins.md) for extending the API

