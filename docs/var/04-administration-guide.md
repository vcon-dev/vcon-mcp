# VCONIC MCP Server — Administration Guide

**Document ID:** VCONIC-MCP-ADM-001  
**Product:** VCONIC MCP Server  
**Version:** 1.2.0  
**Audience:** Value Added Reseller (VAR) / Systems Integrator  
**Last Updated:** April 2026

---

## 1. Day-to-Day Operations

### 1.1 Service Management

**Check status:**

```bash
docker ps --filter name=vcon-mcp
```

**Start:**

```bash
docker start vcon-mcp
```

**Stop:**

```bash
docker stop vcon-mcp
```

**Restart:**

```bash
docker restart vcon-mcp
```

**View logs:**

```bash
# Last 50 lines
docker logs vcon-mcp --tail 50

# Follow real-time
docker logs vcon-mcp -f

# Filter for errors (logs are JSON in production)
docker logs vcon-mcp 2>&1 | grep '"level":"error"'
```

### 1.2 Health Monitoring

**Health check:**

```bash
curl http://localhost:3000/api/v1/health
```

**Quick status check script:**

```bash
#!/bin/bash
echo "=== MCP Server Status ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health)
if [ "$STATUS" = "200" ]; then
  echo "Status: HEALTHY"
  curl -s http://localhost:3000/api/v1/health | python3 -m json.tool
else
  echo "Status: UNHEALTHY (HTTP $STATUS)"
  docker logs vcon-mcp --tail 10
fi
```

---

## 2. Database Management

### 2.1 Migration Management

**Check migration status:**

```bash
docker run --rm \
  -e SUPABASE_DB_URL="$SUPABASE_DB_URL" \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main migrate-status
```

**Apply pending migrations:**

```bash
docker run --rm \
  -e SUPABASE_DB_URL="$SUPABASE_DB_URL" \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main migrate
```

### 2.2 Database Analytics

The MCP Server includes built-in database inspection tools accessible via any connected AI assistant:

| Tool | Purpose |
|------|---------|
| `get_database_analytics` | Overall statistics: total vCons, growth rate, content breakdown |
| `get_monthly_growth_analytics` | Monthly trend data |
| `get_database_health_metrics` | Performance indicators |
| `get_database_size_info` | Disk usage per table |
| `get_database_shape` | Schema, indexes, relationships |

These tools can be invoked through any connected MCP client (e.g., Claude).

### 2.3 Utility Scripts

The Docker image includes utility scripts:

```bash
# Embed vCons (generate vector embeddings for semantic search)
docker run --rm \
  -e SUPABASE_URL="$SUPABASE_URL" \
  -e SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main script embed-vcons --provider=openai

# List available scripts
docker run --rm public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main help
```

---

## 3. Backup and Restore

### 3.1 What to Back Up

| Component | Data | Priority |
|-----------|------|----------|
| Supabase PostgreSQL | All vCon data, embeddings, metadata | Critical |
| `.env.mcp` | Environment and credentials | Critical |
| Redis cache | Cached queries | Low (rebuilt automatically) |

### 3.2 Database Backup

**For Supabase-hosted databases:**

Use the Supabase Dashboard:
1. Navigate to **Settings > Database**
2. Click **Download Backup**

Or use the Supabase CLI:

```bash
supabase db dump -p <project-ref> > backup_$(date +%Y%m%d).sql
```

**For self-hosted PostgreSQL:**

```bash
pg_dump -h <host> -U <user> -d postgres -Fc > mcp_backup_$(date +%Y%m%d).dump
```

### 3.3 Configuration Backup

```bash
cp .env.mcp /backups/mcp_env_$(date +%Y%m%d)
```

---

## 4. Cache Management

### 4.1 Redis Cache (If Configured)

**Check cache status:**

```bash
docker compose exec redis redis-cli INFO keyspace
```

**Flush the MCP Server cache:**

```bash
# Flush all cached vCons (safe — will be repopulated on next access)
docker compose exec redis redis-cli FLUSHDB
```

**Monitor cache hit rate:**

```bash
docker compose exec redis redis-cli INFO stats | grep keyspace
```

### 4.2 When to Clear Cache

Clear the Redis cache when:
- vCon data has been modified directly in the database (bypassing the MCP Server)
- You see stale data in search results
- After a database migration that changes data structure

---

## 5. API Key Management

### 5.1 Rotating API Keys

1. Generate a new key:

```bash
openssl rand -hex 32
```

2. Add the new key to `API_KEYS` (comma-separated):

```bash
API_KEYS=old-key,new-key
```

3. Restart the MCP Server:

```bash
docker restart vcon-mcp
```

4. Update all clients to use the new key
5. Remove the old key from `API_KEYS`
6. Restart again

### 5.2 Multiple API Keys

Use separate API keys for different clients:

```bash
API_KEYS=portal-key-abc,admin-key-xyz,integration-key-123
```

This allows you to revoke access for a specific client without affecting others.

---

## 6. Monitoring and Alerting

### 6.1 Key Metrics

| Metric | How to Check | Warning |
|--------|-------------|---------|
| Health status | `GET /api/v1/health` | Non-200 response |
| Container running | `docker ps --filter name=vcon-mcp` | Not running |
| Memory usage | `docker stats vcon-mcp --no-stream` | > 80% of limit |
| Log errors | `docker logs vcon-mcp \| grep error` | Any errors |
| Database connectivity | Health endpoint includes DB check | Connection failure |

### 6.2 Log Format

In production (`NODE_ENV=production`), logs are JSON:

```json
{
  "level": "info",
  "time": 1712592600000,
  "msg": "MCP server initialized",
  "service": "vcon-mcp-server",
  "version": "1.2.0",
  "trace_id": "abc123...",
  "span_id": "def456..."
}
```

Key fields for debugging:

| Field | Description |
|-------|-------------|
| `level` | Log level (debug, info, warn, error) |
| `msg` | Human-readable message |
| `trace_id` | OpenTelemetry trace ID (for correlated request tracing) |
| `err` | Error details (when level is error) |

---

## 7. Graceful Shutdown

The MCP Server handles `SIGINT` and `SIGTERM` gracefully:

1. Closes the HTTP server (stops accepting new connections)
2. Completes in-flight requests
3. Shuts down OpenTelemetry exporters (flushes pending traces)
4. Calls plugin shutdown hooks
5. Exits with code 0

```bash
# Graceful stop (sends SIGTERM)
docker stop vcon-mcp

# Force stop (if graceful fails after 10s)
docker stop -t 10 vcon-mcp
```

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | April 2026 | VCONIC Engineering | Initial release |
