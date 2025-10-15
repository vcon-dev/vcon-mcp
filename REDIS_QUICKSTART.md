# Redis Caching - Quick Start

Get 20-50x faster vCon reads in 5 minutes.

## Prerequisites

- vCon MCP Server already installed
- Supabase configured and working

## Step 1: Install Redis

### macOS (Homebrew)
```bash
brew install redis
brew services start redis
```

### Ubuntu/Debian
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
```

### Docker
```bash
docker run -d --name redis -p 6379:6379 redis:latest
```

### Verify Installation
```bash
redis-cli ping
# Should return: PONG
```

## Step 2: Enable Caching in MCP Server

### Option A: Environment Variable
```bash
export REDIS_URL=redis://localhost:6379
```

### Option B: Claude Desktop Config

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vcon": {
      "command": "node",
      "args": ["/path/to/vcon-mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "your-supabase-url",
        "SUPABASE_ANON_KEY": "your-anon-key",
        "REDIS_URL": "redis://localhost:6379"
      }
    }
  }
}
```

### Option C: .env File

Create/edit `.env` in project root:

```bash
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-anon-key
REDIS_URL=redis://localhost:6379
```

## Step 3: Restart and Verify

### Restart MCP Server
```bash
npm run build
npm run dev
```

### Look for Success Messages
```
✅ Database client initialized
✅ Redis cache connected
✅ Cache layer enabled (TTL: 3600s)
✅ vCon MCP Server running on stdio
```

### If Using Claude Desktop
Restart Claude Desktop app completely.

## Step 4: Test Caching

### First Read (Cache Miss)
Ask Claude: "Get vCon [some-uuid]"

Server logs:
```
ℹ️  Cache MISS for vCon [uuid]
✅ Cached vCon [uuid] (TTL: 3600s)
```

### Second Read (Cache Hit)
Ask Claude: "Get vCon [same-uuid]"

Server logs:
```
✅ Cache HIT for vCon [uuid]
```

**Result**: 50x faster! 🚀

## Optional: Adjust Cache TTL

Default is 1 hour (3600 seconds). To change:

```bash
# 30 minutes
export VCON_REDIS_EXPIRY=1800

# 2 hours
export VCON_REDIS_EXPIRY=7200

# 5 minutes (for testing)
export VCON_REDIS_EXPIRY=300
```

## Troubleshooting

### "Redis connection failed"

**Problem**: Redis not running

**Solution**:
```bash
# Check if Redis is running
redis-cli ping

# If not, start it
# macOS:
brew services start redis

# Linux:
sudo systemctl start redis-server

# Docker:
docker start redis
```

### "Cache layer disabled"

**Problem**: REDIS_URL not set

**Solution**: Set the environment variable (see Step 2)

### Server still works but no caching

**This is normal!** The system works without Redis (just slower). To enable caching, follow Step 1-2.

## Production Tips

### Use Authentication
```bash
# In redis.conf
requirepass your-strong-password

# Then use:
REDIS_URL=redis://:your-strong-password@localhost:6379
```

### Use TLS in Production
```bash
REDIS_URL=rediss://localhost:6380
```

### Monitor Cache Performance
```bash
# Connect to Redis
redis-cli

# View cached vCons
KEYS vcon:*

# Check cache stats
INFO stats

# Monitor in real-time
MONITOR
```

## Conserver Integration (Optional)

To use Supabase storage backend in conserver:

### 1. Install Python Dependencies
```bash
pip install supabase redis
```

### 2. Copy Storage Backend
```bash
cp examples/conserver-supabase-storage.py /path/to/conserver/server/storage/supabase.py
```

### 3. Update config.yml
```yaml
storages:
  supabase:
    module: storage.supabase
    options:
      url: ${SUPABASE_URL}
      anon_key: ${SUPABASE_ANON_KEY}
      redis_url: ${REDIS_URL}

chains:
  main_chain:
    storages:
      - supabase
```

### 4. Restart Conserver
```bash
docker-compose restart
```

## Performance Comparison

| Scenario | Without Redis | With Redis | Improvement |
|----------|---------------|------------|-------------|
| First read | 50-100ms | 50-100ms | Same |
| Subsequent reads | 50-100ms | 1-2ms | **50x faster** |
| Cache after 1 hour | 50-100ms | 50-100ms | Cache expired |

## Next Steps

- ✅ Caching enabled and working
- 📖 Read [Full Integration Guide](docs/guide/redis-supabase-integration.md)
- 🔧 Review [Configuration Guide](docs/guide/configuration.md)
- 📊 Check [Performance Benchmarks](REDIS_INTEGRATION.md#performance-benchmarks)
- 🔒 Review [Security Best Practices](docs/guide/redis-supabase-integration.md#security-considerations)

## Support

- 📖 [Full Documentation](docs/guide/redis-supabase-integration.md)
- 🐛 [Report Issues](https://github.com/yourusername/vcon-mcp/issues)
- 💬 [Discussions](https://github.com/yourusername/vcon-mcp/discussions)

## Summary

**You're done!** Redis caching is now enabled. Your vCon reads are now 50x faster! 🎉

---

**Questions?** See the [full integration guide](docs/guide/redis-supabase-integration.md) or open an issue.


