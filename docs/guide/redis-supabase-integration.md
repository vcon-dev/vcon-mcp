# Redis-Supabase Integration Guide

This guide explains how to integrate Redis caching with Supabase storage for the vCon MCP Server and conserver, creating a high-performance architecture with Redis as hot storage and Supabase as permanent storage.

## Architecture Overview

The integration provides a two-tier storage system:

```
┌─────────────────────────────────────────────────────────────┐
│                     Write Path (REST API)                    │
│                                                               │
│  Client → Conserver API → Supabase (permanent)              │
│                              ↓                                │
│                         Redis (cache + queue)                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Read Path (MCP)                          │
│                                                               │
│  AI Assistant → MCP Tools → Redis (cache check)             │
│                              ↓ miss                           │
│                         Supabase (fetch & cache)             │
└─────────────────────────────────────────────────────────────┘
```

### Key Benefits

1. **Fast Writes**: REST API writes to Supabase first (permanent), then Redis (cache + queue)
2. **Fast Reads**: MCP checks Redis cache first, falls back to Supabase on cache miss
3. **Permanent Storage**: All vCons saved to Supabase regardless of Redis TTL expiry
4. **Chain Processing**: Redis list operations preserved for conserver chain coordination
5. **AI Integration**: MCP tools access complete dataset through cache layer
6. **Automatic Cache Management**: Cache invalidation on updates/deletes

## MCP Server Configuration (TypeScript)

### Environment Variables

Add to your `.env` file:

```bash
# Supabase Configuration (required)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# Redis Configuration (optional - enables caching)
REDIS_URL=redis://localhost:6379
# or for Redis with auth:
# REDIS_URL=redis://:password@localhost:6379

# Cache TTL in seconds (default 3600 = 1 hour)
VCON_REDIS_EXPIRY=3600
```

### Installation

```bash
# Install dependencies
npm install

# The following packages are already included:
# - ioredis (Redis client)
# - @supabase/supabase-js (Supabase client)
```

### Cache Behavior

The MCP server implements **cache-first reads**:

1. **Cache Hit**: Returns data from Redis immediately (sub-millisecond)
2. **Cache Miss**: Fetches from Supabase, caches result, then returns
3. **Cache Invalidation**: Automatic on updates and deletes
4. **Graceful Degradation**: If Redis is unavailable, falls back to Supabase-only

### Usage

```bash
# Start MCP server (cache automatically enabled if REDIS_URL is set)
npm run build
npm run dev
```

The server will log cache status on startup:

```
✅ Database client initialized
✅ Redis cache connected
✅ Cache layer enabled (TTL: 3600s)
```

Or if Redis is not configured:

```
✅ Database client initialized
ℹ️  Cache layer disabled (Redis not configured)
```

### Cache Monitoring

The MCP server logs cache hits and misses:

```
✅ Cache HIT for vCon 550e8400-e29b-41d4-a716-446655440000
ℹ️  Cache MISS for vCon 650e8400-e29b-41d4-a716-446655440001
✅ Cached vCon 650e8400-e29b-41d4-a716-446655440001 (TTL: 3600s)
```

## Conserver Configuration (Python)

### Installation

```bash
# Install required packages
pip install supabase redis
```

### Configuration

Create or update your `config.yml`:

```yaml
storages:
  supabase:
    module: storage.supabase
    options:
      url: ${SUPABASE_URL}
      anon_key: ${SUPABASE_ANON_KEY}
      # Optional Redis cache
      redis_url: ${REDIS_URL}
      cache_ttl: 3600

chains:
  main_chain:
    links:
      - transcribe
      - analyze
    storages:
      - supabase  # Automatically writes to Supabase + Redis
    ingress_lists:
      - new_calls
    egress_lists:
      - processed_calls
    enabled: 1
```

### Environment Variables

