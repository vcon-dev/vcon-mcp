# MCP Server for IETF vCon - Implementation Corrections

## Executive Summary

This document identifies and corrects inconsistencies between the IETF vCon specification (draft-ietf-vcon-vcon-core-00) and the MCP Server implementation specification. These corrections are critical for ensuring compliance with the vCon standard and interoperability with other vCon implementations.

## Critical Inconsistencies Found

### 1. Analysis Object Schema Field Naming

**Issue**: Field name mismatch between spec and implementation

**IETF Specification (Section 4.5.7)**:
```
schema: "String" (optional)
```

**Current Implementation**:
- Database schema uses: `schema_version TEXT`
- Tool definitions use: `schema_version`
- Type definitions use: `schema_version`

**Impact**: 
- Non-compliant vCons will be created
- Interoperability failures with other vCon systems
- Database queries will fail to find analysis by schema

**Correction Required**:
```sql
-- Database Schema Change
ALTER TABLE analysis RENAME COLUMN schema_version TO schema;
```

```typescript
// Tool Definition Correction
interface AddAnalysisTool {
  name: "add_analysis";
  inputSchema: {
    properties: {
      analysis: {
        properties: {
          schema: { type: "string" },  // NOT schema_version
          // ...
        }
      }
    }
  }
}
```

---

### 2. Analysis Vendor Field Requirement

**Issue**: Vendor field optionality differs from specification

**IETF Specification (Section 4.5.5)**:
```
vendor: "String"  (REQUIRED - not optional)
```

**Current Implementation**:
- Database schema: `vendor TEXT` (nullable)
- Tool definitions mark vendor as optional

**Impact**:
- vCons may be created without required vendor information
- Non-compliant with IETF specification

**Correction Required**:
```sql
-- Database Schema Change
ALTER TABLE analysis ALTER COLUMN vendor SET NOT NULL;
```

```typescript
// Tool Definition Correction
interface AddAnalysisTool {
  inputSchema: {
    properties: {
      analysis: {
        properties: {
          vendor: { type: "string" },  // REQUIRED
        },
        required: ["type", "vendor", "body"]  // vendor is required
      }
    }
  }
}
```

---

### 3. Analysis Body Field Data Type

**Issue**: Body field storage type incompatible with specification

**IETF Specification (Section 4.5.8)**:
```
body: "String"
```
The body should be able to store ANY string content, including non-JSON formats.

**Current Implementation**:
```sql
body JSONB NOT NULL DEFAULT '{}'
```

**Impact**:
- Cannot store non-JSON analysis bodies (CSV, plain text, XML, etc.)
- Forces all analysis to be JSON format
- Data loss when storing non-JSON analysis results

**Correction Required**:
```sql
-- Database Schema Change
ALTER TABLE analysis ALTER COLUMN body TYPE TEXT;
ALTER TABLE analysis ALTER COLUMN body DROP DEFAULT;

-- Add a new field to track if body is JSON or needs encoding
ALTER TABLE analysis ADD COLUMN body_format TEXT DEFAULT 'json';
```

**Migration Strategy**:
```sql
-- For existing data
UPDATE analysis 
SET body = body::text,
    body_format = 'json'
WHERE body IS NOT NULL;
```

---

### 4. Encoding Field Default Values

**Issue**: Inconsistent default values for encoding across objects

**IETF Specification (Section 2.3.2)**:
```
encoding: "String"
Must be one of: "base64url", "json", "none"
```

**Current Implementation**:
- Analysis table: `encoding TEXT DEFAULT 'json'`
- Dialog table: `encoding TEXT DEFAULT 'none'`
- Attachments table: `encoding TEXT DEFAULT 'none'`

**Impact**:
- Inconsistent behavior across different object types
- Default assumptions may not match actual content

