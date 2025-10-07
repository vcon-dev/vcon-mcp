# IETF vCon MCP Server - Documentation Index

## 🎯 Quick Start

**New to this project?** Start here:

1. Read: [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md) - 5 minute overview of critical corrections
2. Read: [`IMPLEMENTATION_CORRECTIONS.md`](./IMPLEMENTATION_CORRECTIONS.md) - Detailed list of issues
3. Implement: Follow [`CLAUDE_CODE_INSTRUCTIONS.md`](./CLAUDE_CODE_INSTRUCTIONS.md)
4. Deploy: Use [`CORRECTED_SCHEMA.md`](./CORRECTED_SCHEMA.md) for database

**Migrating existing code?** 
→ See [`MIGRATION_GUIDE.md`](./MIGRATION_GUIDE.md)

---

## 📚 Documentation Structure

### Essential Documents (Read First)

| Document | Purpose | Audience | Time |
|----------|---------|----------|------|
| [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md) | Critical field corrections at a glance | Everyone | 5 min |
| [`IMPLEMENTATION_CORRECTIONS.md`](./IMPLEMENTATION_CORRECTIONS.md) | Complete list of spec inconsistencies | Developers | 15 min |
| [`CLAUDE_CODE_INSTRUCTIONS.md`](./CLAUDE_CODE_INSTRUCTIONS.md) | Complete implementation guide | Developers | 30 min |

### Implementation Resources

| Document | Purpose | When to Use |
|----------|---------|-------------|
| [`CORRECTED_SCHEMA.md`](./CORRECTED_SCHEMA.md) | Database schema with corrections | Setting up database |
| [`MIGRATION_GUIDE.md`](./MIGRATION_GUIDE.md) | Fix existing code | Updating old implementations |

### Reference Documents

Located in `background_docs/`:

| Document | Purpose |
|----------|---------|
| `draft-ietf-vcon-vcon-core-00.txt` | Official IETF vCon specification |
| `draft-howe-vcon-consent-00.txt` | Privacy and consent extensions |
| `draft-howe-vcon-lifecycle-00.txt` | vCon lifecycle management |
| `vcon_adapter_guide.md` | Adapter implementation patterns |
| `vcon_quickstart_guide.md` | Quick start for vCon basics |

---

## 🔴 Critical Corrections Summary

### The 7 Critical Issues

1. **Analysis Schema Field**
   - ❌ Wrong: `schema_version`
   - ✅ Correct: `schema`
   - Spec: Section 4.5.7

2. **Analysis Vendor Requirement**
   - ❌ Wrong: `vendor?: string`
   - ✅ Correct: `vendor: string` (required)
   - Spec: Section 4.5.5

3. **Analysis Body Type**
   - ❌ Wrong: `body: object` or `JSONB`
   - ✅ Correct: `body?: string`
   - Spec: Section 4.5.8

4. **Party UUID Field**
   - ❌ Missing: No uuid field
   - ✅ Correct: `uuid?: string`
   - Spec: Section 4.2.12

5. **Encoding Defaults**
   - ❌ Wrong: `DEFAULT 'json'` or `DEFAULT 'none'`
   - ✅ Correct: No default, require explicit values
   - Spec: Section 2.3.2

6. **Dialog Type Constraints**
   - ❌ Wrong: No validation
   - ✅ Correct: Must be one of 4 valid types
   - Spec: Section 4.3.1

7. **Missing Dialog Fields**
   - ❌ Missing: `session_id`, `application`, `message_id`
   - ✅ Correct: Include all spec fields
   - Spec: Sections 4.3.10, 4.3.13, 4.3.14

---

## 🎓 Learning Path

### For Developers New to vCon

1. **Understand vCon Basics** (30 min)
   - Read: `background_docs/vcon_quickstart_guide.md`
   - Read: IETF spec introduction (Sections 1-2)

2. **Learn the Corrections** (15 min)
   - Read: [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md)
   - Skim: [`IMPLEMENTATION_CORRECTIONS.md`](./IMPLEMENTATION_CORRECTIONS.md)

3. **Implementation** (2-4 hours)
   - Follow: [`CLAUDE_CODE_INSTRUCTIONS.md`](./CLAUDE_CODE_INSTRUCTIONS.md)
   - Use: [`CORRECTED_SCHEMA.md`](./CORRECTED_SCHEMA.md)

4. **Testing** (1 hour)
   - Run compliance tests from instructions
   - Verify against checklist

### For Developers Migrating Existing Code

