# Debugging Tenant ID and RLS

Complete guide for debugging Row Level Security (RLS) and tenant isolation in the vCon MCP Server.

## Quick Diagnosis

If your tenant ID isn't being picked up, follow these steps:

### 1. Check Environment Variables

Your MCP server configuration should include:

```json
{
  "mcpServers": {
    "vcon": {
      "command": "node",
      "args": ["path/to/vcon-mcp/build/index.js"],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your_service_role_key",
        "RLS_ENABLED": "true",
        "CURRENT_TENANT_ID": "your_tenant_id",
        "MCP_DEBUG": "true"
      }
    }
  }
}
```

**Important:** 
- Use `SUPABASE_SERVICE_ROLE_KEY` (not `SUPABASE_ANON_KEY`) for RLS operations
- Set `RLS_ENABLED=true` to enable RLS support
- Set `CURRENT_TENANT_ID` to your actual tenant ID
- Set `MCP_DEBUG=true` for verbose logging

### 2. Check the Logs

When using STDIO transport (Claude Desktop), logs go to **stderr** and appear in:

**macOS:**
```bash
# Claude Desktop logs
tail -f ~/Library/Logs/Claude/mcp*.log

# Or check Console.app and filter for "vcon" or "tenant"
```

**Linux:**
```bash
# Check systemd journal if running as service
journalctl -f | grep -i tenant

# Or application logs
tail -f ~/.local/share/Claude/logs/mcp*.log
```

**Windows:**
```powershell
# Claude Desktop logs
Get-Content "$env:APPDATA\Claude\logs\mcp*.log" -Wait
```

Look for these log messages:

```
✅ Database client initialized
[INFO] Initializing Supabase client: {"key_type":"service_role","rls_enabled":true}
[DEBUG] Tenant configuration loaded: {"rls_enabled":true,"current_tenant_id":"your_tenant_id"}
✅ Tenant context set successfully: {"tenant_id":"your_tenant_id"}
[INFO] Tenant context verification: {"expected_tenant_id":"your_tenant_id","actual_tenant_id":"your_tenant_id","match":true}
```

### 3. Enable Debug Mode

Add these environment variables for maximum debugging:

```bash
MCP_DEBUG=true          # Enable MCP protocol debugging
RLS_DEBUG=true          # Enable RLS-specific debugging
```

With `RLS_DEBUG=true`, you'll see:
- Tenant distribution in database
- Visible vCons count
- RLS policy effectiveness

Example output:
```json
{
  "message": "vCon visibility report",
  "current_tenant_id": "1124",
  "visible_vcons": 5,
  "tenant_distribution": {
    "1124": 5,
    "1125": 0
  }
}
```

## Common Issues and Solutions

### Issue 1: "Failed to set tenant context"

**Symptoms:**
```
[ERROR] Failed to set tenant context: function set_tenant_context does not exist
```

**Solution:**
Run the missing migration:
```bash
psql $DATABASE_URL -f supabase/migrations/20251113000000_add_set_tenant_helper.sql
```

### Issue 2: Using ANON_KEY instead of SERVICE_ROLE_KEY

**Symptoms:**
```
[INFO] Initializing Supabase client: {"key_type":"anon"}
```

**Solution:**
Replace `SUPABASE_ANON_KEY` with `SUPABASE_SERVICE_ROLE_KEY` in your configuration. The anon key has limited permissions and may not work with RLS session variables.

### Issue 3: Tenant Context Mismatch

**Symptoms:**
```
[ERROR] ❌ Tenant context mismatch!
  expected: "1124"
  actual: null
```

**Solution:**
1. Check that `set_tenant_context` function exists
2. Verify service role has permission to execute it
3. Try setting manually in psql:
   ```sql
   SELECT set_tenant_context('1124');
   SELECT get_current_tenant_id();  -- Should return '1124'
   ```

### Issue 4: RLS Enabled but No vCons Visible

**Symptoms:**
- RLS is enabled
- Tenant ID is set correctly
- But queries return 0 vCons

**Diagnosis:**
Check if vCons have tenant_id set:
```sql
SELECT uuid, tenant_id 
FROM vcons 
LIMIT 10;
```

If `tenant_id` is NULL, your vCons weren't populated with tenant IDs.

**Solution:**
Populate tenant IDs from attachments:
```sql
-- Process in batches to avoid timeout
SELECT * FROM populate_tenant_ids_batch('tenant', 'id', 1000);
```

Or manually set for testing:
```sql
UPDATE vcons SET tenant_id = '1124' WHERE uuid = 'some-uuid';
```

### Issue 5: Environment Variables Not Picked Up in STDIO

