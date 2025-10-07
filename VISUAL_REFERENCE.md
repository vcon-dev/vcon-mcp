# Visual Corrections Reference

## 🎨 Before & After Comparisons

---

## 1️⃣ Analysis Object - The Most Critical Corrections

### ❌ BEFORE (Non-Compliant)

```typescript
interface Analysis {
  type: string;
  dialog?: number;
  vendor?: string;              // ⚠️ Optional - WRONG
  schema_version?: string;      // ⚠️ Wrong field name
  body: {                       // ⚠️ Object type - WRONG
    [key: string]: any;
  };
}
```

```sql
CREATE TABLE analysis (
    ...
    vendor TEXT,                  -- ⚠️ Nullable - WRONG
    schema_version TEXT,          -- ⚠️ Wrong field name
    body JSONB NOT NULL,          -- ⚠️ JSONB - WRONG
    encoding TEXT DEFAULT 'json'  -- ⚠️ Has default - WRONG
);
```

### ✅ AFTER (Spec-Compliant)

```typescript
interface Analysis {
  type: string;
  dialog?: number | number[];   // ✓ Array support added
  vendor: string;               // ✓ REQUIRED
  schema?: string;              // ✓ Correct field name
  body?: string;                // ✓ String type - supports all formats
  encoding?: 'base64url' | 'json' | 'none';
}
```

```sql
CREATE TABLE analysis (
    ...
    vendor TEXT NOT NULL,         -- ✓ Required
    schema TEXT,                  -- ✓ Correct field name
    body TEXT,                    -- ✓ TEXT type
    encoding TEXT CHECK (         -- ✓ No default, has constraint
        encoding IS NULL OR 
        encoding IN ('base64url', 'json', 'none')
    ),
    dialog_indices INTEGER[]      -- ✓ Added for multi-dialog reference
);
```

**What This Means:**
- ✅ Can store CSV analysis: `body: "col1,col2\nval1,val2"`
- ✅ Can store XML analysis: `body: "<root>...</root>"`
- ✅ Can store plain text: `body: "Summary text..."`
- ✅ Vendor tracking is enforced
- ✅ Consistent with other vCon implementations

---

## 2️⃣ Party Object - Missing Fields

### ❌ BEFORE

```typescript
interface Party {
  tel?: string;
  mailto?: string;
  name?: string;
  // Missing uuid field
  // Missing did field
}
```

```sql
CREATE TABLE parties (
    ...
    name TEXT,
    tel TEXT,
    mailto TEXT
    -- Missing uuid column
    -- Missing did column
);
```

### ✅ AFTER

```typescript
interface Party {
  tel?: string;
  mailto?: string;
  name?: string;
  uuid?: string;      // ✓ Added - for cross-vCon tracking
  did?: string;       // ✓ Added - for decentralized identity
}
```

```sql
CREATE TABLE parties (
    ...
    name TEXT,
    tel TEXT,
    mailto TEXT,
    uuid UUID,          -- ✓ Added
    did TEXT            -- ✓ Added
);

CREATE INDEX idx_parties_uuid ON parties(uuid);
```

---

## 3️⃣ Dialog Object - Missing Fields

### ❌ BEFORE

```typescript
interface Dialog {
  type: string;  // ⚠️ No type constraint
  start?: string;
  parties?: number[];
  body?: string;
  encoding?: string;  // ⚠️ No enum constraint
  // Missing session_id
  // Missing application
  // Missing message_id
}
```

### ✅ AFTER

```typescript
interface Dialog {
  type: 'recording' | 'text' | 'transfer' | 'incomplete';  // ✓ Constrained
  start?: string;
  parties?: number | number[] | (number | number[])[];
  body?: string;
  encoding?: 'base64url' | 'json' | 'none';  // ✓ Enum constraint
  session_id?: string;      // ✓ Added
  application?: string;     // ✓ Added
  message_id?: string;      // ✓ Added
}
```

