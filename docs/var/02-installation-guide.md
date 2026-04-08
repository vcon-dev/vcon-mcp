# VCONIC MCP Server — Installation Guide

**Document ID:** VCONIC-MCP-INST-001  
**Product:** VCONIC MCP Server  
**Version:** 1.2.0  
**Audience:** Value Added Reseller (VAR) / Systems Integrator  
**Last Updated:** April 2026

---

## 1. Overview

This guide provides step-by-step procedures for installing the VCONIC MCP Server in a production environment. The MCP Server enables AI assistants (Claude, etc.) to search, manage, and analyze vCon conversation data through the Model Context Protocol.

For a quick evaluation setup, see the [Quick Start Guide](./01-quick-start-guide.md).

---

## 2. Pre-Installation Checklist

### 2.1 Hardware Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Disk | 10 GB SSD | 20 GB SSD |
| Network | 100 Mbps | 1 Gbps |

> **NOTE:** The MCP Server is lightweight compared to the Conserver. It can run on the same host or on a separate machine.

### 2.2 Software Requirements

| Software | Version | Purpose |
|----------|---------|---------|
| Docker Engine | 24.0+ | Container runtime |
| **or** Node.js | 20+ | Direct execution (non-Docker) |

### 2.3 Prerequisites

| Requirement | Details |
|-------------|---------|
| PostgreSQL database | Supabase-hosted or self-hosted PostgreSQL with Supabase extensions |
| Supabase project URL | `https://<project>.supabase.co` or self-hosted URL |
| Supabase service role key | Full-access key for database operations |
| Supabase direct DB URL | `postgresql://...` connection string (for migrations) |

### 2.4 Network Requirements

**Inbound ports:**

| Port | Protocol | Purpose |
|------|----------|---------|
| 3000 | HTTP | MCP Server API and MCP protocol endpoint |

**Outbound access required:**

| Destination | Port | Purpose | Required? |
|-------------|------|---------|-----------|
| Supabase endpoint | 443 | Database access | Yes |
| Docker registry (ECR) | 443 | Image pulls | Yes (Docker deployment) |

---

## 3. Installation Procedure

### 3.1 Pull the Docker Image

```bash
docker pull public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
```

To use a specific version:

```bash
docker pull public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:<version>
```

### 3.2 Run Database Migrations

Before starting the server, apply the database schema:

```bash
docker run --rm \
  -e SUPABASE_DB_URL="postgresql://postgres:<password>@<host>:5432/postgres" \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main migrate
```

Verify migration status:

```bash
docker run --rm \
  -e SUPABASE_DB_URL="postgresql://postgres:<password>@<host>:5432/postgres" \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main migrate-status
```

> **NOTE:** Migrations are idempotent. Running them multiple times is safe.

### 3.3 Create the Environment File

Create a file named `.env.mcp` on the host:

```bash
# ==============================================================
# REQUIRED SETTINGS
# ==============================================================

# Supabase connection
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

# Transport mode
MCP_TRANSPORT=http
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3000

# API authentication
API_AUTH_REQUIRED=true
API_KEYS=<key1>,<key2>

# ==============================================================
# TOOL CONFIGURATION
# ==============================================================

# Tool profile: full, readonly, user, admin, minimal
MCP_TOOLS_PROFILE=full

# ==============================================================
# OPTIONAL: REDIS CACHING
# ==============================================================

# Enables 20-50x faster reads for frequently accessed vCons
# REDIS_URL=redis://<host>:6379
# VCON_REDIS_EXPIRY=3600

# ==============================================================
# OPTIONAL: MULTI-TENANCY
# ==============================================================

# RLS_ENABLED=true
# CURRENT_TENANT_ID=<tenant-uuid>

# ==============================================================
# OBSERVABILITY
# ==============================================================

LOG_LEVEL=info
NODE_ENV=production
OTEL_ENABLED=true
OTEL_EXPORTER_TYPE=console
# OTEL_ENDPOINT=http://otel-collector:4318
```

### 3.4 Start the MCP Server

```bash
docker run -d \
  --name vcon-mcp \
  --restart unless-stopped \
  --network conserver \
  -p 3000:3000 \
  --env-file .env.mcp \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
```

> **NOTE:** Joining the `conserver` Docker network allows the MCP Server to reach Redis and PostgreSQL containers by service name if they are running on the same host.

### 3.5 Verify Installation

**Health check:**

```bash
curl http://localhost:3000/api/v1/health
```

Expected:

