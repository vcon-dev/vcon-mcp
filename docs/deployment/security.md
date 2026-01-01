# Security

Security considerations specific to vCon MCP Server.

## Supabase Keys

| Key | Access Level | Use Case |
|-----|--------------|----------|
| `SUPABASE_SERVICE_ROLE_KEY` | Full access, bypasses RLS | Server-side deployments |
| `SUPABASE_ANON_KEY` | Restricted, RLS enforced | Client-facing with user auth |

**Recommendation**: Use `SUPABASE_SERVICE_ROLE_KEY` for trusted server deployments.

## Tool Access Control

### Profiles

Control which MCP tools are available:

```bash
MCP_TOOLS_PROFILE=readonly   # Read-only operations
MCP_TOOLS_PROFILE=user       # CRUD without admin ops
MCP_TOOLS_PROFILE=full       # All tools (default)
```

### Disable Specific Tools

```bash
MCP_DISABLED_TOOLS=delete_vcon,execute_sql
```

### Available Profiles

| Profile | Description |
|---------|-------------|
| `full` | All tools enabled (default) |
| `readonly` | Read-only operations only |
| `user` | CRUD without admin operations |
| `admin` | Full access including schema changes |
| `minimal` | Basic operations only |

## Container Security

The Docker image includes security defaults:

- Runs as non-root user (`vcon`, uid 1001)
- Minimal Alpine base image
- No shell access by default

## Best Practices

- Store secrets in environment variables or secret managers, not in code
- Use HTTPS in production (via reverse proxy)
- Enable `MCP_HTTP_STATELESS=true` for multi-instance deployments
- Restrict tool profiles based on use case

## Next Steps

- [Production Setup](./production.md)
- [Docker Deployment](./docker.md)
