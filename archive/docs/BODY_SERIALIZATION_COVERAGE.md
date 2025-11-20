# Body Serialization Coverage Summary

## Overview

This document clarifies which vCon components are affected by the body serialization issue and what fixes have been applied.

## The Issue

PostgreSQL TEXT columns cannot store JavaScript objects/arrays directly. When the `load-legacy-vcons.ts` script tried to insert objects/arrays into TEXT columns, they were stored as NULL.

## Component-by-Component Analysis

### ✅ Attachments - FIXED

**Status**: Issue found and fixed

**Database Schema**:
```sql
CREATE TABLE attachments (
  body TEXT,  -- Cannot store objects
  ...
)
```

**Issue**: All 6 attachments in your vCon have object/array bodies that were stored as NULL.

**Fixes Applied**:
- ✅ Loader script (`load-legacy-vcons.ts`): Serializes attachment bodies
- ✅ Repair script (`fix-attachment-bodies.ts`): Fixes existing NULL bodies

### ✅ Analysis - FIXED

**Status**: Issue found and fixed

**Database Schema**:
```sql
CREATE TABLE analysis (
  body TEXT,  -- Cannot store objects
  ...
)
```

**Issue**: Your first analysis (transcript) has an object body with segments, paragraphs, etc.

**Fixes Applied**:
- ✅ Loader script (`load-legacy-vcons.ts`): Serializes analysis bodies
- ✅ Repair script (`fix-attachment-bodies.ts`): Fixes existing NULL bodies

### ⚠️ Dialog - PREVENTIVE FIX ONLY

**Status**: Preventive fix applied, but repair script not updated

**Database Schema**:
```sql
CREATE TABLE dialog (
  body TEXT,  -- Cannot store objects
  ...
)
```

**Your vCon**: Dialog uses `url` field, not `body`, so no issue for you.

**Fixes Applied**:
- ✅ Loader script (`load-legacy-vcons.ts`): Serializes dialog bodies (preventive)
- ❌ Repair script: NOT included (add if needed)

**When you might have dialog bodies**:
- Text messages with inline content
- Incomplete recordings with metadata
- Transfer dialogs with structured data

### ✅ Parties - NO ISSUE

**Status**: No issue, uses JSONB

**Database Schema**:
```sql
CREATE TABLE parties (
  jcard JSONB,        -- Native object support
  civicaddress JSONB, -- Native object support
  tel TEXT,           -- Simple string
  name TEXT,          -- Simple string
  ...
)
```

**Why no issue**: JSONB columns handle objects natively, no serialization needed.

## Summary Table

| Component | Body Column Type | Object Bodies? | Loader Fixed? | Repair Script? | Your vCon Affected? |
|-----------|-----------------|----------------|---------------|----------------|---------------------|
| Attachments | TEXT | ✅ Common | ✅ Yes | ✅ Yes | ✅ Yes (6 items) |
| Analysis | TEXT | ✅ Common | ✅ Yes | ✅ Yes | ✅ Yes (1 item) |
| Dialog | TEXT | ⚠️ Sometimes | ✅ Yes | ❌ No | ❌ No (uses URL) |
| Parties.jcard | JSONB | N/A | N/A | N/A | N/A (native) |
| Parties.civicaddress | JSONB | N/A | N/A | N/A | N/A (native) |

## What's Fixed for Your vCon

For vCon `019a9e8f-8558-83e9-9dd8-dd37220d739c`:

### Affected Items (Need Repair)
- ✅ 6 attachments with object/array bodies
- ✅ 1 analysis with object body (transcript)
- ❌ 0 dialog bodies (uses URL instead)
- ❌ 0 party issues (uses JSONB)

### How to Fix
```bash
# This will fix your 6 attachments + 1 analysis
npx tsx scripts/fix-attachment-bodies.ts 019a9e8f-8558-83e9-9dd8-dd37220d739c
```

## Do I Need to Add Dialog to the Repair Script?

**Probably not**, unless you have vCons where:
1. Dialog has a `body` field (not just `url`)
2. The `body` contains an object or array

You can check if you have any dialog with NULL bodies:

```sql
-- Check for NULL dialog bodies
SELECT 
  COUNT(*) as dialogs_with_null_body
FROM dialog
WHERE body IS NULL;

-- If count > 0, check if they should have content
SELECT 
  v.uuid,
  d.dialog_index,
  d.type,
  d.body,
  d.url
FROM vcons v
JOIN dialog d ON d.vcon_id = v.id
WHERE d.body IS NULL
LIMIT 10;
```

If you find dialogs that should have body content but it's NULL, let me know and I'll add dialog support to the repair script.

## Prevention

All future vCons loaded with the updated `load-legacy-vcons.ts` script will automatically have:
- ✅ Attachment bodies serialized correctly
- ✅ Analysis bodies serialized correctly  
- ✅ Dialog bodies serialized correctly (if they exist)

## Technical Reference

### What Gets Serialized

Any `body` field that is:
- An object: `{key: "value"}`
- An array: `["item1", "item2"]` or `[{obj1}, {obj2}]`

Gets converted to:
- JSON string: `'{"key":"value"}'` or `'["item1","item2"]'`
- Encoding set to: `'json'`

### Code Location

**Loader Script**: `scripts/load-legacy-vcons.ts`
- Lines 257-276: Attachment serialization
- Lines 278-295: Dialog serialization
- Lines 297-315: Analysis serialization

**Repair Script**: `scripts/fix-attachment-bodies.ts`
- Handles: Attachments, Analysis
- Does NOT handle: Dialog (add if needed)

## Need Help?

If you find other components with NULL bodies, check:
1. Is the database column TEXT? (issue) or JSONB? (no issue)
2. Should the body contain an object/array?
3. Run the repair script or manually update with JSON strings

