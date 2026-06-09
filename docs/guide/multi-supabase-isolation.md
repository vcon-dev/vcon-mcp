# Multi-Supabase Isolation (vCon groups)

Run one vCon MCP instance per group (a customer, dealer, or business unit) so
each group's data is physically or logically isolated. The caller picks a group
by choosing which named MCP server to call.

An instance is fully described by three env vars:

| Var | Meaning |
|-----|---------|
| `SUPABASE_URL` | which Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | credentials |
| `SUPABASE_DB_SCHEMA` | which Postgres schema (default `public`) |

You choose the isolation strength per instance:

- **Different `SUPABASE_URL` → project isolation.** Separate Supabase project per
  group: separate compute, connection pool, backups, and blast radius. Costs N×
  billing/RAM and an O(N) migration fan-out.
- **Same `SUPABASE_URL`, different `SUPABASE_DB_SCHEMA` → schema isolation.** A
  Postgres schema per group inside one shared project. Cheap (one
  project/pool/billing/backup); creating or dropping a group is an instant
  `CREATE`/`DROP SCHEMA`. Trade-off: shared blast radius, and a real security
  boundary needs per-schema roles (see [Security](#security)).

You can mix freely — some groups in their own projects, others as schemas in a
shared project, and local vs cloud per group.

> **Why not separate Postgres databases?** Supabase's API layer (PostgREST,
> which `supabase-js` rides on) serves only the one default `postgres` database.
> A second database is unreachable without dropping `supabase-js` for a raw `pg`
> connection. Schema isolation is the Postgres-native option that fits this stack.

This is distinct from [RLS multi-tenancy](./rls-multi-tenant.md), which keeps all
groups in one schema and filters by `tenant_id`. Use RLS when you want one shared
dataset with row-level scoping; use this guide when you want groups in separate
schemas or projects.

## Provisioning a group

### Mode A — project isolation

1. Create a Supabase project; capture its `SUPABASE_URL`, service-role and anon keys.
2. Apply the full schema — a fresh project is empty:
   ```bash
   supabase db push   # against the new project
   ```
3. Create `.env.<group>` from `.env.example` with the project's creds,
   `VCON_INSTANCE_LABEL=<group>`, and leave `SUPABASE_DB_SCHEMA` unset.
4. Optionally set `RLS_ENABLED=false` — physical separation replaces RLS.

### Mode B — schema isolation

1. Bootstrap the schema into the shared project (clones `public`'s tables,
   indexes, the `vcon_tags_mv` view, triggers, and the search RPCs into the new
   schema). It writes reviewable SQL first; re-run with `--apply` once you've
   checked the cross-schema references:
   ```bash
   scripts/bootstrap-schema.sh sales            # writes sql/bootstrap-sales.sql
   scripts/bootstrap-schema.sh sales --apply    # applies it
   ```
2. **Expose the schema to PostgREST** or `supabase-js` can't reach it:
   - Cloud: Dashboard → API → Exposed schemas → add `sales`.
   - Local: add it to `[api] schemas` in `supabase/config.toml`, then restart.
3. Create `.env.<group>` with the shared project's creds,
   `SUPABASE_DB_SCHEMA=sales`, and `VCON_INSTANCE_LABEL=sales`.

### Local vs cloud

The server is agnostic — `http://127.0.0.1:54321` (local) and
`https://<project>.supabase.co` (cloud) are interchangeable, and groups can mix.

> **Local multi-stack caveat.** The Supabase CLI binds fixed ports
> (54321/54322/…), so `supabase start` runs one stack per machine by default, and
> each stack is ~12 containers / 1–2 GB RAM. Run multiple *project-isolated* local
> groups only by remapping ports in each project's `config.toml`. Schema isolation
> sidesteps this — many local groups in one stack.

## Launching an instance

Build once, then launch per group:

```bash
npm run build
ENV_FILE=.env.sales npm run start:group
# or, equivalently, with auto-labeling:
scripts/start-group.sh sales
```

`ENV_FILE` selects which env file to load (defaults to `.env`).
`GET /api/v1/health` reports the instance's `instance` label and `schema` so you
can confirm what a process is serving.

## Wiring the MCP client

Register one named server per group. The only difference between modes is the
env block.

**Project isolation (stdio):**
```json
{
  "mcpServers": {
    "vcon-sales": {
      "command": "node",
      "args": ["/abs/path/vcon-mcp/dist/index.js"],
      "env": {
        "VCON_INSTANCE_LABEL": "sales",
        "SUPABASE_URL": "https://sales-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "…",
        "SUPABASE_ANON_KEY": "…",
        "OPENAI_API_KEY": "…"
      }
    }
  }
}
```

**Schema isolation (stdio)** — same URL/keys, different `SUPABASE_DB_SCHEMA`:
```json
{
  "mcpServers": {
    "vcon-acme": {
      "command": "node",
      "args": ["/abs/path/vcon-mcp/dist/index.js"],
      "env": {
        "VCON_INSTANCE_LABEL": "acme",
        "SUPABASE_DB_SCHEMA": "acme",
        "SUPABASE_URL": "https://shared-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "…",
        "SUPABASE_ANON_KEY": "…",
        "OPENAI_API_KEY": "…"
      }
    }
  }
}
```

**HTTP / Docker** — one container per group on distinct ports, each with the
matching env (`MCP_TRANSPORT=http`, `MCP_HTTP_PORT=300x`, optional
`SUPABASE_DB_SCHEMA`). Put a reverse proxy in front for a single hostname.

## Keeping groups in sync

Every future schema change must reach every group. This fan-out is the dominant
ongoing cost of isolation. Run it in one command:

```bash
scripts/migrate-all-groups.sh            # apply across all .env.<group>
scripts/migrate-all-groups.sh --dry-run  # preview
```

It branches per group: project-isolated groups get `supabase db push`;
schema-isolated groups get their `sql/bootstrap-<schema>.sql` re-applied
(regenerate it with `bootstrap-schema.sh` when migrations change).

## Security

In **project isolation**, each group's project is its own security boundary by
default.

In **schema isolation**, a single project **service-role key bypasses RLS and can
read every exposed schema** — so a shared service-role key makes schema separation
an *organizational* boundary, not a hard one. For a real boundary:

- Create a per-group Postgres role granted only on its schema (`GRANT USAGE ON
  SCHEMA sales`, table grants within `sales`, revoke elsewhere).
- Have that group's instance authenticate as that role (a scoped key / JWT with
  the role's `search_path`), not the project service-role key.

Until per-schema roles are in place, treat schema isolation as logical separation
with a shared trust domain.

## On-demand lifecycle (future)

Not built in today; groups are provisioned once and stay up.

- **Schema mode** makes on-demand trivial — `CREATE SCHEMA` on first use, `DROP
  SCHEMA … CASCADE` after idle, both instant and free.
- **Project mode** would use the [Supabase Management API](https://supabase.com/docs/reference/api)
  to create/restore/pause projects, plus scale-to-zero for the MCP process (stdio
  is already on-demand; for HTTP use e.g. Cloud Run `min-instances=0`). Cloud
  free-tier projects also auto-pause after ~1 week idle and resume on first request.

## Limitations

- **No cross-group queries.** Search and analytics are per-instance. A global view
  across groups would need a different design (one server with runtime routing).
- **Embeddings** share `OPENAI_API_KEY` but write into each group's own
  `vcon_embeddings`.
