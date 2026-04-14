# Getting Started with vCon MCP Server

> **Quick start guide to understand and build this project**

## 🎯 What Is This Project?

This project provides:

1. **Complete Documentation** for building an IETF vCon-compliant MCP server
2. **Corrections** to common implementation mistakes in the spec
3. **Step-by-step Build Guide** to implement from scratch
4. **Reference Materials** from IETF vCon working group

## 📚 Start Here

### New to vCon?

**Read in this order:**

1. **[README.md](../../README.md)** (5 min)
   - Overview of the project
   - Documentation structure
   - Critical corrections summary

2. **[QUICK_REFERENCE.md](../reference/QUICK_REFERENCE.md)** (5 min)
   - Critical field corrections
   - Common mistakes to avoid
   - Quick checklist

3. **[CLAUDE.md](../../CLAUDE.md)** (15 min)
   - Complete implementation guide for AI-assisted development
   - Corrected TypeScript types and patterns
   - Database schema and queries

### Already Know vCon?

**Fast track:**

1. **[IMPLEMENTATION_CORRECTIONS.md](../reference/IMPLEMENTATION_CORRECTIONS.md)** (15 min)
   - All 7 critical spec issues
   - What was wrong vs. what's correct
   - Why each correction matters

2. **[CLAUDE.md](../../CLAUDE.md)** (30 min)
   - Complete implementation guide
   - Corrected TypeScript types
   - Database schema and queries
   - MCP tool definitions

### Migrating Existing Code?

1. **[MIGRATION_GUIDE.md](../reference/MIGRATION_GUIDE.md)** (30 min)
   - Database migration SQL
   - Code refactoring steps
   - Verification queries

2. **[QUICK_REFERENCE.md](../reference/QUICK_REFERENCE.md)**
   - Use as checklist while migrating

## 🔴 Critical Corrections

**⚠️ These are MANDATORY for IETF spec compliance:**

### 1. Analysis Schema Field
```typescript
// ❌ WRONG
interface Analysis {
  schema_version?: string;
}

// ✅ CORRECT
interface Analysis {
  schema?: string;
}
```

### 2. Analysis Vendor Requirement
```typescript
// ❌ WRONG
interface Analysis {
  vendor?: string;  // Optional
}

// ✅ CORRECT
interface Analysis {
  vendor: string;  // Required
}
```

### 3. Analysis Body Type
```typescript
// ❌ WRONG
interface Analysis {
  body: object;  // Only supports JSON
}

// ✅ CORRECT
interface Analysis {
  body?: string;  // Supports any format
}
```

