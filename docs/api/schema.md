# Database schema (API docs)

**Authoritative reference:** [`docs/reference/AGENT_DATABASE_SCHEMA.md`](../reference/AGENT_DATABASE_SCHEMA.md)

That document is maintained for **coding agents** and reflects the PostgreSQL schema as defined by **`supabase/migrations/`** (tables, tenant columns, embeddings, materialized views, RLS behavior, and known legacy columns such as `must_support` / `appended` alongside `critical` / `amended`).

**IETF-focused DDL narrative** (not the full deployed catalog) remains in [`docs/reference/CORRECTED_SCHEMA.md`](../reference/CORRECTED_SCHEMA.md).

**Do not** rely on older copies of this page that inlined outdated `CREATE TABLE` snippets (for example defaults and column names from pre-v0.4.0 drafts). If anything here disagrees with `AGENT_DATABASE_SCHEMA.md` or the migrations, treat those sources as correct.
