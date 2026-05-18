---
title: vCon MCP session handoff (optimization-ready)
date: 2026-05-13
tags:
  - vcon-mcp
  - mcp
  - rest
  - purpose-vs-type
  - discovery
---

# Session handoff (paste into vault or attach to next thread)

## What was implemented (high level)

- **Discovery-first read surfaces** for attachment and analysis categories across **MCP resources** and **REST**.
- **Canonical rule**: `attachment.purpose` is spec-facing; `attachment.type` is **legacy compatibility only**. **`analysis.type`** unchanged.
- **Query layer**: distinct values for attachment types, attachment purposes, analysis types (Supabase + Mongo); Supabase **persists and reads `attachment.purpose`**.
- **Shared helpers**: `src/utils/read-surfaces.ts` (filter, tags extract, discovery value shaping).
- **Docs**: REST + resources + README; **four system-instruction copy-pastes** in `docs/examples/system-instruction-assets.md`; **thread bootstrap** in `docs/optimization/thread-context-bootstrap.md`.

## URIs and REST (cheat sheet)

**MCP discovery**

- `vcon://v1/discovery/attachments/purposes` (preferred)
- `vcon://v1/discovery/attachments/types` (legacy)
- `vcon://v1/discovery/analysis/types`

**MCP filtered reads**

- `vcon://v1/vcons/{uuid}/attachments/purpose/{purpose}` (preferred)
- `vcon://v1/vcons/{uuid}/attachments/type/{type}` (legacy)
- `vcon://v1/vcons/{uuid}/analysis/type/{type}`

**REST**

- `GET /api/v1/discovery/attachments/purposes`
- `GET /api/v1/discovery/attachments/types`
- `GET /api/v1/discovery/analysis/types`
- `GET /api/v1/vcons/:uuid/attachments?purpose=...` (preferred)
- `GET /api/v1/vcons/:uuid/attachments?type=...` (legacy)
- `GET /api/v1/vcons/:uuid/analysis?type=...`

## Key files

| Area | Path |
|------|------|
| MCP resource list + resolve | `src/resources/index.ts` |
| REST discovery | `src/api/routes/discovery.ts` |
| REST vCon reads | `src/api/routes/vcons.ts` |
| Router mount | `src/api/rest-router.ts` |
| Filters | `src/utils/read-surfaces.ts` |
| Types | `src/types/vcon.ts` |
| IVConQueries | `src/db/interfaces.ts` |
| Supabase | `src/db/queries.ts` |
| Mongo | `src/db/mongo-queries.ts` |
| add_attachment schema | `src/tools/vcon-crud.ts` |
| Instruction assets (4 variants) | `docs/examples/system-instruction-assets.md` |
| Optimization bootstrap | `docs/optimization/thread-context-bootstrap.md` |

## Tests touched / added

- `tests/new-tools-resources.test.ts`
- `tests/api/routes/discovery.test.ts`
- `tests/api/routes/vcons.test.ts`
- `tests/db-queries.test.ts`
- `tests/api/helpers.ts`

## Commands that were green

- `npm run build`
- `npx vitest run` (targeted suites during work)
- `npm run docs:build`

## Policy for agents (one line)

Discover **attachment purposes** and **analysis types** first; read by **`purpose`** for attachments and **`type`** for analysis; use **`attachment.type` only for legacy data**; use **tags** only when data lives in tags.

## Next thread (optimization) — suggested focus

- Performance of distinct-category queries at scale (SQL vs batch fallback).
- Whether to add **write-path normalization** (`type` → `purpose`) on ingest.
- Optional deprecation timeline for attachment-`type` discovery surfaces.

## Checkpoint 2026-05-13 — shape graph, capabilities, tests

**Shipped in repo (local commit, not pushed)**

- **OSS shape graph**: `src/types/vcon-shape-graph.ts`; `getVconShapeGraph()` on `IVConQueries` with Postgres materialization (SQL path + fallback) and Mongo implementation; optional co-occurrence edges where supported.
- **Surfaces**: MCP resource `vcon://v1/graph/shape`; read tool `vcon_graph_shape`; `vcon_capabilities` lists the tool and a `shape_graph` block (resource URI, JSON schema id, short description). `describe_response_shape` includes `vcon_graph_shape`.
- **Docs**: `docs/api/shape-graph-and-plugins.md` (default graph plus how proprietary graphs attach via plugins).
- **Tests**: `tests/handlers/schema.test.ts` and `tests/tools/templates.test.ts` aligned to 0.4.0 and real handler responses (raw JSON Schema for `get_schema`, file body for TypeScript mode); registry and tool-category counts; resource tests for shape graph; stress read for `vcon://v1/graph/shape`.

**Suggested next hardening pass**

- Re-read SQL for `getVconShapeGraph` under tenant RLS and large corpora (timeouts, `exec_sql` availability).
- Optional caching for shape graph (same Redis optional pattern as other queries).
- Contract tests for `SHAPE_GRAPH_FAILED` and oversized payloads if you add strict byte limits later.

---

*Copy this file into your vault, or keep it in-repo and `@` it from the optimization thread.*
