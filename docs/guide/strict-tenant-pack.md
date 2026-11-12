# Strict Tenant Pack

The strict pack makes row level security fail closed, so a request signed for one tenant reads and deletes only that tenant's rows and writes nothing else.

It is opt-in. `supabase db push` never applies it, and a deployment that does not run it keeps today's behaviour. Apply it when tenant JWTs (`role: authenticated` with a `tenant_id` claim) reach PostgREST and several tenants share one database, as with the [tenant lane](./tenant-lane.md). A deployment where only the service key talks to the database gains little from it, and loses some search results (see below).

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

   The refusal message lists each table and count still in the way. For data that carries tenant
   attachments, `backfill_vcon_tenant_ids` and `backfill_tenant_id_batch` do the same in batches;
   see [the writer guide](./rls-multi-tenant.md). A vCon placed in `_quarantine` leaves it only
   through `release_vcon_from_quarantine`, which logs who moved it and why.

3. **Write every vCon with a tenant.** After the pack, a write whose `vcons` row has no `tenant_id`
   fails with a not-null error, including a `save_vcon_batch` re-post that leaves it out: the
   constraint is checked before the re-post can keep the stored tenant. `TENANT_MODE=writer`
   always stamps one (`_quarantine` when the stamp is missing or bad). Child rows take their vCon's
   tenant from their insert triggers.
