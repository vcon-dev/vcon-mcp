# Agent plan: drive the vCon MCP server (errors, function, performance)

Use this document as the operating brief for a coding agent whose job is to **exercise the MCP server end-to-end**, find **regressions and failure modes**, and characterize **latency and resource use**. Assume the repo is already built unless noted.

---

## 0. Preconditions

| Item | Action |
|------|--------|
| Environment | `npm install` if needed; copy `.env` / Supabase keys per project README. |
| Build | `npm run build` must succeed before any runtime work. |
| Database | Confirm backend: Postgres (Supabase) or Mongo per config. `npm run db:status` or `npm run db:check` when available. |
| Safety | For live MCP tool sweeps that mutate data, follow **`vcon-mcp-test` skill** (`~/.claude/skills/vcon-mcp-test/SKILL.md`): user-supplied UUID, explicit permission for create/delete, revert protocol. |

Record **branch name**, **git SHA**, and **which profile** (`MCP_TOOLS_PROFILE`, tenant headers) you used in the final report.

---

## 1. Automated baseline (fast, no manual MCP client)

Run in order; capture stdout and exit codes.

1. **Unit and integration**  
   `npx vitest run`  
   Goal: all green. If failures, triage: handler vs DB mock vs assertion drift.

2. **E2E** (if env has real DB / server wiring)  
   `npm run test:e2e`  
   Goal: no timeout flakes; note any test that assumes empty DB vs fixture.

3. **Stress** (longer, broader surfaces)  
   `npm run test:stress`  
   Goal: resources list/read, full-coverage paths still pass.

4. **Compliance** (spec drift)  
   `npm run test:compliance`  
   Goal: vCon shape and field names stay aligned with project rules.

5. **Lint**  
   `npm run lint`

Optional repo scripts (when credentials allow real DB):

- `npm run test:mcp` — `scripts/test-mcp-tools.ts`
- `npm run test:search` / `npm run test:search:quick`
- `npm run test:tenant` — RLS / tenant isolation
- `npm run test:tags`

Deliverable: **table** of command, pass/fail, duration, and one-line notes.

---

## 2. Functional: MCP contract and resources (read-heavy)

Drive the same paths a client LLM would use. Prefer **stdio MCP** with the official inspector or a small script that calls `Client` from `@modelcontextprotocol/sdk`.

Reference: `npm run test:console` → `npx @modelcontextprotocol/inspector tsx src/index.ts`

### 2.1 Discovery order (capabilities first)

- Call tool **`vcon_capabilities`**. Verify `tools` includes `vcon_graph_shape`, `shape_graph.resource_uri`, `shape_graph.json_schema_id`.
- Read resource **`vcon://v1/graph/shape`**. Validate JSON against expectations in `src/types/vcon-shape-graph.ts` (`schema_version`, `nodes[].kind`, `edges[].joint_vcon_count` when present).
- Call tool **`vcon_graph_shape`**. Assert payload equals resource body (same logical graph; `generated_at` may differ).

### 2.2 Discovery resources

Read each; confirm JSON parses and counts are non-negative:

- `vcon://v1/discovery/attachments/purposes`
- `vcon://v1/discovery/attachments/types`
- `vcon://v1/discovery/analysis/types`

### 2.3 Contract tools (envelopes and errors)

| Tool | What to verify |
|------|------------------|
| `vcon_fetch` | Valid UUID: `{ ok: true, item.id }`. Invalid UUID / not found: `{ ok: false, error.code }`. `RESPONSE_TOO_LARGE` with tiny `max_response_bytes` and heavy `include`. |
| `vcon_search` | Each mode: `metadata`, `keyword`, `semantic`, `hybrid` (semantic/hybrid need embeddings or server support). Cursor round-trip. |
| `describe_response_shape` | List mode; then `tool_name` for `vcon_graph_shape`, `vcon_fetch`, `vcon_search`. |
| `vcon_aggregate` | Expected success or documented `AGGREGATE_FAILED` if RPC missing. |

