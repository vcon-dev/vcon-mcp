# Configuration Guide

This guide covers all configuration options for the vCon MCP Server.

## Environment Variables

The vCon MCP Server is configured via environment variables. You can set these in several ways:

1. **`.env` file** in the project root (recommended for development)
2. **System environment variables** (recommended for production)
3. **Claude Desktop config** (when running as MCP server)
4. **Docker environment** (when running in containers)

### Required Configuration

#### Supabase Connection

```bash
# Your Supabase project URL
SUPABASE_URL=https://your-project.supabase.co

# Your Supabase anon key (client-side) or service role key (server-side)
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Where to find these:**
1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to Settings → API
4. Copy the URL and anon key

### Optional Configuration

#### Redis Caching

Enable high-performance caching for 20-50x faster reads:

```bash
# Basic Redis connection
REDIS_URL=redis://localhost:6379

# Redis with authentication
REDIS_URL=redis://:password@localhost:6379

# Redis with TLS (secure)
REDIS_URL=rediss://localhost:6380

# Redis Sentinel (high availability)
REDIS_URL=redis+sentinel://sentinel1:26379,sentinel2:26379/mymaster

# Cache TTL in seconds (default: 3600 = 1 hour)
VCON_REDIS_EXPIRY=3600
```

**Performance impact:**
- Without Redis: 50-100ms read latency
- With Redis (cache hit): 1-2ms read latency
- **50x improvement** on frequently accessed vCons

See [Redis-Supabase Integration Guide](redis-supabase-integration.md) for detailed setup.

#### Plugin System

Load custom plugins to extend functionality:

```bash
# Comma-separated list of plugin paths
VCON_PLUGINS_PATH=@mycompany/vcon-plugin,./local-plugin.js

# License key for proprietary plugins
VCON_LICENSE_KEY=your-license-key-here

# Offline mode (disables network features in plugins)
VCON_OFFLINE_MODE=false
```

**Plugin sources:**
- **npm packages**: `@mycompany/vcon-plugin`
- **Local files**: `./examples/logging-plugin.js`
- **Relative paths**: `../plugins/custom-plugin.js`
- **GitHub**: Can be installed via npm

See [Plugin Development Guide](../development/plugins.md) for creating plugins.

#### Row Level Security (RLS) Multi-Tenant Support

Enable Row Level Security for multi-tenant data isolation:

```bash
# Enable RLS (default: false)
RLS_ENABLED=true

# Tenant extraction configuration
# Attachment type to look for (default: "tenant")
TENANT_ATTACHMENT_TYPE=tenant

# JSON path to extract tenant ID from attachment body (default: "id")
# Supports dot notation for nested paths (e.g., "metadata.tenant.id")
TENANT_JSON_PATH=id

# Current tenant ID for service role operations (optional)
# Used when service role needs to operate in a specific tenant context
CURRENT_TENANT_ID=1124
```

**How it works:**
- When creating a vCon, the system looks for an attachment with `type="tenant"` (or your configured type)
- Extracts the tenant ID from the attachment's `body` JSON using the configured path
- Stores the tenant ID in the `vcons.tenant_id` column
- RLS policies automatically filter queries to only show vCons matching the current tenant

**Example tenant attachment:**
```json
{
  "type": "tenant",
  "body": "{\"id\": 1124}",
  "encoding": "json"
}
```

**For authenticated users:**
- Tenant ID should be set in JWT claims as `tenant_id`
- Supabase automatically provides this via `request.jwt.claims`

**For service role:**
- Set `CURRENT_TENANT_ID` environment variable
- Or configure in Supabase app settings

See [RLS Multi-Tenant Guide](rls-multi-tenant.md) for complete setup instructions.

#### Logging and Debugging

```bash
# Log level (DEBUG shows cache hits/misses)
LOG_LEVEL=INFO

# Node environment
NODE_ENV=production
```

Log levels:
- `DEBUG`: Verbose logging including cache operations
- `INFO`: Standard operational messages
- `WARN`: Warnings and degraded functionality
- `ERROR`: Errors only

## Configuration Examples

### Development Setup

```bash
# .env file for local development
SUPABASE_URL=https://dev-project.supabase.co
SUPABASE_ANON_KEY=eyJ...dev-key...
REDIS_URL=redis://localhost:6379
VCON_REDIS_EXPIRY=300  # 5 minutes for testing
LOG_LEVEL=DEBUG
NODE_ENV=development
```

### Production Setup

```bash
# Production environment variables
SUPABASE_URL=https://prod-project.supabase.co
SUPABASE_ANON_KEY=eyJ...prod-key...
REDIS_URL=rediss://:secure-password@redis.internal:6380
VCON_REDIS_EXPIRY=3600
LOG_LEVEL=INFO
NODE_ENV=production
```

### Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vcon": {
      "command": "node",
      "args": ["/Users/you/vcon-mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_ANON_KEY": "your-anon-key",
        "REDIS_URL": "redis://localhost:6379",
        "VCON_REDIS_EXPIRY": "3600",
        "LOG_LEVEL": "INFO"
      }
    }
  }
}
```

### Docker Compose

