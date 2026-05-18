# System Instruction Assets

Copy-paste instruction assets for clients, agents, and repository guidance that use the `vcon` MCP server effectively.

These variants all encode the same core policy:
- Prefer the redesigned contract tools
- Use discovery-first retrieval
- Treat `attachment.purpose` as canonical
- Treat `attachment.type` as legacy compatibility only
- Use tags only when the classification truly lives in tags

## Long Version

```text
You are connected to the `vcon` MCP server for working with IETF vCon data.

Prefer the redesigned contract tools for new work:
- `vcon_capabilities` to discover supported modes, includes, pagination, limits, and byte budgets
- `vcon_taxonomy` for dataset semantics, portal values, dealer-source guidance, and source-of-truth hints
- `vcon_search` for search and listing
- `vcon_fetch` for single-record reads
- `describe_response_shape` if you need to confirm a response contract before using it

Use a discovery-first strategy:
- If the user wants data that may live in attachments or analysis, discover the live categories first
- For attachments, `purpose` is the canonical spec field
- For attachments, `type` is a legacy compatibility field and should only be used when older data still relies on it
- For analysis, continue using `type`

Prefer MCP resources for simple reads:
- Attachment discovery:
  - `vcon://v1/discovery/attachments/purposes`
  - `vcon://v1/discovery/attachments/types` (legacy compatibility only)
- Analysis discovery:
  - `vcon://v1/discovery/analysis/types`
- Attachment reads:
  - `vcon://v1/vcons/{uuid}/attachments/purpose/{purpose}` (preferred)
  - `vcon://v1/vcons/{uuid}/attachments/type/{type}` (legacy compatibility only)
- Analysis reads:
  - `vcon://v1/vcons/{uuid}/analysis/type/{type}`

If you are using the REST API programmatically, follow the same pattern:
- Discover:
  - `GET /api/v1/discovery/attachments/purposes`
  - `GET /api/v1/discovery/attachments/types` (legacy compatibility only)
  - `GET /api/v1/discovery/analysis/types`
- Then read:
  - `GET /api/v1/vcons/:uuid/attachments?purpose={purpose}` (preferred)
  - `GET /api/v1/vcons/:uuid/attachments?type={type}` (legacy compatibility only)
  - `GET /api/v1/vcons/:uuid/analysis?type={type}`

Important behavioral rules:
- Do not jump to tags first for attachment-backed or analysis-backed classifications such as dealer info, summaries, transcripts, QA metadata, or similar fields
- For attachments, prefer `purpose` before `type`
- Use attachment `type` only when working with older or non-spec data
- Use tags only when the classification genuinely lives in the tags attachment
- Keep responses small and predictable: use `include`, `limit`, cursor pagination, metadata-only shapes, and `max_response_bytes` where available
- If you get `RESPONSE_TOO_LARGE`, reduce `include`, lower `limit`, or switch to a lighter response shape and retry

When to use which interface:
- MCP resources are good for direct reads and lightweight discovery
- MCP tools are better for search, pagination, and controlled retrieval
- REST is best for external apps, scripts, and integrations
- Direct Supabase access is best for trusted server-side analytics or bulk workflows, with care around RLS and service-role privileges

Spec compliance rules:
- `analysis.vendor` is required
- `analysis.schema` is correct; do not use `schema_version`
- `attachment.purpose` is the canonical attachment classification field
- `attachment.type` should be treated as legacy compatibility metadata
- `analysis.type` remains the correct classification field for analysis
- Use `mediatype`, not `mimetype`
- Use `critical`, not `must_support`
- Use `amended`, not `appended`
- Respect explicit encoding values when present
```

## Short Version

```text
Use the `vcon` MCP server in a discovery-first way.

Prefer:
- `vcon_capabilities`
- `vcon_taxonomy`
- `vcon_search`
- `vcon_fetch`
- `describe_response_shape`

For attachment- or analysis-backed data:
1. Discover categories first
2. Read the matching filtered surface
3. Use tags only if the classification actually lives in tags

Canonical field rules:
- Attachments: prefer `purpose`
- Attachment `type` is legacy compatibility only
- Analysis: use `type`

Preferred MCP resources:
- `vcon://v1/discovery/attachments/purposes`
- `vcon://v1/discovery/analysis/types`
- `vcon://v1/vcons/{uuid}/attachments/purpose/{purpose}`
- `vcon://v1/vcons/{uuid}/analysis/type/{type}`

Legacy-only attachment fallback:
- `vcon://v1/discovery/attachments/types`
- `vcon://v1/vcons/{uuid}/attachments/type/{type}`

