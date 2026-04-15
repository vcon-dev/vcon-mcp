# PostgreSQL schema reference (for coding agents)

**Purpose:** Single place to understand what exists in the vCon MCP Supabase database after all migrations in `supabase/migrations/` have been applied.

**Not a substitute for migrations.** If this document disagrees with SQL in `supabase/migrations/`, the migrations win. Reconcile by reading migrations in timestamp order or by introspecting a live database.

**Related:** IETF field naming and v0.4.0 semantics are summarized in [QUICK_REFERENCE.md](./QUICK_REFERENCE.md). MCP search tools are described in [Search tools guide](../guide/search.md). PostgreSQL RPC signatures live in `supabase/migrations/` (see migrations that define `search_vcons_keyword`, `search_vcons_semantic`, and related functions).

---

## 1. Extensions

Typical extensions enabled (see early migrations):

| Extension | Use |
|-----------|-----|
| `uuid-ossp` / `pgcrypto` | UUID generation (`gen_random_uuid()`) |
| `pg_trgm` | Trigram and GIN ops (often under schema `extensions`) |
| `vector` | `pgvector` embeddings (`vector(384)` after dimension migration) |

---

## 2. Core vCon tables (normalized)

### `vcons`

Root row per vCon. Internal primary key is `id`; `uuid` is the vCon document UUID.

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID | PK |
| `uuid` | UUID | Unique vCon id (document) |
| `vcon_version` | VARCHAR(10) | DB default from initial migration is still `'0.3.0'` unless changed; **application code targets `0.4.0`** |
| `subject` | TEXT | |
| `created_at`, `updated_at` | TIMESTAMPTZ | |
| `basename`, `filename` | TEXT | |
| `done`, `corrupt` | BOOLEAN | |
| `processed_by` | TEXT | |
| `privacy_processed`, `redaction_rules` | JSONB | Privacy extension |
| `redacted` | JSONB | |
| `group_data` | JSONB | |
| `extensions` | TEXT[] | |
| `must_support` | TEXT[] | **Deprecated** name; kept in sync with `critical` (see below) |
| `critical` | TEXT[] | v0.4.0 name (Section 4.1.4) |
| `appended` | JSONB | **Deprecated** name; kept in sync with `amended` |
| `amended` | JSONB | v0.4.0 name (Section 4.1.9) |
| `tenant_id` | TEXT | Multi-tenant scope; `NULL` can mean shared (see RLS) |
| `subject_tsvector` | TSVECTOR | Materialized for FTS; maintained by trigger |

**Triggers:** `sync_deprecated_fields_trigger` keeps `must_support`/`critical` and `appended`/`amended` aligned during transition.

**Views:** `vcons_legacy` exposes old column names; `vcon_field_usage` shows which side is populated.

---

### `parties`

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID | PK |
| `vcon_id` | UUID | FK → `vcons(id)` CASCADE |
| `party_index` | INTEGER | Index in vCon `parties` array |
| `tel`, `sip`, `stir`, `mailto`, `name`, `did`, `validation` | TEXT | |
| `jcard` | JSONB | |
| `gmlpos`, `timezone` | TEXT | |
| `civicaddress` | JSONB | |
| `uuid` | TEXT | **Not a UUID type:** migration widened to TEXT for flexible identifiers |
| `data_subject_id` | TEXT | Privacy |
| `metadata` | JSONB | |
| `tenant_id` | TEXT | Denormalized for RLS |
| `party_tsvector` | TSVECTOR | FTS helper |

Unique: `(vcon_id, party_index)`.

---

