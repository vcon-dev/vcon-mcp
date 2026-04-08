# VCONIC MCP Server — Upgrade Guide

**Document ID:** VCONIC-MCP-UPG-001  
**Product:** VCONIC MCP Server  
**Version:** 1.2.0  
**Audience:** Value Added Reseller (VAR) / Systems Integrator  
**Last Updated:** April 2026

---

## 1. Overview

This guide covers the procedures for upgrading the VCONIC MCP Server. The MCP Server is delivered as a Docker image, making upgrades straightforward: pull the new image, run migrations, and restart.

---

## 2. Pre-Upgrade Checklist

- [ ] **Read the Release Notes** for the target version
- [ ] **Back up the database** (see [Administration Guide](./04-administration-guide.md))
- [ ] **Back up the environment file** (`.env.mcp`)
- [ ] **Verify current system health** — health endpoint returns healthy
- [ ] **Note the current image tag** for rollback purposes
- [ ] **Notify connected AI assistant users** of brief downtime

---

## 3. Upgrade Procedure

### 3.1 Record Current Version

```bash
# Note current image
docker inspect vcon-mcp --format '{{.Config.Image}}'

# Note current health
curl http://localhost:3000/api/v1/health
```

### 3.2 Pull New Image

```bash
docker pull public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:<new-version>
```

### 3.3 Run Database Migrations

```bash
docker run --rm \
  -e SUPABASE_DB_URL="$SUPABASE_DB_URL" \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:<new-version> migrate
```

### 3.4 Stop Current Container

```bash
docker stop vcon-mcp
docker rm vcon-mcp
```

### 3.5 Start New Version

```bash
docker run -d \
  --name vcon-mcp \
  --restart unless-stopped \
  --network conserver \
  -p 3000:3000 \
  --env-file .env.mcp \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:<new-version>
```

### 3.6 Verify

```bash
# Health check
curl http://localhost:3000/api/v1/health

# Check logs
docker logs vcon-mcp --tail 30

# Verify tools work (via REST API)
curl -H "Authorization: Bearer <key>" http://localhost:3000/api/v1/vcons
```

---

## 4. Rollback Procedure

### 4.1 Stop New Version

```bash
docker stop vcon-mcp
docker rm vcon-mcp
```

### 4.2 Start Previous Version

```bash
docker run -d \
  --name vcon-mcp \
  --restart unless-stopped \
  --network conserver \
  -p 3000:3000 \
  --env-file .env.mcp \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:<previous-version>
```

### 4.3 Rollback Migrations (If Needed)

> **CAUTION:** Migration rollback may cause data loss if the new version created new tables or columns. Only rollback migrations if instructed by VCONIC engineering.

### 4.4 Verify

```bash
curl http://localhost:3000/api/v1/health
```

---

## 5. Zero-Downtime Upgrade (Advanced)

For deployments that cannot tolerate downtime:

1. Start the new version on a different port:

```bash
docker run -d --name vcon-mcp-new -p 3001:3000 --env-file .env.mcp <new-image>
```

2. Verify the new instance:

```bash
curl http://localhost:3001/api/v1/health
```

3. Switch the reverse proxy to point to the new port
4. Stop the old container:

```bash
docker stop vcon-mcp && docker rm vcon-mcp
```

5. Rename the new container and update port:

```bash
docker stop vcon-mcp-new && docker rm vcon-mcp-new
# Re-run on standard port
docker run -d --name vcon-mcp -p 3000:3000 --env-file .env.mcp <new-image>
```

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | April 2026 | VCONIC Engineering | Initial release |