```sql
CREATE TABLE dialog (
    ...
    type TEXT NOT NULL CHECK (
        type IN ('recording', 'text', 'transfer', 'incomplete')
    ),
    encoding TEXT CHECK (
        encoding IS NULL OR 
        encoding IN ('base64url', 'json', 'none')
    ),
    session_id TEXT,      -- ✓ Added
    application TEXT,     -- ✓ Added
    message_id TEXT       -- ✓ Added
);
```

---

## 4️⃣ VCon Object - Missing Extension Support

### ❌ BEFORE

```typescript
interface VCon {
  vcon: '0.0.2';  // ⚠️ Old version
  uuid: string;
  created_at: string;
  parties: Party[];
  // Missing extensions array
  // Missing must_support array
}
```

### ✅ AFTER

```typescript
interface VCon {
  vcon: '0.3.0';              // ✓ Current version
  uuid: string;
  extensions?: string[];      // ✓ Added
  must_support?: string[];    // ✓ Added
  created_at: string;
  parties: Party[];
}
```

---

## 📊 Side-by-Side Field Name Changes

| Object | Old Field | New Field | Required? | Type Change |
|--------|-----------|-----------|-----------|-------------|
| Analysis | `schema_version` | `schema` | No | - |
| Analysis | `vendor?` | `vendor` | **YES** | - |
| Analysis | `body: object` | `body?: string` | No | **YES** |
| Party | - | `uuid` | No | New field |
| Party | - | `did` | No | New field |
| Dialog | - | `session_id` | No | New field |
| Dialog | - | `application` | No | New field |
| Dialog | - | `message_id` | No | New field |
| VCon | - | `extensions` | No | New field |
| VCon | - | `must_support` | No | New field |

---

## 🎯 Critical Changes Summary

### High Impact Changes (Breaking)

```diff
  interface Analysis {
    type: string;
-   vendor?: string;
+   vendor: string;              // Now REQUIRED

-   schema_version?: string;
+   schema?: string;              // Renamed

-   body: object;
+   body?: string;                // Type changed
  }
```

### Database Migration Impact

```sql
-- BEFORE: These queries would work
SELECT * FROM analysis WHERE schema_version = 'v1.0';
INSERT INTO analysis (type, body) VALUES ('test', '{}');

-- AFTER: These queries are correct
SELECT * FROM analysis WHERE schema = 'v1.0';
INSERT INTO analysis (type, vendor, body) VALUES ('test', 'VendorName', 'content');
```

---

## 🔄 Migration Path Visualization

```
┌─────────────────────────────┐
│   Old Implementation        │
│                             │
│  - schema_version           │
│  - vendor optional          │
│  - body as JSONB            │
│  - missing fields           │
└──────────┬──────────────────┘
           │
           │ Apply Corrections
           │
           ▼
┌─────────────────────────────┐
│  Migration Steps            │
│                             │
│  1. Rename columns          │
│  2. Change types            │
│  3. Add constraints         │
│  4. Add missing fields      │
└──────────┬──────────────────┘
           │
           │ Verify
           │
           ▼
┌─────────────────────────────┐
│  Spec-Compliant             │
│  Implementation             │
│                             │
│  - schema                   │
│  - vendor required          │
│  - body as TEXT             │
│  - all fields present       │
└─────────────────────────────┘
```

---

## 🧪 Test Data Examples

### ❌ BEFORE - Would Create Invalid vCon

```json
{
  "vcon": "0.0.2",
  "uuid": "...",
  "parties": [{"name": "Alice"}],
  "analysis": [{
    "type": "sentiment",
    "schema_version": "1.0",
    "body": {"sentiment": "positive"}
  }]
}
```

**Issues:**
- ❌ Missing required `vendor` field
- ❌ Wrong field name `schema_version`
- ❌ Body is object, should be string

### ✅ AFTER - Creates Valid vCon

```json
{
  "vcon": "0.3.0",
  "uuid": "...",
  "parties": [{
    "name": "Alice",
    "uuid": "..."
  }],
  "analysis": [{
    "type": "sentiment",
    "vendor": "SentimentCorp",
    "schema": "1.0",
    "body": "{\"sentiment\": \"positive\"}",
    "encoding": "json"
  }]
}
```

**Correct:**
- ✅ Has required `vendor` field
- ✅ Uses correct field name `schema`
- ✅ Body is string (JSON serialized)

