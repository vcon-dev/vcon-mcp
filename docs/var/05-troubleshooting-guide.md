# VCONIC MCP Server — Troubleshooting Guide

**Document ID:** VCONIC-MCP-TSG-001  
**Product:** VCONIC MCP Server  
**Version:** 1.2.0  
**Audience:** Value Added Reseller (VAR) / Systems Integrator  
**Last Updated:** April 2026

---

## 1. Troubleshooting Methodology

1. **Check container status:** `docker ps --filter name=vcon-mcp`
2. **Check health endpoint:** `curl http://localhost:3000/api/v1/health`
3. **Check logs:** `docker logs vcon-mcp --tail 50`
4. **Test database connectivity:** Health endpoint includes DB check

---

## 2. Common Issues

### 2.1 Container Won't Start

**Symptom:** Container exits immediately after start.

| Possible Cause | Diagnosis | Resolution |
|----------------|-----------|------------|
| Missing required env vars | Logs show "SUPABASE_URL is required" | Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` |
| Invalid Supabase URL | Logs show connection error | Verify URL format: `https://<project>.supabase.co` |
| Port already in use | Logs show "EADDRINUSE" | Change `MCP_HTTP_PORT` or stop conflicting service |
| Invalid env value | Logs show validation error | Check `.env.mcp` for typos |

```bash
docker logs vcon-mcp --tail 30
```

### 2.2 Health Endpoint Returns Unhealthy

**Symptom:** `GET /api/v1/health` returns non-200 or error.

| Possible Cause | Diagnosis | Resolution |
|----------------|-----------|------------|
| Database unreachable | Health response shows DB error | Verify Supabase URL and keys, check network |
| Schema not migrated | Logs show "relation does not exist" | Run migrations: `docker run ... migrate` |
| Service role key expired | Logs show 401 from Supabase | Regenerate key in Supabase dashboard |

### 2.3 API Returns 401 Unauthorized

**Symptom:** REST API requests return 401.

| Possible Cause | Diagnosis | Resolution |
|----------------|-----------|------------|
| Missing API key | No `Authorization` header | Add `Authorization: Bearer <key>` header |
| Wrong API key | Key not in `API_KEYS` list | Verify key matches one in `API_KEYS` env var |
| Auth disabled but key sent | Unexpected behavior | Check `API_AUTH_REQUIRED` setting |

```bash
# Test with auth
curl -v -H "Authorization: Bearer YOUR_KEY" http://localhost:3000/api/v1/health
```

### 2.4 MCP Tools Not Appearing in AI Assistant

**Symptom:** Connected AI assistant doesn't show vCon tools.

| Possible Cause | Diagnosis | Resolution |
|----------------|-----------|------------|
| Wrong transport mode | Client expects stdio, server is HTTP (or vice versa) | Match `MCP_TRANSPORT` to client expectation |
| Restrictive tool profile | `MCP_TOOLS_PROFILE=minimal` hides most tools | Change to `full` or `user` profile |
| Tools explicitly disabled | Check `MCP_DISABLED_TOOLS` | Remove tool name from disabled list |
| Client configuration error | Check client MCP config | Verify server URL, command, and args in client config |

### 2.5 Search Returns No Results

**Symptom:** `search_vcons` or `search_vcons_content` returns empty results.

| Possible Cause | Diagnosis | Resolution |
|----------------|-----------|------------|
| No vCons in database | Check via `get_database_analytics` tool | Verify Conserver is running and storing vCons |
| Wrong Supabase project | Pointing to empty/wrong database | Verify `SUPABASE_URL` points to correct project |
| RLS filtering too strict | `RLS_ENABLED=true` with wrong tenant | Verify `CURRENT_TENANT_ID` matches data |
| Search criteria too narrow | Date range or filters exclude all data | Broaden search parameters |

### 2.6 Semantic Search Not Working

**Symptom:** `search_vcons_semantic` returns errors or no results.

| Possible Cause | Diagnosis | Resolution |
|----------------|-----------|------------|
| No embeddings generated | `vcon_embeddings` table is empty | Run the embed-vcons script (see Administration Guide) |
| pgvector extension missing | Logs show "extension vector does not exist" | Enable pgvector in Supabase dashboard |

### 2.7 Slow Performance

**Symptom:** API responses are slow (> 2 seconds).

| Possible Cause | Diagnosis | Resolution |
|----------------|-----------|------------|
| No Redis cache | `REDIS_URL` not set | Configure Redis caching |
| Large result sets | Queries return too many vCons | Use pagination, limit result size |
| Missing database indexes | `analyze_query` tool shows seq scans | Check migration status, recreate indexes |
| Network latency | High latency to Supabase | Use a closer region or self-hosted PostgreSQL |

### 2.8 Container High Memory Usage

**Symptom:** Container memory grows over time.

| Possible Cause | Diagnosis | Resolution |
|----------------|-----------|------------|
| Large query results cached | Memory grows with queries | Restart container, set memory limits |
| Too many concurrent connections | `MCP_HTTP_STATELESS=true` with many clients | Set container memory limits, scale horizontally |

---

## 3. Diagnostic Commands Reference

### 3.1 Container Diagnostics

```bash
# Status
docker ps --filter name=vcon-mcp

# Logs (last 100 lines)
docker logs vcon-mcp --tail 100

# Resource usage
docker stats vcon-mcp --no-stream

# Inspect configuration
docker inspect vcon-mcp | python3 -m json.tool
```

### 3.2 API Diagnostics

```bash
# Health check (no auth)
curl -v http://localhost:3000/api/v1/health

# List vCons (requires auth)
curl -H "Authorization: Bearer <key>" http://localhost:3000/api/v1/vcons

# Submit test vCon (requires auth)
curl -X POST http://localhost:3000/api/v1/vcons \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"vcon":"0.0.1","parties":[],"dialog":[],"analysis":[],"attachments":[]}'
```

### 3.3 Database Diagnostics

```bash
# Test direct database connection
docker run --rm \
  -e SUPABASE_DB_URL="$SUPABASE_DB_URL" \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main migrate-status

# Check vCon count (via psql)
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM vcons;"
```

### 3.4 Network Diagnostics

```bash
# Test Supabase connectivity
curl -s -o /dev/null -w "HTTP %{http_code}" "$SUPABASE_URL/rest/v1/" \
  -H "apikey: $SUPABASE_ANON_KEY"

# Test Redis connectivity (if configured)
docker compose exec redis redis-cli PING
```

---

## 4. Escalation Procedures

### 4.1 When to Escalate

- Container crashes with internal errors not related to configuration
- Data inconsistency between Conserver and MCP Server views
- MCP protocol errors with specific clients
- Migration failures on a previously working database

### 4.2 Information to Collect

1. **Container logs:** `docker logs vcon-mcp --tail 200`
2. **Health endpoint response:** Full JSON output
3. **Environment:** `.env.mcp` (redact keys)
4. **Migration status:** Output of `migrate-status`
5. **Docker version:** `docker --version`
6. **MCP client details:** Which client, version, transport mode

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | April 2026 | VCONIC Engineering | Initial release |
