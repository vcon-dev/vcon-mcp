# MCP Tools Reference

Complete reference for all Model Context Protocol (MCP) tools provided by the vCon MCP Server.

## Overview

The vCon MCP Server provides 46 tools organized into these functional groups:

- **[Redesigned Contract Tools](#redesigned-contract-tools)** - Recommended discovery, fetch, search, and aggregation surface for new clients
- **[Core Operations](#core-operations)** - Create, read, update, delete vCons
- **[Component Management](#component-management)** - Add, update, and remove parties, dialog, analysis, attachments
- **[Search & Query](#search--query)** - Four search modes with different capabilities
- **[Tag Management](#tag-management)** - Organize with key-value metadata
- **[Database Tools](#database-tools)** - Inspect and optimize database
- **[Database Analytics](#database-analytics)** - Size, growth, content, tag, and health analytics
- **[Database Size Tools](#database-size-tools)** - Smart limits and size awareness for large databases
- **[Schema & Examples](#schema--examples)** - Get schemas and example vCons

## Recommended Starting Point

If you are building a new client, especially an LLM-generated one, start with the redesigned additive tool family:

- `vcon_capabilities`
- `vcon_taxonomy`
- `vcon_search`
- `vcon_fetch`
- `describe_response_shape`

These tools were added to address undocumented limits, inconsistent envelopes, and hard-to-predict payloads in the older tool set.

## Are The Older Tools Still Useful?

Yes. The older tools are still useful for backward compatibility, narrow workflows, and incremental migration. Existing clients built around `get_vcon`, `search_vcons`, `search_vcons_content`, `search_vcons_semantic`, `search_vcons_hybrid`, and `search_by_tags` can keep working while new clients adopt the redesigned surface.

For new client work, prefer the redesigned tools first. Treat the older tools as compatibility and specialized interfaces rather than the default entry point.

---

## Tool Categories

Tools are organized into **5 categories** that can be enabled or disabled for different deployment scenarios. By default, all categories are enabled.

| Category | Tools | Description |
|----------|-------|-------------|
| `read` (15) | `get_vcon`, `vcon_fetch`, `vcon_capabilities`, `vcon_search`, `vcon_taxonomy`, `vcon_aggregate`, `vcon_graph_shape`, `describe_response_shape`, `search_vcons`, `search_vcons_content`, `search_vcons_semantic`, `search_vcons_hybrid`, `get_tags`, `search_by_tags`, `get_unique_tags` | All read operations |
| `write` (18) | `create_vcon`, `create_vcon_from_template`, `update_vcon`, `delete_vcon`, `add_analysis`, `add_dialog`, `add_attachment`, `add_party`, `update_party`, `remove_party`, `update_dialog`, `remove_dialog`, `update_analysis`, `remove_analysis`, `update_attachment`, `remove_attachment`, `manage_tag`, `remove_all_tags` | All mutating operations |
| `schema` (2) | `get_schema`, `get_examples` | Documentation helpers |
| `analytics` (6) | `get_database_analytics`, `get_monthly_growth_analytics`, `get_attachment_analytics`, `get_tag_analytics`, `get_content_analytics`, `get_database_health_metrics` | Usage and growth reporting |
| `infra` (5) | `get_database_shape`, `get_database_stats`, `analyze_query`, `get_database_size_info`, `get_smart_search_limits` | Admin/debugging |

A session that authenticates with a read-only API key loses the `write` category; the other enabled categories stay available.

### Enabling/Disabling Categories

Configure via environment variables:

```bash
# Use a preset profile
MCP_TOOLS_PROFILE=readonly   # Options: full, readonly, user, admin, minimal, public

# Or enable specific categories only
MCP_ENABLED_CATEGORIES=read,write,schema

# Or disable specific categories (starts with all enabled)
MCP_DISABLED_CATEGORIES=analytics,infra

# Disable individual tools
MCP_DISABLED_TOOLS=delete_vcon,analyze_query
```

### Deployment Profiles

| Profile | Categories | Use Case |
|---------|------------|----------|
| `full` | All | Development, full access |
| `readonly` | read, schema | Read-only deployments |
| `user` | read, write, schema | End-user facing |
| `admin` | read, analytics, infra, schema | Admin dashboards |
| `minimal` | read, write | Basic CRUD only |
| `public` | read, schema, minus `vcon_aggregate` and `vcon_taxonomy` | Hosted public datasets; also filters prompts |

The `public` profile is for hosted, read-only datasets where an agent with no prior context
connects and has to work out what the corpus is about from `tools/list` alone. It keeps the
read and search tools, `get_schema`, `get_examples`, and tag discovery, and hides database
internals, analytics, and the two deployment-shaped tools (`vcon_aggregate`, `vcon_taxonomy`).
Prompts carry the same categories, so the profile also drops `daily_activity_report`.
`MCP_DISABLED_TOOLS` still applies on top of any profile.

See the [Configuration Guide](../guide/configuration.md) for more details.

## Redesigned Contract Tools

These tools are additive. They do not replace the legacy tools immediately, but they are the recommended surface for new client development.

All seven tools return an `ok` envelope instead of the `success` envelope used by the legacy tools:

```typescript
// Single item
{ ok: true, item: object, meta?: object }

// List
{ ok: true, items: object[], page?: { count, total?, iterable_total?, next_cursor? }, meta?: object }

// Failure (a normal tool result, not an MCP protocol error)
{ ok: false, error: { code: string, message: string, ...details }, meta?: object }
```

Failure codes returned by these tools:

| Code | Tool | Meaning |
|------|------|---------|
| `INVALID_ARGUMENT` | `vcon_fetch`, `vcon_search`, `vcon_aggregate` | Missing or malformed argument. Includes `invalid_values` and `valid_values` when `include` has an unsupported entry |
| `NOT_FOUND` | `vcon_fetch` | No vCon with that `id` |
| `FETCH_FAILED` | `vcon_fetch` | Any other read error; `message` carries the cause |
| `SEARCH_FAILED` | `vcon_search` | The search backend raised an error; `message` carries the cause |
| `AGGREGATE_FAILED` | `vcon_aggregate` | The rollup failed, for example because the `aggregate_vcons_by_dealer_stats` RPC is missing |
| `SHAPE_GRAPH_FAILED` | `vcon_graph_shape` | The shape graph query failed |
| `RESPONSE_TOO_LARGE` | `vcon_fetch`, `vcon_search` | The serialized response would exceed `max_response_bytes`. The error carries `approximate_bytes`, `max_response_bytes`, and `suggestions` |
| `UNKNOWN_TOOL` | `describe_response_shape` | No descriptor for `tool_name`. The error carries `available_tools` |

Two `vcon_search` inputs are rejected as MCP `InvalidParams` errors instead of an envelope: an unsupported `mode` and a malformed `cursor`.

These tools read through the database layer directly, so the `beforeRead`, `afterRead`, `beforeSearch`, and `afterSearch` plugin hooks do not run for them.

### vcon_capabilities

Discover supported include groups, search modes, cursor semantics, byte-budget defaults, and migration hints before building a client.

**Input Parameters:** none.

**Response:** `{ ok: true, item }` where `item` has these keys: `tools`, `shape_graph`, `response_budgeting`, `fetch`, `search`, `pagination`, `taxonomy_hints`, and `migration` (maps each legacy search tool to its `vcon_search` mode, and `get_vcon` to `vcon_fetch`).

**Use first when:**
- You need to inspect limits before making calls
- You are generating a client from tool descriptions
- You want to know which include groups and search modes are supported

### vcon_taxonomy

Return dataset-specific guidance, including the portal taxonomy and preferred data sources. The guidance comes from configuration (`VCON_TAXONOMY_DATASET`, `VCON_DEALER_ATTACHMENT_TYPE`, `VCON_TAXONOMY_CONFIG`; see the [configuration guide](../guide/configuration.md#dataset-taxonomy-guidance)).

**Input Parameters:** none.

**Response:** `{ ok: true, item }` where `item` has `dataset`, `portal_values`, `common_tags`, `preferred_sources`, `query_recipes`, and `coverage`. With no configuration, `dataset` is `null`, `portal_values` is empty, and the remaining sections hold generic dealer and summary guidance. A deployment's configured vocabulary replaces them. `coverage` is computed from live counts and falls back to `{ note: "coverage unavailable" }` when the counts fail.

**Example hints a configured deployment can surface:**
- Use `tags.portal` classification values before semantic search for "bad call" or upset-customer views
- Prefer the dealer attachment (`attachment:<VCON_DEALER_ATTACHMENT_TYPE>`) over sparse `dealer_name` tags for dealer-aware interfaces

### vcon_search

Unified metadata, keyword, semantic, and hybrid search with one stable response shape.

**Input Parameters:**

```typescript
{
  mode?: "metadata" | "keyword" | "semantic" | "hybrid",  // Default: "metadata"
  query?: string,            // Required for keyword and hybrid; query or embedding for semantic
  embedding?: number[],      // Optional precomputed vector, exactly 384 dimensions (semantic, hybrid)
  tags?: { [key: string]: string },  // Top-level tag filters, applied in every mode
  filters?: {                // Metadata mode only, except start_date and end_date (see below)
    subject?: string,
    start_date?: string,
    end_date?: string,
    date_field?: "created" | "conversation",  // Which date start/end apply to; default "created"
    party_name?: string,
    party_email?: string,
    party_tel?: string,
    dealer_id?: string,      // Matches the dealer attachment id; use string form, e.g. "1174"
    dealer_name?: string     // Case-insensitive substring of the dealer attachment name
  },
  include?: string[],        // Default: ["core", "summary"]
  limit?: number,            // Default: 25, range 1-100 (out-of-range values are clamped)
  cursor?: string,           // Opaque; pass back page.next_cursor unchanged
  max_response_bytes?: number,  // Integer >= 1024, default 250000
  threshold?: number,        // Semantic mode, 0-1, default 0.7
  semantic_weight?: number   // Hybrid mode, 0-1, default 0.6
}
```

**Where each input applies:**

| Mode | Honours | Ignores |
|------|---------|---------|
| `metadata` | All `filters` fields, `tags` | `query`, `embedding` |
| `keyword` | `query` (required), `tags`, `filters.start_date`, `filters.end_date`, `filters.date_field` | Other `filters` fields |
| `semantic` | `query` or `embedding`, `tags`, `threshold` | All `filters` fields, including dates |
| `hybrid` | `query` (required), optional `embedding`, `tags`, `semantic_weight` | All `filters` fields, including dates |

Tag filters go in the top-level `tags` parameter. A `tags` object placed inside `filters` is ignored.

`filters.date_field` picks the timestamp the date window applies to. See [Date fields](#date-fields).

In hybrid mode, if the query embedding cannot be generated the search falls back to keyword-only ranking.

**Response:**

```json
{
  "ok": true,
  "items": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "vcon_version": "0.4.0",
      "created_at": "2026-05-11T14:00:00Z",
      "subject": "Upset customer call",
      "summary": [{ "type": "summary", "vendor": "OpenAI", "body": "..." }],
      "search": { "mode": "keyword", "content_type": "dialog", "content_index": 0, "relevance_score": 0.91, "snippet": "..." }
    }
  ],
  "page": { "count": 1, "total": 187, "next_cursor": "eyJvZmZzZXQiOjI1fQ" },
  "meta": { "mode": "keyword", "include": ["core", "summary"], "approximate_bytes": 640, "max_response_bytes": 250000 }
}
```

- Every item carries the core fields (`id`, `vcon_version`, `created_at`, `updated_at`, `subject`, `extensions`, `critical`) whatever `include` says. `include` adds the other groups (see the include table under `vcon_fetch`).
- The `search` object depends on the mode. `metadata`: `{ mode }`. `keyword`: `mode`, `content_type`, `content_index`, `relevance_score`, `snippet`. `semantic`: `mode`, `content_type`, `content_reference`, `similarity_score`, `content_text`. `hybrid`: `mode`, `combined_score`, `semantic_score`, `keyword_score`.
- `page.total` is the full match count for `metadata` and `keyword` modes. Semantic and hybrid modes omit it.
- `page.next_cursor` is `null` on the last page. The cursor is currently base64url JSON holding an offset; treat it as opaque.
- With `mode: "metadata"` and `tags`, only the newest 100000 matches are reachable through cursors. When the total exceeds that, `page.iterable_total` is set to 100000.
- When fewer than `limit` items come back, `meta.short_page_reason` is one of `keyword_dedup_or_rank_window`, `below_limit_more_results_exist`, or `end_of_searchable_results`.
- Oversized results return `RESPONSE_TOO_LARGE` with narrowing suggestions instead of truncating.

**Highlights:**
- explicit `include` groups such as `core`, `summary`, `dealer`, `tags`
- cursor pagination via `page.next_cursor` (there is no `offset`)
- explicit response budgeting with `max_response_bytes`
- loud failure with `RESPONSE_TOO_LARGE` instead of silent truncation

**Example:**

```typescript
{
  "mode": "keyword",
  "query": "billing issue refund",
  "tags": { "department": "support", "priority": "high" },
  "include": ["core", "summary", "dealer", "tags"],
  "limit": 20
}
```

### vcon_fetch

Single-record fetch with one stable response shape.

**Input Parameters:**

```typescript
{
  id: string,                  // vCon UUID (required)
  include?: string[],          // Default: ["core", "parties", "summary"]
  max_response_bytes?: number  // Integer >= 1024, default 250000
}
```

**Include groups:**

| Group | Adds to `item` |
|-------|----------------|
| `core` | `id`, `vcon_version`, `created_at`, `updated_at`, `subject`, `extensions`, `critical` (always present) |
| `parties` | `parties` |
| `summary` | `summary`: the analysis entries of type `summary`, each with `type`, `vendor`, `product`, `schema`, `encoding`, `dialog`, and `body` when it is a non-empty string |
| `tags` | `tags`: parsed tag key/value object |
| `dealer` | `dealer`: parsed dealer attachment (type from `VCON_DEALER_ATTACHMENT_TYPE`, default `dealer`; `id` as string, `name`, `outboundPhoneNumber`, `team`) or `null` |
| `counts` | `counts`: `{ parties, dialog, analysis, attachments }` |
| `dialog`, `analysis`, `attachments` | The full arrays |

**Response:**

```json
{
  "ok": true,
  "item": { "id": "...", "summary": [], "dealer": null },
  "meta": { "include": ["core", "summary", "dealer"], "approximate_bytes": 612, "max_response_bytes": 250000 }
}
```

**Highlights:**
- explicit `include` groups instead of `response_format`
- normalized primary identifier field: `id`
- useful lightweight pattern: `include=["core","summary","dealer"]`
- explicit response budgeting with `max_response_bytes`

### describe_response_shape

Return the published JSON schema plus one concrete example for redesigned and legacy tools. Use this when a client needs to probe actual envelope structure before wiring a parser.

**Input Parameters:**

```typescript
{
  tool_name?: string,        // Omit to list every tool with a descriptor
  include_example?: boolean  // Default: true
}
```

**Response:** With `tool_name`, `{ ok: true, item: { tool_name, summary, response_schema, example?, notes? } }`. Without it, `{ ok: true, items: [{ tool_name, summary }], page: { count, total, next_cursor: null } }`.

Descriptors exist for `vcon_fetch`, `vcon_taxonomy`, `vcon_capabilities`, `vcon_graph_shape`, `vcon_search`, `vcon_aggregate`, `describe_response_shape`, `get_vcon`, `search_vcons`, `search_by_tags`, `search_vcons_content`, `search_vcons_semantic`, and `search_vcons_hybrid`. Any other name returns `UNKNOWN_TOOL`.

---

### vcon_aggregate

Server-side rollup for rate-style questions: which groups have the highest share of vCons matching a tag filter. Groups vCons by an attachment-derived key (this release: the dealer attachment id, where a deployment stores one; type from `VCON_DEALER_ATTACHMENT_TYPE`) and returns `filtered_count` (rows matching the supplied tags) and `baseline_count` (all rows in the group), so a client can divide for a rate in one round trip. Requires the Postgres RPC `aggregate_vcons_by_dealer_stats` from the latest migration.

**Input Parameters:**

```typescript
{
  group_by?: "dealer",                 // Only value supported; default "dealer"
  tags?: { [key: string]: string },    // Numerator filter; default {} (baseline-only ranking)
  filters?: {
    start_date?: string,
    end_date?: string,
    date_field?: "created" | "conversation"  // Window on created_at (default) or conversation_start
  },
  having?: { min_count?: number },     // Floor on baseline_count per group; minimum and default 1
  limit?: number                       // Default 20, range 1-500 (clamped)
}
```

**Response:**

```json
{
  "ok": true,
  "item": {
    "group_by": "dealer",
    "rows": [
      { "dealer_id": "1174", "dealer_name": "Example Motors", "team_id": 8, "team_name": "Purple Team", "filtered_count": 42, "baseline_count": 600 }
    ]
  }
}
```

`group_by` other than `"dealer"` returns `INVALID_ARGUMENT`.

---

### vcon_graph_shape

Return the default OSS vCon shape graph for the corpus: nodes for analysis types, attachment purposes, legacy attachment types (when purpose is absent), and tag keys, plus optional co-occurrence edges between analysis types and attachment purposes. Spec-generic structure only, no business ontology. Returns the same payload as the resource `vcon://v1/graph/shape`; prefer the resource when the client supports resources.

**Input Parameters:** none.

**Response:** `{ ok: true, item }` where `item` is the shape graph document (`schema_version`, `generated_at`, `corpus`, `nodes`, `edges`). Failures return `SHAPE_GRAPH_FAILED`.

---

## Core Operations

Legacy tools in this document return `{ success: true, ... }` on success and signal failure by throwing an MCP error. See [Error Responses](#error-responses).

### create_vcon

Create a new vCon (Virtual Conversation) record. The server generates `created_at` and sets `vcon` to `"0.4.0"`. The `uuid` is optional: when supplied (a valid UUID) it is used as the vCon identifier, so re-posting the same `uuid` replaces the stored vCon instead of creating a duplicate (idempotent create). Without it the server generates one. An invalid `uuid` is rejected with `InvalidParams`.

**Input Parameters:**

```typescript
{
  uuid?: string,              // Optional UUID; makes the create idempotent (re-post replaces)
  subject?: string,           // Conversation subject
  parties: Party[],           // Required, at least one
  dialog?: Dialog[],          // Optional inline conversation content
  analysis?: Analysis[],      // Optional inline analysis (vendor required on each)
  attachments?: Attachment[], // Optional inline attachments
  extensions?: string[],      // Optional extension identifiers
  critical?: string[],        // Extensions that must be supported (v0.4.0)
  must_support?: string[]     // Deprecated alias for critical; used only when critical is absent
}
```

See [Child object fields](#child-object-fields) for the shape of `Party`, `Dialog`, `Analysis`, and `Attachment`. The whole vCon is validated before it is stored; a failure is an `InvalidParams` error listing every problem. Legacy `mimetype` keys on dialog, analysis, and attachments are renamed to `mediatype`.

**Response:**

```typescript
{
  success: true,
  uuid: string,
  message: string,       // "Created vCon with UUID: ..."
  vcon: object,          // The stored vCon
  warnings: string[]     // Lawful basis findings; empty when a well-formed lawful_basis attachment is present
}
```

`warnings` is never blocking. When the vCon has no attachment with `purpose` (or legacy `type`) `"lawful_basis"`, it contains `no lawful_basis attachment: this vCon carries no record of the lawful basis for processing`. When one exists, `warnings` lists problems with its body (unknown basis value, missing or past `expiration`, empty `purpose_grants` or `proof_mechanisms`). The server never adds a lawful basis on its own.

**Example:**

```typescript
{
  "subject": "Customer Support Call",
  "parties": [
    { "name": "Agent Smith", "mailto": "smith@company.com" },
    { "name": "John Doe", "tel": "+1-555-1234" }
  ]
}
```

---

### get_vcon

Retrieve a vCon by UUID.

**Input Parameters:**

```typescript
{
  uuid: string,                                  // vCon UUID (required)
  response_format?: "full" | "summary" | "metadata"  // Default: "full"
}
```

- `full`: the complete vCon.
- `summary`: top-level fields (`vcon`, `uuid`, `created_at`, `updated_at`, `subject`, `extensions`, `critical`), `parties`, and only the analysis entries of type `summary`. Recommended for browsing, since transcripts can be very large.
- `metadata`: the same top-level fields and `parties`, with no dialog, analysis, or attachments.

**Response:**

```typescript
{
  success: true,
  vcon: object
}
```

Reads run the `beforeRead` and `afterRead` plugin hooks. A missing vCon raises an `InternalError` whose message contains `not found`.

**Example:**

```typescript
{
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "response_format": "summary"
}
```

---

### update_vcon

Update top-level vCon fields. Dialog, analysis, attachments, and parties have their own tools.

**Input Parameters:**

```typescript
{
  uuid: string,            // vCon UUID (required)
  updates: {               // Required
    subject?: string,
    extensions?: string[],
    critical?: string[],
    must_support?: string[]  // Deprecated alias; ignored when critical is also given
  },
  return_updated?: boolean   // Default: true
}
```

Only `subject`, `extensions`, and `critical` are applied. Any other key in `updates` is dropped without an error. Updating a UUID that does not exist fails when the vCon is read back, with an `InternalError` whose message contains `not found`.

**Response:**

```typescript
// return_updated true (default)
{ success: true, vcon: object }

// return_updated false
{ success: true, message: string }
```

Runs the `beforeUpdate` and `afterUpdate` plugin hooks.

**Example:**

```typescript
{
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "updates": {
    "subject": "Updated: Customer Support Call - Resolved"
  }
}
```

---

### delete_vcon

Delete a vCon and all related data (parties, dialog, analysis, attachments). This cannot be undone.

**Input Parameters:**

```typescript
{
  uuid: string   // vCon UUID (required)
}
```

There is no confirmation flag; the call deletes immediately. Runs the `beforeDelete` and `afterDelete` plugin hooks.

**Response:**

```typescript
{
  success: true,
  message: string   // "Deleted vCon <uuid>"
}
```

A missing vCon raises an `InvalidRequest` error (`vCon with UUID <uuid> not found`).

**Example:**

```typescript
{
  "uuid": "123e4567-e89b-12d3-a456-426614174000"
}
```

---

### create_vcon_from_template

Create a vCon from a predefined template.

**Input Parameters:**

```typescript
{
  template_name: "phone_call" | "chat_conversation" | "email_thread" | "video_meeting" | "custom",  // Required
  parties: Party[],   // Required, at least one
  subject?: string,
  lawful_basis?: {    // Optional; attached as a lawful_basis attachment only when supplied
    lawful_basis: "consent" | "contract" | "legal_obligation" | "vital_interests" | "public_task" | "legitimate_interests",
    expiration?: string | null,
    purpose_grants?: object[],
    proof_mechanisms?: object[]
  }
}
```

The server never invents a lawful basis. When `lawful_basis` is supplied it is stored as an attachment with `purpose` and `type` `"lawful_basis"`, `mediatype` `application/json`, `encoding` `json`, and the object serialized as the string `body`. When omitted, no attachment is added and `warnings` reports the missing lawful basis. `create_vcon` already accepts inline `attachments`, so it needs no extra parameter.

**What a template adds:** the template sets the vCon version to `0.4.0`, generates the `uuid` and `created_at`, and stores your `parties` and `subject`. `phone_call`, `chat_conversation`, and `video_meeting` add an empty `dialog` array. `email_thread` adds an empty `attachments` array. `custom` adds nothing. The templates do not add timestamps, durations, or threading data. An unrecognized `template_name` behaves like `custom`.

**Response:**

```typescript
{
  success: true,
  uuid: string,
  vcon: object,
  warnings: string[]   // Lawful basis findings, as for create_vcon
}
```

**Example:**

```typescript
{
  "template_name": "phone_call",
  "subject": "Sales Call",
  "parties": [
    { "name": "Sales Rep", "mailto": "rep@company.com" },
    { "name": "Prospect", "mailto": "prospect@client.com" }
  ]
}
```

---

## Component Management

Index-addressed tools use zero-based positions in the vCon's `parties`, `dialog`, `analysis`, and `attachments` arrays. These tools write through the database layer directly and do not run plugin hooks.

### Child object fields

These shapes apply to `create_vcon` and to every add and update tool below. The Zod parsers accept extra keys and keep them as extension keys.

**Party** (all optional, but at least one of `tel`, `sip`, `mailto`, `name`, `uuid` must be present):
`name`, `tel`, `mailto`, `sip`, `stir`, `did`, `uuid`, `validation`, `jcard` (object), `gmlpos`, `civicaddress` (object), `timezone`.

**Dialog**:
`type` (required: `recording`, `text`, `transfer`, `incomplete`), `start` (ISO 8601), `duration` (seconds), `parties` (index, list of indexes, or nested lists), `originator`, `mediatype`, `filename`, `body`, `encoding`, `url`, `content_hash`, `disposition`, `session_id`, `application`, `message_id`, `party_history` (`[{ party, time, event }]` with `event` one of `join`, `drop`, `hold`, `unhold`, `mute`, `unmute`), and the transfer fields `transferee`, `transferor`, `transfer_target`, `original`, `consultation`, `target_dialog`.

- `incomplete` dialogs require a `disposition` string.
- `session_id` is a `{ local, remote }` object, or an array of them (vCon 0.4.0). A plain string, the pre-0.4.0 form, is still accepted and stored as given.
- `create_vcon` also requires `transferee`, `transferor`, and `transfer_target` on `transfer` dialogs.

**Analysis**:
`type` (required), `vendor` (required), `product`, `schema` (a schema identifier, not a version), `dialog` (index or list of indexes), `body`, `encoding`, `mediatype`, `filename`, `url`, `content_hash`.

**Attachment**:
`purpose` (the spec field for classification), `type` (legacy name for the same thing), `party`, `dialog`, `start`, `mediatype`, `filename`, `body`, `encoding`, `url`, `content_hash`.

- An attachment needs either `body` with `encoding`, or `url` with `content_hash`.

**Body and encoding.** `encoding` is `base64url`, `json`, or `none`, and has no default. `body` is a string, except that when `encoding` is `json` it may be any JSON value (object, array, number, boolean, or null). A non-string body with any other `encoding`, or with none, is rejected. `content_hash` is a string or a list of strings.

### add_dialog

Add a dialog entry (conversation segment) to a vCon.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,   // required
  dialog: Dialog       // required; see Child object fields
}
```

The input schema advertises `type`, `start`, `duration`, `parties`, `body`, `encoding`, `mediatype`, `session_id`, `application`, and `message_id`. The handler parses the full dialog shape, so the other dialog fields are also accepted.

**Response:**

```typescript
{
  success: true,
  message: string,   // "Added <type> dialog to vCon <uuid>"
  dialog: object     // The dialog as parsed; no index is returned
}
```

**Example:**

```typescript
{
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "dialog": {
    "type": "text",
    "start": "2025-10-14T10:30:00Z",
    "parties": [0, 1],
    "originator": 1,
    "body": "Hello, I need help with my account.",
    "encoding": "none"
  }
}
```

---

### add_analysis

Add AI/ML analysis results to a vCon.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,   // required
  analysis: Analysis   // required; type and vendor are required
}
```

A missing `vendor` is an `InvalidParams` error. The legacy key `schema_version` is rejected; use `schema`.

**Common Analysis Types:**

- `sentiment` - Sentiment analysis
- `summary` - Conversation summary
- `transcript` - Transcription
- `translation` - Translation
- `keywords` - Keyword extraction
- `entities` - Named entity recognition
- `topics` - Topic classification
- `action_items` - Action item extraction

**Response:**

```typescript
{
  success: true,
  message: string,    // "Added <type> analysis from <vendor> to vCon <uuid>"
  analysis: object    // The analysis as parsed; no index is returned
}
```

**Example:**

```typescript
{
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "analysis": {
    "type": "sentiment",
    "vendor": "OpenAI",
    "product": "GPT-4",
    "schema": "sentiment-v1",
    "body": "{\"sentiment\": \"positive\", \"score\": 0.85, \"confidence\": 0.92}",
    "encoding": "json",
    "dialog": [0]
  }
}
```

---

### add_attachment

Add an attachment (file, document, etc.) to a vCon. Use `purpose` to classify the attachment; `type` is the legacy name for the same field.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,      // required
  attachment: Attachment  // required; see Child object fields
}
```

**Response:**

```typescript
{
  success: true,
  message: string,       // "Added attachment to vCon <uuid>"
  attachment: object     // The attachment as parsed; no index is returned
}
```

**Example:**

```typescript
{
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "attachment": {
    "purpose": "invoice",
    "mediatype": "application/pdf",
    "filename": "invoice-12345.pdf",
    "body": "base64url-encoded-pdf-content",
    "encoding": "base64url"
  }
}
```

---

### add_party

Append a party to an existing vCon.

```typescript
{
  vcon_uuid: string,   // required
  party: Party         // required; see Child object fields
}
// Response: { success: true, message, index, party }
```

`index` is the zero-based position of the new party. Later `dialog.parties`, `attachment.party`, and similar references use it.

---

### Sub-resource Updates & Removal

Index-addressed edits to a vCon's child arrays. Each tool takes `vcon_uuid` plus an integer `index` (zero or greater, the element's position in its array). **Update** tools use PUT semantics: omitted fields are cleared. **Removal** follows IETF core-02 §4.1.8: party and dialog removals preserve the slot as a placeholder so positional references (`dialog.parties`, `attachment.party`, `analysis.dialog`, etc.) do not shift; analysis and attachment removals hard-delete the element and renumber the rest.

| Tool | Parameters | Behavior |
|------|-----------|----------|
| `update_party` | `vcon_uuid`, `index`, `party` | Replace the party at `index` |
| `remove_party` | `vcon_uuid`, `index`, `anonymize?` | Remove party; leaves an empty placeholder, or `{name:"anonymous"}` when `anonymize=true` |
| `update_dialog` | `vcon_uuid`, `index`, `dialog` | Replace the dialog at `index` |
| `remove_dialog` | `vcon_uuid`, `index` | Remove dialog; leaves a content-stripped placeholder that keeps `type` |
| `update_analysis` | `vcon_uuid`, `index`, `analysis` | Replace the analysis at `index` (`vendor` required) |
| `remove_analysis` | `vcon_uuid`, `index` | Hard-delete; remaining analyses renumbered contiguously |
| `update_attachment` | `vcon_uuid`, `index`, `attachment` | Replace the attachment at `index` |
| `remove_attachment` | `vcon_uuid`, `index` | Hard-delete and renumber; removing a `tags` attachment clears the vCon's tags |

Update tools return `{ success: true, message, <party|dialog|analysis|attachment> }` with the replacement object echoed back. Remove tools return `{ success: true, message }`. An `index` that is missing, negative, or not an integer, or that is out of range for the array, is an `InvalidParams` error.

---

## Search & Query

The four legacy search tools return `{ success, count, response_format, results }`. None of them takes an `offset`, and none returns `has_more`. To page through results, use `vcon_search` with its cursor. Dates are ISO 8601; a date that cannot be parsed is silently ignored. The `limit` maximum of 1000 is declared in each tool's input schema.

### search_vcons

Basic search with filtering by metadata (subject, parties, dates, tags).

**Input Parameters:**

```typescript
{
  subject?: string,       // Case-insensitive partial match
  party_name?: string,    // Case-insensitive partial match
  party_email?: string,
  party_tel?: string,
  start_date?: string,    // On or after (created_at unless date_field is "conversation")
  end_date?: string,      // On or before
  date_field?: "created" | "conversation",  // Default: "created". See Date fields below
  tags?: { [key: string]: string },
  limit?: number,         // Default: 10, max: 1000
  response_format?: "full" | "metadata" | "ids_only",  // Default: "metadata"
  include_count?: boolean // Default: false
}
```

**Response:**

```typescript
{
  success: true,
  count: number,                 // Rows returned
  response_format: string,
  results: VCon[] | MetadataRow[] | string[],
  total_count?: number           // Only when include_count is true and the count succeeds
}
```

`metadata` rows are `{ uuid, subject, created_at, conversation_start, parties_count, dialog_count, analysis_count, attachments_count }`. `ids_only` returns UUID strings. Runs the `beforeSearch` and `afterSearch` plugin hooks.

**Example:**

```typescript
{
  "subject": "support",
  "start_date": "2025-10-01T00:00:00Z",
  "limit": 20,
  "include_count": true
}
```

---

#### Date fields

Every tool that takes `start_date`/`end_date` also takes `date_field`:

| Value | Column | Meaning |
|-------|--------|---------|
| `created` (default) | `vcons.created_at` | When the vCon object was created. The vCon core draft does not allow it to be backdated |
| `conversation` | `vcons.conversation_start` | When the conversation happened. See the rule below |

Use `conversation` for imported historical conversations, where `created_at` is the import time.

`conversation_start` is, ignoring NULL starts and starts before `1990-01-01T00:00:00Z` (placeholders):

1. the earliest `dialog[].start`, if any dialog has one
2. otherwise the earliest `attachments[].start`, capped at `created_at`
3. otherwise `created_at`

Attachment starts are capped because some vCon libraries stamp every attachment's `start` with the
write time, so an enrichment attachment added later would otherwise move the conversation past
`created_at`. Dialog starts are not capped.
`conversation_start` is maintained by database triggers (migration
`20261019171238_add_conversation_start.sql`); without that migration, `date_field: "conversation"`
fails with a database error while the default keeps working. The MongoDB backend rejects
`conversation`. Search results that return `created_at` also return `conversation_start`.

---

### search_vcons_content

Full-text keyword search across subject, dialog, analysis, and party content.

**Input Parameters:**

```typescript
{
  query: string,          // Required, non-empty
  tags?: { [key: string]: string },
  start_date?: string,
  end_date?: string,
  date_field?: "created" | "conversation",  // Default: "created"
  limit?: number,         // Default: 50, max: 1000
  response_format?: "full" | "snippets" | "metadata" | "ids_only",  // Default: "snippets"
  include_count?: boolean // Default: false
}
```

**Response:**

```typescript
{
  success: true,
  count: number,          // Matching rows from the search, before any de-duplication
  response_format: string,
  results: Row[],
  total_count?: number    // Only when include_count is true and the count succeeds
}
```

Row shape by `response_format`:

- `snippets`: `{ vcon_id, content_type, content_index, relevance_score, snippet }`. Snippets are cut to 500 characters.
- `metadata`: `{ vcon_id, content_type, relevance_score }`
- `ids_only`: `vcon_id` strings, with no de-duplication across matches in the same vCon
- `full`: complete vCons for the unique matches, first 20 only

`content_type` is `subject`, `party`, `dialog`, or `analysis`. Expect large transcripts: use `get_vcon` with `response_format: "summary"` on the returned ids instead of `full`.

**Example:**

```typescript
{
  "query": "billing issue refund",
  "tags": { "department": "support" },
  "limit": 25
}
```

---

### search_vcons_semantic

Semantic search using embeddings.

**Input Parameters:**

```typescript
{
  query?: string,         // Natural language query; embedded for you
  embedding?: number[],   // Or provide a vector directly (exactly 384 dimensions)
  threshold?: number,     // Minimum similarity, 0-1, default: 0.7 (0 is honoured)
  tags?: { [key: string]: string },
  limit?: number,         // Default: 50, max: 1000
  response_format?: "full" | "metadata" | "ids_only"  // Default: "metadata"
}
```

Either `query` or `embedding` is required. When only `query` is given, the vector comes from the configured embedding provider (Supabase `gte-small` by default, or OpenAI when `OPENAI_API_KEY` is set or `EMBEDDING_PROVIDER=openai`). Query vectors must come from the same model as the stored corpus vectors.

**Response:**

```typescript
{
  success: true,
  count: number,          // Matching hits
  response_format: string,
  results: Row[]
}
```

- `metadata`: one row per hit: `{ vcon_id, content_type, content_reference, content_text, similarity_score }`
- `ids_only`: unique vCon UUIDs in rank order
- `full`: complete vCons for the unique matches in rank order, first 20 only

This tool has no `include_count` and returns no `total_count`.

**Example:**

```typescript
{
  "query": "customer frustrated about late delivery",
  "threshold": 0.75,
  "tags": { "priority": "high" },
  "limit": 15
}
```

---

### search_vcons_hybrid

Combined keyword and semantic search.

**Input Parameters:**

```typescript
{
  query: string,            // Required
  embedding?: number[],     // Optional vector (exactly 384 dimensions); generated from query when absent
  semantic_weight?: number, // 0-1, default: 0.6 (0 is honoured: keyword only)
  tags?: { [key: string]: string },
  limit?: number,           // Default: 50, max: 1000
  response_format?: "full" | "metadata" | "ids_only"  // Default: "metadata"
}
```

If the query embedding cannot be generated, the search falls back to keyword-only ranking. The tool has no date filters and no `include_count`.

**Response:**

```typescript
{
  success: true,
  count: number,
  response_format: string,
  results: Row[]
}
```

- `metadata`: `{ vcon_id, combined_score, semantic_score, keyword_score }`. A `keyword_score` of 0 only means the vCon was found semantically.
- `ids_only`: unique vCon UUIDs in rank order
- `full`: complete vCons for the unique matches in rank order, first 20 only

**Example:**

```typescript
{
  "query": "pricing discussion discount",
  "semantic_weight": 0.5,
  "tags": { "department": "sales" },
  "limit": 20
}
```

---

## Tag Management

The tag toolset was consolidated to 5 tools. Tags are stored as a
special vCon attachment (`type: "tags"`, `encoding: "json"`, body is a
JSON array of `"key:value"` strings). The attachment is also readable as
`purpose: "tags"`; the database mirrors the two fields on write.

### manage_tag

Add, update, or remove a single tag on a vCon. Replaces the older
`add_tag`, `update_tags`, and `remove_tag` tools.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,                       // vCon UUID (required)
  action: "set" | "remove",                // (required)
  key: string,                             // Tag key (required)
  value?: string | number | boolean        // Required when action="set"
}
```

**Response (on success):**

```typescript
{
  success: true,
  message: string,
  action: "set" | "remove",
  key: string,
  value?: string                            // Stringified, only when action="set"
}
```

**Examples:**

```typescript
// Set a tag
{
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "action": "set",
  "key": "department",
  "value": "sales"
}

// Remove a tag
{
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "action": "remove",
  "key": "department"
}
```

---

### get_tags

Retrieve tags from a vCon. Provide a specific `key` to get one tag, or
omit `key` to get all tags. Replaces the older `get_tag` and
`get_all_tags` tools.

**Input Parameters:**

```typescript
{
  vcon_uuid: string,                                       // (required)
  key?: string,                                            // Omit for all tags
  default_value?: string | number | boolean | null         // Used when key is provided
}
```

**Response for a single tag (key provided):**

```typescript
{
  success: true,
  key: string,
  value: string | number | boolean | null,
  exists: boolean
}
```

**Response for all tags (key omitted):**

```typescript
{
  success: true,
  vcon_uuid: string,
  tags: { [key: string]: string },
  count: number
}
```

**Example Response (all tags):**

```json
{
  "success": true,
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "tags": {
    "department": "sales",
    "priority": "high",
    "status": "open",
    "customer_id": "CUST-12345"
  },
  "count": 4
}
```

---

### remove_all_tags

Remove all tags from a vCon.

**Input Parameters:**

```typescript
{
  vcon_uuid: string                       // (required)
}
```

---

### search_by_tags

Find vCons by tag criteria. All specified tags must match (AND logic).

**Input Parameters:**

```typescript
{
  tags: { [key: string]: string },        // Non-empty object (required)
  limit?: number,                          // Default: 50, max: 100
  return_full_vcons?: boolean,             // Default: automatic (see below)
  max_full_vcons?: number                  // Default: 20, max: 50
}
```

**Response:**

```typescript
{
  success: true,
  count: number,                           // Matching UUIDs returned (up to limit)
  tags_searched: object,
  vcon_uuids: string[],                    // All matching UUIDs (up to limit)
  vcons?: VCon[],                          // Present when full vCons are returned
  message?: string                         // Present when vcons is absent or truncated
}
```

**Behavior:**

- Always returns `vcon_uuids` for matching vCons (up to `limit`).
- When `return_full_vcons` is omitted, full vCons are returned automatically if there are 20 or fewer matches, and omitted for larger result sets to keep the response under MCP size limits.
- `return_full_vcons: true` returns full vCons for any result size; `false` returns UUIDs only.
- At most `max_full_vcons` full vCons are returned, taken from the front of `vcon_uuids`. When that is fewer than the match count, `message` says so.
- `tags` must be a non-empty object. Null, undefined, an array, or `{}` is rejected, and so is any tag value that is itself an object. Other values are converted to strings.

**Example:**

```typescript
{
  "tags": {
    "department": "support",
    "priority": "high",
    "status": "open"
  },
  "limit": 25
}
```

---

### get_unique_tags

Discover all unique tag keys and values across the database. Useful for
building selection UIs and tag analytics.

**Input Parameters:**

```typescript
{
  include_counts?: boolean,                // Include usage counts; default false
  key_filter?: string,                     // Case-insensitive key filter (see note)
  min_count?: number                       // Minimum occurrence; default 1
}
```

`key_filter` matches the start of the key on the materialized-view path, which is the normal path. The fallback batch scan, used only when the view or `exec_sql` RPC is unavailable, matches anywhere in the key.

**Response:**

```typescript
{
  success: true,
  unique_keys: string[],
  unique_key_count: number,
  tags_by_key: {
    [key: string]: string[]                // All distinct values per key
  },
  counts_per_value?: {                     // Only when include_counts=true
    [key: string]: { [value: string]: number }
  },
  total_vcons_with_tags: number,
  summary: {
    total_unique_keys: number,
    total_vcons: number,
    filter_applied: boolean,               // true when key_filter was given
    min_count_filter: number
  }
}
```

**Example:**

```typescript
{
  "include_counts": true,
  "key_filter": "department"
}
```

---

## Database Tools

### get_database_shape

Get database structure, sizes, and indexes.

**Input Parameters:**

```typescript
{
  include_counts?: boolean,   // Default: true
  include_sizes?: boolean,    // Default: true
  include_indexes?: boolean,  // Default: true
  include_columns?: boolean   // Default: false
}
```

**Response:**

```typescript
{
  success: boolean,
  database_shape: {
    timestamp: string,
    tables: [{
      name: string,
      schema: string,
      row_count: number,
      total_size: string,
      table_size: string,
      indexes_size: string,
      indexes?: Array<{
        indexname: string,
        index_type: string,
        index_size: string
      }>,
      columns?: Array<{
        column_name: string,
        data_type: string,
        is_nullable: string
      }>
    }],
    relationships: Array<{
      from_table: string,
      from_column: string,
      to_table: string,
      to_column: string
    }>
  }
}
```

---

### get_database_stats

Get performance metrics and usage statistics.

**Input Parameters:**

```typescript
{
  include_query_stats?: boolean,   // Default: true
  include_index_usage?: boolean,   // Default: true
  include_cache_stats?: boolean,   // Default: true
  table_name?: string               // Specific table
}
```

**Response:**

```typescript
{
  success: boolean,
  database_stats: {
    timestamp: string,
    cache_stats: {
      hit_ratio: string,
      heap_blocks_hit: number,
      heap_blocks_read: number
    },
    table_stats: Array<{
      table_name: string,
      sequential_scans: number,
      index_scans: number,
      inserts: number,
      updates: number,
      deletes: number,
      live_rows: number,
      dead_rows: number
    }>,
    index_usage: Array<{
      table_name: string,
      index_name: string,
      scans: number,
      rows_read: number
    }>,
    unused_indexes: Array<{
      table_name: string,
      index_name: string,
      index_size: string
    }>
  }
}
```

---

### analyze_query

Analyze SQL query execution plan (limited support).

**Input Parameters:**

```typescript
{
  query: string,          // SELECT query (required)
  analyze_mode?: "explain" | "explain_analyze"  // Default: "explain"
}
```

**Note:** Has limited support due to RPC constraints. Use direct database access for full EXPLAIN capabilities. Only queries starting with `SELECT` are accepted; anything else fails the call. The response is `{ success: true, query_analysis }`.

---

## Database Analytics

### get_database_analytics

Get database analytics including size, growth trends, content distribution, and health metrics.

**Input Parameters:**

```typescript
{
  include_growth_trends?: boolean,      // Include monthly growth trends (default: true)
  include_content_analytics?: boolean,  // Include content analysis (default: true)
  include_attachment_stats?: boolean,   // Include attachment statistics (default: true)
  include_tag_analytics?: boolean,      // Include tag usage patterns (default: true)
  include_health_metrics?: boolean,     // Include health metrics (default: true)
  months_back?: number                  // Months to analyze (default: 12)
}
```

**Response:**

```typescript
{
  success: true,
  database_analytics: {
    timestamp: string,
    summary: {
      total_vcons: number,
      total_parties: number,
      total_dialogs: number,
      total_analysis: number,
      total_attachments: number,
      total_size_bytes: number,
      total_size_pretty: string,
      database_health_score: number
    },
    tables: {
      [table_name]: {
        row_count: number,
        total_size: string,
        table_size: string
      }
    },
    growth: {
      monthly_data: Array<{
        month: string,
        vcon_count: number,
        total_size: number
      }>,
      summary: {
        total_growth: number,
        avg_monthly_growth: number,
        growth_percentage: number
      }
    },
    content: {
      dialog_types: Array<{
        type: string,
        count: number,
        avg_duration: number
      }>,
      analysis_types: Array<{
        type: string,
        vendor: string,
        count: number
      }>,
      party_roles: Array<{
        role: string,
        count: number,
        unique_names: number
      }>
    },
    attachments: {
      type_breakdown: Array<{
        type: string,
        count: number,
        total_size: number,
        percentage: number
      }>,
      size_distribution: Array<{
        size_bucket: string,
        count: number,
        percentage: number
      }>
    },
    tags: {
      tag_frequency: Array<{
        key: string,
        usage_count: number,
        unique_values: number
      }>,
      value_distribution: Array<{
        key: string,
        value: string,
        count: number,
        percentage: number
      }>
    },
    health: {
      table_performance: Array<{
        table_name: string,
        sequential_scans: number,
        index_scans: number,
        dead_row_percentage: number
      }>,
      index_usage: Array<{
        table_name: string,
        index_name: string,
        scans: number,
        health_status: string
      }>
    }
  }
}
```

**Example:**

```typescript
{
  "include_growth_trends": true,
  "include_content_analytics": true,
  "months_back": 6
}
```

---

### get_monthly_growth_analytics

Get detailed monthly growth analytics with trends and projections.

**Input Parameters:**

```typescript
{
  months_back?: number,           // Months to analyze (default: 12)
  include_projections?: boolean,  // Include growth projections (default: true)
  granularity?: 'monthly' | 'weekly' | 'daily'  // Time granularity (default: 'monthly')
}
```

**Response:**

```typescript
{
  success: true,
  monthly_growth_analytics: {
    timestamp: string,
    period: string,
    granularity: string,
    trends: {
      vcon_creation: Array<{
        period: string,
        vcon_count: number,
        unique_vcons: number
      }>,
      size_growth: Array<{
        period: string,
        dialog_size: number,
        attachment_size: number,
        total_size: number
      }>,
      content_volume: Array<{
        period: string,
        vcon_count: number,
        dialog_count: number,
        analysis_count: number,
        attachment_count: number
      }>
    },
    growth_rates: {
      vcon_growth_rate: number,
      size_growth_rate: number
    },
    projections: {
      next_3_months: {
        projected_vcons: number,
        projected_size: number,
        projected_size_pretty: string
      },
      growth_rates: {
        vcon_growth_rate: number,
        size_growth_rate: number
      }
    }
  }
}
```

---

### get_attachment_analytics

Get attachment analytics including file type distribution and size analysis.

**Input Parameters:**

```typescript
{
  include_size_distribution?: boolean,  // Include size distribution (default: true)
  include_type_breakdown?: boolean,     // Include file type breakdown (default: true)
  include_temporal_patterns?: boolean,  // Include temporal patterns (default: false)
  top_n_types?: number                  // Top N file types to analyze (default: 10)
}
```

**Response:**

```typescript
{
  success: true,
  attachment_analytics: {
    timestamp: string,
    summary: {
      total_attachments: number,
      total_size: number,
      avg_size: number,
      unique_types: number,
      vcons_with_attachments: number
    },
    type_breakdown: Array<{
      type: string,
      count: number,
      total_size: number,
      avg_size: number,
      percentage: number
    }>,
    size_distribution: Array<{
      size_bucket: string,
      count: number,
      total_size: number,
      percentage: number
    }>,
    temporal_patterns: Array<{
      month: string,
      attachment_count: number,
      total_size: number,
      avg_size: number
    }>
  }
}
```

---

### get_tag_analytics

Get tag analytics including usage patterns and value distribution.

**Input Parameters:**

```typescript
{
  include_frequency_analysis?: boolean,  // Include frequency analysis (default: true)
  include_value_distribution?: boolean,  // Include value distribution (default: true)
  include_temporal_trends?: boolean,     // Include temporal trends (default: false)
  top_n_keys?: number,                   // Top N tag keys to analyze (default: 20)
  min_usage_count?: number               // Minimum usage count filter (default: 1)
}
```

**Response:**

```typescript
{
  success: true,
  tag_analytics: {
    timestamp: string,
    summary: {
      unique_keys: number,
      unique_values: number,
      vcons_with_tags: number,
      total_tag_assignments: number
    },
    frequency_analysis: Array<{
      key: string,
      usage_count: number,
      unique_values: number,
      vcons_with_tag: number,
      avg_values_per_key: number
    }>,
    value_distribution: Array<{
      key: string,
      value: string,
      count: number,
      percentage: number
    }>,
    temporal_trends: Array<{
      month: string,
      key: string,
      usage_count: number
    }>
  }
}
```

---

### get_content_analytics

Get content analytics including dialog types, analysis breakdown, and conversation metrics.

**Input Parameters:**

```typescript
{
  start_date?: string,                   // ISO 8601; only vCons created on or after this date
  end_date?: string,                     // ISO 8601, exclusive; only vCons created before this date
  date_field?: "created" | "conversation", // Default "created"; "conversation" scopes by conversation_start
  include_dialog_analysis?: boolean,     // Include dialog analysis (default: true)
  include_analysis_breakdown?: boolean,  // Include analysis breakdown (default: true)
  include_party_patterns?: boolean,      // Include party patterns (default: true)
  include_conversation_metrics?: boolean, // Include conversation metrics (default: true)
  include_temporal_content?: boolean     // Include temporal content patterns (default: false)
}
```

**Response:**

```typescript
{
  success: true,
  content_analytics: {
    timestamp: string,
    summary: {
      total_vcons: number,
      total_parties: number,
      total_dialogs: number,
      total_analysis: number,
      total_attachments: number,
      total_duration_seconds: number,
      avg_duration_seconds: number
    },
    dialog_analysis: Array<{
      type: string,
      count: number,
      avg_duration: number,
      total_duration: number,
      total_size: number,
      unique_vcons: number
    }>,
    analysis_breakdown: Array<{
      type: string,
      vendor: string,
      count: number,
      avg_confidence: number,
      unique_vcons: number
    }>,
    party_patterns: Array<{
      role: string,
      count: number,
      unique_names: number,
      unique_emails: number,
      unique_phones: number,
      unique_vcons: number
    }>,
    conversation_metrics: {
      total_conversations: number,
      avg_parties_per_conversation: number,
      avg_dialogs_per_conversation: number,
      avg_analysis_per_conversation: number,
      avg_attachments_per_conversation: number,
      avg_duration_per_conversation: number,
      avg_size_per_conversation: number,
      max_parties_in_conversation: number,
      max_dialogs_in_conversation: number
    },
    temporal_content: Array<{
      month: string,
      vcon_count: number,
      dialog_count: number,
      analysis_count: number,
      attachment_count: number,
      total_duration: number
    }>
  }
}
```

---

### get_database_health_metrics

Get database health metrics including performance indicators and optimization recommendations.

**Input Parameters:**

```typescript
{
  include_performance_metrics?: boolean,  // Include performance metrics (default: true)
  include_storage_efficiency?: boolean,   // Include storage efficiency (default: true)
  include_index_health?: boolean,         // Include index health (default: true)
  include_connection_metrics?: boolean,   // Include connection metrics (default: true)
  include_recommendations?: boolean       // Include recommendations (default: true)
}
```

**Response:**

```typescript
{
  success: true,
  database_health_metrics: {
    timestamp: string,
    overall_score: number,
    metrics: {
      performance: Array<{
        table_name: string,
        sequential_scans: number,
        index_scans: number,
        inserts: number,
        updates: number,
        deletes: number,
        live_rows: number,
        dead_rows: number,
        dead_row_percentage: number,
        index_usage_ratio: number
      }>,
      storage: Array<{
        table_name: string,
        total_size: string,
        table_size: string,
        index_size: string,
        index_size_percentage: number
      }>,
      indexes: Array<{
        table_name: string,
        index_name: string,
        scans: number,
        rows_read: number,
        rows_fetched: number,
        index_size: string,
        health_status: 'UNUSED' | 'LOW_USAGE' | 'ACTIVE'
      }>,
      connections: {
        heap_read: number,
        heap_hit: number,
        cache_hit_ratio: number,
        idx_read: number,
        idx_hit: number,
        idx_cache_hit_ratio: number
      }
    },
    recommendations: string[],
    alerts: string[]
  }
}
```

---

## Database Size Tools

### get_database_size_info

Get database size information and smart recommendations for query limits. Essential for large databases to prevent memory exhaustion.

**Input Parameters:**

```typescript
{
  include_recommendations?: boolean  // Include smart recommendations (default: true)
}
```

**Response:**

```typescript
{
  success: true,
  database_size_info: {
    total_vcons: number,
    total_size_bytes: number,
    total_size_pretty: string,
    size_category: 'small' | 'medium' | 'large' | 'very_large',
    recommendations: {
      max_basic_search_limit: number,
      max_content_search_limit: number,
      max_semantic_search_limit: number,
      max_analytics_limit: number,
      recommended_response_format: string,
      memory_warning: boolean
    },
    table_sizes: {
      [table_name]: {
        row_count: number,
        size_bytes: number,
        size_pretty: string
      }
    }
  }
}
```

**Example:**

```typescript
{
  "include_recommendations": true
}
```

---

### get_smart_search_limits

Get smart search limits based on database size and query complexity. Helps prevent memory exhaustion by suggesting appropriate limits.

**Input Parameters:**

```typescript
{
  query_type: 'basic' | 'content' | 'semantic' | 'hybrid' | 'analytics',
  estimated_result_size?: 'small' | 'medium' | 'large' | 'unknown'  // Default: 'unknown'
}
```

**Response:**

```typescript
{
  success: true,
  smart_limits: {
    query_type: string,
    estimated_result_size: string,
    recommended_limit: number,
    recommended_response_format: string,
    memory_warning: boolean,
    explanation: string
  }
}
```

**Example:**

```typescript
{
  "query_type": "content",
  "estimated_result_size": "large"
}
```

---

## Schema & Examples

### get_schema

Get the vCon schema definition.

**Input Parameters:**

```typescript
{
  format?: "json_schema" | "typescript"   // Default: "json_schema"
}
```

There is no `version` parameter and no `openapi` format. Any other `format` value is an `InvalidParams` error.

**Response:** the raw schema, not wrapped in a `success` envelope.

- `json_schema`: a JSON Schema document (definition name `VCon`) generated from the server's validation schemas. It describes the vCon 0.4.0 shape, including `critical`, `amended`, `redacted`, and `group`.
- `typescript`: the text of `src/types/vcon.ts`, returned as plain text rather than JSON.

---

### get_examples

Get example vCons.

**Input Parameters:**

```typescript
{
  example_type: "minimal" | "phone_call" | "chat" | "email" | "video" | "full_featured",  // Required
  format?: "json" | "yaml"  // Default: "json"
}
```

**Response:** the example vCon itself, not wrapped in a `success` envelope. With `json` it is JSON text; with `yaml` it is plain YAML text. An unknown `example_type` or `format` is an `InvalidParams` error. Each call generates fresh UUIDs and timestamps.

**Example Types:**

- **minimal** - Bare minimum required fields
- **phone_call** - Phone call with a recording, transcript, summary, sentiment, and tags
- **chat** - Text chat example
- **email** - Email thread with a contract attachment
- **video** - Video meeting with a recording and transcript
- **full_featured** - Recording and text dialog, analysis, tags, a follow-up attachment, and a synthetic `lawful_basis` attachment (example data only, never a real consent record)

---

## Error Responses

### Legacy and CRUD tools

These tools throw MCP protocol errors. The client sees a JSON-RPC error with a code and a message, not a tool result.

| MCP error code | When |
|----------------|------|
| `InvalidParams` | Missing or malformed input: a bad UUID, a missing required field, a failed Zod parse (the message lists each path and problem), a failed vCon, dialog, analysis, attachment, or party validation, an out-of-range `index` |
| `InvalidRequest` | `delete_vcon` on a UUID that does not exist |
| `MethodNotFound` | An unknown tool name, or a tool that is disabled by `MCP_TOOLS_PROFILE`, `MCP_ENABLED_CATEGORIES`, `MCP_DISABLED_CATEGORIES`, `MCP_DISABLED_TOOLS`, or a read-only API key |
| `InternalError` | Any other failure, with the message `Tool execution failed: <cause>`. This includes database errors and a missing vCon in `get_vcon` and `update_vcon` (the cause contains `not found`) |

### Contract tools

The `vcon_*` contract tools and `describe_response_shape` return failures as `{ ok: false, error: { code, message } }`. See [Redesigned Contract Tools](#redesigned-contract-tools) for the code list. Their two exceptions are listed there.

---

## Usage Notes

### Best Practices

1. **Check the lawful basis** - Read `warnings` on `create_vcon` and `create_vcon_from_template` results
2. **Use appropriate search** - Choose the right search tool for your use case
3. **Tag consistently** - Establish a tagging schema
4. **Monitor performance** - Use database tools regularly
5. **Handle errors** - Legacy tools throw MCP errors; contract tools return `ok: false`

### Pagination

- `vcon_search` pages with an opaque `cursor`. Pass `page.next_cursor` back unchanged until it is `null`. It has no `offset`.
- `search_vcons`, `search_vcons_content`, `search_vcons_semantic`, `search_vcons_hybrid`, and `search_by_tags` take a `limit` only. They have no `offset` and no `has_more`.
- The REST list endpoint is the one place that offers `limit`, `offset`, and `has_more`. See the [REST API](./rest-api.md).

---

## Next Steps

- See [Resources](./resources.md) for URI-based access
- See [Prompts](./prompts.md) for query templates
- See [TypeScript Types](./types.md) for type definitions
- See [Examples](/examples/) for practical usage
