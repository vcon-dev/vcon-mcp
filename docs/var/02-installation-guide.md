# VCONIC Installation Guide

**Audience:** Reseller deployment leads provisioning VCONIC for a single
customer environment.

## Reseller lens

A customer install is one VCONIC instance per Supabase project (or
per-tenant if running multi-tenant — see
[RLS Multi-Tenant](../guide/rls-multi-tenant.md)). Plan one Docker host
per environment (staging, production). Don't share Supabase projects
across customers unless RLS is explicitly enabled and verified.

## Prerequisites

| Component | Minimum |
|---|---|
| Docker Engine | 24.0+ |
| PostgreSQL (via Supabase) | 14+ |
| Node.js (only for source/dev installs) | 20+ |
| Outbound HTTPS | to Supabase project URL, ECR Public, and (optional) OpenAI |

Optional but commonly needed:

- Reverse proxy with TLS termination (nginx, Caddy, Traefik) for HTTP transport
- Redis for response caching
- OpenAI or LiteLLM credentials for semantic search embeddings

## Install methods

### A. Docker (recommended for customer environments)

```bash
docker pull public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:1.2.0
```

Pin to a semver tag (`1.2.0`) in customer environments — don't use
`latest` in production. Tag policy:

- `main-<sha>` — every push to main
- `latest` — main HEAD (dev / demo only)
- `1.2.0`, `1.2`, `1` — published on git tag releases

See [Docker deployment](../deployment/docker.md) for image internals
(non-root user, dumb-init entrypoint, Supabase CLI bundled).

### B. npm package (for embedded use inside a Node service)

```bash
npm install vcon-mcp
```

The package exposes the server module and types. Suitable when wrapping
the server inside another Node application. See
[Installation](../guide/installation.md) for the full developer path.

### C. Source build (for customer-managed forks)

```bash
git clone https://github.com/vcon-dev/vcon-mcp.git
cd vcon-mcp && npm install && npm run build
```

## Step-by-step

1. **Create the Supabase project.** Cloud or
   [self-hosted](../deployment/self-hosted-supabase.md).
2. **Apply migrations.** From the Docker image:

   ```bash
   docker run --rm \
     -e SUPABASE_DB_URL='postgresql://...' \
     public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:1.2.0 \
     migrate
   ```

3. **Choose a transport.** See the table below.
4. **Set required env vars.** Minimum: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
   See [Configuration Guide](./03-configuration-guide.md) for the full list.
5. **Start the container.** Example for HTTP transport:

   ```bash
   docker run -d --name vconic \
     -p 3000:3000 \
     -e SUPABASE_URL='https://...' \
     -e SUPABASE_ANON_KEY='...' \
     -e MCP_TRANSPORT=http \
     -e MCP_HTTP_HOST=0.0.0.0 \
     -e API_KEYS='customer-key-1' \
     public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:1.2.0
   ```

6. **Verify.** `curl http://localhost:3000/api/v1/health` returns `{"status":"ok"}`
   with `X-Version` and `X-Git-Commit` response headers.

### Transport choice

| Transport | When to use | How to launch |
|---|---|---|
| `stdio` | AI client (Claude Desktop) spawns the server per-session | Default; `MCP_TRANSPORT=stdio` (or unset) |
| `http` | Shared deployment, multiple clients, REST API needed | `MCP_TRANSPORT=http` + `MCP_HTTP_HOST=0.0.0.0` |

## TLS / reverse proxy

VCONIC does not terminate TLS itself. Front it with a reverse proxy.
Minimal nginx for HTTP transport:

```nginx
location / {
  proxy_pass http://vconic-host:3000;
  proxy_set_header Host $host;
  proxy_set_header Authorization $http_authorization;
}
```

## Verification checklist

- [ ] `GET /api/v1/health` returns 200
- [ ] `X-Version` response header matches the deployed tag
- [ ] An authenticated MCP request (`tools/list`) returns the expected tool catalog
- [ ] `get_database_shape` reports all migration tables present

## See also

- [Installation (developer view)](../guide/installation.md)
- [Docker deployment](../deployment/docker.md)
- [Production setup](../deployment/production.md)
- [Self-hosted Supabase](../deployment/self-hosted-supabase.md)
