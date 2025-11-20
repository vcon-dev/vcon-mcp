# Attachment & Analysis Body Serialization Fix

## Problem

When loading vCons using the `load-legacy-vcons.ts` script, **attachments and analysis** with object or array bodies were not properly serialized to JSON strings before being stored in the database. This caused the bodies to be stored as NULL in PostgreSQL because TEXT columns cannot directly store JavaScript objects.

### Example - Attachments

In your vCon JSON, attachments like this:

```json
{
  "type": "strolid_dialer_payloads",
  "body": [{"call_id": "mc995ap6kek0k175n091", "lead_id": 6801724, ...}],
  "encoding": "none"
}
```

Were being inserted into the database with:
- `body` = NULL (should be a JSON string)
- `encoding` = "none" (should be "json")

### Example - Analysis

In your vCon JSON, analysis like this:

```json
{
  "type": "transcript",
  "body": {
    "segments": [...],
    "paragraphs": {...},
    "transcript": "...",
    "detected_language": "en"
  },
  "encoding": "none"
}
```

Were being inserted with:
- `body` = NULL (should be a JSON string)
- `encoding` = "none" (should be "json")

## Root Cause

The `migrateVCon()` function in `load-legacy-vcons.ts` was not checking if attachment or analysis bodies needed to be serialized from objects/arrays to JSON strings. The database query layer expects `body` to be a string (per the TypeScript type definition and database schema).

Both `attachments.body` and `analysis.body` are TEXT columns in the database, but the script was trying to insert JavaScript objects/arrays directly.

## Solution

### 1. Fix Applied to load-legacy-vcons.ts

The `migrateVCon()` function has been updated to:
- Check if `body` is an object or array
- Serialize it using `JSON.stringify()`
- Set `encoding` to 'json' if not already set

This fix applies to:
- `attachments[].body`
- `dialog[].body`
- `analysis[].body`

### 2. Fix Existing Data

For vCons already loaded with NULL attachment or analysis bodies, you have two options:

#### Option A: Re-load from S3 (Recommended)

If you have the original vCons in S3, use the automated fix script:

```bash
# Fix a specific vCon
npx tsx scripts/fix-attachment-bodies.ts <vcon-uuid>

# Fix all vCons with NULL attachment bodies
npx tsx scripts/fix-attachment-bodies.ts --all
```

This script:
1. Finds vCons with NULL attachment or analysis bodies
2. Re-downloads the original from S3
3. Properly serializes the bodies
4. Updates both attachments and analysis tables in the database

**Requirements:**
- `VCON_S3_BUCKET` environment variable must be set
- AWS credentials must be configured
- Original vCons must still be in S3

#### Option B: Manual Fix with SQL

If you have the original vCon JSON, you can manually update specific attachments or analysis:

```sql
-- Update a specific attachment body
UPDATE attachments
SET 
  body = '{"source": "crexendo"}',  -- JSON string
  encoding = 'json'
WHERE vcon_id = (SELECT id FROM vcons WHERE uuid = '<vcon-uuid>')
  AND attachment_index = 1;  -- The specific attachment index

-- Update a specific analysis body
UPDATE analysis
SET 
  body = '{"segments": [...], "transcript": "..."}',  -- JSON string
  encoding = 'json'
WHERE vcon_id = (SELECT id FROM vcons WHERE uuid = '<vcon-uuid>')
  AND analysis_index = 0;  -- The specific analysis index
```

#### Option C: Re-load the vCons

Delete the problematic vCons and re-load them using the fixed script:

```bash
# Delete the vCon (this will cascade delete all related data)
# Do this carefully!

# Then re-load with the fixed script
npx tsx scripts/load-legacy-vcons.ts /path/to/vcons
```

### 3. Verify the Fix

Check that attachments and analysis now have proper bodies:

```sql
-- Check attachments
SELECT 
  v.uuid,
  a.attachment_index,
  a.type,
  a.body IS NULL as body_is_null,
  a.encoding,
  length(a.body) as body_length
FROM vcons v
JOIN attachments a ON a.vcon_id = v.id
WHERE v.uuid = '<your-vcon-uuid>'
ORDER BY a.attachment_index;

-- Check analysis
SELECT 
  v.uuid,
  an.analysis_index,
  an.type,
  an.body IS NULL as body_is_null,
  an.encoding,
  length(an.body) as body_length
FROM vcons v
JOIN analysis an ON an.vcon_id = v.id
WHERE v.uuid = '<your-vcon-uuid>'
ORDER BY an.analysis_index;
```

## For the Specific vCon: 019a9e8f-8558-83e9-9dd8-dd37220d739c

Your vCon has **6 attachments** with object/array bodies:

1. **strolid_dialer_payloads** - Array of objects
2. **ingress_info** - Object with source
3. **tags** - Array of strings
4. **tenant** - Object with id
5. **strolid_dealer** - Object with dealer info
6. **strolid_lead** - Object with lead info

And **1 analysis** with object body:

1. **transcript** (index 0) - Object with segments, paragraphs, transcript, detected_language

All of these need their `body` fields serialized to JSON strings.

### Quick Fix for This vCon

```bash
# Using the automated script (requires S3 access)
npx tsx scripts/fix-attachment-bodies.ts 019a9e8f-8558-83e9-9dd8-dd37220d739c

# Or if you have the original JSON file
# Just re-load it with the fixed script:
npx tsx scripts/load-legacy-vcons.ts /path/to/vcon/file
```

## Prevention

Going forward, all new vCons loaded with `load-legacy-vcons.ts` will automatically have their attachment and analysis bodies properly serialized. The fix has been applied to:
- `scripts/load-legacy-vcons.ts` (migrateVCon function)
  - Lines 257-276: Attachment body serialization
  - Lines 278-295: Dialog body serialization  
  - Lines 297-315: Analysis body serialization

## Technical Details

### Database Schema
Both `attachments.body` and `analysis.body` columns are defined as TEXT:
```sql
-- In attachments table
body TEXT

-- In analysis table  
body TEXT
```

### TypeScript Types
```typescript
export interface Attachment {
  body?: string;  // Must be a string, not object/array
  encoding?: 'base64url' | 'json' | 'none';
}

export interface Analysis {
  body?: string;  // Must be a string, not object/array
  encoding?: 'base64url' | 'json' | 'none';
}
```

### Proper Encoding Values
- `encoding: 'json'` - Body contains JSON string
- `encoding: 'none'` - Body contains plain text string
- `encoding: 'base64url'` - Body contains base64url-encoded string

When storing objects/arrays, use:
```typescript
{
  body: JSON.stringify(myObject),
  encoding: 'json'
}
```

## Summary Table

| Component | Affected? | Database Column Type | Fix Applied? |
|-----------|-----------|---------------------|--------------|
| Attachments | ✅ Yes | TEXT | ✅ Yes |
| Analysis | ✅ Yes | TEXT | ✅ Yes |
| Dialog | ⚠️ Potential | TEXT | ✅ Yes (preventive) |
| Parties.jcard | ❌ No | JSONB | N/A (native support) |
| Parties.civicaddress | ❌ No | JSONB | N/A (native support) |

## See Also
- vCon IETF Spec Section 4.4 (Attachment Object)
- vCon IETF Spec Section 4.5 (Analysis Object)
- `src/types/vcon.ts` - TypeScript type definitions
- `supabase/migrations/20251007184415_initial_vcon_schema.sql` - Database schema
- `scripts/load-legacy-vcons.ts` - Loader script with fix
- `scripts/fix-attachment-bodies.ts` - Repair script

