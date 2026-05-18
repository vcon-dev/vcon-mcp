# Shape graph (OSS) and custom graphs via plugins

## Default shape graph

The open source server exposes a **corpus-level shape graph**: which `analysis.type` values, `attachments.purpose` values, legacy `attachments.type` values (when purpose is absent), and tag keys appear in stored vCons, plus optional **co-occurrence** edges (same vCon carries both an analysis type and an attachment purpose). Counts are aggregates over the tenant-scoped database; see `corpus.notes` in the payload for backend-specific semantics.

**Surfaces**

- MCP resource: `vcon://v1/graph/shape` (JSON body matches the tool payload).
- Read-only tool: `vcon_graph_shape` (same JSON for clients that do not use resources first).

**Discovery order**

1. `vcon_capabilities` (limits, modes, and pointers to the shape graph).
2. Resource `vcon://v1/graph/shape` or tool `vcon_graph_shape`.
3. Discovery resources such as `vcon://v1/discovery/analysis/types`, then search and fetch tools.

The machine-readable JSON shape is documented by `VCON_SHAPE_GRAPH_JSON_SCHEMA` in `src/types/vcon-shape-graph.ts` (`schema_version` `1.0.0`).

## Proprietary or customer-specific graphs

Company ontologies, vertical taxonomies, merged “effective” graphs, external graph databases (for example FalkorDB), and analyst-specific bundles **do not** belong in the OSS core. They should attach through **plugins** and optional sidecar services so deployments without those products keep a single, spec-aligned code path.

Plugins implement `VConPlugin` (`src/hooks/plugin-interface.ts`) and typically:

- Register extra **tools** via `registerTools` (for example `implementation_taxonomy`, `graph_query`, overlay validators).
- Register extra **resources** via `registerResources` (for example static ontology JSON or a merged graph snapshot URI).
- Optionally implement `handleToolCall` for namespaced tool names and hooks such as `beforeSearch` / `afterSearch` to map neutral client filters to internal RPCs.

The OSS server must not **require** any plugin for correct vCon CRUD, search, or the default shape graph. Heavy graph storage and proprietary merge logic stay in the plugin or in a separate process the customer runs; the MCP host wires them in through the plugin manager at startup.