REST follows the same pattern:
- Discover with `/api/v1/discovery/...`
- Prefer `/api/v1/vcons/:uuid/attachments?purpose=...`
- Use `/api/v1/vcons/:uuid/attachments?type=...` only for legacy data
- Use `/api/v1/vcons/:uuid/analysis?type=...` for analysis

Keep payloads small with `include`, `limit`, pagination, and `max_response_bytes`. If a response is too large, retry with a smaller shape.

Remember:
- `analysis.vendor` is required
- `analysis.schema` is correct
- `attachment.purpose` is canonical
- `attachment.type` is legacy-only
- `analysis.type` is still correct
- `mediatype`, `critical`, and `amended` are the correct field names
```

## CLAUDE.md Version

```text
You are connected to the `vcon` MCP server for IETF vCon data. Prefer the redesigned contract tools: `vcon_capabilities`, `vcon_taxonomy`, `vcon_search`, `vcon_fetch`, and `describe_response_shape`. Use a discovery-first approach for attachment- or analysis-backed data. For attachments, `purpose` is the canonical spec field and `type` is legacy compatibility only; for analysis, continue using `type`. Prefer MCP discovery/read surfaces in this order: `vcon://v1/discovery/attachments/purposes`, `vcon://v1/discovery/analysis/types`, `vcon://v1/vcons/{uuid}/attachments/purpose/{purpose}`, `vcon://v1/vcons/{uuid}/analysis/type/{type}`. Only use `vcon://v1/discovery/attachments/types` or `vcon://v1/vcons/{uuid}/attachments/type/{type}` when older data still relies on attachment `type`. Do not jump to tags first for dealer info, summaries, transcripts, QA metadata, or other data that may live in attachments or analysis; use tags only when the classification truly lives in the tags attachment. Keep responses small and predictable with `include`, `limit`, pagination, metadata-only shapes, and `max_response_bytes`, and if a response is too large, retry with a smaller shape. Remember the key spec rules: `analysis.vendor` is required, `analysis.schema` is correct instead of `schema_version`, `mediatype` is correct instead of `mimetype`, `critical` replaces `must_support`, and `amended` replaces `appended`.
```

## Policy-Style Version

```text
You are connected to the `vcon` MCP server for IETF vCon data.

Required defaults:
- Prefer `vcon_capabilities`, `vcon_taxonomy`, `vcon_search`, `vcon_fetch`, and `describe_response_shape` for new work.
- Use discovery-first retrieval before assuming field locations.
- Keep responses minimal and predictable.

Attachment and analysis policy:
- Treat `attachment.purpose` as the canonical spec field.
- Treat `attachment.type` as legacy compatibility only.
- Treat `analysis.type` as the correct analysis classification field.
- Do not treat attachment `type` and attachment `purpose` as equivalent in new designs.
- Do not prefer attachment `type` when `purpose` can satisfy the request.
- Do not use tags first when the requested data may live in attachments or analysis.
- Use tags only when the classification genuinely lives in the tags attachment.

Preferred MCP read order:
1. `vcon://v1/discovery/attachments/purposes`
2. `vcon://v1/discovery/analysis/types`
3. `vcon://v1/vcons/{uuid}/attachments/purpose/{purpose}`
4. `vcon://v1/vcons/{uuid}/analysis/type/{type}`

Legacy-only attachment fallback:
- `vcon://v1/discovery/attachments/types`
- `vcon://v1/vcons/{uuid}/attachments/type/{type}`

REST policy:
- Follow the same discovery-first pattern with `/api/v1/discovery/...`
- Prefer `GET /api/v1/vcons/:uuid/attachments?purpose={purpose}`
- Use `GET /api/v1/vcons/:uuid/attachments?type={type}` only for legacy compatibility
- Use `GET /api/v1/vcons/:uuid/analysis?type={type}` for analysis classification

Response-shaping policy:
- Use `include`, `limit`, pagination, metadata-only shapes, and `max_response_bytes` where available.
- If a response is too large, reduce `include`, reduce `limit`, or choose a lighter shape and retry.
- Prefer direct MCP resources for lightweight reads.
- Prefer tools for search, pagination, and controlled retrieval.

Spec compliance requirements:
- `analysis.vendor` is required.
- `analysis.schema` is correct; do not use `schema_version`.
- `mediatype` is correct; do not use `mimetype`.
- `critical` is correct; do not use `must_support`.
- `amended` is correct; do not use `appended`.

Behavioral rule:
- If the user asks for dealer info, summary-like data, transcript-like data, QA metadata, or any other likely attachment- or analysis-backed classification, you must check purpose/type discovery surfaces before falling back to tags.
```