### 2.4 Legacy tools (spot-check)

Sample **`get_vcon`**, **`search_vcons`**, tag tools, and one analytics tool to ensure the registry still dispatches and envelopes match docs.

Deliverable: **checklist** with pass/fail and pasted **error codes** only (not full payloads).

---

## 3. Errors and edge cases (intentional abuse)

Design tests so the server **fails safely** (structured errors, no crash, no unbounded memory).

| Category | Examples |
|----------|----------|
| Invalid params | Bad UUID, unknown `include`, bad `mode`, malformed tags object, `limit` over max. |
| Missing backend | Wrong Supabase URL or key: tools should return errors, not hang. |
| Empty corpus | Discovery returns empty arrays; shape graph still valid with `nodes: []`. |
| Large responses | `vcon_search` / `vcon_fetch` with `max_response_bytes` set low; confirm `RESPONSE_TOO_LARGE` and suggestions. |
| Tenant | If multi-tenant: repeat a read with wrong `x-tenant-id` (or env) and confirm isolation or expected 403/empty behavior per `src/config/tenant-config.ts`. |

Deliverable: **matrix** (input class → HTTP/MCP outcome → log line if any).

---

## 4. Performance (measurable, comparable)

Use the **same machine** and note cold vs warm. Prefer wall-clock and log timestamps; optional `console.time` in a one-off script under `scripts/` if you add one (do not commit noisy logging unless asked).

### 4.1 Candidate hot paths

1. **`getVconShapeGraph`** (Postgres `exec_sql` path vs fallback in `src/db/queries.ts`). Time repeated calls; check `corpus.notes` for which path ran.
2. **Discovery aggregates** — `getUniqueAttachmentPurposes`, `getUniqueAnalysisTypes`, tag distinct queries.
3. **`vcon_search`** — metadata with tag sort window; keyword; semantic with embedding.
4. **Resource `vcon://v1/vcons/ids`** with pagination — large `limit` vs default.

### 4.2 Database-level checks (Postgres)

When allowed:

- `npm run analyze:indexes` or `analyze_query` tool on representative SQL (search, shape graph, discovery).
- Compare **EXPLAIN** vs **EXPLAIN ANALYZE** for sequential scans on large tables.

### 4.3 SLO-style targets (fill in after first baseline)

Document p50/p95 for:

- `vcon_capabilities` (should be tiny)
- `vcon://v1/graph/shape` read
- `vcon_search` metadata page (default limit)

Deliverable: **small table** of operation, N iterations, p50, p95, and whether Redis cache was on (`Cache layer` log lines).

---

## 5. Observability and logs

- Watch for **`Cache layer disabled`** vs enabled when testing repeat reads.
- Correlate **`withSpan`** / tool name attributes if OpenTelemetry is configured.
- On failure, capture **first stack trace** and the **tool name + args** (redact secrets).

---

## 6. Exit criteria for the agent

The run is complete when:

1. Automated suite results are summarized (section 1).
2. At least one **manual or inspector** session covered sections 2.1–2.3.
3. At least **three** error classes from section 3 were exercised with recorded outcomes.
4. Section 4 has **numbers** for at least two hot paths, or a written reason they could not be measured (e.g. no DB access).
5. A short **follow-up list** of bugs or PR-sized fixes is ranked (P0/P1/P2).

---

## 7. Related docs in this repo

- `CLAUDE.md` — spec compliance checklist and tool overview.
- `docs/optimization/SESSION_HANDOFF_FOR_VAULT.md` — recent feature checkpoint.
- `docs/api/shape-graph-and-plugins.md` — shape graph and plugin boundaries.
- `tests/stress/full-coverage.test.ts` — resource URLs used in stress runs.

---

*This plan is read-only guidance; update it when new tools or transport modes (HTTP MCP, etc.) ship.*
