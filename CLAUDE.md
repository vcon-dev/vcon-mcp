# Claude Code Instructions for vCon MCP Server

This document provides comprehensive instructions for coding agents working with the vCon MCP Server codebase.

## Project Overview

This is an MCP (Model Context Protocol) server for managing **vCon** (Virtual Conversation) data stored in Supabase. vCon is an IETF standard (draft-ietf-vcon-vcon-core-00) for representing conversation data.

**Key Technologies:**
- TypeScript
- MCP SDK (`@modelcontextprotocol/sdk`)
- Supabase (PostgreSQL)
- Zod for validation

---

## Critical IETF Spec Compliance

### Analysis Object - MUST READ

```typescript
// CORRECT
interface Analysis {
  type: string;
  vendor: string;           // REQUIRED - not optional!
  schema?: string;          // CORRECT field name
  body?: string;            // String type (not object)
  encoding?: 'base64url' | 'json' | 'none';
}

// WRONG - DO NOT USE
interface AnalysisWrong {
  schema_version?: string;  // WRONG - use 'schema'
  vendor?: string;          // WRONG - vendor is required
  body?: object;            // WRONG - body is string
}
```

### Field Name Corrections

| Wrong | Correct | Notes |
|-------|---------|-------|
| `schema_version` | `schema` | Analysis object field |
| `vendor?: string` | `vendor: string` | Required in Analysis |
| `body: object` | `body: string` | Supports JSON, CSV, XML, plain text |

### Encoding Field

- Valid values: `'base64url'`, `'json'`, `'none'`
- **NO default value** - must be explicitly set
- Applied to: Dialog, Analysis, Attachment objects

### Dialog Types

Must be one of: `'recording'`, `'text'`, `'transfer'`, `'incomplete'`

---

## Database Schema

### Core Tables

| Table | Description |
|-------|-------------|
| `vcons` | Main vCon container (uuid, subject, created_at, extensions, must_support) |
| `parties` | Participants (tel, sip, mailto, name, uuid, did) |
| `dialog` | Conversation segments (type, start_time, duration, body, encoding) |
| `analysis` | AI/ML results (type, vendor, schema, body, dialog_indices) |
| `attachments` | Related files (type, party, dialog, body, encoding) |
| `groups` | Aggregated vCons |
| `party_history` | Join/drop/mute events |
| `vcon_embeddings` | Semantic search embeddings |

### Key Relationships

```
vcons (1) ──┬── (*) parties
            ├── (*) dialog
            ├── (*) analysis
            ├── (*) attachments
            └── (*) groups
```

### Tags Storage

Tags are stored as a **special attachment**, not a column:

```json
{
  "type": "tags",
  "encoding": "json",
  "body": "[\"department:sales\", \"priority:high\", \"sentiment:positive\"]"
}
```

Format: `"key:value"` strings in a JSON array.

---

## MCP Tools Reference

### vCon CRUD Tools

| Tool | Description |
|------|-------------|
| `create_vcon` | Create new vCon with parties |
| `get_vcon` | Retrieve vCon by UUID |
| `update_vcon` | Update metadata (subject, extensions) |
| `delete_vcon` | Delete vCon and all related data |
| `add_dialog` | Add conversation segment |
| `add_analysis` | Add AI analysis (vendor REQUIRED) |
| `add_attachment` | Add file/document |

### Search Tools

| Tool | Use Case |
|------|----------|
| `search_vcons` | Filter by metadata, tags, dates |
| `search_vcons_content` | Full-text keyword search |
| `search_vcons_semantic` | AI embedding similarity search |
| `search_vcons_hybrid` | Combined keyword + semantic |

**Large Database Warning:** Use `response_format: "metadata"` or `"ids_only"` for large result sets.

### Tag Tools

| Tool | Description |
|------|-------------|
| `manage_tag` | Add/update/remove single tag |
| `get_tags` | Get one or all tags |
| `remove_all_tags` | Clear all tags |
| `search_by_tags` | Find vCons by tag values |
| `get_unique_tags` | Discover available tags |

### Database Tools

| Tool | Description |
|------|-------------|
| `get_database_shape` | Tables, indexes, sizes |
| `get_database_stats` | Performance statistics |
| `analyze_query` | Query execution plan |

---

## Common Patterns

### Creating a vCon with Analysis

```typescript
// 1. Create vCon
const vcon = await tools.create_vcon({
  subject: "Support call",
  parties: [
    { name: "Customer", tel: "+1234567890" },
    { name: "Agent", mailto: "agent@company.com" }
  ]
});

// 2. Add dialog
await tools.add_dialog({
  vcon_uuid: vcon.uuid,
  dialog: {
    type: "text",
    start: new Date().toISOString(),
    parties: [0, 1],
    body: "Hello, I need help...",
    encoding: "none"
  }
});

// 3. Add analysis (vendor REQUIRED)
await tools.add_analysis({
  vcon_uuid: vcon.uuid,
  analysis: {
    type: "sentiment",
    vendor: "OpenAI",          // REQUIRED
    product: "GPT-4",
    schema: "sentiment-v1",    // NOT schema_version
    body: JSON.stringify({ sentiment: "positive", score: 0.85 }),
    encoding: "json"
  }
});

// 4. Add tags
await tools.manage_tag({
  vcon_uuid: vcon.uuid,
  action: "set",
  key: "department",
  value: "support"
});
```

### Searching vCons

```typescript
// By tags
const results = await tools.search_by_tags({
  tags: { department: "sales", priority: "high" },
  limit: 50
});

// Semantic search
const results = await tools.search_vcons_semantic({
  query: "angry customer complaints about billing",
  threshold: 0.7,
  response_format: "metadata"
});

// Hybrid search (best of both)
const results = await tools.search_vcons_hybrid({
  query: "refund request",
  tags: { department: "billing" },
  semantic_weight: 0.6
});
```

---

## File Structure

```
src/
├── server/
│   ├── setup.ts          # MCP server initialization
│   └── handlers.ts       # Request handlers
├── tools/
│   ├── vcon-crud.ts      # Core vCon tools
│   ├── tag-tools.ts      # Tag management
│   ├── database-tools.ts # DB inspection
│   └── handlers/         # Tool implementations
├── db/
│   ├── queries.ts        # Database queries
│   └── database-inspector.ts
├── types/
│   └── vcon.ts           # TypeScript types (IETF compliant)
├── prompts/
│   └── index.ts          # MCP prompts
└── hooks/
    └── plugin-manager.ts # Plugin system

supabase/
└── migrations/           # Database migrations
```

---

## Multi-Tenant Support

The database uses Row Level Security (RLS) with `tenant_id`:

- Set via `x-tenant-id` header or environment variable
- All queries are automatically scoped to tenant
- See `src/config/tenant-config.ts`

---

## Testing

```bash
npm run build     # TypeScript compilation
npm run test      # Run tests
npm run lint      # ESLint
```

---

## Quick Checklist Before Committing

- [ ] `analysis.schema` NOT `analysis.schema_version`
- [ ] `analysis.vendor` is required (no `?`)
- [ ] `analysis.body` is string type
- [ ] No default values for `encoding` fields
- [ ] Dialog `type` is one of: recording, text, transfer, incomplete
- [ ] Tags stored as attachment with `type: "tags"`

---

## References

- IETF vCon Spec: `background_docs/draft-ietf-vcon-vcon-core-00.txt`
- Schema Details: `docs/reference/CORRECTED_SCHEMA.md`
- Implementation Notes: `docs/reference/IMPLEMENTATION_CORRECTIONS.md`
- Python vCon Library: `background_docs/LLM_GUIDE.md`