```json
{
  "status": "healthy",
  "timestamp": "2026-04-08T14:30:00.000Z",
  "version": {
    "version": "1.2.0",
    "gitCommit": "...",
    "buildTime": "..."
  }
}
```

**Check logs:**

```bash
docker logs vcon-mcp --tail 30
```

Look for:
- `MCP server initialized` — server started successfully
- `HTTP transport listening on 0.0.0.0:3000` — accepting connections
- No error messages

---

## 4. Post-Installation Verification

### 4.1 List Available Tools

Connect an MCP client and verify that tools are available. Using curl to test the REST API:

```bash
curl http://localhost:3000/api/v1/health \
  -H "Authorization: Bearer <your-api-key>"
```

### 4.2 Test vCon Search

If the Conserver has stored vCons in the database, test retrieval:

```bash
curl "http://localhost:3000/api/v1/vcons" \
  -H "Authorization: Bearer <your-api-key>"
```

### 4.3 Test MCP Protocol

For MCP-compatible clients, connect to `http://localhost:3000/mcp` using the Streamable HTTP transport and call the `get_schema` tool to verify.

---

## 5. Production Hardening

### 5.1 Reverse Proxy

Place the MCP Server behind nginx or another reverse proxy for SSL termination:

```nginx
server {
    listen 443 ssl;
    server_name mcp.example.com;

    ssl_certificate     /etc/ssl/certs/mcp.crt;
    ssl_certificate_key /etc/ssl/private/mcp.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for SSE transport
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
    }
}
```

> **IMPORTANT:** The `proxy_buffering off` directive is required for Server-Sent Events (SSE) transport to work correctly.

### 5.2 Tool Access Restriction

Restrict which tools are available based on the deployment's needs:

```bash
# Read-only access (search and retrieve, no create/delete)
MCP_TOOLS_PROFILE=readonly

# Or disable specific categories
MCP_DISABLED_CATEGORIES=infra,analytics

# Or disable individual tools
MCP_DISABLED_TOOLS=delete_vcon,update_vcon
```

### 5.3 DNS Rebinding Protection

Enable DNS rebinding protection for HTTP deployments:

```bash
MCP_HTTP_DNS_PROTECTION=true
MCP_HTTP_ALLOWED_HOSTS=mcp.example.com,localhost
MCP_HTTP_ALLOWED_ORIGINS=https://mcp.example.com
```

### 5.4 CORS Configuration

If the MCP Server will be accessed from web browsers:

```bash
MCP_HTTP_CORS=true
MCP_HTTP_ALLOWED_ORIGINS=https://portal.example.com
```

### 5.5 Redis Caching

For deployments with high query volume, add Redis caching:

```bash
REDIS_URL=redis://<redis-host>:6379
VCON_REDIS_EXPIRY=3600
```

This provides 20–50x faster read performance for frequently accessed vCons.

---

## 6. AI Assistant Integration

### 6.1 Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vcon": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "SUPABASE_URL=https://<project>.supabase.co",
        "-e", "SUPABASE_SERVICE_ROLE_KEY=<key>",
        "public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main"
      ]
    }
  }
}
```

### 6.2 Claude Code

Add to Claude Code's MCP configuration:

```json
{
  "mcpServers": {
    "vcon": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <api-key>"
      }
    }
  }
}
```

### 6.3 Other MCP Clients

Any MCP-compatible client can connect via:
- **stdio** transport: Run the Docker container with `-i` flag (no port mapping needed)
- **HTTP** transport: Connect to `http://<host>:3000/mcp`

---

## 7. Uninstallation

```bash
# Stop and remove the container
docker stop vcon-mcp
docker rm vcon-mcp

# Remove the image
docker rmi public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main

# Remove environment file
rm .env.mcp
```

> **NOTE:** Uninstalling the MCP Server does not affect the vCon data in PostgreSQL. The data remains accessible to other VCONIC products.

---

## 8. Installation Checklist Summary

- [ ] Docker image pulled
- [ ] Database migrations applied
- [ ] Environment file created with all required values
- [ ] Container started and running
- [ ] Health endpoint returns healthy
- [ ] REST API responds to queries
- [ ] AI assistant connected and tools visible
- [ ] SSL/TLS configured via reverse proxy (production)
- [ ] Tool access restrictions applied (production)
- [ ] DNS rebinding protection enabled (production)
- [ ] Redis caching configured (if needed)

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | April 2026 | VCONIC Engineering | Initial release |
