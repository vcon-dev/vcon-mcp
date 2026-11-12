# RLS Multi-Tenant Setup Guide

Complete guide for enabling Row Level Security (RLS) for multi-tenant data isolation in the vCon MCP Server.

## Overview

Row Level Security (RLS) enables automatic data isolation between tenants at the database level. Each tenant can only access their own vCons and related data, even when sharing the same database.

### How It Works

1. **Tenant Identification**: Tenant ID is extracted from vCon attachments
2. **Storage**: Tenant ID is stored in `vcons.tenant_id` column
3. **Filtering**: RLS policies automatically filter queries by tenant
4. **Isolation**: Each tenant sees only their own data

## Prerequisites

- Supabase project with database access
- Service role key for running migrations
- vCons with tenant attachments (or ability to add them)

## Quick Start

### 1. Configure Tenant Extraction

Set environment variables for tenant extraction:

```bash
# Enable RLS
RLS_ENABLED=true

# Attachment type to look for (default: "tenant")
TENANT_ATTACHMENT_TYPE=tenant

# JSON path to extract tenant ID (default: "id")
TENANT_JSON_PATH=id
```

### 2. Run Migration

Run the migration script to enable RLS and populate tenant IDs:

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
npx tsx scripts/migrate-to-rls.ts
```

### 3. Verify Setup

Check that tenant IDs are populated:

```sql
SELECT COUNT(*) as total, 
       COUNT(tenant_id) as with_tenant,
       COUNT(*) - COUNT(tenant_id) as without_tenant
FROM vcons;
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RLS_ENABLED` | `false` | Enable/disable RLS multi-tenant support |
| `TENANT_ATTACHMENT_TYPE` | `tenant` | Attachment type to look for tenant information |
| `TENANT_JSON_PATH` | `id` | JSON path to extract tenant ID (supports dot notation) |
| `CURRENT_TENANT_ID` | (none) | Current tenant ID for service role operations |

### Tenant Attachment Format

The system looks for attachments with the configured type and extracts the tenant ID from the body JSON.

**Default format:**
```json
{
  "type": "tenant",
  "body": "{\"id\": 1124}",
  "encoding": "json"
}
```

**Custom format example:**
If you use a different structure:
```json
{
  "type": "organization",
  "body": "{\"metadata\": {\"tenant\": {\"id\": 1124}}}",
  "encoding": "json"
}
```

Configure accordingly:
```bash
TENANT_ATTACHMENT_TYPE=organization
TENANT_JSON_PATH=metadata.tenant.id
```

## Migration Process

### Step 1: Dry Run

Test the migration without making changes:

```bash
npx tsx scripts/migrate-to-rls.ts --dry-run
```

This shows:
- Current migration status
- Number of vCons that would be updated
- Configuration that would be used

### Step 2: Run Migration

Execute the migration:

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
RLS_ENABLED=true \
TENANT_ATTACHMENT_TYPE=tenant \
TENANT_JSON_PATH=id \
npx tsx scripts/migrate-to-rls.ts
```

The script will:
1. Add `tenant_id` column to `vcons` table
2. Create extraction function
3. Populate tenant IDs from existing attachments
4. Enable RLS on all tables
5. Create RLS policies

### Step 3: Verify Results

Check migration results:

```sql
-- Check tenant distribution
SELECT tenant_id, COUNT(*) as vcon_count
FROM vcons
WHERE tenant_id IS NOT NULL
GROUP BY tenant_id
ORDER BY vcon_count DESC;

-- Check vCons without tenants
SELECT uuid, created_at
FROM vcons
WHERE tenant_id IS NULL
LIMIT 10;
```

## Authentication Setup

### For Authenticated Users (JWT)

Tenant ID should be included in JWT claims. Supabase automatically provides this via `request.jwt.claims->>'tenant_id'`.

**Example JWT payload:**
```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "tenant_id": "1124"
}
```

**Setting tenant in JWT:**
- Configure in your authentication provider
- Or use Supabase Auth with custom claims
- Or set via Supabase Edge Functions

### For Service Role