4. **Move service-key searches onto a claim**, or accept losing them. See the next section.
5. **Plan a maintenance window.** See [Locks and time](#locks-and-time).

## What stops working for the service key

The pack makes every search RPC filter on the tenant in the request's JWT, with no fallback. A server that holds the service key and sends no `tenant_id` claim, which is how `TENANT_MODE=writer` and `TENANT_MODE` unset run, gets nothing back from them. Table reads through the service key are unchanged, and so is everything that reads tables directly.

| Surface | Under the pack, with the service key and no claim |
|---|---|
| MCP `search_vcons_content` | no results (`search_vcons_keyword`) |
| MCP `search_vcons_semantic` | no results (`search_vcons_semantic`) |
| MCP `search_vcons_hybrid` | no results (`search_vcons_hybrid`) |
| MCP `search_by_tags` | no results (`search_vcons_by_tags`) |
| MCP `search_vcons` with `tags` | no results (`search_vcons_by_tags_and_date`) |
| MCP `search_vcons` with a dealer filter | no results (`vcon_uuids_for_dealer_filter`); the total from `count_vcons_for_dealer_filter` or `count_vcons_tags_and_dealer` is 0 |
| MCP `search_vcons` with dates and no subject | results as before; the reported total is 0 (`search_vcons_by_tags_and_date_count`) |
| MCP `vcon_search` | `keyword`, `semantic` and `hybrid` modes return nothing; `metadata` mode as `search_vcons` above |
| MCP `vcon_aggregate` | no rows (`aggregate_vcons_by_dealer_stats`) |
| REST `GET /api/v1/vcons/search/content`, `/semantic`, `/hybrid` | no results |
| REST `GET /api/v1/tags/search` | no results |
| REST `GET /api/v1/vcons` with `tags`, or with dates and a count | as `search_vcons` above |

Unchanged for the service key: `get_vcon`, `delete_vcon`, the create and update tools, `search_vcons` with no tag, dealer or date filter, `get_tags`, `get_unique_tags`, the analytics and database tools, and the resources.

A service-key caller that sends a `tenant_id` claim gets that tenant's results from all of the above. The tenant lane always sends one.

## Apply

The connection string comes from `DATABASE_URL` or a file, never from the command line, where `ps` would show its password. The password is passed to `psql` in `PGPASSWORD`.

```bash
export DATABASE_URL=postgresql://postgres:...@host:5432/postgres   # or --url-file FILE
supabase/strict/apply.sh --dry-run    # what would change; rolls back
supabase/strict/apply.sh              # apply, then the guard, in one transaction
supabase/strict/apply.sh --check      # the guard alone; changes nothing
```

Use the role that owns the schema (`postgres` on Supabase). With neither `DATABASE_URL` nor `--url-file`, `psql` uses the usual `PG*` variables.

| Exit | Meaning |
|---|---|
| 0 | Applied, already in the strict state, or the check passed |
| 2 | Usage error, `psql` missing, or no connection |
| 3 | Refused: rows without a tenant, mismatched children, or a schema older than the pack expects. Nothing changed |
| 4 | The catalog guard failed. After an apply, everything was rolled back |
| 1 | Any other error. Rolled back |

Each change prints a line starting `strict-pack: changed:`. A run on a database already in the strict state prints none and reports that nothing changed.

## Locks and time

The first apply runs as one transaction and holds what it takes until it commits:

- `SET NOT NULL` and the `tenant_id <> ''` check scan each of the ten tables under an `ACCESS EXCLUSIVE` lock.
- Each new foreign key scans its child table to validate it, and each new unique key builds an index.
- Policies, functions and grants change catalog rows and lock those objects briefly.

`lock_timeout` is 10 seconds, but it bounds only the wait to get a lock, not the time a scan holds one. While the transaction runs, reads and writes on the tenant tables wait. The time grows with the size of the tables: a store of a few hundred vCons finishes in well under a second, and a store of millions can hold its locks for minutes. Apply in a maintenance window with writers paused. `--dry-run` takes the same locks, so run it in the window too, or on a copy. Later runs on a database already in the strict state skip every step and take no table locks.

## Re-run after every upgrade

A migration can `CREATE OR REPLACE` a search function and bring back the branch that admits rows with no tenant, recreate a view without `security_invoker`, or grant a privilege back. The guard fails when that happens. After each upgrade:

```bash
supabase/strict/apply.sh --check || supabase/strict/apply.sh
```

The pack restores the shapes it knows. When it meets one it does not, it stops and names the object rather than skip it:

- a search function whose NULL-tenant branch is written in a form the rewrite does not recognise, or a tag-and-date search whose body changed shape;
- an extra permissive policy, a `SECURITY DEFINER` function, a STABLE function that treats the tenant in a NULL-tolerant way, a materialized view or a new table that a tenant role can reach.

Those need a person: fix the object, or extend `strict_pack.sql`, then run the pack again.

An upgrade that drops `vcon_tags_mv` without `CASCADE` fails on a strict database, because `vcon_tags_scoped` depends on it. Drop `vcon_tags_scoped` first; the next pack run recreates it.

## What it changes

| Area | Change |
|---|---|
| Policies | One policy per tenant table, for `authenticated` only: `tenant_id = (SELECT get_current_tenant_id())`, with no NULL branch. Row level security is enabled and forced |
| Tenant source | `get_current_tenant_id()` reads the signed JWT claim only. A missing claim, an empty claim and `_quarantine` all mean no tenant. The `app.current_tenant_id` session fallback is gone, so `set_tenant_context()` has no effect |
| Table privileges | `authenticated` keeps `SELECT` and `DELETE` on the tenant tables and loses `INSERT` and `UPDATE`: a tenant reads and deletes, and the writer, with the service key, does every write. Views are `SELECT` only. `PUBLIC`, `anon` and `authenticated` lose `TRUNCATE`, `TRIGGER`, `REFERENCES` and `MAINTAIN` on every table and view, which row level security does not govern, and tables `postgres` creates in `public` later grant none of the four |
| Functions | Tenant roles execute no `VOLATILE` function, the only kind that can write: `save_vcon_batch`, `remove_vcon_child_and_compact`, `mark_vcon_synced`, `recompute_vcon_conversation_start` and `backfill_search_vector_batch` among them. Three read-only helpers declared `VOLATILE` go with them: `get_vcon_embeddings`, `get_unsynced_vcons` and `check_vcon_embeddings_complete`. The search and tag RPCs are `STABLE` and stay |
| Service-only functions | `exec_sql`, `explain_query`, the session-tenant and health functions, the tag refresh, `backfill_tenant_id_batch`, `backfill_vcon_tenant_ids`, `vcon_tenant_stamp` and `release_vcon_from_quarantine` stay `service_role` only. A later grant is taken back |
| Conversation start | Deleting a dialog or attachment row refreshes its vCon's `conversation_start` through a trigger that updates `vcons`. It runs as its owner (`SECURITY DEFINER`, `search_path` fixed to `public, pg_temp`), so a tenant's `delete_vcon` still works without `UPDATE` on `vcons`. Its owner must have `BYPASSRLS`; the pack hands it to the owner of `vcons` if not. Tenant roles cannot execute it directly. It touches only vCons whose rows the caller has just deleted |
| Views | Every view runs with the caller's privileges (`security_invoker`) |
| Tag view | `vcon_tags_scoped` shows the caller's tenant's rows of `vcon_tags_mv`, runs as the owner of `vcon_tags_mv`, and is a security barrier. `authenticated` reads it and loses `vcon_tags_mv` and the refresh functions; the service key keeps both |
| Search RPCs | Twelve functions lose their NULL-tenant branch and read `vcon_tags_scoped`. `search_vcons_by_tags_and_date` and its count gain a tenant predicate |
| `vkong.vcons` | `authenticated` loses it. It has no tenant column |
| Backstops | `tenant_id` is `NOT NULL` and never empty on all ten tables. These bind the service key too |
| Keys | Each child references its parent by `(id, tenant_id)`: the eight children of `vcons` by `(uuid, tenant_id)`, `party_history` by `dialog (id, tenant_id)`. A row cannot hang off another tenant's vCon, and a tenant move cascades to every child |

The ten tenant tables are `vcons`, `parties`, `dialog`, `attachments`, `analysis`, `groups`, `party_history`, `vcon_embeddings`, `embedding_queue` and `s3_sync_tracking`.

## What the guard checks

- Every table with a `tenant_id` column has row level security on and forced, a `NOT NULL` non-empty `tenant_id`, and only the tenant filter as a permissive policy for `anon`, `authenticated` or `PUBLIC`.
- `anon` and `authenticated` hold no `TRUNCATE`, `TRIGGER`, `REFERENCES` or `MAINTAIN` on any table or view, no `INSERT` or `UPDATE` (column grants included) on a tenant table, and only `SELECT` on a view.
- Every foreign key between tenant tables includes `tenant_id` on both sides.
- No function `anon` or `authenticated` can execute is `SECURITY DEFINER` or `VOLATILE`, reads `vcon_tags_mv`, reads a session setting other than the JWT claims, or treats the tenant in a NULL-tolerant way; none of the service-only functions is executable by them; and the conversation-start trigger runs as its owner, with `search_path` exactly `public, pg_temp`, an owner that has `BYPASSRLS`, and no `EXECUTE` grant to `anon` or `authenticated`.
- Every view runs as the caller, except `vcon_tags_scoped`, which must be exactly the tenant filter, a security barrier, and owned by the owner of `vcon_tags_mv`.
- `anon` and `authenticated` hold nothing on any materialized view, and `anon` holds nothing on any table or function.
- `get_current_tenant_id()` returns NULL with no claim, an empty claim, `_quarantine`, or only the session variable set.

### What the function check can and cannot see

It reads the source of every function `anon` or `authenticated` can execute and fails on these ways of letting a missing tenant through, where "tenant" is any identifier containing the word, such as `current_tenant`, `v.tenant_id` or `get_current_tenant_id()`:

- `... tenant ... IS NULL`
- `IS DISTINCT FROM` or `IS NOT DISTINCT FROM` on either side of a tenant
- `COALESCE(...)` or `NULLIF(...)` with a tenant among its arguments
- a tenant compared with `''`

It cannot see:

- a test written some other way, such as `OR true` or `length(current_tenant) = 0`;
- a tenant held in a variable whose name lacks "tenant";
- a predicate that is simply missing;
- SQL assembled at run time from strings.

It does not scan trigger functions, which cannot be called directly, or functions only `service_role` can execute. `get_current_tenant_id()` is checked by behaviour instead. For an `authenticated` caller these gaps matter less than they look: the functions run as the caller, so the table policies and `NOT NULL` still bind. A NULL-tolerant body widens what a `service_role` caller with a tenant claim sees.

## Test it

The tests run on a throwaway stack in Docker and need nothing else of yours: PostgreSQL 17 with pgvector (`pgvector/pgvector:0.8.1-pg17`), every migration unmodified, PostgREST 16.2 (`postgrest/postgrest:v16.2`) at pool 4, and HS256 JWTs. Fixtures hold two tenants, a vCon of the second tenant whose children have no tenant, a vCon with no tenant and one in `_quarantine`, each with its own canary word.

```bash
npm run test:tenant            # REST shape with the strict pack applied
npm run test:tenant:baseline   # the same requests on the unmodified schema
npm run test:tenant:guard      # apply.sh and the catalog guard
npm run test:tenant:mcp        # MCP shape: the server as a tenant lane, strict pack applied
npm run test:tenant:mcp:baseline  # the same calls on the unmodified schema
```

On Node 22.18 or later, `node tests/tenant-isolation/rest-shape.ts` works without `npm install`. `KEEP=1` leaves the containers running.

The REST shape sends each request as the first tenant and fails if a response contains another fixture's canary, or if a read that should return the tenant's own rows does not contain its canary. It covers:

- the ten tables by read, insert, upsert, update and delete;
- `TRUNCATE` and `CREATE TRIGGER` as `authenticated`;
- the search and tag RPCs, including those behind `search_vcons`, `search_vcons_content`, `search_vcons_semantic`, `get_vcon` and `delete_vcon`;
- every write RPC;
- both views and the tag views;
- `exec_sql` and `explain_query`;
- the session-variable spoof;
- the composite keys;
- the uuid oracle and the uuid squat;
- no, null, empty and quarantine claims, expired and wrongly signed tokens, and `anon`;
- service-key searches and re-posts.

The baseline run expects the leaks the pack closes, which shows the harness can see a leak.

The strict run ends by serving PostgREST the way the [tenant lane](./tenant-lane.md) needs it: a login role that is a member of `authenticated` only and no anon role, so a `service_role` or anon token fails and a request with no token gets 401. `startRest('lane')` in `tests/tenant-isolation/stack.ts` gives that shape to other tests.

The MCP shape runs the server itself as a [tenant lane](./tenant-lane.md) (`TENANT_MODE=lane`, no key) against that PostgREST, through a proxy that strips the `/rest/v1` prefix supabase-js adds, and calls it with a real MCP client. As the first tenant it calls each of the five tools with the second tenant's uuid and canary text and fails on any answer that holds them, and checks that its own canary comes back through each. `search_vcons_semantic` gets a precomputed embedding; with query text and no embedding provider it must report itself unavailable. Markers are looked for in every field of an answer (text, `structuredContent`, `_meta`, error data), not only its text. It also checks `delete_vcon` of the other tenant's uuid (not found, the row stays), of its own vCon (gone with every child row), and of its own vCon while a row-security policy refuses the delete but allows the read (not found, the row stays); that a `_quarantine` claim, a missing tenant claim, a wrong signature, a `service_role` claim and an expired token each read nothing; that every other tool, resources and prompts are refused; that every store request carried the caller's token and nothing else; and that the lane refuses to start with a service or anon key. It needs `npm ci`, since it runs the server and the MCP client from this repo. The baseline run expects the leaks the pack closes to show through the lane, and fails if none does.

The guard test checks:

- that the pack refuses NULL rows and leaves the catalog unchanged;
- that a second run leaves a catalog snapshot identical row for row;
- that each kind of upgrade regression makes the guard fail until the pack runs again: a restored privilege or function grant, a NULL branch in any of the spellings above, and the other cases.

## Known limits

- The service key still reads every tenant on direct table reads. It carries no tenant traffic.
- `authenticated` keeps `DELETE` on the tenant tables for `delete_vcon`. A database session that can `SET ROLE authenticated`, such as one logged in as a PostgREST login role, can therefore still `LOCK` a tenant table. PostgREST never issues `LOCK`, so keep its login credentials secret.
- `FORCE ROW LEVEL SECURITY` binds a table owner without `BYPASSRLS`. On Supabase, `postgres` and `service_role` have `BYPASSRLS`, which beats it. The conversation-start trigger relies on its owner having `BYPASSRLS`.
