# Production Setup

Production deployment considerations for vCon MCP Server.

## Environment Variables

### Required

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key
MCP_HTTP_STATELESS=true  # Required for multi-instance deployments
```

### Recommended

```bash
NODE_ENV=production
MCP_TOOLS_PROFILE=full       # or: readonly, user, admin, minimal, public
LOG_LEVEL=info
OTEL_ENABLED=true            # Enable observability
OPENAI_API_KEY=your-key      # For embeddings
REDIS_URL=redis://host:6379  # For caching
```

## Multi-Instance Deployment

```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  vcon-mcp:
    image: public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
    deploy:
      replicas: 3
    environment:
      - MCP_HTTP_STATELESS=true
    env_file:
      - .env.production
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:3000/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

> **Important**: `MCP_HTTP_STATELESS=true` is required for multi-instance deployments.

## Resource Recommendations

| Workload | CPU | Memory | Replicas |
|----------|-----|--------|----------|
| Development | 0.25 | 256Mi | 1 |
| Small | 0.5 | 512Mi | 1-2 |
| Medium | 1 | 1Gi | 2-3 |
| Large | 2 | 2Gi | 3+ |

## Database tuning for large corpora

The Supabase CLI starts Postgres with development defaults: `shared_buffers = 128MB`, `effective_cache_size = 128MB`, `effective_io_concurrency = 1`. Past a few hundred thousand vCons, keyword search (`search_vcons_keyword`, REST `/vcons/search/content`, MCP `search_vcons_content`) starts returning `canceling statement due to statement timeout`. The `authenticated` role has `statement_timeout = 8s`.

The query itself is not the problem. It ranks every match, and each match's `body_tsvector` is stored out of line (TOAST). While those pages are cached, a common term on ~260k vCons takes 1–3 s. Cold, the same search needs one random read per match: measured at 22–46 s for terms matching 6k–56k analysis and dialog rows (CON-1071). With 128MB of shared buffers and any concurrent load (ingest, embedding backfill), the working set never stays cached.

For a deployment on a dedicated host, size Postgres to the machine. On a 16 GB host:

1. **Memory.** Set these in `supabase/config.toml`; the CLI applies them on `supabase start`:

   ```toml
   [db.settings]
   shared_buffers = "4GB"          # ~25% of RAM; should hold the search working set
   effective_cache_size = "10GB"   # ~65% of RAM
   maintenance_work_mem = "512MB"
   ```

   Leave `work_mem` at its default. The CLI's database container has a 64 MB `/dev/shm`, so a larger `work_mem` makes parallel queries fail with `could not resize shared memory segment ... No space left on device`.

2. **SSD planner settings.** `[db.settings]` doesn't accept these, so set them as the superuser over the container's socket:

   ```bash
   docker exec supabase_db_vcon-mcp psql -U supabase_admin -d postgres \
     -c "alter system set effective_io_concurrency = 200" \
     -c "alter system set random_page_cost = 1.1" \
     -c "select pg_reload_conf()"
   ```

3. **Keep the cache warm across restarts.** Run `create extension if not exists pg_prewarm;` as `supabase_admin`. Then append `pg_prewarm` to `shared_preload_libraries` and restart the database container. Autoprewarm records the buffer contents every few minutes and reloads them at startup. `shared_preload_libraries` replaces the image's list rather than adding to it: read the current value with `show shared_preload_libraries`, append `, pg_prewarm`, and write the list as **one** plain quoted string. Dollar-quoting the value turns the whole list into a single library name, and Postgres will not start.

4. **Warm the working set once** after tuning or a bulk load:

   ```sql
   select sum(pg_prewarm(r)) from (
     select c.oid::regclass r from pg_class c
      where c.relname in ('analysis','dialog','vcons','parties') and c.relnamespace = 'public'::regnamespace
     union all
     select c.reltoastrelid::regclass from pg_class c
      where c.relname in ('analysis','dialog','vcons') and c.relnamespace = 'public'::regnamespace
     union all
     select i.indexrelid::regclass from pg_index i join pg_class c on c.oid = i.indrelid
      where c.relname in ('analysis','dialog','vcons','parties','vcon_tags_mv') and c.relnamespace = 'public'::regnamespace
   ) x;
   ```

Measured on 259,596 vCons, a 16 GB host and gp3 storage, with an embedding backfill running: after these steps, keyword searches through the REST API took 0.8–2.4 s. The worst case was "call", which matches ~520k rows, at 5.3 s. Before, they timed out.

Tag-filtered searches also need `vcon_tags_mv` refreshed. Self-hosted boxes have nothing that does this automatically; see [pg_cron setup](../setup-pg-cron-guide.md).

## Health Check

```bash
curl http://localhost:3000/api/v1/health
```

## Graceful Shutdown

The server handles SIGTERM gracefully - completes in-flight requests before exiting:

```bash
docker stop --time=30 vcon-mcp
```

## Next Steps

- [Docker Deployment](./docker.md)
- [Kubernetes Deployment](./kubernetes.md)
- [Cloud Providers](./cloud.md)
