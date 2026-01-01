# Docker Deployment Guide

Deploy the vCon MCP Server using Docker for consistent, portable deployments.

## Quick Start

### Pull from ECR Public

```bash
# Pull the latest image
docker pull public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main

# Run the server
docker run -p 3000:3000 \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e SUPABASE_ANON_KEY=your-anon-key \
  -e MCP_HTTP_STATELESS=true \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
```

### Build Locally

```bash
# Clone and build
git clone https://github.com/vcon-dev/vcon-mcp.git
cd vcon-mcp
docker build -t vcon-mcp .

# Run
docker run -p 3000:3000 --env-file .env vcon-mcp
```

## Image Tags

| Tag | Description |
|-----|-------------|
| `main` | Latest stable build from main branch |
| `main-<sha>` | Specific commit (e.g., `main-abc1234`) |
| `1.2.3` | Semantic version release |
| `1.2` | Minor version (latest patch) |
| `1` | Major version (latest minor/patch) |

## Running the Server

### Basic Usage

```bash
# Start the MCP server (default)
docker run -p 3000:3000 \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e SUPABASE_ANON_KEY=your-anon-key \
  -e MCP_HTTP_STATELESS=true \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
```

### With Environment File

```bash
# Create .env file
cat > .env << EOF
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key
MCP_TRANSPORT=http
MCP_HTTP_HOST=0.0.0.0
MCP_HTTP_PORT=3000
MCP_HTTP_STATELESS=true
MCP_TOOLS_PROFILE=full
EOF

# Run with env file
docker run -p 3000:3000 --env-file .env public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
```

### Multi-Client Support

For multiple clients to connect simultaneously, enable stateless mode:

```bash
docker run -p 3000:3000 \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e SUPABASE_ANON_KEY=your-anon-key \
  -e MCP_HTTP_STATELESS=true \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
```

> **Note**: Without `MCP_HTTP_STATELESS=true`, only one MCP client can connect at a time due to session tracking limitations in the MCP SDK.

## Running Scripts

The Docker image includes all utility scripts from the `/scripts` directory:

### List Available Scripts

```bash
docker run --rm public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main help
```

### Run a Script

```bash
# Check database status
docker run --rm \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e SUPABASE_ANON_KEY=your-anon-key \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main script check-db-status

# Sync vCons
docker run --rm \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e SUPABASE_ANON_KEY=your-anon-key \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main script sync-all

# Generate embeddings
docker run --rm \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e SUPABASE_ANON_KEY=your-anon-key \
  -e OPENAI_API_KEY=your-openai-key \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main script embed-vcons --provider=openai
```

### Run TypeScript Directly

```bash
# Run any TypeScript file
docker run --rm \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e SUPABASE_ANON_KEY=your-anon-key \
  -v $(pwd)/my-script.ts:/app/my-script.ts \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main tsx /app/my-script.ts
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (full database access, bypasses RLS) |
| `SUPABASE_ANON_KEY` | Supabase anonymous key (restricted access with RLS) |

> **Note:** You need at least one of `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ANON_KEY`. The service role key is recommended for server-side deployments as it provides full database access.

### MCP Transport

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `http` | Transport type: `http` or `stdio` |
| `MCP_HTTP_HOST` | `0.0.0.0` | HTTP host to bind |
| `MCP_HTTP_PORT` | `3000` | HTTP port to listen on |
| `MCP_HTTP_STATELESS` | `false` | Enable stateless mode for multi-client |
| `MCP_HTTP_JSON_ONLY` | `false` | Disable SSE, JSON responses only |

### Tool Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TOOLS_PROFILE` | `full` | Preset: `full`, `readonly`, `user`, `admin`, `minimal` |
| `MCP_ENABLED_CATEGORIES` | (all) | Comma-separated: `read,write,schema,analytics,infra` |
| `MCP_DISABLED_TOOLS` | (none) | Comma-separated tool names to disable |

### Optional Services

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | Redis URL for caching (e.g., `redis://localhost:6379`) |
| `OPENAI_API_KEY` | OpenAI API key for embeddings |
| `OTEL_ENABLED` | Enable OpenTelemetry (`true`/`false`) |
| `OTEL_ENDPOINT` | OTLP collector endpoint |

## Docker Compose

### Basic Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  vcon-mcp:
    image: public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
    ports:
      - "3000:3000"
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
      - MCP_HTTP_STATELESS=true
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### With Redis Caching

