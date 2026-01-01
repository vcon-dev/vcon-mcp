# Performance

Performance considerations for vCon MCP Server.

## Resource Recommendations

| Workload | CPU | Memory | Replicas |
|----------|-----|--------|----------|
| Development | 0.25 | 256Mi | 1 |
| Production (small) | 0.5 | 512Mi | 2 |
| Production (large) | 1 | 1Gi | 3+ |

## Multi-Instance Deployments

Enable stateless mode for horizontal scaling:

```bash
MCP_HTTP_STATELESS=true
```

## Embedding Performance

Process embeddings in batches to avoid rate limits:

```bash
docker run --rm \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_SERVICE_ROLE_KEY=your-key \
  -e OPENAI_API_KEY=your-key \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main \
  script embed-vcons --batch-size=50 --delay=100
```

## Search Performance

| Search Type | Speed | Use Case |
|-------------|-------|----------|
| Full-text | Fast | Keyword matching |
| Semantic | Slower | Meaning-based search |
| Hybrid | Medium | Best of both |

## Caching (Optional)

Enable Redis for caching:

```bash
REDIS_URL=redis://localhost:6379
```

## Observability

Enable OpenTelemetry for performance monitoring:

```bash
OTEL_ENABLED=true
OTEL_ENDPOINT=http://jaeger:4318
```

## Next Steps

- [Docker Deployment](./docker.md)
- [Production Setup](./production.md)
