# vCon Attachment & Analysis Body Repair Summary

## Date: November 20, 2024

## Problem Identified

When loading vCons with the `load-legacy-vcons.ts` script, attachments and analysis with object/array bodies were not properly serialized to JSON strings before database insertion. This caused NULL bodies in PostgreSQL TEXT columns.

## Solution Applied

1. **Fixed the loader script** (`load-legacy-vcons.ts`)
   - Now properly serializes attachment, analysis, and dialog bodies
   - Converts objects/arrays to JSON strings
   - Sets encoding to 'json' appropriately

2. **Created repair scripts**
   - `fix-attachment-bodies.ts` - Single vCon or manual list repair
   - `fix-all-vcons-incremental.ts` - Batch processing by date range

## Repair Results

### Remote Database (https://ijuooeoejxyjmoxrwgzg.supabase.co)

**Batch 1 (Last 7 days, 50 vCons):**
- vCons processed: 50
- Attachments fixed: 287
- Analysis fixed: 31
- Errors: 0

**Batch 2 (Last 30 days, 100 vCons):**
- vCons processed: 100
- Attachments fixed: 577
- Analysis fixed: 69
- Errors: 0

**Batch 3 (Last 30 days, 200 vCons):**
- vCons processed: 200
- Attachments fixed: 1,148
- Analysis fixed: 131
- Errors: 0

**Remote Total:**
- ✅ 200 vCons repaired (last 30 days)
- ✅ 1,148 attachments fixed
- ✅ 131 analysis fixed
- ❌ 0 errors

### Local Database (http://127.0.0.1:54321)

**Batch (Last 30 days, 100 vCons):**
- vCons processed: 100
- Attachments fixed: 564
- Analysis fixed: 73
- Errors: 0

**Local Total:**
- ✅ 100 vCons repaired
- ✅ 564 attachments fixed
- ✅ 73 analysis fixed
- ❌ 0 errors

## Grand Total

- **300 vCons successfully repaired**
- **1,712 attachments fixed**
- **204 analysis records fixed**
- **0 errors**

## What Was Fixed

### Attachments
All attachments with object/array bodies were serialized to JSON strings:
- `strolid_dialer_payloads` - Array of call metadata objects
- `ingress_info` - Source tracking objects
- `tags` - Arrays of tag strings
- `tenant` - Tenant ID objects
- `strolid_dealer` - Dealer information objects
- `strolid_lead` - Lead data objects

### Analysis
Analysis records with complex object bodies were serialized:
- `transcript` - Object with segments, paragraphs, full transcript
- Other analysis types as needed

## Prevention

All future vCons loaded with the updated `load-legacy-vcons.ts` will automatically have proper serialization. The fix is now part of the codebase.

## Scripts for Future Use

### Fix Specific vCons
```bash
npx tsx scripts/fix-attachment-bodies.ts <uuid1> <uuid2> ...
```

### Fix Recent vCons (Recommended)
```bash
# Last 7 days, 50 vCons
npx tsx scripts/fix-all-vcons-incremental.ts 7 50

# Last 30 days, 100 vCons
npx tsx scripts/fix-all-vcons-incremental.ts 30 100
```

### Environment Variables Required
```bash
# For remote database
SUPABASE_URL="https://ijuooeoejxyjmoxrwgzg.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="<key>"

# For S3 access (to download originals)
VCON_S3_BUCKET="vcons"
AWS_REGION="us-east-1"
```

## Database Status

### ✅ Remote Database
- **Status**: Repaired
- **Coverage**: Last 30 days (200 most recent vCons)
- **Attachments Fixed**: 1,148
- **Analysis Fixed**: 131
- **Next Action**: Run additional batches if older vCons need repair

### ✅ Local Database
- **Status**: Repaired  
- **Coverage**: Last 30 days (100 most recent vCons)
- **Next Action**: Run additional batches if older vCons need repair

## To Fix Older vCons

If you need to fix vCons older than 30 days, run additional batches:

```bash
# Remote: Last 60 days, 100 vCons
SUPABASE_URL="$REMOTE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$REMOTE_KEY" \
VCON_S3_BUCKET=vcons \
npx tsx scripts/fix-all-vcons-incremental.ts 60 100

# Local: Last 60 days, 100 vCons
VCON_S3_BUCKET=vcons \
npx tsx scripts/fix-all-vcons-incremental.ts 60 100
```

## Verification

You can verify the fixes worked by querying any repaired vCon:

```sql
-- Check attachments now have bodies
SELECT 
  attachment_index,
  type,
  length(body) as body_length,
  encoding
FROM attachments
WHERE vcon_id = (SELECT id FROM vcons WHERE uuid = '<uuid>')
ORDER BY attachment_index;

-- Check analysis now have bodies
SELECT 
  analysis_index,
  type,
  length(body) as body_length,
  encoding
FROM analysis
WHERE vcon_id = (SELECT id FROM vcons WHERE uuid = '<uuid>')
ORDER BY analysis_index;
```

All bodies should now have content (body_length > 0) and proper encoding ('json' for objects/arrays).

## Documentation

See `ATTACHMENT_BODY_FIX.md` for technical details and `BODY_SERIALIZATION_COVERAGE.md` for component coverage details.

