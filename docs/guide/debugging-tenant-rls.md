# Debugging Tenant ID and RLS

How the tenant reaches a row, which caller row level security binds, and how to check each step.

## How tenancy works in the store

- `vcons.tenant_id` holds the tenant. Nine child tables carry the same column, and an insert trigger on each (`set_<table>_tenant_id`) copies it from the parent vCon. `party_history` takes it through `dialog`.
- With `RLS_ENABLED=true` the server reads the tenant from the vCon's tenant attachment (`purpose` or `type` equal to `TENANT_ATTACHMENT_TYPE`, value at `TENANT_JSON_PATH`) and writes it to `vcons.tenant_id`. No database trigger reads the attachment.
- The tenant policies admit the `authenticated` role to rows whose `tenant_id` equals `get_current_tenant_id()`. That function reads the `tenant_id` claim of the request's JWT.
- The service role key bypasses row level security. A server using it, which is the default, reads every tenant's rows from the tables whatever `CURRENT_TENANT_ID` says. Per-tenant isolation needs a JWT with `role: authenticated` and a `tenant_id` claim on each request.

Two things differ until the [strict pack](./strict-tenant-pack.md) is applied:

| | Without the strict pack | With it |
|---|---|---|
| Rows with a NULL `tenant_id` | Every `authenticated` caller reads and can claim them | Cannot exist (`NOT NULL`) |
| `get_current_tenant_id()` with no claim | Falls back to the `app.current_tenant_id` session variable | NULL, so no rows |
| Search RPCs with no tenant | Return every tenant's rows | Return no rows |
| `set_tenant_context()` | Sets the fallback on one pooled connection, which later requests with no claim inherit | Ignored |

## Quick diagnosis

1. **Which key does the server use?** The startup log shows `key_type`. With `service_role`, tables are not filtered by tenant. That is expected: the service key is for the writer and operators, not for tenant traffic.
2. **Is the strict pack in place?** Run `supabase/strict/apply.sh --check "$DATABASE_URL"`. Exit 0 means it is; exit 4 lists what is missing.
3. **Do the rows have tenants?**

   ```sql
   SELECT coalesce(tenant_id, '(none)') AS tenant, count(*) FROM vcons GROUP BY 1 ORDER BY 2 DESC;
   ```

   A vCon whose tenant attachment was missing or unreadable at write time has `tenant_id` NULL.
4. **Which tenant does a request carry?** Call the function through PostgREST with the same token the caller uses:

   ```bash
   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/get_current_tenant_id" \
     -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $TENANT_JWT" -H 'Content-Type: application/json' -d '{}'
   ```

   Or in psql, as the request would run:

   ```sql
   BEGIN;
   SET LOCAL ROLE authenticated;
   SELECT set_config('request.jwt.claims', '{"role":"authenticated","tenant_id":"t-aaaaaaaaaaaaaaaa"}', true);
   SELECT get_current_tenant_id();          -- t-aaaaaaaaaaaaaaaa
   SELECT uuid, tenant_id FROM vcons LIMIT 5;  -- only that tenant's rows
   ROLLBACK;
   ```

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `TENANT_MODE` | unset (`off`) | `writer` stamps every vCon (`_quarantine` when the stamp is missing or bad) and refreshes the tag view; `lane` serves tenants with their own JWT and holds no key. See [the writer guide](./rls-multi-tenant.md) and [the tenant lane](./tenant-lane.md) |
| `RLS_ENABLED` | `false` | Turns on tenant extraction on write, and the startup tenant checks below |
| `TENANT_ATTACHMENT_TYPE` | `tenant` | Attachment `purpose` (or legacy `type`) that holds the tenant |
| `TENANT_JSON_PATH` | `id` | Path to the tenant id inside that attachment's body |
| `CURRENT_TENANT_ID` | (none) | Passed to `set_tenant_context()` at startup. It does not filter table reads through the service key. With the strict pack applied it has no effect. `TENANT_MODE=writer` refuses to start with it set |
| `RLS_DEBUG`, `MCP_DEBUG` | `false` | Log a count of visible vCons by tenant at startup |

## Startup log messages

| Message | Meaning |
|---|---|
| `RLS is enabled but CURRENT_TENANT_ID is not set` | Informational. The message's own text ("only tenant_id=NULL") is not accurate: through the service key every row is visible |
| `Tenant context set successfully` | `set_tenant_context()` ran on one pooled connection. Other connections did not get it |
| `Tenant context mismatch!` | `get_current_tenant_id()` ran on a connection without the setting, or the strict pack is applied and ignores it. Neither affects table reads through the service key |
| `Failed to set tenant context` | Since migration `20261109163739_revoke_anon_read_paths.sql`, only `service_role` may call `set_tenant_context()`. An anon or `authenticated` key gets permission denied |

## Common issues

### A tenant sees rows it should not

Check, in order:

1. The caller uses the service key. It sees everything by design.
2. The rows have NULL `tenant_id` and the strict pack is not applied, so the policies admit them to every tenant. Assign the rows a tenant (or `_quarantine`), then apply the pack.
3. A search RPC was replaced by an upgrade and lost its tenant filter. `apply.sh --check` names it; re-run `apply.sh`.

### A tenant sees nothing

1. The JWT has no `tenant_id` claim, an empty one, or `_quarantine`. All three mean no tenant.
2. The rows carry a different tenant id than the token, for example a different case or a stray space.
3. The search RPC needs the tag view: with the strict pack, tag searches read `vcon_tags_scoped`, which shows only the caller's tenant. If tags look stale, the writer has not refreshed `vcon_tags_mv`; a tenant token cannot refresh it.

### A write fails with a row level security or not-null error

With the strict pack, every row needs a tenant. An `authenticated` caller can write only rows of its own tenant, and a child must belong to the same tenant as its vCon. The service key may write any tenant but not none.

## Test tenant isolation

`npm run test:tenant` runs the REST shape on a throwaway PostgreSQL 17 and PostgREST 16.2 in Docker, with every migration, the strict pack and two synthetic tenants. It needs Docker, not your database. `npm run test:tenant:baseline` runs the same requests on the unmodified schema and expects the known leaks; `npm run test:tenant:guard` tests the apply script and the catalog guard. See [the strict pack guide](./strict-tenant-pack.md#test-it).

## Key functions

- `get_current_tenant_id()`: the request's tenant, from the JWT `tenant_id` claim (and, without the strict pack, the session fallback).
- `set_tenant_context(text)`, `clear_tenant_context()`: set or clear `app.current_tenant_id`. `service_role` only. Legacy.
- `backfill_vcon_tenant_ids(batch_size, writer_rule)`: fills `vcons.tenant_id` from tenant attachments, one batch at a time. `service_role` only.
- `backfill_tenant_id_batch(table, batch_size)`: gives child rows their parent vCon's tenant, one batch at a time. `service_role` only.
- `release_vcon_from_quarantine(uuid, tenant, reason, evidence, released_by)`: the one way out of `_quarantine`, logged. `service_role` only.
- `scripts/backfill-tenant-ids.ts`: runs `backfill_tenant_id_batch` over every child table.
