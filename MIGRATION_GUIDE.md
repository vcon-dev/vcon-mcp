# Migration Guide: Fixing Existing Code

## Overview

This guide helps you migrate existing vCon implementation code to be spec-compliant. Use the search-and-replace patterns below to quickly fix common issues.

---

## 🔧 Search and Replace Patterns

### Pattern 1: Fix schema_version → schema

**TypeScript/JavaScript Files:**

```bash
# Search for
schema_version

# Replace with
schema
```

**Files to update:**
- `src/types/vcon.ts`
- `src/tools/*.ts`
- `src/db/queries.ts`
- Any interface definitions
- Any object literals

**Example changes:**

```typescript
// Before
interface Analysis {
  schema_version?: string;
}

// After
interface Analysis {
  schema?: string;
}

// Before
const analysis = {
  type: 'test',
  schema_version: '1.0'
};

// After
const analysis = {
  type: 'test',
  schema: '1.0'
};
```

---

### Pattern 2: Make vendor required

**Find optional vendor:**
```typescript
// Search for
vendor?: string

// Replace with
vendor: string
```

**Update tool schemas:**
```typescript
// Before
properties: {
  vendor: { type: 'string' }
}

// After
properties: {
  vendor: { type: 'string' }
},
required: ['type', 'vendor']  // Add vendor to required array
```

---

### Pattern 3: Fix body type

**TypeScript files:**
```typescript
// Search for
body: object
// OR
body: any
// OR
body: JSONB

// Replace with
body?: string
```

**Database queries:**
```sql
-- Search for
body JSONB

-- Replace with
body TEXT
```

---

### Pattern 4: Add missing Party fields

**TypeScript interfaces:**
```typescript
// Search for
interface Party {
  tel?: string;
  sip?: string;
  mailto?: string;
  name?: string;
  // ... existing fields

// Replace with (add these fields)
interface Party {
  tel?: string;
  sip?: string;
  mailto?: string;
  name?: string;
  did?: string;          // ADD THIS
  uuid?: string;         // ADD THIS
  // ... existing fields
```

**Database schema:**
```sql
-- Add these columns if missing
ALTER TABLE parties ADD COLUMN IF NOT EXISTS did TEXT;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS uuid UUID;
```

---

### Pattern 5: Add missing Dialog fields

**TypeScript interfaces:**
```typescript
// Add to Dialog interface if missing
interface Dialog {
  // ... existing fields
  session_id?: string;     // ADD
  application?: string;    // ADD
  message_id?: string;     // ADD
  // ... existing fields
}
```

**Database schema:**
```sql
-- Add these columns if missing
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS application TEXT;
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS message_id TEXT;
```

---

### Pattern 6: Remove encoding defaults

**Database schema:**
```sql
-- Search for
encoding TEXT DEFAULT 'json'
encoding TEXT DEFAULT 'none'

-- Replace with
encoding TEXT CHECK (encoding IS NULL OR encoding IN ('base64url', 'json', 'none'))
```

**Migration SQL:**
```sql
ALTER TABLE analysis ALTER COLUMN encoding DROP DEFAULT;
ALTER TABLE dialog ALTER COLUMN encoding DROP DEFAULT;
ALTER TABLE attachments ALTER COLUMN encoding DROP DEFAULT;
```

---

### Pattern 7: Add dialog_indices to Analysis

**TypeScript interface:**
```typescript
// Add to Analysis interface
interface Analysis {
  type: string;
  dialog?: number | number[];  // ADD THIS if missing
  // ... other fields
}
```

**Database:**
```sql
-- Add column if missing
ALTER TABLE analysis ADD COLUMN IF NOT EXISTS dialog_indices INTEGER[];
```

---

## 🔄 Complete Migration Script

Run this bash script to automatically fix most issues:

```bash
#!/bin/bash
# fix-vcon-compliance.sh

echo "🔧 Fixing vCon Spec Compliance Issues..."

# Fix schema_version → schema in TypeScript/JavaScript
echo "📝 Fixing schema_version → schema..."
find src -type f \( -name "*.ts" -o -name "*.js" \) -exec sed -i '' 's/schema_version/schema/g' {} +

# Fix optional vendor in interfaces
echo "📝 Making vendor required..."
find src/types -type f -name "*.ts" -exec sed -i '' 's/vendor?: string/vendor: string/g' {} +

# Fix body type
echo "📝 Fixing body type..."
find src/types -type f -name "*.ts" -exec sed -i '' 's/body: object/body?: string/g' {} +
find src/types -type f -name "*.ts" -exec sed -i '' 's/body: any/body?: string/g' {} +

# Add TODO comments for manual fixes
echo "📝 Adding TODO comments for manual review..."
find src -type f \( -name "*.ts" -o -name "*.js" \) -exec sed -i '' 's/interface Party {/interface Party {\n  \/\/ TODO: Add uuid?: string; and did?: string; if missing/g' {} +
find src -type f \( -name "*.ts" -o -name "*.js" \) -exec sed -i '' 's/interface Dialog {/interface Dialog {\n  \/\/ TODO: Add session_id?: string; application?: string; message_id?: string; if missing/g' {} +

echo "✅ Automated fixes complete!"
echo ""
echo "⚠️  Manual review required for:"
echo "  1. Check all TODO comments added"
echo "  2. Update tool schemas to require vendor"
echo "  3. Update database schema (run migration SQL)"
echo "  4. Add missing interface fields"
echo ""
echo "📋 Run verification:"
echo "  npm run test:compliance"
```

**Make it executable:**
```bash
chmod +x fix-vcon-compliance.sh
./fix-vcon-compliance.sh
```

---

## 📊 Database Migration

Complete database migration in order:

```sql
-- Step 1: Rename columns
BEGIN;

ALTER TABLE analysis RENAME COLUMN schema_version TO schema;

COMMIT;

-- Step 2: Add missing columns
BEGIN;

-- Add to parties
ALTER TABLE parties ADD COLUMN IF NOT EXISTS did TEXT;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS uuid UUID;

-- Add to dialog  
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS application TEXT;
ALTER TABLE dialog ADD COLUMN IF NOT EXISTS message_id TEXT;

-- Add to analysis
ALTER TABLE analysis ADD COLUMN IF NOT EXISTS dialog_indices INTEGER[];

-- Add to vcons
ALTER TABLE vcons ADD COLUMN IF NOT EXISTS extensions TEXT[];
ALTER TABLE vcons ADD COLUMN IF NOT EXISTS must_support TEXT[];

COMMIT;

-- Step 3: Fix body type
BEGIN;

ALTER TABLE analysis ADD COLUMN body_new TEXT;
UPDATE analysis SET body_new = body::text WHERE body IS NOT NULL;
ALTER TABLE analysis DROP COLUMN body;
ALTER TABLE analysis RENAME COLUMN body_new TO body;

COMMIT;

-- Step 4: Make vendor required
BEGIN;

-- Set default for existing nulls
UPDATE analysis SET vendor = 'unknown' WHERE vendor IS NULL OR vendor = '';

-- Make required
ALTER TABLE analysis ALTER COLUMN vendor SET NOT NULL;

COMMIT;

-- Step 5: Remove defaults and add constraints
BEGIN;

-- Remove defaults
ALTER TABLE analysis ALTER COLUMN encoding DROP DEFAULT;
ALTER TABLE dialog ALTER COLUMN encoding DROP DEFAULT;
ALTER TABLE attachments ALTER COLUMN encoding DROP DEFAULT;

-- Add constraints
ALTER TABLE dialog ADD CONSTRAINT dialog_type_check 
  CHECK (type IN ('recording', 'text', 'transfer', 'incomplete'));

ALTER TABLE dialog ADD CONSTRAINT dialog_encoding_check 
  CHECK (encoding IS NULL OR encoding IN ('base64url', 'json', 'none'));

ALTER TABLE attachments ADD CONSTRAINT attachments_encoding_check 
  CHECK (encoding IS NULL OR encoding IN ('base64url', 'json', 'none'));

ALTER TABLE analysis ADD CONSTRAINT analysis_encoding_check 
  CHECK (encoding IS NULL OR encoding IN ('base64url', 'json', 'none'));

COMMIT;

-- Step 6: Create indexes
BEGIN;

CREATE INDEX IF NOT EXISTS idx_parties_uuid ON parties(uuid) WHERE uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dialog_session ON dialog(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analysis_dialog ON analysis USING GIN (dialog_indices);

COMMIT;
```