1. **Assessment** (15 min)
   - Read: [`IMPLEMENTATION_CORRECTIONS.md`](./IMPLEMENTATION_CORRECTIONS.md)
   - Identify which issues affect your code

2. **Planning** (30 min)
   - Review: [`MIGRATION_GUIDE.md`](./MIGRATION_GUIDE.md)
   - Create backup of existing code/database

3. **Migration** (2-3 hours)
   - Run automated fixes from migration guide
   - Complete manual corrections
   - Run database migration SQL

4. **Verification** (1 hour)
   - Run all verification queries
   - Execute compliance tests
   - Manual code review

---

## 🔧 Implementation Checklist

Use this to track your progress:

### Pre-Implementation
- [ ] Read QUICK_REFERENCE.md
- [ ] Read IMPLEMENTATION_CORRECTIONS.md  
- [ ] Read CLAUDE_CODE_INSTRUCTIONS.md
- [ ] Set up Supabase project
- [ ] Create project structure

### Database Setup
- [ ] Run CORRECTED_SCHEMA.md SQL
- [ ] Verify schema with verification queries
- [ ] Set up Row Level Security
- [ ] Configure connection

### TypeScript Implementation
- [ ] Create types/vcon.ts with corrected types
- [ ] Implement tools with correct schemas
- [ ] Write database queries with correct field names
- [ ] Implement validation
- [ ] Add tests

### Verification
- [ ] TypeScript compiles without errors
- [ ] All tests pass
- [ ] Database verification passes
- [ ] No `schema_version` in codebase
- [ ] Analysis vendor is required
- [ ] Can create spec-compliant vCon

---

## 🧪 Testing Strategy

### 1. Unit Tests
```bash
npm run test
```
- Type validation
- Field name verification
- Required field checks

### 2. Compliance Tests
```bash
npm run test:compliance
```
- Spec conformance
- Field naming
- Type correctness

### 3. Database Tests
```sql
-- Run verification queries from CORRECTED_SCHEMA.md
\i verify-schema.sql
```

### 4. Integration Tests
- Create vCon end-to-end
- Export and validate against spec
- Test interoperability

---

## 📋 Common Tasks

### Create a Spec-Compliant vCon

```typescript
import { VCon, Analysis } from './types/vcon';

const vcon: VCon = {
  vcon: '0.3.0',
  uuid: crypto.randomUUID(),
  created_at: new Date().toISOString(),
  parties: [{
    name: 'Alice',
    mailto: 'alice@example.com',
    uuid: crypto.randomUUID()  // Don't forget uuid
  }],
  dialog: [{
    type: 'text',
    start: new Date().toISOString(),
    parties: [0],
    body: 'Hello world',
    encoding: 'none',
    session_id: 'session-123'  // New field
  }],
  analysis: [{
    type: 'sentiment',
    vendor: 'ExampleVendor',  // Required field
    schema: 'v1.0',           // Correct field name
    body: JSON.stringify({ sentiment: 'positive' }),
    encoding: 'json',
    dialog: [0]
  }]
};
```

### Add Analysis to vCon

```typescript
import { Analysis } from './types/vcon';

const analysis: Analysis = {
  type: 'transcript',
  dialog: [0],
  vendor: 'TranscriptCorp',  // Required
  product: 'AutoTranscribe',
  schema: 'v2.1',            // Not schema_version
  body: 'Transcript text...',
  encoding: 'none'
};

await vconQueries.addAnalysis(vconUuid, analysis);
```

### Query Analysis by Schema

```sql
-- Use 'schema' not 'schema_version'
SELECT * FROM analysis 
WHERE schema = 'v1.0' 
  AND vendor = 'MyVendor';
```

---

## 🚨 Troubleshooting

### TypeScript Errors

**Error:** `Property 'schema_version' does not exist`
- **Fix:** Change to `schema` everywhere
- **Doc:** QUICK_REFERENCE.md

**Error:** `Property 'vendor' is missing`
- **Fix:** vendor is required in Analysis
- **Doc:** IMPLEMENTATION_CORRECTIONS.md #2

**Error:** `Type 'object' is not assignable to type 'string'`
- **Fix:** body must be string type
- **Doc:** IMPLEMENTATION_CORRECTIONS.md #3

### Database Errors

**Error:** `column "schema_version" does not exist`
- **Fix:** Run schema migration SQL
- **Doc:** MIGRATION_GUIDE.md

**Error:** `null value in column "vendor" violates not-null constraint`
- **Fix:** Always provide vendor in analysis
- **Doc:** IMPLEMENTATION_CORRECTIONS.md #2