When using service role key, set the current tenant:

```bash
CURRENT_TENANT_ID=1124
```

Or set in Supabase app settings:
```sql
SET app.current_tenant_id = '1124';
```

## RLS Policies

The migration creates policies on all tables:

### vcons Table
- Users can only see vCons where `tenant_id` matches their current tenant
- vCons with `tenant_id IS NULL` are accessible to all (for backward compatibility)

### Child Tables
- `parties`, `dialog`, `attachments`, `analysis`, `groups`
- Policies check parent vCon's `tenant_id` via EXISTS subquery

### Policy Logic

```sql
-- Example policy (simplified)
CREATE POLICY "vcons_tenant_isolation" ON vcons
  FOR ALL
  USING (
    tenant_id IS NULL OR tenant_id = get_current_tenant_id()
  );
```

## Writer Mode (`TENANT_MODE=writer`)

`TENANT_MODE` is unset by default, and the server behaves as described above. Set
`TENANT_MODE=writer` on the one process that receives conserver writes and runs operator tools.
That process:

- needs `SUPABASE_SERVICE_ROLE_KEY` and the Supabase backend, and refuses to start without them
- refuses to start with `CURRENT_TENANT_ID` set. The writer serves every tenant, and the session
  tenant that variable sets outlives a request on a pooled connection
- refuses to start with `TENANT_ATTACHMENT_TYPE` or `TENANT_JSON_PATH` set to anything but
  `tenant` and `id`, the only values the SQL backfill (`vcon_tenant_stamp`) knows
- refuses to start unless the store has `save_vcon_batch` and migration
  `20261112120000_keep_stored_tenant.sql`. It probes both without writing. If `save_vcon_batch`
  disappears later, writes fail with an error; the writer never falls back to per-table writes,
  which overwrite a stored tenant
- reads the tenant attachment on every vCon it stores, whatever `RLS_ENABLED` says
- stores a vCon whose stamp is missing, malformed or conflicting under the reserved tenant
  `_quarantine`, and logs a warning with the reason. No vCon is dropped because of its stamp
- logs a warning, naming the uuid and the stored and stamped tenants, when a re-post kept a
  stored tenant that differs from its stamp
- refreshes `vcon_tags_mv` at start and every `TAGS_MV_REFRESH_INTERVAL_MS` (default 60000),
  since tenant tokens cannot refresh it and nothing else does without pg_cron

```bash
TENANT_MODE=writer
SUPABASE_SERVICE_ROLE_KEY=...
# TAGS_MV_REFRESH_INTERVAL_MS=60000
```

An unknown `TENANT_MODE` value stops startup.

### The stamp

```json
{"purpose": "tenant", "start": "2026-11-06T18:00:00Z", "party": 0, "dialog": 0,
 "mediatype": "application/json", "encoding": "json", "body": {"id": "t-0123456789abcdef"}}
```

A tenant id is `t-` and 16 lowercase hex digits. The writer also reads the legacy `type: "tenant"`
field and a JSON-string body (`"body": "{\"id\": \"t-0123456789abcdef\"}"`).

A stamp is malformed when the body is missing or empty, is `base64url`, is not JSON, or is not a
JSON object, or when the id is missing, not a string, not `t-` and 16 lowercase hex digits (no
trimming, no case folding), or is `_quarantine`. Two tenant attachments naming different ids
conflict; the same id twice does not. One malformed attachment beside a good one sends the vCon to
`_quarantine`.

### Re-posts keep the stored tenant

`save_vcon_batch` keeps a vCon's stored tenant when the same uuid is posted again, whatever tenant
the new post carries, and its children follow the stored value. A vCon stored with a NULL tenant
takes the new one. This applies to every deployment from migration
`20261112120000_keep_stored_tenant.sql`, whatever `TENANT_MODE` says. A direct `UPDATE` of
`vcons.tenant_id` still works and moves the children with it.

### Reading and releasing quarantine

With the service key:

```sql
SELECT uuid, created_at, subject FROM vcons WHERE tenant_id = '_quarantine' ORDER BY created_at;
```