```yaml
version: '3.8'
services:
  vcon-mcp:
    build: .
    environment:
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
      - REDIS_URL=redis://redis:6379
      - VCON_REDIS_EXPIRY=3600
    depends_on:
      - redis
  
  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

## Configuration Validation

The server validates configuration on startup:

### Successful Startup

```
✅ Database client initialized
✅ Redis cache connected
✅ Cache layer enabled (TTL: 3600s)
✅ vCon MCP Server running on stdio
📚 Tools available: 14
💬 Prompts available: 9
🔗 Database: Connected
```

### Missing Required Configuration

```
❌ Failed to initialize database:
Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.
```

**Solution**: Add required environment variables.

### Redis Connection Failed

```
✅ Database client initialized
⚠️  Redis connection error: ECONNREFUSED
ℹ️  Cache layer disabled (Redis not configured)
✅ vCon MCP Server running on stdio
```

**Impact**: Server runs in Supabase-only mode (no caching). All functionality works but reads are slower.

## Security Best Practices

### API Keys

1. **Never commit API keys** to version control
2. **Use service role key** only on backend/server
3. **Use anon key** for client-side applications
4. **Rotate keys regularly** in production
5. **Use different keys** for dev/staging/prod

### Redis Security

1. **Enable authentication**: Always set `requirepass` in Redis
2. **Use TLS**: Use `rediss://` URLs in production
3. **Network isolation**: Bind Redis to `127.0.0.1` or private network
4. **Disable dangerous commands**: Rename FLUSHDB, CONFIG in redis.conf
5. **Regular backups**: Enable AOF or RDB persistence

Example secure Redis configuration:

```conf
# redis.conf
requirepass your-strong-password-here
bind 127.0.0.1
protected-mode yes

# Disable dangerous commands
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""
rename-command SHUTDOWN SHUTDOWN_SECRET_NAME
```

### Supabase Security

1. **Enable Row Level Security (RLS)**: Restrict access per user/tenant
   - See [RLS Multi-Tenant Guide](rls-multi-tenant.md) for setup
   - Configure `RLS_ENABLED=true` and tenant extraction settings
2. **Use JWT authentication**: For multi-tenant applications
   - Include `tenant_id` in JWT claims for automatic tenant filtering
3. **Enable realtime authorization**: Control who can subscribe to changes
4. **Set up database policies**: Enforce business logic at database level
5. **Monitor API usage**: Track requests in Supabase dashboard

## Performance Tuning

### Redis Configuration

For optimal cache performance:

```bash
# High-traffic deployments
VCON_REDIS_EXPIRY=7200  # 2 hours

# Frequently updated data
VCON_REDIS_EXPIRY=1800  # 30 minutes

# Development/testing
VCON_REDIS_EXPIRY=300   # 5 minutes
```

### Supabase Connection Pooling

The Supabase client automatically handles connection pooling. For high-traffic scenarios:

1. **Use connection pooler**: Enable in Supabase dashboard
2. **Set pool size**: Configure based on expected concurrent connections
3. **Enable persistent connections**: Keep connections alive

### Redis Connection Pooling

The Redis client (ioredis) automatically pools connections. Default settings work for most cases:

```typescript
// Advanced configuration (usually not needed)
const redis = new Redis(url, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  lazyConnect: false,
  keepAlive: 30000,
  connectTimeout: 5000
});
```

## Monitoring

### Key Metrics to Track

1. **Cache hit rate**: Percentage of reads served from Redis
2. **Average response time**: With and without cache
3. **Error rate**: Failed operations per minute
4. **Memory usage**: Redis memory consumption
5. **Database connections**: Active Supabase connections

### Logging Configuration

Enable debug logging for troubleshooting:

```bash
LOG_LEVEL=DEBUG
```

Debug logs include:
- Cache hits: `✅ Cache HIT for vCon {uuid}`
- Cache misses: `ℹ️  Cache MISS for vCon {uuid}`
- Cache writes: `✅ Cached vCon {uuid} (TTL: 3600s)`
- Cache invalidation: `✅ Invalidated cache for vCon {uuid}`
- Connection status: `✅ Redis cache connected`

## Troubleshooting

### Common Issues

#### "Missing Supabase credentials"

**Cause**: `SUPABASE_URL` or `SUPABASE_ANON_KEY` not set

**Solution**:
```bash
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_ANON_KEY=your-anon-key
```

#### "Redis connection failed"

**Cause**: Redis not running or URL incorrect

**Solution**:
```bash
# Start Redis locally
redis-server

# Or via Docker
docker run -d -p 6379:6379 redis:latest

# Verify connection
redis-cli ping
# Should return: PONG
```

#### "Cache layer disabled"

**Cause**: `REDIS_URL` not set (this is normal if caching not needed)

**Impact**: No impact on functionality, only performance

**Solution**: If you want caching, set `REDIS_URL`

## Configuration Migration

### From Non-Cached to Cached

1. **Install Redis**: `brew install redis` or Docker
2. **Add REDIS_URL**: Update environment variables
3. **Restart server**: Changes take effect immediately
4. **Monitor**: Check logs for `Cache HIT` messages

**No data migration needed** - cache builds automatically

### Changing Cache TTL

1. **Update VCON_REDIS_EXPIRY**: New value in seconds
2. **Restart server**: New TTL applies to future cache entries
3. **Flush cache** (optional): `redis-cli FLUSHDB` to clear old entries

## Additional Resources

- [Redis-Supabase Integration Guide](redis-supabase-integration.md)
- [Plugin Development Guide](../development/plugins.md)
- [Performance Optimization](../development/performance.md)
- [Security Best Practices](../development/security.md)

## Support

Need help with configuration?

- GitHub Issues: [vcon-mcp/issues](https://github.com/vcon-dev/vcon-mcp/issues)
- Documentation: [Full docs](../)
- Email: support@example.com