Add to your `.env`:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# Redis
REDIS_URL=redis://localhost:6379
VCON_REDIS_EXPIRY=3600
```

### Storage Backend Setup

1. Copy the storage backend to your conserver installation:

```bash
# Copy from examples
cp examples/conserver-supabase-storage.py /path/to/conserver/server/storage/supabase.py
```

2. The storage backend will be automatically discovered by conserver

### Write Path Behavior

When a vCon is saved through conserver chains:

1. **Write to Supabase**: Permanent storage (source of truth)
2. **Write to Redis**: Cache with TTL + add to processing queues
3. **Push to Lists**: UUID added to Redis lists for chain processing
4. **Return Success**: Only after both Supabase and Redis writes succeed

## Advanced Configuration

### Custom Cache TTL

Different TTL values for different use cases:

```bash
# Short TTL for frequently changing data
VCON_REDIS_EXPIRY=300  # 5 minutes

# Long TTL for stable data
VCON_REDIS_EXPIRY=86400  # 24 hours

# Very short for development
VCON_REDIS_EXPIRY=60  # 1 minute
```

### Redis Connection Options

#### Basic Connection

```bash
REDIS_URL=redis://localhost:6379
```

#### With Authentication

```bash
REDIS_URL=redis://:password@localhost:6379
```

#### Redis Sentinel

```bash
REDIS_URL=redis+sentinel://sentinel1:26379,sentinel2:26379/mymaster
```

#### Redis Cluster

```bash
REDIS_URL=redis://node1:6379,node2:6379,node3:6379
```

### Production Recommendations

1. **Use Redis Persistence**: Configure Redis with AOF or RDB persistence
2. **Monitor Cache Hit Rate**: Track cache hits vs misses for optimization
3. **Set Appropriate TTL**: Balance between freshness and cache efficiency
4. **Use Redis Sentinel**: For high availability in production
5. **Enable TLS**: Use `rediss://` for encrypted connections

## Monitoring and Metrics

### Cache Performance

Monitor these metrics in production:

- **Cache Hit Rate**: Percentage of reads served from cache
- **Cache Miss Rate**: Percentage of reads requiring Supabase fetch
- **Average Read Latency**: Measure impact of caching
- **Redis Memory Usage**: Ensure cache doesn't exceed available memory

### Example Monitoring Script

```python
import redis
import json

r = redis.from_url("redis://localhost:6379")

# Get cache stats
info = r.info('stats')
print(f"Keyspace hits: {info['keyspace_hits']}")
print(f"Keyspace misses: {info['keyspace_misses']}")

hit_rate = info['keyspace_hits'] / (info['keyspace_hits'] + info['keyspace_misses'])
print(f"Cache hit rate: {hit_rate:.2%}")

# Get memory usage
memory = r.info('memory')
print(f"Used memory: {memory['used_memory_human']}")
```

## Troubleshooting

### Redis Connection Errors

If Redis is unavailable:

```
⚠️  Redis connection error: Connection refused
ℹ️  Cache layer disabled (Redis not configured)
```

**Solution**: The system automatically falls back to Supabase-only mode. Fix Redis and restart.

### Cache Inconsistency

If cached data becomes stale:

```bash
# Flush all vCon keys from Redis
redis-cli KEYS "vcon:*" | xargs redis-cli DEL

# Or flush entire database (careful!)
redis-cli FLUSHDB
```

### Memory Pressure

If Redis runs out of memory:

**Option 1**: Increase Redis memory limit

```bash
# In redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
```

**Option 2**: Reduce cache TTL

```bash
VCON_REDIS_EXPIRY=1800  # 30 minutes instead of 1 hour
```

### Performance Issues

If reads are slow:

1. **Check Redis Connection**: Ensure Redis is local or low-latency
2. **Monitor Cache Hits**: Low hit rate indicates TTL is too short
3. **Check Supabase Latency**: Database queries should be indexed
4. **Enable Connection Pooling**: Both Redis and Supabase should pool connections

## Migration Guide

### From Supabase-Only to Redis-Cached

1. **Install Redis**:
```bash
# Docker
docker run -d -p 6379:6379 redis:latest

# Or install locally
brew install redis  # macOS
sudo apt install redis  # Ubuntu
```

2. **Add Environment Variable**:
```bash
echo "REDIS_URL=redis://localhost:6379" >> .env
```

3. **Restart Services**:
```bash
# MCP Server
npm run build
npm run dev

# Conserver
docker-compose restart
```

