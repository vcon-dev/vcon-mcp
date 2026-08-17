# vCon MCP Server: Search Capabilities

A reference for technical leaders evaluating or extending the search layer of the vCon MCP Server.

## Overview

Search spans three layers:

1. **MCP tools** that AI clients call directly.
2. **REST endpoints** that mirror the MCP tools over HTTP.
3. **Postgres/Supabase functions** (RPCs, indexes, a materialized view) that do the actual work.

There are two generations of tools, both live:

- **Legacy tools** (`search_vcons`, `search_vcons_content`, `search_vcons_semantic`, `search_vcons_hybrid`) in `src/tools/vcon-crud.ts`.
- **Redesigned contract tools** (`vcon_search`, `vcon_fetch`, `vcon_aggregate`, plus discovery tools) in `src/tools/vcon-contract.ts`, which return a stable, paginated, byte-bounded envelope.

New integrations should prefer the contract tools.

## Four core search modes

| Mode | Tool | What it does | Under the hood | Default limit |
|------|------|--------------|----------------|---------------|
| Metadata | `search_vcons` | Filter by subject, party name/email/tel, date range, tags | Direct table filtering ([queries.ts:1099](../../src/db/queries.ts)) | 10 |
| Keyword | `search_vcons_content` | Full-text search with highlighted snippets | RPC `search_vcons_keyword`: weighted `tsvector` (subject=A, parties/analysis=B, dialog=C), `plainto_tsquery`, `ts_rank_cd`, `ts_headline` | 50 |
| Semantic | `search_vcons_semantic` | Embedding similarity | RPC `search_vcons_semantic`: pgvector cosine (`<=>`) on `vcon_embeddings`, HNSW index | 50 |
| Hybrid | `search_vcons_hybrid` | Blend of keyword + semantic | RPC `search_vcons_hybrid`: `combined = w·semantic + (1-w)·keyword` | 50 |

Notes:

- Semantic and hybrid use **384-dimension** embeddings (OpenAI `text-embedding-3-small`). If you pass a `query` string but no `embedding` array, the server auto-generates the embedding ([src/utils/embeddings.ts](../../src/utils/embeddings.ts)).
- Default semantic similarity `threshold` is `0.7`. Default hybrid `semantic_weight` is `0.6` (0 = keyword only, 1 = semantic only).
- All modes accept a `tags` filter (AND logic across key/value pairs) and ISO 8601 `start_date` / `end_date`.

## Redesigned contract tools (`vcon_*`)

These return a stable envelope: `{ ok, items, page }`, with cursor-based pagination and a byte budget.

### `vcon_search`

One tool, four `mode`s: `metadata` | `keyword` | `semantic` | `hybrid`. Adds:

- **Structured `filters`**: `subject`, `start_date`, `end_date`, `party_name`, `party_email`, `party_tel`, `dealer_id`, `dealer_name`.
- **`include` field groups**: `core`, `parties`, `summary`, `tags`, `dealer`, `counts`, `dialog`, `analysis`, `attachments`. Default: `['core', 'summary']`.
- **Cursor pagination**: pass `page.next_cursor` back as `cursor`. Opaque, not offset-based.
- **`max_response_bytes`** (default 250 KB): if the payload would exceed the budget, the tool returns a `RESPONSE_TOO_LARGE` error with narrowing suggestions rather than silently truncating.
- `limit` 1-100, default 25.

### `vcon_fetch`

Single vCon by `id` (UUID), with the same `include` groups. Default include: `['core', 'parties', 'summary']`.

### `vcon_aggregate`

Server-side rollup. `group_by: dealer` returns per-dealer `filtered_count` vs `baseline_count` (RPC `aggregate_vcons_by_dealer_stats`). Use it to answer "what fraction of dealer X's calls were tagged Y" without pulling rows client-side. `having.min_count` sets a baseline floor; default limit 20, max 500.

### Discovery tools

- `vcon_taxonomy`: portal taxonomy, common tag keys, sparse vs preferred fields, attachment types.
- `vcon_capabilities`: supported include groups, search modes, pagination semantics, byte budgets.
- `describe_response_shape`: schema/example for a named tool.

## Tag search

Tags are stored as a special attachment, not a column:

```json
{ "type": "tags", "encoding": "json", "body": "[\"department:sales\", \"priority:high\"]" }
```

They are surfaced through the **`vcon_tags_mv`** materialized view (GIN index on a JSONB column). This MV is the authoritative tag source. It refreshes on a schedule, not on every write, so it can lag recent writes.

| Tool | Purpose |
|------|---------|
| `search_by_tags` | AND-match key/value pairs (RPC `search_vcons_by_tags`, with a JS fallback scan under timeout) |
| `get_unique_tags` | Discover the tag schema via SQL aggregation over the MV (`include_counts`, `key_filter`, `min_count`) |
| `manage_tag` / `get_tags` / `remove_all_tags` | Single-vCon tag CRUD |

## REST endpoints

`src/api/routes/search.ts`:

- `GET /vcons/search/content`
- `GET /vcons/search/semantic`
- `GET /vcons/search/hybrid`

`src/api/routes/tags.ts`:

- Tag CRUD on `/vcons/:uuid/tags`
- `GET /tags` for tag discovery

Parameters mirror the MCP tools, passed as query-string args (filters and embeddings as JSON strings).

## Response formats and large-dataset safety

- Legacy `response_format`: `full` | `metadata` | `ids_only`. Content search also supports `snippets` (capped at 500 chars to stay under MCP's 1 MB response limit).
- `get_smart_search_limits` recommends a limit and format based on database size and expected result size (a very large DB downgrades to `metadata` and shrinks the limit).
- For large corpora, prefer `metadata` or `ids_only` and page with the contract tools.

## Database objects (Supabase migrations)

| Object | Type | Role |
|--------|------|------|
| `search_vcons_keyword` | RPC | Weighted full-text search + snippets |
| `search_vcons_semantic` | RPC | pgvector cosine similarity |
| `search_vcons_hybrid` | RPC | Weighted keyword + semantic fusion |
| `search_vcons_by_tags` | RPC | Tag containment match |
| `aggregate_vcons_by_dealer_stats` | RPC | Per-dealer rollup |
| `vcon_embeddings` | Table | 384-dim vectors, HNSW index (`m=16, ef_construction=64`) |
| `vcon_tags_mv` | Materialized view | Authoritative tag source, GIN-indexed JSONB |

## Caveats

- Supabase caps RPC results at ~1000 rows; keyword count dedupes vcon_ids in JS.
- Keyword search uses `plainto_tsquery`, so query operators are ignored.
- `vcon_tags_mv` can lag writes; do not assume just-written tags are immediately searchable.
- Dealer aggregation only works for vCons carrying a `strolid_dealer` attachment.
- `search_vcons_content` is slow on large corpora; cold full-text runs can exceed 30s (e2e timeout is set to 120s as steady state, not a flake).
- Embedding dimension is 384 in production; some older migrations reference 1536. Use 384.

## Recommendations

- New clients: use `vcon_search` / `vcon_fetch` / `vcon_aggregate` for the stable envelope, cursor pagination, and byte budgets.
- Large result sets: request `metadata` or `ids_only`, then fetch detail per UUID.
- Tag analytics: aggregate server-side (`vcon_aggregate`, `get_unique_tags`) rather than pulling rows.
