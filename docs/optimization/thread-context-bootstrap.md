# Optimization thread bootstrap (saved context)

Use this file at the start of an optimization thread. It summarizes decisions, behavior, and where assets live.

## Purpose vs type (attachments)

- **`attachment.purpose`** is the **canonical** spec-facing classification field for attachments.
- **`attachment.type`** is **legacy / compatibility only** (e.g. older data, Strolid-style metadata). Do not treat it as equivalent to `purpose` for new designs.
- **`analysis.type`** remains the correct classification field for analysis (unchanged).

### Read / discovery order (preferred)

1. Discover attachment purposes: `vcon://v1/discovery/attachments/purposes` or `GET /api/v1/discovery/attachments/purposes`
2. Discover analysis types: `vcon://v1/discovery/analysis/types` or `GET /api/v1/discovery/analysis/types`
3. Read attachments by purpose: `vcon://v1/vcons/{uuid}/attachments/purpose/{purpose}` or `GET /api/v1/vcons/:uuid/attachments?purpose=...`
4. Read analysis by type: `vcon://v1/vcons/{uuid}/analysis/type/{type}` or `GET /api/v1/vcons/:uuid/analysis?type=...`

### Legacy-only attachment paths

- `vcon://v1/discovery/attachments/types` / `GET /api/v1/discovery/attachments/types`
- `vcon://v1/vcons/{uuid}/attachments/type/{type}` / `GET /api/v1/vcons/:uuid/attachments?type=...`

### Tags

- Do **not** jump to tags first for dealer-like, summary-like, transcript-like, or other attachment/analysis-backed data.
- Use tags only when classification **actually** lives in the tags attachment.

## Contract tools (recommended for agents)

Prefer: `vcon_capabilities`, `vcon_taxonomy`, `vcon_search`, `vcon_fetch`, `describe_response_shape`.

Payload discipline: `include`, `limit`, pagination, metadata-only shapes, `max_response_bytes`; on `RESPONSE_TOO_LARGE`, shrink and retry.

## Spec reminders (high signal)

- `analysis.vendor` required; `analysis.schema` not `schema_version`; `body` as string when structured JSON is stored.
- `mediatype` not `mimetype`; `critical` not `must_support`; `amended` not `appended`.

## Code / docs touchpoints (for optimization work)

- Types: `src/types/vcon.ts` (`Attachment.purpose` vs optional `type`).
- MCP resources: `src/resources/index.ts` (discovery + filtered reads; purpose-first descriptions).
- REST: `src/api/routes/discovery.ts`, `src/api/routes/vcons.ts`, mount in `src/api/rest-router.ts`.
- Shared filters: `src/utils/read-surfaces.ts`.
- Query layer: `src/db/interfaces.ts`, `src/db/queries.ts`, `src/db/mongo-queries.ts` (distinct discovery + Supabase `purpose` round-trip on attachments).
- Tool schema: `src/tools/vcon-crud.ts` (`AttachmentSchema` documents purpose vs type).
- Tests: `tests/new-tools-resources.test.ts`, `tests/api/routes/discovery.test.ts`, `tests/api/routes/vcons.test.ts`, `tests/db-queries.test.ts`, `tests/api/helpers.ts`.

## Documentation assets (system instructions)

Full copy-paste variants live in:

- `docs/examples/system-instruction-assets.md` (long, short, CLAUDE.md one-paragraph, strict policy-style)

Linked from:

- `docs/examples/index.md`
- `docs/SUMMARY.md`

## Verification notes

- `npm run build` and targeted Vitest suites were used during implementation.
- `npm run docs:build` succeeded after adding the system-instruction assets page.

---

*This file is intentionally dense so a new thread can load one artifact instead of replaying the whole conversation.*
