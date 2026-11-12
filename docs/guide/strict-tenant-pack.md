# Strict Tenant Pack

The strict pack makes row level security fail closed, so a request signed for one tenant reads and writes only that tenant's rows.

It is opt-in. `supabase db push` never applies it, and a deployment that does not run it keeps today's behaviour. Apply it when tenant JWTs (`role: authenticated` with a `tenant_id` claim) reach PostgREST and several tenants share one database. A deployment where only the service key talks to the database gains little from it.

The pack lives in `supabase/strict/`:

| File | Purpose |
|---|---|
| `strict_pack.sql` | The changes. Every step checks the catalog first, so a second run changes nothing |
| `catalog_guard.sql` | Read-only checks that fail, listing every gap, when the database is not in the strict state |
| `apply.sh` | Runs both in one transaction, or the guard alone |

## Before you apply

1. **Apply every migration**, including `20261109163739_revoke_anon_read_paths.sql`. The pack refuses an older schema. PostgreSQL 15 or later is required.
2. **Give every row a tenant.** The pack refuses while any of the ten tenant tables holds a NULL or empty `tenant_id`, and while a child row's tenant differs from its vCon's. Nothing is guessed for you. Rows that cannot be assigned go to the reserved tenant `_quarantine`, which no token can read.

   ```sql
   -- vCons with no tenant go to quarantine; a trigger carries the change to their children.
   UPDATE vcons SET tenant_id = '_quarantine' WHERE tenant_id IS NULL;
   -- Children take their vCon's tenant. Repeat for each child table with a vcon_id column.
   UPDATE parties c SET tenant_id = v.tenant_id FROM vcons v
    WHERE v.uuid = c.vcon_id AND c.tenant_id IS DISTINCT FROM v.tenant_id;
   -- party_history hangs off dialog.
   UPDATE party_history h SET tenant_id = d.tenant_id FROM dialog d
    WHERE d.id = h.dialog_id AND h.tenant_id IS DISTINCT FROM d.tenant_id;
   ```

   The refusal message lists each table and count still in the way.

3. **Move service-key searches onto a claim.** After the pack, the search RPCs (`search_vcons_keyword`, `search_vcons_semantic`, `search_vcons_hybrid`, the tag searches and `search_vcons_by_tags_and_date` with its count) return rows only for the tenant in the request's JWT. A service key with no `tenant_id` claim gets an empty result. Table reads through the service key are unchanged.

## Apply

```bash
supabase/strict/apply.sh --dry-run "$DATABASE_URL"   # what would change; rolls back
supabase/strict/apply.sh "$DATABASE_URL"             # apply, then the guard, in one transaction
supabase/strict/apply.sh --check "$DATABASE_URL"     # the guard alone; changes nothing
```

`DATABASE_URL` is a connection string for the role that owns the schema (`postgres` on Supabase). Without it, `psql` uses the usual `PG*` variables.

| Exit | Meaning |
|---|---|
| 0 | Applied, already in the strict state, or the check passed |
| 2 | Usage error, `psql` missing, or no connection |
| 3 | Refused: rows without a tenant, mismatched children, or a schema older than the pack expects. Nothing changed |
| 4 | The catalog guard failed. After an apply, everything was rolled back |
| 1 | Any other error. Rolled back |

Each change prints a line starting `strict-pack: changed:`. A run on a database already in the strict state prints none and reports that nothing changed.

## Re-run after every upgrade

A migration can `CREATE OR REPLACE` a search function and bring back the branch that admits rows with no tenant, recreate a view without `security_invoker`, or grant the tag materialized view again. The guard fails when that happens. After each upgrade:

```bash
supabase/strict/apply.sh --check "$DATABASE_URL" || supabase/strict/apply.sh "$DATABASE_URL"
```

The pack restores the shapes it knows. When it meets one it does not, it stops and names the object rather than skip it:

- a search function whose NULL-tenant branch is written in a form the rewrite does not recognise, or a tag-and-date search whose body changed shape;
- an extra permissive policy, a `SECURITY DEFINER` function, a materialized view or a new table that a tenant role can reach.

Those need a person: fix the object, or extend `strict_pack.sql`, then run the pack again.

An upgrade that drops `vcon_tags_mv` without `CASCADE` fails on a strict database, because `vcon_tags_scoped` depends on it. Drop `vcon_tags_scoped` first; the next pack run recreates it.

## What it changes

