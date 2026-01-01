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
MCP_TOOLS_PROFILE=full       # or: readonly, user, admin, minimal
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
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/api/v1/health"]
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