Only `release_vcon_from_quarantine()` moves a vCon out. It needs a reason, evidence as a non-empty
JSON object (for example what showed the number was in that tenant's inventory at the time of the
call) and who did it. It writes them to the append-only table `tenant_quarantine_releases` in the
same transaction, and the vCon's children move with it. `service_role` only.

```sql
SELECT release_vcon_from_quarantine(
  '<vcon uuid>',
  't-0123456789abcdef',
  'number was in this tenant''s inventory at call time',
  '{"inventory_ref": "<snapshot id>", "checked_at": "2026-11-12T00:00:00Z"}',
  '<staff identity>'
);
```

## Adding Tenant to Existing vCons

If you have vCons without tenant attachments, you can:

### Option 1: Add Tenant Attachment

Add a tenant attachment to existing vCons:

```typescript
await addAttachment(vconUuid, {
  purpose: 'tenant',
  body: JSON.stringify({ id: 1124 }),
  encoding: 'json'
});
```

Then fill `tenant_id` from the attachments, in batches, until the call returns 0. It reads
`purpose` or `type`, skips a body that is not JSON, and never changes a tenant that is already set:

```sql
SELECT backfill_vcon_tenant_ids(1000, false);
```

With `false`, any non-empty id is taken and a vCon whose stamp cannot be read stays NULL. With
`true`, the writer rule applies: only a `t-` id is taken and every other NULL vCon goes to
`_quarantine`. `vcon_tenant_stamp(vcon_id, strict)` shows what either would choose for one vCon.
Child rows that disagree with their vCon are repaired with
`backfill_tenant_id_batch('<table>', 1000)` (or `scripts/backfill-tenant-ids.ts`), one table at a
time.

### Option 2: Manual Update

Manually set tenant_id for specific vCons:

```sql
UPDATE vcons
SET tenant_id = '1124'
WHERE uuid = 'vcon-uuid-here';
```

### Option 3: Bulk Update

Update all vCons for a specific pattern:

```sql
-- Example: Set tenant based on subject pattern
UPDATE vcons
SET tenant_id = '1124'
WHERE subject LIKE 'Tenant-1124-%'
  AND tenant_id IS NULL;
```

## Testing RLS

### Test as Different Tenants

1. **Create test vCons with different tenants:**
```typescript
// Tenant 1124
await createVCon({
  // ... vCon data
  attachments: [{
    type: 'tenant',
    body: JSON.stringify({ id: 1124 }),
    encoding: 'json'
  }]
});

// Tenant 1125
await createVCon({
  // ... vCon data
  attachments: [{
    type: 'tenant',
    body: JSON.stringify({ id: 1125 }),
    encoding: 'json'
  }]
});
```

2. **Query as tenant 1124:**
```sql
SET app.current_tenant_id = '1124';
SELECT uuid, tenant_id FROM vcons;
-- Should only see tenant 1124 vCons
```

3. **Query as tenant 1125:**
```sql
SET app.current_tenant_id = '1125';
SELECT uuid, tenant_id FROM vcons;
-- Should only see tenant 1125 vCons
```

### Verify Isolation

```sql
-- As tenant 1124, should not see tenant 1125's data
SET app.current_tenant_id = '1124';
SELECT COUNT(*) FROM vcons WHERE tenant_id = '1125';
-- Should return 0
```

## Troubleshooting

### Issue: "No tenant_id found for vCons"

**Cause**: vCons don't have tenant attachments or extraction failed

**Solution**:
1. Check attachment format matches configuration
2. Verify JSON path is correct
3. Check attachment encoding (should be 'json' or parseable)

### Issue: "RLS blocking all queries"

**Cause**: Tenant ID not set in JWT or app settings

**Solution**:
1. For authenticated users: Ensure JWT includes `tenant_id` claim
2. For service role: Set `CURRENT_TENANT_ID` or `app.current_tenant_id`
3. Check `get_current_tenant_id()` function returns correct value

### Issue: "Can't see any vCons after enabling RLS"

**Cause**: Tenant ID mismatch or not set