| Area | Change |
|---|---|
| Policies | One policy per tenant table, for `authenticated` only: `tenant_id = (SELECT get_current_tenant_id())` for reading and writing, with no NULL branch. Row level security is enabled and forced |
| Tenant source | `get_current_tenant_id()` reads the signed JWT claim only. A missing claim, an empty claim and `_quarantine` all mean no tenant. The `app.current_tenant_id` session fallback is gone, so `set_tenant_context()` has no effect |
| Views | Every view runs with the caller's privileges (`security_invoker`) |
| Tag view | `vcon_tags_scoped` shows the caller's tenant's rows of `vcon_tags_mv`. `authenticated` reads it and loses `vcon_tags_mv` and the refresh functions; the service key keeps both |
| Search RPCs | Twelve functions lose their NULL-tenant branch and read `vcon_tags_scoped`. `search_vcons_by_tags_and_date` and its count gain a tenant predicate |
| `vkong.vcons` | `authenticated` loses it. It has no tenant column |
| Backstops | `tenant_id` is `NOT NULL` and never empty on all ten tables. These bind the service key too |
| Keys | Each child references its parent by `(id, tenant_id)`: the eight children of `vcons` by `(uuid, tenant_id)`, `party_history` by `dialog (id, tenant_id)`. A tenant cannot attach a row to another tenant's vCon, and a tenant move cascades to every child |

The ten tenant tables are `vcons`, `parties`, `dialog`, `attachments`, `analysis`, `groups`, `party_history`, `vcon_embeddings`, `embedding_queue` and `s3_sync_tracking`.

## What the guard checks

- Every table with a `tenant_id` column has row level security on and forced, a `NOT NULL` non-empty `tenant_id`, and only the tenant filter as a permissive policy for `anon`, `authenticated` or `PUBLIC`.
- Every foreign key between tenant tables includes `tenant_id` on both sides.
- No function `anon` or `authenticated` can execute is `SECURITY DEFINER`, tests a tenant for NULL, reads `vcon_tags_mv`, or reads a session setting other than the JWT claims.
- Every view runs as the caller, except `vcon_tags_scoped`, which must be exactly the tenant filter.
- `anon` and `authenticated` hold nothing on any materialized view, and `anon` holds nothing on any table or function.
- `get_current_tenant_id()` returns NULL with no claim, an empty claim, `_quarantine`, or only the session variable set.

## Test it

The tests run on a throwaway stack in Docker and need nothing else of yours: PostgreSQL 17 with pgvector (`pgvector/pgvector:0.8.1-pg17`), every migration unmodified, PostgREST 16.2 (`postgrest/postgrest:v16.2`) at pool 4, and HS256 JWTs. Fixtures hold two tenants, a vCon of the second tenant whose children have no tenant, a vCon with no tenant and one in `_quarantine`, each with its own canary word.

```bash
npm run test:tenant            # REST shape with the strict pack applied
npm run test:tenant:baseline   # the same requests on the unmodified schema
npm run test:tenant:guard      # apply.sh and the catalog guard
```

On Node 22.18 or later, `node tests/tenant-isolation/rest-shape.ts` works without `npm install`. `KEEP=1` leaves the containers running.

The REST shape sends each request as the first tenant and fails if a response contains another fixture's canary, or if a read that should return the tenant's own rows does not contain its canary. It covers the ten tables by read, insert, upsert, update and delete; the search and tag RPCs, including those behind `search_vcons`, `search_vcons_content`, `search_vcons_semantic`, `get_vcon` and `delete_vcon`; both views; the tag views; `exec_sql` and `explain_query`; the session-variable spoof; the composite keys; no, null, empty and quarantine claims, expired and wrongly signed tokens, `anon`; and service-key searches and re-posts. The baseline run expects the leaks the pack closes, which shows the harness can see a leak.

The guard test checks that the pack refuses NULL rows and leaves the catalog unchanged, that a second run leaves a catalog snapshot identical row for row, and that each kind of upgrade regression makes the guard fail until the pack runs again.

## Known limits

- The service key still reads every tenant on direct table reads. It carries no tenant traffic.
- A service-key re-post of a vCon with a different `tenant_id` moves the vCon and its children to that tenant. Keeping a stored tenant is the writer's job, not the pack's.
- Unique keys still tell a caller that can insert whether a vCon uuid exists: inserting another tenant's uuid fails with a duplicate-key error rather than succeeding. vCon uuids are random, and a tenant-scoped reader that does not insert never reaches this.
- `FORCE ROW LEVEL SECURITY` binds a table owner without `BYPASSRLS`. On Supabase, `postgres` and `service_role` have `BYPASSRLS`, which beats it.
