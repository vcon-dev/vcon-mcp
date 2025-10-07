# Quick Reference: Critical Field Corrections

## ⚠️ STOP! Read This Before Implementing

This checklist ensures you use the CORRECT field names per IETF spec.

---

## 🔴 CRITICAL CORRECTIONS

### Analysis Object

```typescript
// ❌ WRONG - DO NOT USE
interface AnalysisWrong {
  schema_version?: string;  // WRONG NAME
  vendor?: string;          // WRONG - NOT OPTIONAL
  body: any;                // WRONG TYPE
}

// ✅ CORRECT - USE THIS
interface Analysis {
  type: string;
  vendor: string;           // REQUIRED ✓
  schema?: string;          // CORRECT NAME ✓
  body?: string;            // CORRECT TYPE ✓
}
```

**Database:**
```sql
-- ❌ WRONG
schema_version TEXT
vendor TEXT  -- nullable
body JSONB

-- ✅ CORRECT
schema TEXT
vendor TEXT NOT NULL
body TEXT
```

---

### Party Object

```typescript
// ❌ MISSING
interface PartyWrong {
  tel?: string;
  name?: string;
  // missing uuid field
}

// ✅ CORRECT
interface Party {
  tel?: string;
  name?: string;
  uuid?: string;  // ADD THIS ✓
}
```

---

### Dialog Object

```typescript
// ❌ MISSING FIELDS
interface DialogWrong {
  type: string;
  start?: string;
  // missing session_id, application, message_id
}

// ✅ CORRECT
interface Dialog {
  type: 'recording' | 'text' | 'transfer' | 'incomplete';
  start?: string;
  session_id?: string;      // ADD THIS ✓
  application?: string;     // ADD THIS ✓
  message_id?: string;      // ADD THIS ✓
}
```

---

### Encoding Fields

```typescript
// ❌ WRONG - Has default
encoding TEXT DEFAULT 'json'

// ✅ CORRECT - No default
encoding TEXT CHECK (encoding IN ('base64url', 'json', 'none'))
```

---

## 📋 Pre-Implementation Checklist

Before writing ANY code:

- [ ] I have read `CLAUDE_CODE_INSTRUCTIONS.md`
- [ ] I have read `IMPLEMENTATION_CORRECTIONS.md`
- [ ] I understand `schema` NOT `schema_version`
- [ ] I understand `vendor` is REQUIRED in analysis
- [ ] I understand `body` must be TEXT/string
- [ ] I understand NO default values for `encoding`

---

## 🔍 Code Review Checklist

Before committing:

### TypeScript Types
- [ ] No references to `schema_version` anywhere
- [ ] Analysis.vendor is not optional (no `?`)
- [ ] Analysis.body is `string` type, not `object` or `any`
- [ ] Party has `uuid?: string` field
- [ ] Dialog has `session_id`, `application`, `message_id` fields
- [ ] VCon has `extensions?: string[]` and `must_support?: string[]`

### Database Schema
- [ ] analysis table has `schema` column (not `schema_version`)
- [ ] analysis.vendor is NOT NULL
- [ ] analysis.body is TEXT (not JSONB)
- [ ] No DEFAULT on encoding columns
- [ ] dialog.type has CHECK constraint
- [ ] parties table has uuid column
- [ ] analysis table has dialog_indices column

### Tool Definitions
- [ ] addAnalysisTool requires `vendor` in schema
- [ ] addAnalysisTool uses `schema` (not `schema_version`)
- [ ] All tool schemas use correct field names

### Queries
- [ ] Database queries reference `schema` not `schema_version`
- [ ] INSERT statements include vendor as required
- [ ] SELECT statements include all new fields

---

## 🚨 Common Mistakes

### Mistake #1: Using schema_version
```typescript
// ❌ WRONG
const analysis = {
  type: 'transcript',
  schema_version: '1.0'  // WRONG FIELD NAME
};

// ✅ CORRECT
const analysis = {
  type: 'transcript',
  schema: '1.0'  // CORRECT
};
```

### Mistake #2: Making vendor optional
```typescript
// ❌ WRONG
interface Analysis {
  vendor?: string;  // WRONG - should be required
}

// ✅ CORRECT
interface Analysis {
  vendor: string;  // REQUIRED - no ?
}
```

### Mistake #3: Using object for body
```typescript
// ❌ WRONG
interface Analysis {
  body?: object;  // WRONG TYPE
}

// ✅ CORRECT
interface Analysis {
  body?: string;  // Can contain JSON, CSV, XML, etc.
}
```

### Mistake #4: Forgetting new fields
```typescript
// ❌ MISSING FIELDS
interface Party {
  name?: string;
  tel?: string;
  // missing uuid, did
}

// ✅ CORRECT
interface Party {
  name?: string;
  tel?: string;
  uuid?: string;
  did?: string;
}
```

---

## 🧪 Quick Test

Run this test to verify compliance:

```typescript
import { Analysis, Party, Dialog, VCon } from './types/vcon';

// This should compile without errors
const analysis: Analysis = {
  type: 'test',
  vendor: 'TestVendor',  // Required field
  schema: '1.0',         // Correct field name
  body: 'any string',    // String type
  encoding: 'none'
};

// This should compile without errors
const party: Party = {
  name: 'Test',
  uuid: '123e4567-e89b-12d3-a456-426614174000'
};

// This should compile without errors
const dialog: Dialog = {
  type: 'recording',
  session_id: 'session-123',
  application: 'TestApp'
};

// This should NOT compile (schema_version doesn't exist)
const wrongAnalysis: Analysis = {
  type: 'test',
  vendor: 'Test',
  schema_version: '1.0'  // TypeScript error!
};

// This should NOT compile (vendor is required)
const wrongAnalysis2: Analysis = {
  type: 'test',
  // vendor: 'Test',  // Missing required field!
  body: 'test'
};
```

---

## 📚 Quick Links

- Full instructions: `CLAUDE_CODE_INSTRUCTIONS.md`
- Detailed corrections: `IMPLEMENTATION_CORRECTIONS.md`
- Database schema: `CORRECTED_SCHEMA.md`
- IETF spec: `background_docs/draft-ietf-vcon-vcon-core-00.txt`

---

## ✅ Final Verification

After implementation, verify:

```bash
# 1. Check TypeScript compilation
npm run build
# Should have NO errors

# 2. Run compliance tests
npm run test:compliance
# Should PASS all tests

# 3. Verify database schema
psql -d your_db -f scripts/verify-schema.sql
# Should return 0 errors

# 4. Search for wrong field names
grep -r "schema_version" src/
# Should return NO results

grep -r "vendor\?" src/types/
# Should return NO results in Analysis type
```

---

## 🆘 If You're Unsure

**STOP and check:**

1. Is this field name in the IETF spec?
2. Is this field marked optional or required in spec?
3. What is the exact type in the spec?

**Then verify against:**
- `CLAUDE_CODE_INSTRUCTIONS.md` - Section matching your task
- `IMPLEMENTATION_CORRECTIONS.md` - List of all corrections
- `draft-ietf-vcon-vcon-core-00.txt` - The authoritative spec

---

*Last Updated: 2025-10-07*  
*Spec Version: draft-ietf-vcon-vcon-core-00*  
*Schema Version: 0.3.0*