```yaml
version: '3.8'

services:
  vcon-mcp:
    image: public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
    ports:
      - "3000:3000"
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
      - REDIS_URL=redis://redis:6379
      - MCP_HTTP_STATELESS=true
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

### With Observability

```yaml
version: '3.8'

services:
  vcon-mcp:
    image: public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
    ports:
      - "3000:3000"
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
      - MCP_HTTP_STATELESS=true
      - OTEL_ENABLED=true
      - OTEL_EXPORTER_TYPE=otlp
      - OTEL_ENDPOINT=http://jaeger:4318

  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"  # Jaeger UI
      - "4318:4318"    # OTLP HTTP
```

## Connecting to Local Services

When running in Docker and connecting to services on your host machine (like local Supabase), use `host.docker.internal`:

```bash
# Instead of localhost or 127.0.0.1
docker run -p 3000:3000 \
  -e SUPABASE_URL=http://host.docker.internal:54321 \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e SUPABASE_ANON_KEY=your-anon-key \
  -e MCP_HTTP_STATELESS=true \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
```

> **Note**: `host.docker.internal` works on Docker Desktop (Mac/Windows). On Linux, use `--network host` or the host's actual IP.

## Health Checks

The image includes a built-in health check:

```bash
# Check health via REST API
curl http://localhost:3000/api/v1/health

# Docker health status
docker inspect --format='{{.State.Health.Status}}' <container-id>
```

## Production Deployment

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vcon-mcp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: vcon-mcp
  template:
    metadata:
      labels:
        app: vcon-mcp
    spec:
      containers:
      - name: vcon-mcp
        image: public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
        ports:
        - containerPort: 3000
        env:
        - name: SUPABASE_URL
          valueFrom:
            secretKeyRef:
              name: vcon-secrets
              key: supabase-url
        - name: SUPABASE_SERVICE_ROLE_KEY
          valueFrom:
            secretKeyRef:
              name: vcon-secrets
              key: supabase-service-role-key
        - name: SUPABASE_ANON_KEY
          valueFrom:
            secretKeyRef:
              name: vcon-secrets
              key: supabase-anon-key
        - name: MCP_HTTP_STATELESS
          value: "true"
        livenessProbe:
          httpGet:
            path: /api/v1/health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /api/v1/health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
```

### AWS ECS

```json
{
  "family": "vcon-mcp",
  "containerDefinitions": [
    {
      "name": "vcon-mcp",
      "image": "public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "MCP_HTTP_STATELESS", "value": "true"}
      ],
      "secrets": [
        {"name": "SUPABASE_URL", "valueFrom": "arn:aws:secretsmanager:..."},
        {"name": "SUPABASE_SERVICE_ROLE_KEY", "valueFrom": "arn:aws:secretsmanager:..."},
        {"name": "SUPABASE_ANON_KEY", "valueFrom": "arn:aws:secretsmanager:..."}
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health || exit 1"],
        "interval": 30,
        "timeout": 10,
        "retries": 3
      }
    }
  ]
}
```

## Image Details

- **Base Image**: Node.js 20 Alpine
- **Size**: ~680 MB
- **Platforms**: linux/amd64, linux/arm64
- **User**: Non-root (`vcon:nodejs`)
- **Working Directory**: `/app`

## Troubleshooting

### Container Exits Immediately

Check logs for missing environment variables:

```bash
docker logs <container-id>
```

Common causes:
- Missing `SUPABASE_URL` or Supabase keys (`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`)
- Invalid credentials

### Connection Refused to Database

If connecting to local Supabase:

```bash
# Use host.docker.internal instead of localhost
-e SUPABASE_URL=http://host.docker.internal:54321
```

### Multiple Clients Failing

Enable stateless mode:

```bash
-e MCP_HTTP_STATELESS=true
```

### View Container Logs

```bash
# Follow logs
docker logs -f <container-id>

# Last 100 lines
docker logs --tail 100 <container-id>
```

## Building Custom Images

```dockerfile
FROM public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main

# Add custom scripts
COPY my-scripts/ /app/scripts/

# Add custom environment defaults
ENV MY_CUSTOM_VAR=value
```

Build and run:

```bash
docker build -t my-vcon-mcp .
docker run -p 3000:3000 --env-file .env my-vcon-mcp
```

