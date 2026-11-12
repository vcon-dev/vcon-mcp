# Tenant lane (`TENANT_MODE=lane`)

A tenant lane is one vcon-mcp process that serves many tenants of a row-level store. It holds no store key.
Each request carries a short-lived JWT that names one tenant. The lane passes that JWT to its own PostgREST,
which verifies it, and the row-level policies keyed on the token's `tenant_id` claim decide which rows the
request can see. The lane serves five tools and refuses everything else.

Use it when a front end (a portal or an MCP gateway) signs users in, knows their tenant, and needs to read
that tenant's vCons. Writes, operator tools and analytics stay on a separate process that holds the
service key and runs with `TENANT_MODE=off` or `writer`.

`TENANT_MODE` is opt in. Unset, or `off`, the server behaves as it always has.

## Environment

| Variable | Lane value |
|----------|------------|
| `TENANT_MODE` | `lane` |
| `MCP_TRANSPORT` | `http`. The lane refuses to start on stdio |
| `MCP_HTTP_STATELESS` | `true`. The lane refuses to start without it |
| `SUPABASE_URL` | The lane PostgREST base URL. supabase-js appends `/rest/v1`, so the proxy in front of PostgREST strips it |
| `SUPABASE_DB_SCHEMA` | Optional, default `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Must be unset. The lane refuses to start if it holds a value |
| `SUPABASE_ANON_KEY` | Must be unset. The lane refuses to start if it holds a value |
| `MCP_HTTP_HOST`, `MCP_HTTP_PORT` | As for any HTTP server |
| `EMBEDDING_PROVIDER`, `OPENAI_API_KEY` | Needed for `search_vcons_semantic` with query text. See [Semantic search](#semantic-search) |

The lane logs a warning at start for each of these settings it ignores: `REDIS_URL`, `VCON_PLUGINS_PATH`,
`API_KEYS`, `API_KEYS_READONLY`, `API_ANONYMOUS_READONLY`, `API_AUTH_REQUIRED`, `API_KEY_HEADER`,
`OAUTH_ISSUER`, `RLS_ENABLED`, `CURRENT_TENANT_ID`, `MCP_TOOLS_PROFILE`, `MCP_ENABLED_CATEGORIES`,
`MCP_DISABLED_CATEGORIES`, `MCP_DISABLED_TOOLS`, `REST_API_ENABLED`.

## Each request

Send `Authorization: Bearer <jwt>` on every request to the MCP endpoint. The token's claims:

| Claim | Value |
|-------|-------|
| `role` | `authenticated` |
| `tenant_id` | The tenant the request reads for |
| `sub` | The user or token the request is for |
| `act` | Optional. A staff user acting for the tenant |
| `exp` | Short. 60 seconds is the intended lifetime |

The lane does not verify the signature. It holds no secret. Before any store call it refuses, with HTTP
401, a request with no bearer, or one that is not three base64url segments with a signature, whose
header or payload is not a JSON object, whose `role` is not `authenticated`, or whose `tenant_id` is not
a non-empty string. Those checks only refuse. PostgREST verifies the signature and expiry on every store
call.

For each accepted request the lane builds a new store client from that request's token. The token is
sent to PostgREST as both `apikey` and `Authorization: Bearer`. No env key is ever sent, and no client is
shared between requests.

The lane logs the `tenant_id` claim, decoded without verifying, to make its logs readable. It never logs
the bearer.

## What it serves and what it refuses

| Surface | In a lane |
|---------|-----------|
| `tools/list` | The five tools below |
| `tools/call` | `search_vcons`, `search_vcons_content`, `search_vcons_semantic`, `get_vcon`, `delete_vcon`. Any other name answers JSON-RPC "Method not found" before a handler runs |
| Resources, resource templates, prompts | Not declared. Every method answers "Method not found" |
| `POST` to the MCP endpoint | Served, stateless, one server per request |
| `GET`, `DELETE` to the MCP endpoint | 405. A stateless lane has no stream or session to offer |
| `GET <REST_API_BASE_PATH>/health` | 200, liveness only. It makes no store call, because the lane has no credential of its own |
| Every other route under `REST_API_BASE_PATH` | 404 |
| Plugins, the Redis cache, stdio, OAuth discovery | Off |
| The batch writer | Unreachable. The lane's only write is `delete_vcon` |

`delete_vcon` reports "not found" when the delete removed no row. Under row-level security another
tenant's uuid matches nothing and PostgREST answers without an error, so a zero-row delete must not read
as success.

The tag view `vcon_tags_mv` is never refreshed through a lane. A tenant token may not refresh it. The
process that holds the service key refreshes it on a timer, so tag filters in a lane can lag by that
timer's interval.

## The lane's store

The lane must reach its own PostgREST, never the one that accepts the service key. That PostgREST:

- has its own JWT secret, not the secret the service key was signed with. A holder of the old secret can
  mint a `service_role` token, and PostgREST honours the `role` claim
- connects as a login role that is a member of `authenticated` only, for example `tenant_authenticator`.
  A token that claims `service_role` then fails at `SET ROLE`
- has no anon role configured, so a request without a valid token gets nothing
- serves `PGRST_DB_SCHEMAS=public`, or the schema in `SUPABASE_DB_SCHEMA`
- sits behind a proxy that strips the `/rest/v1` prefix supabase-js adds

The rows the lane reads are only isolated when the store's policies are keyed on the verified
`tenant_id` claim, with no NULL-tenant fallback, and when nothing an `authenticated` role can execute
bypasses those policies. Apply the strict row-level tenancy pack before any tenant traffic reaches a
lane, and re-run it after every upgrade, since a migration can replace a function and restore a NULL
branch.

Do not point a lane at a PostgREST that also serves the service key, and do not give a lane any key. The
lane cannot detect another name for the same host.

## Semantic search

`search_vcons_semantic` with query text needs an embedding of that text. The default provider calls the
`embed-query` edge function with the service key, which a lane does not hold, so in a lane it fails with
an error that says so and sends nothing. Two options:

- set `EMBEDDING_PROVIDER=openai` and `OPENAI_API_KEY`. Only do this when the stored corpus was embedded
  with the same model. Vectors from different models fit the same column and give meaningless results
- have the caller pass a precomputed 384-dimension `embedding` instead of `query`

The tenant token goes to the store only. It is never sent to the embedding provider.

## Not yet tested

The lane is tested in process against a stand-in store. Not yet tested: a real PostgREST with a tenant
secret behind a proxy, Kong in the path, real pgvector, connection poolers and load.