### `dialog`

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID | PK |
| `vcon_id` | UUID | FK → `vcons(id)` CASCADE |
| `dialog_index` | INTEGER | |
| `type` | TEXT | CHECK: `recording`, `text`, `transfer`, `incomplete` |
| `start_time` | TIMESTAMPTZ | |
| `duration_seconds` | REAL | |
| `parties` | INTEGER[] | Party indices |
| `originator` | INTEGER | |
| `mediatype`, `filename` | TEXT | |
| `body`, `encoding`, `url`, `content_hash` | TEXT | `encoding` constrained to `base64url`, `json`, `none`, or NULL |
| `disposition` | TEXT | **No longer restricted** to spec enum (migration dropped CHECK) |
| `session_id` | JSONB | v0.4.0 SessionId object shape; use this |
| `session_id_legacy` | TEXT | Legacy plain string column after rename |
| `application`, `message_id` | TEXT | |
| `size_bytes` | BIGINT | |
| `metadata` | JSONB | |
| `transferee`, `transferor` | INTEGER | Transfer dialog (Section 4.3.12) |
| `transfer_target`, `original`, `consultation`, `target_dialog` | INTEGER[] | |
| `tenant_id` | TEXT | |
| `body_tsvector` | TSVECTOR | FTS helper |

Unique: `(vcon_id, dialog_index)`.

---

### `party_history`

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID | PK |
| `dialog_id` | UUID | FK → `dialog(id)` CASCADE |
| `party_index` | INTEGER | |
| `time` | TIMESTAMPTZ | |
| `event` | TEXT | Includes `dtmfdown`, `dtmfup` plus join/hold/mute events |
| `dtmf` | TEXT | When event is DTMF |
| `tenant_id` | TEXT | |

---

### `attachments`

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID | PK |
| `vcon_id` | UUID | FK → `vcons(id)` CASCADE |
| `attachment_index` | INTEGER | |
| `type`, `purpose` | TEXT | `purpose` added for spec alignment |
| `start_time` | TIMESTAMPTZ | |
| `party`, `dialog` | INTEGER | Indices into parties/dialog |
| `mimetype` | TEXT | **Legacy column name** in DB; spec field is `mediatype` |
| `filename`, `body`, `encoding`, `url`, `content_hash` | TEXT | |
| `size_bytes` | BIGINT | |
| `metadata` | JSONB | |
| `created_at`, `updated_at` | TIMESTAMPTZ | Tag rows drive MV refresh |
| `tenant_id` | TEXT | |

**Tags:** Stored as attachment `type = 'tags'`, `encoding = 'json'`, `body` a JSON array of `"key:value"` strings.

Unique: `(vcon_id, attachment_index)`.

---

### `analysis`

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID | PK |
| `vcon_id` | UUID | FK → `vcons(id)` CASCADE |
| `analysis_index` | INTEGER | |
| `type` | TEXT | NOT NULL |
| `dialog_indices` | INTEGER[] | |
| `mediatype`, `filename` | TEXT | |
| `vendor` | TEXT | NOT NULL |
| `product`, `schema` | TEXT | Use `schema`, not `schema_version` |
| `body`, `encoding`, `url`, `content_hash` | TEXT | |
| `created_at` | TIMESTAMPTZ | |
| `confidence` | REAL | |
| `metadata` | JSONB | |
| `tenant_id` | TEXT | |
| `body_tsvector` | TSVECTOR | FTS helper |

Unique: `(vcon_id, analysis_index)`.

---

### `groups`

| Column | Type | Notes |
|--------|------|--------|
| `id` | UUID | PK |
| `vcon_id` | UUID | FK → `vcons(id)` CASCADE |
| `group_index` | INTEGER | |
| `uuid` | UUID | Referenced vCon |
| `body`, `encoding`, `url`, `content_hash` | TEXT | |
| `tenant_id` | TEXT | |

Unique: `(vcon_id, group_index)`.

---

## 3. Operational and extension tables

### `vcon_embeddings`

Semantic search vectors (dimension **384** after `switch_embeddings_to_384` migration; default model `sentence-transformers/all-MiniLM-L6-v2`).

| Column | Notes |
|--------|--------|
| `vcon_id` | FK → `vcons(id)` |
| `content_type` | e.g. `subject`, `dialog`, `analysis` |
| `content_reference` | e.g. dialog index as text |
| `content_text` | Source text |
| `embedding` | `vector(384)` |
| `embedding_model`, `embedding_dimension` | |
| `created_at`, `updated_at` | |
| `tenant_id` | |

Unique `(vcon_id, content_type, content_reference)`.