---

## 📝 Code Pattern Changes

### Pattern: Creating Analysis

#### ❌ BEFORE

```typescript
const analysis = {
  type: 'transcript',
  schema_version: '1.0',
  body: {
    text: 'Hello world',
    confidence: 0.95
  }
};

await db.insert('analysis', analysis);
```

#### ✅ AFTER

```typescript
const analysis: Analysis = {
  type: 'transcript',
  vendor: 'TranscriptCorp',      // Required!
  schema: '1.0',                 // Correct field name
  body: JSON.stringify({         // String type
    text: 'Hello world',
    confidence: 0.95
  }),
  encoding: 'json'
};

await db.insert('analysis', analysis);
```

---

### Pattern: Querying Analysis

#### ❌ BEFORE

```typescript
const results = await db.query(
  'SELECT * FROM analysis WHERE schema_version = $1',
  ['1.0']
);
```

#### ✅ AFTER

```typescript
const results = await db.query(
  'SELECT * FROM analysis WHERE schema = $1 AND vendor = $2',
  ['1.0', 'VendorName']
);
```

---

### Pattern: Type Definitions

#### ❌ BEFORE

```typescript
// Would allow invalid data
function addAnalysis(data: {
  type: string;
  schema_version?: string;
  body?: any;
}) {
  // ...
}
```

#### ✅ AFTER

```typescript
// Enforces spec compliance
function addAnalysis(data: Analysis) {
  if (!data.vendor) {
    throw new Error('vendor is required');
  }
  if (data.body && !data.encoding) {
    throw new Error('encoding required when body is provided');
  }
  // ...
}
```

---

## 🎨 Visual Field Mapping

```
Analysis Object Field Mapping
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Old Schema              New Schema
──────────             ──────────

type                →  type
dialog              →  dialog (now supports arrays)
vendor [optional]   →  vendor [REQUIRED] ⚠️
schema_version      →  schema ⚠️
product             →  product
body [object]       →  body [string] ⚠️
encoding            →  encoding (no default) ⚠️
url                 →  url
                    →  dialog_indices [NEW] ⚠️
```

---

## 🚨 Error Message Translation

### Before → After

```
Old Error:
"column 'schema_version' does not exist"
→ Change all 'schema_version' to 'schema'

Old Error:
"null value in column 'body' violates not-null constraint"
→ body is now optional, check encoding is provided

New Error:
"null value in column 'vendor' violates not-null constraint"
→ vendor is now required, must always be provided
```

---

## ✅ Verification Checklist

Use this visual checklist after migration:

```
Analysis Object:
  ☐ Field named 'schema' (not 'schema_version')
  ☐ vendor is required (not optional)
  ☐ body is string type (not object/JSONB)
  ☐ encoding has no default value
  ☐ dialog supports arrays

Party Object:
  ☐ Has uuid field
  ☐ Has did field

Dialog Object:
  ☐ type is constrained to 4 values
  ☐ Has session_id field
  ☐ Has application field
  ☐ Has message_id field
  ☐ encoding has no default value

VCon Object:
  ☐ Has extensions array
  ☐ Has must_support array
  ☐ Version is '0.3.0'

Database:
  ☐ analysis.schema column exists
  ☐ analysis.vendor is NOT NULL
  ☐ analysis.body is TEXT
  ☐ No defaults on encoding columns
  ☐ Type constraints exist
```

---

## 🎯 Quick Decision Tree

```
┌─────────────────────────────┐
│ Need to store analysis?     │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Do you have vendor name?    │
└────┬───────────┬────────────┘
     NO          YES
     │            │
     ▼            ▼
┌─────────┐  ┌──────────────┐
│ ERROR!  │  │ What format  │
│ vendor  │  │ is the body? │
│ required│  └──┬───────────┘
└─────────┘     │
                ├── JSON → use encoding: 'json'
                ├── CSV  → use encoding: 'none'
                └── Binary → use encoding: 'base64url'
```

---

*This visual guide complements the detailed documentation in other files.*
*For implementation details, see CLAUDE_CODE_INSTRUCTIONS.md*