**Correction Required**:
```sql
-- Remove defaults, require explicit encoding specification
ALTER TABLE analysis ALTER COLUMN encoding DROP DEFAULT;
ALTER TABLE dialog ALTER COLUMN encoding DROP DEFAULT;
ALTER TABLE attachments ALTER COLUMN encoding DROP DEFAULT;

-- Add constraint to ensure valid values
ALTER TABLE analysis ADD CONSTRAINT analysis_encoding_check 
  CHECK (encoding IN ('base64url', 'json', 'none'));
ALTER TABLE dialog ADD CONSTRAINT dialog_encoding_check 
  CHECK (encoding IN ('base64url', 'json', 'none'));
ALTER TABLE attachments ADD CONSTRAINT attachments_encoding_check 
  CHECK (encoding IN ('base64url', 'json', 'none'));
```

---

### 5. Missing Dialog Type Values

**Issue**: Database doesn't enforce valid dialog types

**IETF Specification (Section 4.3.1)**:
```
type: "String"
Must be: "recording", "text", "transfer", or "incomplete"
```

**Current Implementation**:
```sql
type TEXT NOT NULL  -- No constraint
```

**Correction Required**:
```sql
ALTER TABLE dialog ADD CONSTRAINT dialog_type_check 
  CHECK (type IN ('recording', 'text', 'transfer', 'incomplete'));
```

---

### 6. Party UUID vs Data Subject ID

**Issue**: Mixing of party identification fields

**IETF Specification (Section 4.2.12)**:
```
uuid: "String" (optional)
The uuid is a unique identifier for the participant
```

**Current Implementation**:
- parties table has: `data_subject_id TEXT`
- Missing: `uuid` field from Party Object

**Impact**:
- Non-compliant party identification
- Cannot properly track parties across vCons per spec

**Correction Required**:
```sql
-- Add uuid field to parties table
ALTER TABLE parties ADD COLUMN uuid UUID;

-- data_subject_id is custom extension, not in spec
-- Keep for privacy tracking but add proper uuid field
CREATE INDEX idx_parties_uuid ON parties(uuid);
```

---

### 7. Analysis Dialog Reference

**Issue**: Missing proper dialog reference in analysis table

**IETF Specification (Section 4.5.2)**:
```
dialog: "UnsignedInt" | "UnsignedInt[]" (optional)
The index to dialog(s) this analysis was based upon
```

**Current Implementation**:
- No dedicated dialog reference field in analysis table

**Correction Required**:
```sql
-- Add dialog reference field
ALTER TABLE analysis ADD COLUMN dialog_indices INTEGER[];

-- Add index for querying analysis by dialog
CREATE INDEX idx_analysis_dialog ON analysis USING GIN (dialog_indices);
```

---

## Additional Recommendations

### 1. Standardize Parameter Names

The implementation uses both snake_case and camelCase inconsistently. The IETF spec uses snake_case throughout.

**Recommendation**: Use snake_case for all parameter names to match IETF specification.

### 2. Add Type System Validation

**Recommendation**: Implement TypeScript types that exactly match IETF specification:

```typescript
// Exact type from IETF spec
type VConEncoding = 'base64url' | 'json' | 'none';
type DialogType = 'recording' | 'text' | 'transfer' | 'incomplete';

interface AnalysisObject {
  type: string;
  dialog?: number | number[];
  mediatype?: string;
  filename?: string;
  vendor: string;  // REQUIRED
  product?: string;
  schema?: string;  // NOT schema_version
  body?: string;
  encoding?: VConEncoding;
  url?: string;
  content_hash?: string | string[];
}
```

### 3. Separate Extension Fields from Core Fields

The implementation mixes vCon extension fields (like `data_subject_id`, consent tracking) with core vCon fields. These should be clearly separated.

**Recommendation**:
- Keep core vCon fields in main tables
- Create separate extension tables for privacy/consent tracking
- Document which fields are extensions vs. core spec

### 4. Tag Storage and Search

Per `vcon-dev/vcon-lib`, tags are represented as a dedicated attachment rather than a top-level column:

- Attachment with `type="tags"`, `encoding="json"`
- `body` is an array of strings like `"key:value"`