**Solution**:
```sql
-- Check current tenant
SELECT get_current_tenant_id();

-- Check vCon tenant IDs
SELECT DISTINCT tenant_id FROM vcons;

-- Temporarily disable RLS for debugging (use with caution!)
ALTER TABLE vcons DISABLE ROW LEVEL SECURITY;
```

### Issue: "Migration script fails"

**Cause**: Missing permissions or migration already applied

**Solution**:
1. Use service role key (not anon key)
2. Check if migration already ran: `SELECT column_name FROM information_schema.columns WHERE table_name = 'vcons' AND column_name = 'tenant_id'`
3. Run with `--dry-run` first to see what would happen

## Performance Considerations

### Indexing

The migration creates an index on `tenant_id`:
```sql
CREATE INDEX idx_vcons_tenant_id ON vcons(tenant_id) WHERE tenant_id IS NOT NULL;
```

This ensures RLS policies perform efficiently.

### Query Performance

RLS policies use EXISTS subqueries for child tables. For large datasets:
- Ensure indexes exist on foreign keys
- Consider materialized views for complex queries
- Monitor query performance in Supabase dashboard

### Cache Considerations

If using Redis caching:
- Cache keys should include tenant ID
- Invalidate cache when tenant changes
- Consider tenant-scoped cache prefixes

## Best Practices

1. **Always include tenant in vCons**: Add tenant attachment when creating vCons
2. **Use JWT claims**: Set tenant_id in authentication tokens
3. **Test thoroughly**: Verify isolation before production
4. **Monitor queries**: Check Supabase dashboard for RLS policy performance
5. **Handle NULL tenants**: Decide if NULL tenant_id should be accessible to all
6. **Document tenant format**: Keep tenant attachment format consistent
7. **Backup before migration**: Always backup database before running migrations

## Advanced Configuration

### Custom Tenant Extraction

For complex tenant identification, modify the extraction function:

```sql
CREATE OR REPLACE FUNCTION extract_tenant_from_attachments(
  p_vcon_id UUID,
  p_attachment_type TEXT DEFAULT 'tenant',
  p_json_path TEXT DEFAULT 'id'
)
RETURNS TEXT AS $$
-- Custom extraction logic here
$$;
```

### Multiple Tenant Sources

Support multiple ways to identify tenant:

```sql
CREATE OR REPLACE FUNCTION get_tenant_id(p_vcon_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  -- Try attachment first
  v_tenant_id := extract_tenant_from_attachments(p_vcon_id, 'tenant', 'id');
  
  -- Fallback to metadata
  IF v_tenant_id IS NULL THEN
    SELECT metadata->>'tenant_id' INTO v_tenant_id
    FROM vcons WHERE id = p_vcon_id;
  END IF;
  
  RETURN v_tenant_id;
END;
$$;
```

## Migration Rollback

If you need to disable RLS:

```sql
-- Disable RLS on all tables
ALTER TABLE vcons DISABLE ROW LEVEL SECURITY;
ALTER TABLE parties DISABLE ROW LEVEL SECURITY;
ALTER TABLE dialog DISABLE ROW LEVEL SECURITY;
ALTER TABLE attachments DISABLE ROW LEVEL SECURITY;
ALTER TABLE analysis DISABLE ROW LEVEL SECURITY;
ALTER TABLE groups DISABLE ROW LEVEL SECURITY;

-- Drop policies (optional)
DROP POLICY IF EXISTS "vcons_tenant_isolation" ON vcons;
-- ... repeat for other tables

-- Remove tenant_id column (optional)
ALTER TABLE vcons DROP COLUMN IF EXISTS tenant_id;
```

**Warning**: Only rollback in development. Production rollback requires careful planning.

## Related Documentation

- [Configuration Guide](configuration.md) - Environment variable reference
- [Security Best Practices](../../SECURITY.md) - General security guidelines
- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)

## Support

Need help with RLS setup?

- Check migration script output for errors
- Review Supabase logs for policy violations
- Test with `--dry-run` flag first
- Verify tenant extraction configuration matches your data format