**Verification queries:**

```sql
-- Verify schema column renamed
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'analysis' AND column_name = 'schema';
-- Should return 1 row

-- Verify no schema_version
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'analysis' AND column_name = 'schema_version';
-- Should return 0 rows

-- Verify vendor is required
SELECT is_nullable FROM information_schema.columns 
WHERE table_name = 'analysis' AND column_name = 'vendor';
-- Should return 'NO'

-- Verify body is TEXT
SELECT data_type FROM information_schema.columns 
WHERE table_name = 'analysis' AND column_name = 'body';
-- Should return 'text'

-- Verify no defaults on encoding
SELECT column_default FROM information_schema.columns 
WHERE table_name = 'analysis' AND column_name = 'encoding';
-- Should return NULL

-- Verify constraints exist
SELECT constraint_name FROM information_schema.table_constraints 
WHERE table_name = 'dialog' AND constraint_name = 'dialog_type_check';
-- Should return 1 row
```

---

## 🧪 Testing After Migration

### 1. TypeScript Compilation

```bash
# Should compile without errors
npm run build

# If errors, check:
# - All schema_version changed to schema
# - All vendor fields not optional in Analysis type
# - All body fields are string type
```

### 2. Compliance Tests

```bash
# Run compliance tests
npm run test:compliance

# All tests should pass
# If failures, check error messages for specific issues
```

### 3. Database Verification

```bash
# Run verification queries from CORRECTED_SCHEMA.md
psql -d your_database -f verify-schema.sql

# All queries should return expected results
```

### 4. Manual Code Review

```bash
# Search for any remaining issues

# 1. Check for schema_version
grep -r "schema_version" src/
# Should return 0 results

# 2. Check for optional vendor in Analysis
grep -A5 "interface Analysis" src/types/vcon.ts | grep "vendor?"
# Should return 0 results

# 3. Check for object/any body types
grep -A20 "interface Analysis" src/types/vcon.ts | grep "body.*object\|body.*any"
# Should return 0 results

# 4. Check database queries use correct fields
grep -r "schema_version" src/db/
# Should return 0 results
```

---

## 📝 Manual Review Checklist

After running automated fixes:

### TypeScript Types (`src/types/vcon.ts`)
- [ ] `schema` not `schema_version` in Analysis
- [ ] `vendor: string` (required) in Analysis
- [ ] `body?: string` in Analysis
- [ ] `uuid?: string` in Party
- [ ] `did?: string` in Party
- [ ] `session_id?: string` in Dialog
- [ ] `application?: string` in Dialog
- [ ] `message_id?: string` in Dialog
- [ ] `extensions?: string[]` in VCon
- [ ] `must_support?: string[]` in VCon

### Tool Definitions (`src/tools/*.ts`)
- [ ] All tools use `schema` not `schema_version`
- [ ] addAnalysisTool requires vendor field
- [ ] Tool schemas use correct types

### Database Queries (`src/db/queries.ts`)
- [ ] All queries use `schema` column name
- [ ] All INSERT for analysis include vendor
- [ ] All SELECT retrieve new fields

### Database Schema
- [ ] Run migration SQL successfully
- [ ] All verification queries pass
- [ ] Constraints are in place

---

## 🚨 Rollback Plan

If migration fails:

```sql
-- Create backup before migration
pg_dump your_database > backup_before_vcon_migration.sql

-- If needed, restore
psql your_database < backup_before_vcon_migration.sql

-- For code, use git
git checkout HEAD -- .
```

---

## 📞 Support

If you encounter issues:

1. Check `IMPLEMENTATION_CORRECTIONS.md` for detailed explanations
2. Review `CLAUDE_CODE_INSTRUCTIONS.md` for correct implementations
3. Consult IETF spec: `background_docs/draft-ietf-vcon-vcon-core-00.txt`
4. Run compliance tests to identify specific failures

---

*Last Updated: 2025-10-07*  
*For use with: draft-ietf-vcon-vcon-core-00*
