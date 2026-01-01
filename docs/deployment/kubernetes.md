# Kubernetes Deployment

Deploy the vCon MCP Server to Kubernetes.

## Quick Start

### Create Secrets

```bash
kubectl create secret generic vcon-mcp-secrets \
  --from-literal=SUPABASE_URL=https://your-project.supabase.co \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  --from-literal=SUPABASE_ANON_KEY=your-anon-key \
  --from-literal=OPENAI_API_KEY=your-openai-key
```

### Deploy

```yaml
# vcon-mcp.yaml
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
        - name: MCP_HTTP_STATELESS
          value: "true"
        - name: MCP_TOOLS_PROFILE
          value: "full"
        envFrom:
        - secretRef:
            name: vcon-mcp-secrets
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
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
---
apiVersion: v1
kind: Service
metadata:
  name: vcon-mcp
spec:
  selector:
    app: vcon-mcp
  ports:
  - port: 80
    targetPort: 3000
```

```bash
kubectl apply -f vcon-mcp.yaml
```

## Environment Variables

Key configuration for Kubernetes deployments:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes* | Service role key (bypasses RLS) |
| `SUPABASE_ANON_KEY` | Yes* | Anonymous key (uses RLS) |
| `MCP_HTTP_STATELESS` | Recommended | Set `true` for multi-replica deployments |
| `MCP_TOOLS_PROFILE` | No | `full`, `readonly`, `user`, `admin`, `minimal` |
| `MCP_DISABLED_TOOLS` | No | Comma-separated list of tools to disable |
| `OPENAI_API_KEY` | No | For embedding generation |

*At least one Supabase key required

## Running Scripts as Jobs

### One-time Job

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: vcon-check-db
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: script
        image: public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
        command: ["script", "check-db-status"]
        envFrom:
        - secretRef:
            name: vcon-mcp-secrets
```

### Scheduled Embeddings Sync

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: vcon-embeddings
spec:
  schedule: "0 */6 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
          - name: embeddings
            image: public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main
            command: ["script", "embed-vcons", "--provider=openai", "--limit=500"]
            envFrom:
            - secretRef:
                name: vcon-mcp-secrets
```

## Resource Recommendations

| Workload | Replicas | CPU Request | Memory Request |
|----------|----------|-------------|----------------|
| Development | 1 | 100m | 256Mi |
| Production (small) | 2 | 250m | 512Mi |
| Production (large) | 3+ | 500m | 1Gi |

## Troubleshooting

```bash
# Check pod status
kubectl get pods -l app=vcon-mcp

# View logs
kubectl logs -l app=vcon-mcp -f

# Port forward for testing
kubectl port-forward svc/vcon-mcp 3000:80
curl http://localhost:3000/api/v1/health
```

## Next Steps

- [Cloud Providers](./cloud.md) - Managed Kubernetes (EKS, GKE, AKS)
- [Docker Deployment](./docker.md) - Container basics
- [Production Setup](./production.md) - Production configuration