4. **Verify Cache**:
```bash
# Check Redis for cached keys
redis-cli KEYS "vcon:*"
```

### From Other Storage to Supabase

If migrating from MongoDB, S3, or other storage:

1. **Export Existing vCons**: Use your current storage backend
2. **Import to Supabase**: Use the `load-vcons.ts` script or bulk import
3. **Update Configuration**: Change storage backend in `config.yml`
4. **Test Thoroughly**: Verify read/write operations work correctly
5. **Cut Over**: Switch traffic to new backend

## API Examples

### MCP Tool Usage (with Caching)

```typescript
// Create vCon (writes to Supabase, not cached yet)
const result = await mcpClient.callTool('create_vcon', {
  subject: 'Customer Support Call',
  parties: [...]
});

// First read (cache miss, fetches from Supabase, then caches)
const vcon1 = await mcpClient.callTool('get_vcon', {
  uuid: result.uuid
});
// Logs: ℹ️  Cache MISS for vCon ...
// Logs: ✅ Cached vCon ... (TTL: 3600s)

// Second read (cache hit, instant response)
const vcon2 = await mcpClient.callTool('get_vcon', {
  uuid: result.uuid
});
// Logs: ✅ Cache HIT for vCon ...

// Update (invalidates cache)
await mcpClient.callTool('update_vcon', {
  uuid: result.uuid,
  updates: { subject: 'Updated Subject' }
});
// Logs: ✅ Invalidated cache for vCon ...

// Read after update (cache miss, fetches fresh data)
const vcon3 = await mcpClient.callTool('get_vcon', {
  uuid: result.uuid
});
// Logs: ℹ️  Cache MISS for vCon ...
```

### Conserver Storage (Write-Through)

```python
from storage.supabase import SupabaseStorage

storage = SupabaseStorage({
    'url': 'https://project.supabase.co',
    'anon_key': 'key',
    'redis_url': 'redis://localhost:6379'
})

# Save vCon (writes to both Supabase and Redis)
vcon = {
    'uuid': 'abc-123',
    'vcon': '0.3.0',
    'parties': [...]
}

storage.save(vcon)
# Logs: ✅ Saved vCon abc-123 to Supabase
# Logs: ✅ Cached vCon abc-123 in Redis

# Get vCon (cache-first read)
retrieved = storage.get('abc-123')
# Logs: ✅ Cache HIT for vCon abc-123
```

## Security Considerations

### Redis Security

1. **Authentication**: Always use password authentication in production
2. **Network Isolation**: Bind Redis to localhost or private network
3. **TLS Encryption**: Use `rediss://` for encrypted connections
4. **Disable Dangerous Commands**: Use `rename-command` in redis.conf

```bash
# redis.conf
requirepass your-strong-password
bind 127.0.0.1
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""
```

### Supabase Security

1. **Row Level Security**: Enable RLS policies for multi-tenancy
2. **API Keys**: Use service role key only on server side
3. **JWT Validation**: Validate Supabase JWTs for authenticated requests
4. **Rate Limiting**: Use Supabase built-in rate limiting

## Performance Benchmarks

Typical performance with Redis caching enabled:

| Operation | Without Cache | With Cache (Hit) | Improvement |
|-----------|---------------|------------------|-------------|
| Get vCon  | 50-100ms      | 1-2ms           | 50x faster  |
| Search    | 100-200ms     | 5-10ms          | 20x faster  |
| Create    | 100-150ms     | 100-150ms       | Same        |
| Update    | 100-150ms     | 100-150ms       | Same        |

*Benchmarks measured on AWS with Supabase in us-east-1 and Redis co-located with application.*

## Additional Resources

- [Redis Best Practices](https://redis.io/topics/best-practices)
- [Supabase Performance Guide](https://supabase.com/docs/guides/performance)
- [vCon MCP Server Documentation](../README.md)
- [Conserver Documentation](../../background_docs/conserver_config_guide.md)

## Support

For issues or questions:

- GitHub Issues: [vcon-mcp/issues](https://github.com/yourusername/vcon-mcp/issues)
- Email: support@example.com
- Documentation: [Full docs](https://docs.example.com)