Search should derive tag filters by parsing this attachment (e.g., in SQL using `jsonb_array_elements_text`), or via a `vcon_tags_mv` materialized view with a GIN index on the aggregated JSONB object for performance.

---

## Implementation Priority

### High Priority (Breaking Changes)
1. Fix `schema_version` → `schema` field name
2. Make `vendor` field required in analysis
3. Change `body` from JSONB to TEXT in analysis table
4. Add proper `uuid` field to parties table

### Medium Priority (Data Quality)
5. Remove default values from encoding fields
6. Add dialog type constraints
7. Add dialog reference to analysis table

### Low Priority (Best Practices)
8. Standardize naming conventions
9. Add type system validation
10. Separate extension fields

---

## Migration Script

```sql
-- BEGIN TRANSACTION
BEGIN;

-- 1. Fix schema_version → schema
ALTER TABLE analysis RENAME COLUMN schema_version TO schema;

-- 2. Make vendor required (handle existing nulls first)
UPDATE analysis SET vendor = 'unknown' WHERE vendor IS NULL;
ALTER TABLE analysis ALTER COLUMN vendor SET NOT NULL;

-- 3. Fix body field type
-- First, convert existing JSONB to text
ALTER TABLE analysis ADD COLUMN body_text TEXT;
UPDATE analysis SET body_text = body::text WHERE body IS NOT NULL;
ALTER TABLE analysis DROP COLUMN body;
ALTER TABLE analysis RENAME COLUMN body_text TO body;

-- 4. Add uuid to parties
ALTER TABLE parties ADD COLUMN uuid UUID;

-- 5. Remove encoding defaults
ALTER TABLE analysis ALTER COLUMN encoding DROP DEFAULT;
ALTER TABLE dialog ALTER COLUMN encoding DROP DEFAULT;
ALTER TABLE attachments ALTER COLUMN encoding DROP DEFAULT;

-- 6. Add type constraints
ALTER TABLE dialog ADD CONSTRAINT dialog_type_check 
  CHECK (type IN ('recording', 'text', 'transfer', 'incomplete'));

ALTER TABLE analysis ADD CONSTRAINT analysis_encoding_check 
  CHECK (encoding IS NULL OR encoding IN ('base64url', 'json', 'none'));

-- 7. Add dialog reference to analysis
ALTER TABLE analysis ADD COLUMN dialog_indices INTEGER[];
CREATE INDEX idx_analysis_dialog ON analysis USING GIN (dialog_indices);

-- 8. Add indexes
CREATE INDEX idx_parties_uuid ON parties(uuid) WHERE uuid IS NOT NULL;

COMMIT;
```

---

## Testing Checklist

After applying corrections:

- [ ] Create vCon with analysis object using `schema` field
- [ ] Verify `vendor` field is required in analysis
- [ ] Test storing non-JSON analysis body (CSV, plain text)
- [ ] Verify encoding field accepts "base64url", "json", "none"
- [ ] Test dialog type constraint accepts only valid types
- [ ] Create party with uuid field
- [ ] Test analysis with dialog_indices array reference
- [ ] Export vCon and validate against IETF schema validator
- [ ] Test interoperability with other vCon implementations

---

## Documentation Updates Required

1. Update all tool definitions to use corrected field names
2. Update database schema documentation
3. Update API documentation
4. Create vCon compliance checklist
5. Add migration guide for existing deployments

---

## References

- IETF vCon Specification: draft-ietf-vcon-vcon-core-00.txt
- Original Implementation: MCP Server for IETF vCon with Supabase - Complete Implementation Specification.md
- Related: vcon_adapter_guide.md

---

## Questions for Resolution

1. Should we support both `schema` and `schema_version` for backwards compatibility?
2. How should we handle existing vCons with non-compliant field names?
3. Should the migration be applied automatically or require manual intervention?
4. What is the deprecation timeline for non-compliant fields?

---

*Document Version: 1.0*  
*Date: 2025-10-07*  
*Status: Draft for Review*