**Symptoms:**
```
[DEBUG] Tenant configuration loaded: {"current_tenant_id":"(not set)"}
```

**Solution:**
Environment variables in Claude Desktop config are case-sensitive and must be in the `env` object:

```json
{
  "mcpServers": {
    "vcon": {
      "command": "node",
      "args": ["build/index.js"],
      "env": {
        "CURRENT_TENANT_ID": "1124",
        "RLS_ENABLED": "true"
      }
    }
  }
}
```

**Don't** put them at the top level or in `args`.

## Manual Testing

### Test 1: Verify Tenant Context is Set

```bash
# In your terminal, with same env vars
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"
export RLS_ENABLED="true"
export CURRENT_TENANT_ID="1124"

# Run the server with debug
MCP_DEBUG=true node build/index.js
```

Look for the initialization messages in stderr.

### Test 2: Direct Database Check

```sql
-- Connect to your Supabase database
psql $DATABASE_URL

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename = 'vcons';

-- Check policies exist
SELECT policyname, tablename, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'vcons';

-- Test tenant context manually
SELECT set_tenant_context('1124');
SELECT get_current_tenant_id();  -- Should return '1124'

-- Test what's visible
SELECT uuid, tenant_id, subject 
FROM vcons 
LIMIT 5;
```

### Test 3: Query from Node

Create a test script `test-tenant.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function test() {
  console.log('Setting tenant context...');
  const { error: setError } = await supabase.rpc('set_tenant_context', {
    p_tenant_id: process.env.CURRENT_TENANT_ID!
  });
  
  if (setError) {
    console.error('Failed to set:', setError);
    return;
  }
  
  console.log('Verifying tenant context...');
  const { data: tenantId, error: getError } = await supabase.rpc('get_current_tenant_id');
  console.log('Current tenant:', tenantId);
  
  console.log('Querying vCons...');
  const { data: vcons, error: queryError } = await supabase
    .from('vcons')
    .select('uuid, tenant_id, subject')
    .limit(5);
  
  console.log('Visible vCons:', vcons?.length || 0);
  console.log(vcons);
}

test();
```

Run it:
```bash
npx tsx test-tenant.ts
```

## Verification Checklist

- [ ] `RLS_ENABLED=true` in environment
- [ ] `CURRENT_TENANT_ID` is set to actual tenant ID
- [ ] Using `SUPABASE_SERVICE_ROLE_KEY` (not ANON_KEY)
- [ ] Migration `20251113000000_add_set_tenant_helper.sql` is applied
- [ ] `set_tenant_context` function exists in database
- [ ] `get_current_tenant_id` function exists in database
- [ ] RLS policies are enabled on `vcons` table
- [ ] vCons have `tenant_id` populated (not NULL)
- [ ] Logs show "✅ Tenant context set successfully"
- [ ] Tenant context verification shows `"match":true`

## Still Having Issues?

If you've checked everything and it's still not working:

1. **Restart Claude Desktop** after changing configuration
2. **Check for typos** in environment variable names (case-sensitive!)
3. **Verify database connection** works at all (try without RLS first)
4. **Check Supabase logs** in the dashboard under "Logs"
5. **Test with a simple SQL query** directly in Supabase SQL editor

## Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RLS_ENABLED` | No | `false` | Enable RLS multi-tenant support |
| `CURRENT_TENANT_ID` | No | (none) | Current tenant ID for queries |
| `TENANT_ATTACHMENT_TYPE` | No | `tenant` | Attachment type for tenant extraction |
| `TENANT_JSON_PATH` | No | `id` | JSON path to extract tenant ID |
| `MCP_DEBUG` | No | `false` | Enable MCP protocol debugging |
| `RLS_DEBUG` | No | `false` | Enable RLS-specific debugging |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes* | (none) | Service role key for RLS operations |

*Required when `RLS_ENABLED=true`

### Key Functions

- `set_tenant_context(p_tenant_id TEXT)` - Sets session tenant ID
- `get_current_tenant_id()` - Returns current session tenant ID
- `extract_tenant_from_attachments(p_vcon_id UUID, p_attachment_type TEXT, p_json_path TEXT)` - Extracts tenant from vCon
- `populate_tenant_ids_batch(p_attachment_type TEXT, p_json_path TEXT, p_batch_size INTEGER)` - Backfills tenant IDs

### Log Locations

- **Claude Desktop (macOS):** `~/Library/Logs/Claude/mcp*.log`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\logs\mcp*.log`
- **Claude Desktop (Linux):** `~/.local/share/Claude/logs/mcp*.log`
- **STDIO stderr:** All server logs go to stderr, never stdout






