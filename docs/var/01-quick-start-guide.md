# VCONIC MCP Server — Quick Start Guide

**Document ID:** VCONIC-MCP-QSG-001  
**Product:** VCONIC MCP Server  
**Version:** 1.2.0  
**Audience:** Value Added Reseller (VAR) / Systems Integrator  
**Last Updated:** April 2026

---

## Purpose

This guide gets the VCONIC MCP Server running and connected to an AI assistant in under 20 minutes. For full installation procedures, see the [Installation Guide](./02-installation-guide.md).

---

## Prerequisites Checklist

Before you begin, confirm the following:

- [ ] A running PostgreSQL database (Supabase hosted or self-hosted with Supabase schema)
- [ ] Supabase project URL and service role key
- [ ] Docker Engine 24+ installed on the host (for Docker deployment) **or** Node.js 20+ (for local deployment)
- [ ] Minimum 2 CPU cores, 4 GB RAM
- [ ] Network access to the Supabase database endpoint

> **NOTE:** The MCP Server reads vCon data from the same PostgreSQL database that the Conserver writes to. The Conserver must be installed and operational before the MCP Server can serve useful data.

---

## Step 1: Run Database Migrations

The MCP Server requires its schema in the PostgreSQL database. Run migrations first:

```bash
docker run --rm \
  -e SUPABASE_DB_URL="postgresql://postgres:<password>@<host>:5432/postgres" \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main migrate
```

Expected output: migration success messages with no errors.

---

## Step 2: Start the MCP Server

### Option A: Docker (Recommended for Production)

```bash
docker run -d \
  --name vcon-mcp \
  -p 3000:3000 \
  -e SUPABASE_URL="https://<your-project>.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>" \
  -e MCP_TRANSPORT=http \
  -e MCP_HTTP_HOST=0.0.0.0 \
  -e API_AUTH_REQUIRED=true \
  -e API_KEYS="<your-api-key>" \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
```

### Option B: Local Node.js (Development Only)

```bash
cd /opt/vcon-mcp
cp .env.example .env
# Edit .env with your Supabase credentials
npm install
npm run build
npm run dev
```

---

## Step 3: Verify

Hit the health endpoint:

```bash
curl http://localhost:3000/api/v1/health
```

Expected response:

```json
{
  "status": "healthy",
  "timestamp": "2026-04-08T14:30:00.000Z",
  "version": {
    "version": "1.2.0",
    "gitCommit": "abc1234",
    "buildTime": "2026-04-08T00:00:00Z"
  }
}
```

---

## Step 4: Connect an AI Assistant

### Claude Desktop

Add the following to your Claude Desktop MCP configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "vcon": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "SUPABASE_URL=https://<your-project>.supabase.co",
        "-e", "SUPABASE_SERVICE_ROLE_KEY=<your-key>",
        "public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main"
      ]
    }
  }
}
```

### HTTP Mode (For Other Clients)

Any MCP-compatible client can connect to `http://localhost:3000/mcp` using the Streamable HTTP transport.

---

## Step 5: Test a Query

In your AI assistant, ask:

> "Search for recent conversations and summarize what you find."

The assistant will use the MCP Server's `search_vcons` tool to query the database and return results.

---

## What's Next

| Task | Document |
|------|----------|
| Full installation with auth, caching, and tool profiles | [Installation Guide](./02-installation-guide.md) |
| Configure transport, tools, plugins, and multi-tenancy | [Configuration Guide](./03-configuration-guide.md) |
| Day-to-day operations and monitoring | [Administration Guide](./04-administration-guide.md) |
| Troubleshoot issues | [Troubleshooting Guide](./05-troubleshooting-guide.md) |

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | April 2026 | VCONIC Engineering | Initial release |