**Error:** `new row violates check constraint "dialog_type_check"`
- **Fix:** Use only valid dialog types
- **Doc:** QUICK_REFERENCE.md

### Runtime Errors

**Issue:** Non-JSON analysis fails to save
- **Fix:** Ensure body column is TEXT not JSONB
- **Doc:** CORRECTED_SCHEMA.md

**Issue:** vCon fails interoperability tests
- **Fix:** Verify all field names match spec
- **Doc:** CLAUDE_CODE_INSTRUCTIONS.md

---

## 📖 Specification References

### IETF vCon Core Spec
- **Location:** `background_docs/draft-ietf-vcon-vcon-core-00.txt`
- **Key Sections:**
  - 4.1: vCon Object
  - 4.2: Party Object
  - 4.3: Dialog Object
  - 4.4: Attachment Object
  - 4.5: Analysis Object (critical)
  - 4.6: Group Object

### Field References
- `schema`: Section 4.5.7
- `vendor`: Section 4.5.5 (required)
- `body`: Section 4.5.8
- Party `uuid`: Section 4.2.12
- Dialog `type`: Section 4.3.1
- Dialog `session_id`: Section 4.3.10
- `encoding`: Section 2.3.2

---

## 🤝 Contributing

### Before Submitting Code

1. Read all essential documents
2. Run compliance tests
3. Verify against spec
4. Check no `schema_version` in code
5. Ensure vendor is required in analysis types

### Code Review Checklist

Reviewers should verify:
- [ ] Correct field names used
- [ ] Types match spec
- [ ] Required fields not optional
- [ ] Tests include spec compliance
- [ ] Documentation updated

---

## 📊 Project Status

### Compliance Status
- [x] Identified all spec inconsistencies
- [x] Documented corrections
- [x] Created corrected schema
- [x] Written implementation guide
- [ ] Implementation in progress
- [ ] Testing and verification
- [ ] Production deployment

### Documentation Status
- [x] QUICK_REFERENCE.md - Complete
- [x] IMPLEMENTATION_CORRECTIONS.md - Complete
- [x] CLAUDE_CODE_INSTRUCTIONS.md - Complete
- [x] CORRECTED_SCHEMA.md - Complete
- [x] MIGRATION_GUIDE.md - Complete
- [x] README.md - Complete

---

## 🔗 External Resources

- [IETF vCon Working Group](https://datatracker.ietf.org/wg/vcon/)
- [vCon Specification Draft](https://ietf-wg-vcon.github.io/draft-ietf-vcon-vcon-core/)
- [MCP Protocol](https://modelcontextprotocol.io/)
- [Supabase Documentation](https://supabase.com/docs)

---

## 📞 Support

### For Implementation Questions
- Review: CLAUDE_CODE_INSTRUCTIONS.md
- Check: QUICK_REFERENCE.md
- Reference: IETF spec Section matching your question

### For Migration Issues
- Follow: MIGRATION_GUIDE.md
- Run: Verification queries
- Check: Error messages against troubleshooting section

### For Spec Clarification
- Consult: `background_docs/draft-ietf-vcon-vcon-core-00.txt`
- Search: Specification section numbers
- Review: IMPLEMENTATION_CORRECTIONS.md explanations

---

## ⚖️ License

This implementation follows the IETF vCon specification (draft-ietf-vcon-vcon-core-00).

---

## 📝 Version History

- **v1.0.0** (2025-10-07)
  - Initial documentation release
  - All 7 critical corrections documented
  - Complete implementation guide
  - Migration guide for existing code
  - Database schema corrections
  - Testing framework

---

## 🎯 Success Criteria

Your implementation is successful when:

1. ✅ All TypeScript types match IETF spec exactly
2. ✅ Database uses corrected field names  
3. ✅ `schema` used everywhere (not `schema_version`)
4. ✅ Analysis `vendor` is always required
5. ✅ Analysis `body` supports all string formats
6. ✅ All compliance tests pass
7. ✅ vCons are interoperable with other implementations
8. ✅ No spec violations in codebase

---

**Ready to start?** → [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md)

**Need to migrate?** → [`MIGRATION_GUIDE.md`](./MIGRATION_GUIDE.md)

**Building from scratch?** → [`CLAUDE_CODE_INSTRUCTIONS.md`](./CLAUDE_CODE_INSTRUCTIONS.md)

---

*This documentation ensures IETF vCon spec compliance (draft-ietf-vcon-vcon-core-00)*