---

### `embedding_queue`

| Column | Notes |
|--------|--------|
| `id` | BIGSERIAL PK |
| `vcon_id` | FK |
| `created_at` | |
| `tenant_id` | |

Trigger on `vcons` insert can enqueue work.

---

### `s3_sync_tracking`

Tracks S3 sync per vCon: `vcon_id` PK, `vcon_uuid`, `s3_key`, `synced_at`, `updated_at`, optional embedding model fields, `tenant_id`.

---

### `privacy_requests`

GDPR-style request log (no `tenant_id` in migrations). Columns include `request_id`, `party_identifier`, `request_type`, `request_status`, dates, `metadata`, etc.

---

### `migration_reports`

Internal migration audit: `migration_name`, `run_date`, counts, `report_data` JSONB. **RLS:** service-role style access only (see migration).

---

## 4. Materialized view `vcon_tags_mv`

Built from tag attachments. Typical columns (see latest MV migration, e.g. `20251210120000_optimize_mv_tags_timestamps.sql`):

| Column | Purpose |
|--------|---------|
| `tenant_id` | Tenant filter |
| `vcon_id` | |
| `tags` | JSONB object map from `key:value` tag strings |
| `tag_updated_at`, `tag_created_at` | From tag attachment row |

**Refresh:** Must be refreshed after tag changes; application or jobs should use `REFRESH MATERIALIZED VIEW CONCURRENTLY` where supported and indexed appropriately.

---

## 5. Notable views

| View | Purpose |
|------|---------|
| `vcons_legacy` | Maps `critical`→`must_support`, `amended`→`appended` for old readers |
| `vcon_field_usage` | Inspects which legacy vs new fields are used |

---

## 6. Multi-tenancy and RLS

- **`tenant_id`** is denormalized onto child tables for fast policy checks.
- Policies typically allow rows where `tenant_id IS NULL OR tenant_id = get_current_tenant_id()` for role `authenticated` (see `20251122175918_create_tenant_rls_policies.sql` and later fixes).
- **NULL tenant** rows may be visible across tenants by design; confirm product expectations before writing queries.

Helper RPCs such as `set_tenant_context` / `get_current_tenant_id` appear in tenant migrations; use those definitions in migrations as source of truth.

---

## 7. Search and SQL functions

Main user-facing RPCs (signatures evolve; confirm in latest migration):

- `search_vcons_keyword`, `search_vcons_semantic` (**`vector(384)`**), `search_vcons_hybrid`
- `search_vcons_by_tags` (may include time filters)
- `backfill_search_vector_batch` for tsvector backfill

Semantic search joins **`vcon_tags_mv`** for tag filtering in current implementations.

See [Search tools guide](../guide/search.md) and the `optimize_search_*` / `fix_search_*` migrations for behavior; for exact SQL signatures use the latest migration that defines each function.

---

## 8. Table inventory (quick)

| Kind | Name |
|------|------|
| Core | `vcons`, `parties`, `dialog`, `party_history`, `attachments`, `analysis`, `groups` |
| Ops | `vcon_embeddings`, `embedding_queue`, `s3_sync_tracking` |
| Other | `privacy_requests`, `migration_reports` |
| MV | `vcon_tags_mv` |

---

## 9. Common agent mistakes to avoid

1. **Assuming docs/api/schema.md** without checking: prefer this file or migrations.
2. **`must_support` / `appended` vs `critical` / `amended`:** write new code against **`critical`** and **`amended`**; legacy columns exist for transition.
3. **`attachments.mimetype`:** column name in DB is still `mimetype` in many deployments; API/spec use **`mediatype`**.
4. **`parties.uuid`:** type is **TEXT**, not UUID.
5. **`dialog.session_id`:** JSONB object; legacy text may live in `session_id_legacy`.
6. **Embeddings:** **384** dimensions and cosine HNSW index; do not assume 1536 unless you confirm an old branch.
7. **Tags:** not a separate table; attachment type `tags` plus MV for fast search.

---

*Last reviewed against migration set including 2026-04-14 fixes. Update this file when schema changes land.*