**See [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for all 7 corrections.**

## 🚀 Quick Setup (5 Minutes)

### Prerequisites

- Node.js 18+ installed
- Supabase account (free tier works)
- Git installed

### Setup Steps

```bash
# 1. Clone or create project directory
mkdir vcon-mcp-server && cd vcon-mcp-server

# 2. Initialize project
npm init -y

# 3. Install dependencies
npm install @modelcontextprotocol/sdk @supabase/supabase-js zod
npm install -D typescript @types/node tsx vitest

# 4. Copy example configuration
# Use the tsconfig.json and package.json from BUILD_GUIDE.md

# 5. Create .env file
echo "SUPABASE_URL=your-url" > .env
echo "SUPABASE_ANON_KEY=your-key" >> .env

# 6. Follow BUILD_GUIDE.md from Phase 2 onwards
```

## 📖 Documentation Map

```
Start Here
    ├── README.md ────────────────────► Master index & navigation
    │
    ├── docs/guide/getting-started.md ► You are here!
    │
    └── Choose your path:
        │
        ├── New Implementation ─────────────┐
        │   ├── docs/reference/QUICK_REF    │
        │   ├── CLAUDE.md ──────────────────┼──► Primary path
        │   └── docs/reference/CORRECTED_   │
        │       SCHEMA.md ─────────────────-┘
        │
        ├── Migration ──────────────────────┐
        │   ├── IMPLEMENTATION_CORRECTIONS  │
        │   ├── docs/reference/MIGRATION ───┼──► Fix existing code
        │   └── docs/reference/CORRECTED_   │
        │       SCHEMA.md ─────────────────-┘
        │
        └── Deep Dive ──────────────────────┐
            ├── docs/reference/vcon-spec.md │
            └── background_docs/ ───────────┘

```

## 🎓 Learning Paths

### Path 1: Complete Beginner (6 hours)

**Goal:** Build a working vCon MCP server from scratch

1. Read background material (1 hour)
   - `background_docs/vcon_quickstart_guide.md`
   - `background_docs/draft-ietf-vcon-vcon-core-00.txt` (introduction)

2. Understand corrections (30 min)
   - `docs/reference/QUICK_REFERENCE.md`
   - `docs/reference/IMPLEMENTATION_CORRECTIONS.md`

3. Follow the implementation guide (4 hours)
   - `CLAUDE.md` — complete patterns, types, and DB schema

4. Test and verify (30 min)
   - Run `npm test`
   - Test with AI assistant

### Path 2: Experienced Developer (2 hours)

**Goal:** Implement spec-compliant vCon server quickly

1. Review corrections (15 min)
   - `docs/reference/QUICK_REFERENCE.md`

2. Study implementation (30 min)
   - `CLAUDE.md`

3. Build core (1 hour)
   - Database schema
   - TypeScript types
   - Database queries

4. Add MCP layer (15 min)
   - Tool definitions
   - Server setup

### Path 3: Migration (3 hours)

**Goal:** Fix existing implementation to match spec

1. Identify issues (30 min)
   - `docs/reference/IMPLEMENTATION_CORRECTIONS.md`
   - Compare with your code

2. Plan migration (30 min)
   - `docs/reference/MIGRATION_GUIDE.md`
   - Backup database and code

3. Execute migration (1.5 hours)
   - Database schema changes
   - Code refactoring
   - Update tests

4. Verify (30 min)
   - Run verification queries
   - Run `npm test`
   - Manual review

### Path 4: AI-Assisted Build (30 min + AI time)

**Goal:** Use Claude Code to build for you

1. Prepare instructions (15 min)
   - Read `docs/reference/QUICK_REFERENCE.md`
   - Set up Supabase

2. Provide to AI (5 min)
   ```
   Build an IETF vCon MCP server following the specifications in:
   - CLAUDE.md
   - docs/reference/CORRECTED_SCHEMA.md
   - docs/reference/QUICK_REFERENCE.md (for checklist)
   
   Use the corrected field names and ensure full spec compliance.
   ```

3. Review & test (10 min)
   - Verify no `schema_version` in code
   - Check vendor is required
   - Run `npm test`

## 🛠️ What You'll Build

### Core Components

1. **TypeScript Types** (`src/types/vcon.ts`)
   - All IETF vCon objects
   - Corrected field names
   - Type validation helpers

2. **Database Layer** (`src/db/`)
   - Supabase client
   - CRUD operations
   - Search queries

3. **MCP Server** (`src/index.ts`)
   - Tool definitions
   - Request handlers
   - Error handling

4. **Utilities** (`src/utils/`)
   - vCon validation
   - Privacy helpers
   - Serialization

### MCP Tools Provided

- `create_vcon` - Create new vCon
- `add_analysis` - Add analysis to vCon
- `add_dialog` - Add dialog to vCon
- `get_vcon` - Retrieve vCon by UUID
- `search_vcons` - Search vCon database
- `update_vcon` - Update vCon fields

### Database Schema

- `vcons` - Main vCon records
- `parties` - Conversation participants
- `dialog` - Recordings, texts, transfers
- `analysis` - AI/ML analysis results
- `attachments` - File attachments
- `party_history` - Event timeline

## 📋 Pre-Build Checklist

Before you start building:

- [ ] Read README.md
- [ ] Read QUICK_REFERENCE.md
- [ ] Understand the 7 critical corrections
- [ ] Have Supabase account ready
- [ ] Have Node.js 18+ installed
- [ ] Have code editor ready
- [ ] Have 4-6 hours available for first build

## ⚠️ Common Pitfalls

### Mistake #1: Using Wrong Field Names
```typescript
// ❌ DON'T
const analysis = { schema_version: '1.0' };

// ✅ DO
const analysis = { schema: '1.0' };
```

### Mistake #2: Making Vendor Optional
```typescript
// ❌ DON'T
interface Analysis { vendor?: string; }

// ✅ DO
interface Analysis { vendor: string; }
```

### Mistake #3: Wrong Body Type
```typescript
// ❌ DON'T
body: object  // Database: JSONB

// ✅ DO
body?: string  // Database: TEXT
```

### Mistake #4: Adding Default Values
```sql
-- ❌ DON'T
encoding TEXT DEFAULT 'json'

-- ✅ DO
encoding TEXT CHECK (encoding IN ('base64url', 'json', 'none'))
```

### Mistake #5: Forgetting New Fields
```typescript
// ❌ MISSING
interface Party {
  name?: string;
  // missing: uuid, did
}

// ✅ COMPLETE
interface Party {
  name?: string;
  uuid?: string;
  did?: string;
}
```

## 🧪 Testing Your Implementation

### Quick Compliance Check

```bash
# 1. Check for wrong field names
grep -r "schema_version" src/
# Should return nothing

# 2. Check vendor is not optional
grep "vendor?" src/types/vcon.ts
# Should return nothing

# 3. Run tests
npm test
# Should pass

# 4. Check database schema
# Run verification queries from docs/reference/CORRECTED_SCHEMA.md
```

### Integration Test

Create a test vCon:

```typescript
const vcon: VCon = {
  vcon: '0.4.0',
  uuid: crypto.randomUUID(),
  created_at: new Date().toISOString(),
  parties: [{
    name: 'Alice',
    mailto: 'alice@example.com',
    uuid: crypto.randomUUID()
  }],
  analysis: [{
    type: 'sentiment',
    vendor: 'TestVendor',  // Required
    schema: 'v1.0',        // Correct field name
    body: JSON.stringify({ score: 0.8 }),
    encoding: 'json'
  }]
};

// Validate
const result = validateVCon(vcon);
console.log(result.valid ? '✅ Valid' : '❌ Invalid');
```

## 📞 Getting Help

### Documentation Questions

- Check [README.md](./README.md) troubleshooting section
- Search for your error in [BUILD_GUIDE.md](./BUILD_GUIDE.md)
- Review relevant correction in [IMPLEMENTATION_CORRECTIONS.md](./IMPLEMENTATION_CORRECTIONS.md)

### Spec Questions

- Consult `background_docs/draft-ietf-vcon-vcon-core-00.txt`
- Cross-reference section numbers in correction docs
- Check [VISUAL_REFERENCE.md](./VISUAL_REFERENCE.md) for before/after examples

### Implementation Questions

- Follow [CLAUDE_CODE_INSTRUCTIONS.md](./CLAUDE_CODE_INSTRUCTIONS.md) step-by-step
- Use code examples from [BUILD_GUIDE.md](./BUILD_GUIDE.md)
- Check [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) for specific fixes

## 🎯 Success Criteria

Your implementation is successful when:

- [x] Git repository initialized
- [ ] All dependencies installed
- [ ] TypeScript compiles without errors
- [ ] Database schema matches spec
- [ ] No `schema_version` anywhere in code
- [ ] Analysis.vendor is required (not optional)
- [ ] Analysis.body is string type
- [ ] All compliance tests pass
- [ ] MCP server starts and lists tools
- [ ] Can create spec-compliant vCons
- [ ] Can add analysis with correct fields
- [ ] vCons are interoperable

## 🚀 Next Actions

**Choose your path:**

### I'm Ready to Build
→ Read **[CLAUDE.md](../../CLAUDE.md)** and follow the patterns there

### I Need to Understand Corrections First
→ Read **[IMPLEMENTATION_CORRECTIONS.md](../reference/IMPLEMENTATION_CORRECTIONS.md)**

### I'm Migrating Existing Code
→ Follow **[MIGRATION_GUIDE.md](../reference/MIGRATION_GUIDE.md)**

### I Want the Quick Version
→ Read **[QUICK_REFERENCE.md](../reference/QUICK_REFERENCE.md)** then dive into **[CLAUDE.md](../../CLAUDE.md)**

---

## 📊 Project Status

✅ **Complete:**
- Git repository initialized
- All documentation created
- Build guide written
- Example code provided

⏳ **Next Steps:**
- Follow BUILD_GUIDE.md to implement
- Run compliance tests
- Deploy MCP server

---

**Ready?** Start with **[BUILD_GUIDE.md](./BUILD_GUIDE.md)**

**Questions?** Check **[README.md](../../README.md)** → Troubleshooting

**Need quick reference?** Use **[QUICK_REFERENCE.md](../reference/QUICK_REFERENCE.md)**

---

*Last Updated: April 2026*  
*Project: vCon MCP Server Documentation v1.2.0*  
*Spec: draft-ietf-vcon-vcon-core-02 (v0.4.0)*

