# VCONIC Quick Start Guide

**Audience:** Reseller sales engineers and pre-sales staff who need a working
demo on a laptop in under 20 minutes.

> VCONIC MCP Server is the reseller distribution of the open-source
> [`vcon-mcp`](https://github.com/vcon-dev/vcon-mcp) project. All install
> artifacts ship under the `vcon-mcp` name (npm package, Docker image, REST
> API path). VCONIC branding applies to packaging, support, and partner
> tooling — it is not a fork.

## Reseller lens

Use this guide to stand up a single-tenant demo from your laptop. For
multi-customer / production patterns, jump straight to the
[Installation Guide](./02-installation-guide.md).

## What you need

- Docker 24+
- A Supabase project (cloud or [self-hosted](../deployment/self-hosted-supabase.md))
- An MCP-capable AI client (Claude Desktop is the easiest demo)

## 1. Pull the image

```bash
docker pull public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:latest
```

Tags published per build: `main-<7-char-sha>`, `latest` (main HEAD), and
semver tags (e.g. `1.2.0`, `1.2`, `1`) on tagged releases.

## 2. Apply database migrations

Run migrations against the Supabase project once. The image bundles the
Supabase CLI:

```bash
docker run --rm \
  -e SUPABASE_DB_URL='postgresql://postgres:<pwd>@<host>:5432/postgres' \
  public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:latest \
  migrate
```

For deeper context on migrations and what they touch, see
[Migration Guide](../reference/MIGRATION_GUIDE.md).

## 3. Start the server (stdio for Claude Desktop)

The fastest demo path is stdio, launched directly by Claude Desktop. Add
this block to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "vconic": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "SUPABASE_URL=https://your-project.supabase.co",
        "-e", "SUPABASE_ANON_KEY=your-anon-key",
        "public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:latest"
      ]
    }
  }
}
```

Restart Claude Desktop. The `vconic` server appears in the MCP tools menu.

## 4. Smoke-test from the client

Ask the assistant something simple:

> "Show me the database shape."

It should call `get_database_shape` and return tables and row counts.

## 5. Next steps

- Production install → [Installation Guide](./02-installation-guide.md)
- Tune env vars → [Configuration Guide](./03-configuration-guide.md)
- See available tools → [MCP Tools reference](../api/tools.md)

## See also

- [Quick Start (developer view)](../guide/quick-start.md)
- [Getting Started](../guide/getting-started.md)
- [Docker deployment](../deployment/docker.md)
