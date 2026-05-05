# Claude Code Instructions for vCon MCP Server

This document provides comprehensive instructions for coding agents working with the vCon MCP Server codebase.

## Project Overview

This is an MCP (Model Context Protocol) server for managing **vCon** (Virtual Conversation) data stored in Supabase. vCon is an IETF standard (draft-ietf-vcon-vcon-core-02, spec version 0.4.0) for representing conversation data.

**Key Technologies:**
- TypeScript
- MCP SDK (`@modelcontextprotocol/sdk`)
- Koa v3 (`koa`, `@koa/router`) for REST API
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

### Field Name Corrections (spec -02 / v0.4.0)

| Wrong | Correct | Notes |
|-------|---------|-------|
| `schema_version` | `schema` | Analysis object field |
| `vendor?: string` | `vendor: string` | Required in Analysis |
| `body: object` | `body: string` | JSON.stringify objects before storing |
| `mimetype` | `mediatype` | dialog, analysis, attachments (since v0.0.2) |
| `appended` | `amended` | vCon top-level (renamed in v0.4.0) |
| `must_support` | `critical` | vCon top-level (renamed in v0.4.0) |
| `session_id: string` | `session_id: {local, remote}` | Dialog (changed in v0.4.0) |

**Import note:** Real-world vCon files (e.g. Strolid) may use v0.0.1 field names (`mimetype`, `appended`, `must_support`). The import script handles both old and new field names transparently.

### Encoding Field

- Valid values: `'base64url'`, `'json'`, `'none'`
- **NO default value** - must be explicitly set
- Applied to: Dialog, Analysis, Attachment objects

### Dialog Types

Must be one of: `'recording'`, `'text'`, `'transfer'`, `'incomplete'`

---

## Database Schema

**Full reference (PostgreSQL, migrations-aligned):** [`docs/reference/AGENT_DATABASE_SCHEMA.md`](docs/reference/AGENT_DATABASE_SCHEMA.md)

### Core Tables

| Table | Description |
|-------|-------------|
| `vcons` | Main vCon container (uuid, subject, created_at, extensions, critical, amended) |
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

### Analytics Tools

| Tool | Description |
|------|-------------|
| `get_database_analytics` | Size, growth trends, content distribution |
| `get_monthly_growth_analytics` | Monthly growth patterns and projections |
| `get_attachment_analytics` | Attachment types, sizes, storage |
| `get_tag_analytics` | Tag usage patterns and value distribution |
| `get_content_analytics` | Dialog types, party patterns, content insights |
| `get_database_health_metrics` | Performance and optimization recommendations |

### Database Tools

| Tool | Description |
|------|-------------|
| `get_database_shape` | Tables, indexes, sizes |
| `get_database_stats` | Performance statistics |
| `analyze_query` | Query execution plan |
| `get_database_size_info` | Size info and smart recommendations for large datasets |
| `get_smart_search_limits` | Recommended limits to prevent memory issues |

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
├── api/
│   ├── rest-router.ts    # Koa app assembler (mounts sub-routers)
│   ├── context.ts        # RestApiContext type (shared deps)
│   ├── auth.ts           # API key auth middleware
│   ├── response.ts       # JSON envelope helpers
│   ├── validation.ts     # HTTP-friendly validation
│   ├── middleware/        # Pagination, etc.
│   └── routes/           # Modular route handlers
│       ├── vcons.ts      # CRUD + sub-resources
│       ├── tags.ts       # Tag management
│       ├── search.ts     # Content/semantic/hybrid search
│       ├── database.ts   # DB ops (shape, stats, health)
│       ├── analytics.ts  # Growth, content, tag analytics
│       └── schema.ts     # Health, version, schema, examples
├── server/
│   ├── setup.ts          # MCP server initialization
│   └── handlers.ts       # MCP request handlers
├── services/
│   └── vcon-service.ts   # Shared business logic (MCP + REST)
├── tools/
│   ├── vcon-crud.ts      # Core vCon tools (Zod schemas)
│   ├── tag-tools.ts      # Tag management
│   ├── database-tools.ts # DB inspection
│   └── handlers/         # MCP tool implementations
├── db/
│   ├── queries.ts        # Database queries (IVConQueries)
│   └── database-inspector.ts
├── types/
│   └── vcon.ts           # TypeScript types (IETF compliant)
├── prompts/
│   └── index.ts          # MCP prompts
├── utils/
│   └── embeddings.ts     # Shared embedding generation
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
- [ ] `analysis.body` is string type (JSON.stringify objects)
- [ ] No default values for `encoding` fields
- [ ] Dialog `type` is one of: recording, text, transfer, incomplete
- [ ] Use `mediatype` NOT `mimetype` (dialog, analysis, attachments)
- [ ] Use `amended` NOT `appended` (vCon top-level)
- [ ] Use `critical` NOT `must_support` (vCon top-level)
- [ ] `session_id` is `{local: string, remote: string}` NOT a plain string
- [ ] Tags stored as attachment with `type: "tags"`, `encoding: "json"`
- [ ] vcon version field is `"0.4.0"`

---

## References

- IETF vCon Spec: `background_docs/draft-ietf-vcon-vcon-core-00.txt` (v0.3.0 baseline in repo) — v0.4.0 spec available at IETF datatracker: https://datatracker.ietf.org/doc/draft-ietf-vcon-vcon-core/
- Schema Details: `docs/reference/CORRECTED_SCHEMA.md`
- Implementation Notes: `docs/reference/IMPLEMENTATION_CORRECTIONS.md`
- Python vCon Library: `background_docs/LLM_GUIDE.md`
