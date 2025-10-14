# Deployment Guide

Deploy the vCon MCP Server to production environments.

## Overview

This guide covers:
- Production deployment strategies
- Security best practices
- Performance optimization
- Platform-specific guides

## Quick Deployment Options

### Option 1: Docker (Recommended)
```bash
# Build image
docker build -t vcon-mcp .

# Run container
docker run -d \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_ANON_KEY=your-key \
  vcon-mcp
```

### Option 2: Node.js Direct
```bash
# Build
npm run build

# Run
node dist/index.js
```

### Option 3: Kubernetes
```bash
# Apply configuration
kubectl apply -f k8s/deployment.yaml
```

## Documentation Sections

### [Production Setup](./production.md)
- Environment configuration
- Process management
- Logging and monitoring
- Backup strategies

### [Security](./security.md)
- Authentication and authorization
- API security
- Database security
- Network security
- Compliance considerations

### [Performance](./performance.md)
- Database optimization
- Caching strategies
- Query tuning
- Load testing
- Scaling strategies

### [Docker Deployment](./docker.md)
- Dockerfile configuration
- Docker Compose setup
- Multi-stage builds
- Volume management

### [Kubernetes Deployment](./kubernetes.md)
- Deployment manifests
- Service configuration
- Ingress setup
- Secrets management

### [Cloud Providers](./cloud.md)
- AWS deployment
- Google Cloud deployment
- Azure deployment
- Heroku deployment

## Prerequisites

- Node.js 18 or higher
- PostgreSQL 14+ (or Supabase account)
- Sufficient resources (see requirements)

## System Requirements

### Minimum
- **CPU**: 1 core
- **RAM**: 512 MB
- **Disk**: 1 GB
- **Database**: PostgreSQL 14+

### Recommended
- **CPU**: 2+ cores
- **RAM**: 2 GB+
- **Disk**: 10 GB+
- **Database**: PostgreSQL 15+ with pgvector

## Environment Variables

```bash
# Required
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Optional
SUPABASE_SERVICE_ROLE_KEY=your-service-key
VCON_PLUGINS_PATH=./plugins
VCON_LICENSE_KEY=your-license-key
NODE_ENV=production
```

## Health Checks

The server provides health check endpoints:

```bash
# Basic health check
curl http://localhost:3000/health

# Database connectivity check
curl http://localhost:3000/health/database
```

## Monitoring

Key metrics to monitor:
- Request latency
- Database connection pool
- Memory usage
- Error rates
- Search performance

## Next Steps

1. Review [Security](./security.md) best practices
2. Set up [Performance](./performance.md) monitoring
3. Choose your deployment platform
4. Configure backups and disaster recovery

