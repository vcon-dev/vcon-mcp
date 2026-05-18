# VCONIC Release Notes

**Audience:** Reseller-facing summary of shipped VCONIC versions. For the
canonical, developer-oriented changelog see
[CHANGELOG.md](../reference/CHANGELOG.md).

> Versions track the underlying `vcon-mcp` package. The current published
> version is read from
> [`package.json`](https://github.com/vcon-dev/vcon-mcp/blob/main/package.json).

## Current version

### 1.2.0

**Highlights**

- Predictable vCon contract tools (deterministic shape for AI-client use)
- Strolid sync helper bundled for legacy vCon corpora ingestion
- REST API parity with the MCP tool surface
- Embedded API-key authentication for both REST and MCP HTTP transports
- Build provenance exposed via `X-Version`, `X-Git-Commit`, `X-Build-Time`
  response headers
- VitePress documentation site

**Compatibility**

| Component | Tested with |
|---|---|
| Docker Engine | 24+ |
| PostgreSQL | 14+ (via Supabase) |
| Node.js (source builds) | 20+ |
| MCP protocol | 1.x |

**Known issues**

- Cold-start `search_vcons_content` queries on large corpora can exceed
  30s on first run. Steady-state is sub-second once indexes are warm.
- Semantic search requires `OPENAI_API_KEY` (or LiteLLM) plus a
  one-time embedding backfill via `npm run sync:embeddings`.

**Upgrade notes**

Standard stop-the-world procedure — see
[Upgrade Guide](./06-upgrade-guide.md). No new required env vars over
1.1.x.

## Prior versions

For the full version history, including 1.0.x and 1.1.x details, see
the canonical [Changelog](../reference/CHANGELOG.md).

---

## Release-notes template (for future versions)

Use this skeleton for each new VCONIC release entry.

```markdown
### X.Y.Z

**Highlights**

- One sentence per shipped feature

**New environment variables**

| Variable | Default | Meaning |
|---|---|---|
| `NEW_VAR` | `default` | What it controls |

**Breaking changes**

- Explicit list. Mark any that require a code or config change at the
  customer site.

**Migration steps**

1. Concrete commands or config changes.

**Known issues**

- Item + workaround.

**Upgrade notes**

- Anything beyond the standard procedure.
```

## See also

- [Upgrade Guide](./06-upgrade-guide.md)
- [Canonical changelog](../reference/CHANGELOG.md)
- [Migration Guide](../reference/MIGRATION_GUIDE.md)
