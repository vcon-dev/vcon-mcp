# vCon MCP Server Examples

This directory contains example implementations and integrations for the vCon MCP Server.

## Conserver Supabase Storage Backend

**File**: `conserver-supabase-storage.py`

A production-ready storage backend for the vCon conserver that stores vCons in Supabase PostgreSQL with optional Redis caching.

### Features

- **Supabase Integration**: Stores vCons in Supabase PostgreSQL using the vCon schema
- **Redis Caching**: Optional write-through cache for fast reads
- **Full CRUD Support**: Create, read, update, delete, and search operations
- **Error Handling**: Graceful degradation when Redis is unavailable
- **Type Safety**: Complete vCon spec compliance with proper field mapping

### Installation

```bash
# Install required packages
pip install supabase redis
```

### Usage in Conserver

1. **Copy to conserver installation**:
```bash
cp conserver-supabase-storage.py /path/to/conserver/server/storage/supabase.py
```

2. **Configure in config.yml**:
```yaml
storages:
  supabase:
    module: storage.supabase
    options:
      url: ${SUPABASE_URL}
      anon_key: ${SUPABASE_ANON_KEY}
      redis_url: ${REDIS_URL}  # Optional
      cache_ttl: 3600

chains:
  main_chain:
    storages:
      - supabase
    # ... rest of chain config
```

3. **Set environment variables**:
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
REDIS_URL=redis://localhost:6379  # Optional
```

### Architecture

The storage backend implements a write-through cache pattern:

```
Write Path:  Conserver → Supabase (permanent) → Redis (cache)
Read Path:   Conserver → Redis (cache check) → Supabase (fallback)
```

### Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `url` | Yes | `$SUPABASE_URL` | Supabase project URL |
| `anon_key` | Yes | `$SUPABASE_ANON_KEY` | Supabase API key |
| `redis_url` | No | `$REDIS_URL` | Redis connection URL |
| `cache_ttl` | No | `3600` | Cache TTL in seconds |

### Methods

#### `save(vcon: Dict[str, Any]) -> bool`

Saves a vCon to Supabase and caches in Redis.

```python
storage.save({
    'uuid': 'abc-123',
    'vcon': '0.3.0',
    'parties': [...],
    'dialog': [...]
})
```

#### `get(uuid: str) -> Optional[Dict[str, Any]]`

Retrieves a vCon by UUID (cache-first).

```python
vcon = storage.get('abc-123')
```

#### `delete(uuid: str) -> bool`

Deletes a vCon from Supabase and invalidates cache.

```python
storage.delete('abc-123')
```

#### `search(query: Dict[str, Any]) -> List[Dict[str, Any]]`

Searches vCons by criteria.

```python
results = storage.search({
    'subject': 'support',
    'start_date': '2025-01-01',
    'end_date': '2025-12-31'
})
```

### Error Handling

The storage backend handles errors gracefully:

- **Redis Unavailable**: Falls back to Supabase-only mode
- **Supabase Errors**: Logs errors and returns None/False
- **Invalid Data**: Validates vCon structure before saving

### Logging

The storage backend logs all operations:

```
✅ Connected to Supabase
✅ Redis cache enabled (TTL: 3600s)
✅ Saved vCon abc-123 to Supabase
✅ Cached vCon abc-123 in Redis
✅ Cache HIT for vCon abc-123
ℹ️  Cache MISS for vCon def-456
⚠️  Redis connection failed: Connection refused. Caching disabled.
```

### Testing

Test the storage backend:

```python
import os
from storage.supabase import SupabaseStorage

# Initialize
storage = SupabaseStorage({
    'url': os.getenv('SUPABASE_URL'),
    'anon_key': os.getenv('SUPABASE_ANON_KEY'),
    'redis_url': os.getenv('REDIS_URL')
})

# Test save
vcon = {
    'uuid': 'test-123',
    'vcon': '0.3.0',
    'created_at': '2025-10-15T12:00:00Z',
    'parties': [{'name': 'Test User'}]
}

assert storage.save(vcon) == True

# Test get
retrieved = storage.get('test-123')
assert retrieved is not None
assert retrieved['uuid'] == 'test-123'

# Test delete
assert storage.delete('test-123') == True
assert storage.get('test-123') is None

print("✅ All tests passed!")
```

## Logging Plugin

**File**: `logging-plugin.js`

A simple example plugin that logs vCon operations. See the [Plugin Development Guide](../docs/development/plugins.md) for more details.

## More Examples Coming Soon

- **Twilio Adapter**: Convert Twilio call records to vCons
- **Slack Adapter**: Convert Slack conversations to vCons
- **Webhook Handler**: Receive vCons via webhooks
- **Batch Processor**: Process vCons in bulk

## Contributing

Have a useful example or integration? Submit a pull request!

1. Fork the repository
2. Create your example file
3. Add documentation to this README
4. Submit a pull request

## Support

For questions about examples:

- GitHub Issues: [vcon-mcp/issues](https://github.com/vcon-dev/vcon-mcp/issues)
- Documentation: [Full docs](../docs/)
- Email: support@example.com


