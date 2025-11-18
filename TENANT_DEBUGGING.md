# Tenant ID Debugging Setup Complete! 🎉

I've added comprehensive debugging support to help you diagnose tenant ID and RLS issues.

## What's New

### 1. Automatic Tenant Context Setup
- Server now automatically sets tenant context on startup
- Logs show exactly what's happening with your tenant configuration
- Verifies that RLS policies can see your tenant ID

### 2. New Files Created

**Core Implementation:**
- `src/db/tenant-context.ts` - Tenant context management with full logging
- `supabase/migrations/20251113000000_add_set_tenant_helper.sql` - Helper function for setting tenant context

**Documentation:**
- `docs/guide/debugging-tenant-rls.md` - Complete debugging guide
- `scripts/test-tenant-setup.ts` - Test script to verify your configuration

### 3. Enhanced Logging

The server now logs:
- ✅ When Supabase client initializes (shows if using service_role or anon key)
- ✅ RLS enabled status
- ✅ Current tenant ID being used
- ✅ Success/failure of setting tenant context
- ✅ Tenant context verification (expected vs actual)
- ✅ vCon visibility report (when RLS_DEBUG=true)

## Quick Start

### Step 1: Run the Migration

```bash
cd /Users/thomashowe/Documents/GitHub/vcon-mcp

# Apply the new migration
psql $DATABASE_URL -f supabase/migrations/20251113000000_add_set_tenant_helper.sql
```

Or through Supabase CLI:
```bash
supabase db push
```

### Step 2: Test Your Configuration

```bash
# Make sure you have these environment variables set:
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"
export RLS_ENABLED="true"
export CURRENT_TENANT_ID="your_tenant_id"

# Run the test script
npm run test:tenant
```

You should see output like:

```
🔍 Testing Tenant Setup

============================================================

📋 Step 1: Environment Variables

  RLS_ENABLED: ✅ true
  CURRENT_TENANT_ID: ✅ your_tenant_id
  SUPABASE_SERVICE_ROLE_KEY: ✅ set

📋 Step 2: Database Connection

  Connection: ✅ initialized

📋 Step 3: Set Tenant Context

  ✅ Tenant context set successfully

📋 Step 4: Verify Tenant Context

  Expected: your_tenant_id
  Actual: your_tenant_id
  ✅ Tenant context matches!

...
```

### Step 3: Update Claude Desktop Configuration

Edit your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "vcon": {
      "command": "node",
      "args": ["/Users/thomashowe/Documents/GitHub/vcon-mcp/build/index.js"],
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
- Use `SUPABASE_SERVICE_ROLE_KEY` not `SUPABASE_ANON_KEY`
- Environment variables go in the `env` object
- Set `MCP_DEBUG=true` for verbose logging

### Step 4: Rebuild and Restart

```bash
# Rebuild the project
npm run build

# Restart Claude Desktop completely
# (Quit from menu, don't just close window)
```

### Step 5: Check the Logs

```bash
# On macOS
tail -f ~/Library/Logs/Claude/mcp*.log | grep -i tenant

# You should see:
# [INFO] Initializing Supabase client: {"key_type":"service_role","rls_enabled":true}
# [DEBUG] Tenant configuration loaded: {"rls_enabled":true,"current_tenant_id":"your_tenant_id"}
# ✅ Tenant context set successfully: {"tenant_id":"your_tenant_id"}
# [INFO] Tenant context verification: {"match":true}
```

## Debugging Commands

### Check Logs in Real-Time
```bash
# macOS
tail -f ~/Library/Logs/Claude/mcp*.log

# Filter for tenant-related messages
tail -f ~/Library/Logs/Claude/mcp*.log | grep -E "(tenant|RLS|context)"
```

### Test Database Manually
```bash
# Connect to database
psql $DATABASE_URL

# Test the functions
SELECT set_tenant_context('your_tenant_id');
SELECT get_current_tenant_id();

# Check what vCons are visible
SELECT uuid, tenant_id, subject FROM vcons LIMIT 5;
```

### Enable Extra Debugging
Add these to your environment:
```bash
MCP_DEBUG=true    # Enable MCP protocol debugging
RLS_DEBUG=true    # Enable RLS-specific debugging with visibility reports
```

## Common Issues

### ❌ "function set_tenant_context does not exist"
**Fix:** Run the migration from Step 1 above

### ❌ "Using anon key"
**Fix:** Change `SUPABASE_ANON_KEY` to `SUPABASE_SERVICE_ROLE_KEY` in your config

### ❌ "Tenant context mismatch"
**Fix:** Make sure the migration is applied and you're using service_role key

### ❌ "0 vCons visible"
**Fix:** Your vCons might not have tenant_id set. Run:
```sql
SELECT * FROM populate_tenant_ids_batch('tenant', 'id', 1000);
```

## Complete Documentation

For full debugging guide with all troubleshooting steps, see:
- `docs/guide/debugging-tenant-rls.md`

For RLS setup guide:
- `docs/guide/rls-multi-tenant.md`

## What Changed in the Code

### Server Setup (`src/server/setup.ts`)
- Now calls `setTenantContext()` during initialization
- Verifies tenant context is working
- Shows visibility report when debugging enabled

### Database Client (`src/db/client.ts`)
- Prefers `SUPABASE_SERVICE_ROLE_KEY` over `SUPABASE_ANON_KEY`
- Logs which key type is being used
- Shows RLS enabled status

### New Tenant Context Module (`src/db/tenant-context.ts`)
- `setTenantContext()` - Sets PostgreSQL session variable
- `verifyTenantContext()` - Checks if it worked
- `debugTenantVisibility()` - Shows what vCons are visible

## Need Help?

If you're still having issues after following this guide:

1. Run `npm run test:tenant` and share the output
2. Check the logs with `tail -f ~/Library/Logs/Claude/mcp*.log`
3. Verify all checklist items in `docs/guide/debugging-tenant-rls.md`

The logs will now tell you exactly what's happening with your tenant configuration!




