# VCONIC Troubleshooting Guide

**Audience:** Reseller support engineers triaging issues at a customer
site before escalating.

## Reseller lens

Run these checks first; they resolve the majority of customer reports
without engineering escalation. Each row points at the deeper doc for
follow-up.

## First-five checks

1. **Service up?** `docker ps --filter name=vconic`
2. **Health OK?** `curl http://<host>:3000/api/v1/health`
3. **Version known?** `curl -I http://<host>:3000/api/v1/health` →
   record `X-Version` + `X-Git-Commit`
4. **DB reachable?** Logs show no Supabase connection errors on startup
5. **Auth working?** A request with a valid `API_KEYS` entry returns 200

## Symptom triage

| Symptom | Likely cause | First action |
|---|---|---|
| Container exits immediately | Missing `SUPABASE_URL` or `SUPABASE_ANON_KEY` | `docker logs vconic` and check env vars |
| 503 on every REST call | `API_AUTH_REQUIRED=true` with empty `API_KEYS` | Set `API_KEYS` or `API_AUTH_REQUIRED=false` |
| 401 from authenticated client | Wrong `API_KEY_HEADER` or missing `Bearer ` prefix | Confirm client uses `Authorization: Bearer <key>` (default) |
| MCP tools menu is empty | `MCP_TOOLS_PROFILE` too restrictive or `MCP_DISABLED_CATEGORIES` set | Remove overrides, restart, retry |
| `tools/list` works but `search_vcons_semantic` returns nothing | No `OPENAI_API_KEY` or embeddings not backfilled | Set the key; run `npm run sync:embeddings` |
| Empty results in `search_vcons` for tenant user | RLS misconfigured or tenant id missing | See [Debugging Tenant RLS](../guide/debugging-tenant-rls.md) |
| `search_vcons_content` very slow on first call | Cold full-text index, expected behavior on large corpora | Allow up to 120s steady-state; cache warms after first run |
| `add_attachment` rejects `encoding: "json"` | Known quirk of older Python client; not a server bug | See [vCon spec corrections](../reference/CORRECTED_SCHEMA.md) |
| `analysis.schema_version` rejected | Spec field is `schema`, not `schema_version` | Fix client payload |
| Migrations fail mid-run | Missing `SUPABASE_DB_URL` permission or running against wrong DB | Verify URL; back up before retry |
| pgvector missing | Self-hosted Supabase without the extension installed | Enable `vector` extension in the database |

## Diagnostic commands

```bash
# Container state and resource use
docker stats --no-stream vconic

# Recent error-level logs
docker logs --since 1h vconic 2>&1 | grep '"level":50' | tail -20

# Effective env (mask secrets before sharing)
docker exec vconic env | grep -E '^(MCP_|SUPABASE_|API_|RLS_|OTEL_)' | sed 's/=.*KEY.*/=***/'

# Health + version headers
curl -s -D - http://localhost:3000/api/v1/health | head -10
```

## Escalation checklist

When opening an internal escalation, include:

- `X-Version` and `X-Git-Commit` from the health endpoint
- Last 200 lines of error-level logs (`level >= 40`)
- Output of `get_database_shape` from an MCP client
- Customer's transport mode (`stdio` vs `http`) and whether RLS is on
- Whether the issue started after a recent upgrade or env change

## See also

- [Troubleshooting (developer view)](../guide/troubleshooting.md)
- [FAQ](../guide/faq.md)
- [Debugging Tenant RLS](../guide/debugging-tenant-rls.md)
- [Spec corrections](../reference/CORRECTED_SCHEMA.md)
