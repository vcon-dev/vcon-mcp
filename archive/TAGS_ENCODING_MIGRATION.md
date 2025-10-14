# Tags Encoding Migration

## Problem

Tags attachments should use `encoding: 'json'` because the body contains JSON-formatted data (a JSON array of "key:value" strings). Some existing tags attachments might have incorrect encoding values.

## Solution

Two migration options are provided:

### Option 1: SQL Migration (Recommended for Production)

Run the SQL migration file:

```bash
# If using Supabase CLI
supabase migration up

# Or apply directly to your database
psql -d your_database -f supabase/migrations/20251015000000_fix_tags_encoding.sql
```

**File:** `supabase/migrations/20251015000000_fix_tags_encoding.sql`

This migration:
- Updates all tags attachments to `encoding='json'`
- Provides verification output
- Is idempotent (safe to run multiple times)

### Option 2: TypeScript Script (Recommended for Development)

Run the migration script:

```bash
npx tsx scripts/migrate-tags-encoding.ts
```

**File:** `scripts/migrate-tags-encoding.ts`

This script:
- Analyzes current state of tags attachments
- Shows detailed breakdown of encoding values
- Validates JSON format before updating
- Provides detailed progress and results
- Can be run multiple times safely

## What Gets Changed

```sql
-- Before
{
  "type": "tags",
  "encoding": "none",  -- or NULL
  "body": "[\"department:sales\", \"priority:high\"]"
}

-- After
{
  "type": "tags",
  "encoding": "json",  -- ✓ Correct
  "body": "[\"department:sales\", \"priority:high\"]"
}
```

## Why `encoding: 'json'`?

The `encoding` field describes the format of the `body` content:

- **`'none'`**: Plain text (e.g., `"department:sales\npriority:high"`)
- **`'json'`**: JSON formatted string (e.g., `'["department:sales", "priority:high"]'`)
- **`'base64url'`**: Base64url encoded data

Since we use `JSON.stringify()` to create the body, the encoding must be `'json'`.

## Running the Migration

### Development Environment

```bash
# Run TypeScript script
npx tsx scripts/migrate-tags-encoding.ts
```

Output example:
```
🔧 Migrating tags attachments encoding

Step 1: Finding tags attachments...
   Found 42 tags attachments

Step 2: Analyzing current state...
   encoding='json': 38
   encoding='none': 3
   encoding=NULL:   1
   other encoding:  0

Step 3: Updating 4 attachments...
   Updated 4/4 attachments...

─────────────────────────────────────
Migration Complete
─────────────────────────────────────
✓ Successfully updated: 4
✓ All tags attachments now have correct encoding!
```

### Production Environment

```bash
# Option 1: Via Supabase CLI
supabase migration up

# Option 2: Direct SQL
psql -d production_db -f supabase/migrations/20251015000000_fix_tags_encoding.sql

# Option 3: Via migration script with production credentials
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_ANON_KEY=your-key \
npx tsx scripts/migrate-tags-encoding.ts
```

## Verification

After running the migration, verify all tags attachments have correct encoding:

```sql
SELECT 
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE encoding = 'json') as with_json,
  COUNT(*) FILTER (WHERE encoding != 'json' OR encoding IS NULL) as incorrect
FROM attachments
WHERE type = 'tags';
```

Expected result:
```
 total | with_json | incorrect
-------+-----------+-----------
    42 |        42 |         0
```

## Rollback (If Needed)

If you need to rollback (not recommended, but possible):

```sql
-- This would revert the encoding, but it's not correct per vCon spec
UPDATE attachments
SET encoding = 'none'
WHERE type = 'tags';
```

## Impact

- **No data loss**: Only the `encoding` field is updated
- **No breaking changes**: The body content remains the same
- **Backward compatible**: Code already handles JSON parsing
- **Forward compatible**: Matches vCon specification

## Related Files

- **Migration**: `supabase/migrations/20251015000000_fix_tags_encoding.sql`
- **Script**: `scripts/migrate-tags-encoding.ts`
- **Code**: `src/db/queries.ts` (already uses correct encoding)
- **Docs**: This file

## Troubleshooting

### Script reports validation errors

If the script reports that some attachments have invalid JSON:
```
⚠️  Attachment 123: invalid JSON body, skipping
```

This means the body is not valid JSON. Check the attachment manually:
```sql
SELECT id, body, encoding FROM attachments WHERE id = 123;
```

### Migration fails with permission error

Ensure your database user has UPDATE permission on the `attachments` table:
```sql
GRANT UPDATE ON attachments TO your_user;
```

### Want to test without changes

Dry-run SQL query:
```sql
SELECT id, vcon_id, encoding
FROM attachments
WHERE type = 'tags'
  AND (encoding IS NULL OR encoding != 'json');
```

## Post-Migration

After migration:
1. All new tags will be created with `encoding='json'` ✓
2. All existing tags will have `encoding='json'` ✓
3. Search functions will work correctly ✓
4. Tags will be vCon spec compliant ✓

## Questions?

- Check that tags body is JSON: `JSON.parse(body)` should work
- Check that encoding matches format: JSON body = `'json'` encoding
- See main documentation: `docs/TAG_MANAGEMENT_GUIDE.md`

