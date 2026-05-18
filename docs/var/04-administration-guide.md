# VCONIC Administration Guide

**Audience:** Reseller support engineers running day-2 ops on a deployed
VCONIC instance.

## Reseller lens

Treat each customer instance as independently operated. Most
administration touches three surfaces: the running container, the
Supabase database, and the customer's MCP/REST clients.

## Health & version

```bash
curl -s http://<host>:3000/api/v1/health
```

Response headers carry deployment provenance:

- `X-Version` — package version baked into the image
- `X-Git-Commit` — short SHA of the commit
- `X-Build-Time` — image build timestamp

Use these when escalating issues — they identify the exact build.

## Service control

```bash
# Status
docker ps --filter name=vconic

# Logs (Pino JSON, stderr)
docker logs -f vconic | jq 'select(.level >= 40)'

# Graceful restart
docker restart vconic
```

The container uses `dumb-init` as PID 1, so signals propagate cleanly.

## Running migrations

After upgrading the image, run migrations once before restarting the
running container. See [Upgrade Guide](./06-upgrade-guide.md) for the
full procedure. The migration entrypoint:

```bash
docker run --rm \
  -e SUPABASE_DB_URL='postgresql://...' \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:<new-tag> \
  migrate
```

## API key rotation

1. Add the new key to the comma-separated `API_KEYS` env var alongside the
   old one.
2. Restart the container (both keys are now valid).
3. Update clients to the new key.
4. Remove the old key from `API_KEYS` and restart again.

This is a zero-downtime path because both keys accept traffic during the
client cutover.

## Logs

Pino emits structured JSON to stderr. Useful fields:

| Field | Meaning |
|---|---|
| `level` | 30=info, 40=warn, 50=error |
| `component` | Originating subsystem |
| `service` | Always `vcon-mcp-server` |
| `error_code` | Stable error identifier (when present) |
| `remote_address` | Client IP (HTTP transport) |
| `duration_ms` | Operation duration |
| `user_agent` | Client user-agent (HTTP transport) |

Filter in production with `jq` or your log aggregator. Set `LOG_LEVEL=debug`
temporarily to capture more detail.

## Capacity & database health

Use the built-in MCP tools rather than ad-hoc SQL:

| Tool | What it tells you |
|---|---|
| `get_database_shape` | Tables, indexes, row counts |
| `get_database_size_info` | Total size, growth pressure |
| `get_database_stats` | Query stats, cache hit ratio |
| `get_database_analytics` | Content distribution, ingestion patterns |
| `get_database_health_metrics` | Performance signals + recommendations |

See [Database tools](../guide/database-tools.md) for parameter details.

## Backup & restore

Backups are a Supabase responsibility, not VCONIC's. Use:

- Supabase managed backups (cloud) — daily snapshots in the dashboard
- `pg_dump` / `pg_restore` (self-hosted) — point-in-time snapshots

Always snapshot **before** running migrations on a customer environment.

## Embedding refresh

When semantic search misses a vCon, embeddings may be stale or missing.
Backfill from a controlled host (not from the production container):

```bash
git clone --depth 1 https://github.com/vcon-dev/vcon-mcp.git
cd vcon-mcp && npm install
npm run sync:embeddings
```

`npm run embeddings:check` reports coverage gaps without writing.

## Tenant troubleshooting (RLS deployments)

When a tenant reports empty results, check tenant context first:

- Confirm the tenant id is reaching the request (header or service-role env).
- Use [Debugging RLS](../guide/debugging-tenant-rls.md) for the full
  step-by-step.

## Graceful shutdown

```bash
docker stop --time 30 vconic
```

The 30s grace lets in-flight MCP requests complete.

## See also

- [Database tools](../guide/database-tools.md)
- [Migration Guide](../reference/MIGRATION_GUIDE.md)
- [Observability](../guide/observability.md)
- [Debugging Tenant RLS](../guide/debugging-tenant-rls.md)
