# VCONIC MCP Server — Release Notes

**Document ID:** VCONIC-MCP-RN-001  
**Product:** VCONIC MCP Server  
**Version:** 1.2.0  
**Audience:** Value Added Reseller (VAR) / Systems Integrator  
**Last Updated:** April 2026

---

## Current Release

### Version: 1.2.0 (April 2026)

**Release Date:** April 2026  
**Docker Image:** `public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp:main`

#### New Features

- **31 MCP tools** for comprehensive vCon management:
  - CRUD operations (create, read, update, delete vCons)
  - Content management (dialog, analysis, attachments)
  - Search (keyword, semantic, hybrid)
  - Tag management
  - Database analytics and health monitoring
  - Schema and examples
- **Dual transport support** — stdio (for desktop AI assistants) and HTTP/SSE (for remote clients)
- **REST API** — Koa-based REST endpoints for vCon ingestion and retrieval
- **Tool profiles** — Preset configurations (full, readonly, user, admin, minimal) for access control
- **Plugin architecture** — Extensible hook system for custom business logic
- **Redis caching** — Optional caching layer for 20-50x faster reads
- **Multi-tenant support** — Row-Level Security with tenant-based data isolation
- **OpenTelemetry observability** — Automatic instrumentation with console and OTLP exporters
- **Database migrations** — Built-in migration system via Docker command
- **Structured logging** — Pino-based JSON logging with trace correlation
- **Health endpoint** — `GET /api/v1/health` with database connectivity check
- **Graceful shutdown** — Clean handling of SIGINT/SIGTERM

#### Known Issues

- Semantic search requires pgvector extension to be enabled in Supabase. Enable it via the Supabase dashboard under Extensions.
- When using `MCP_HTTP_STATELESS=true`, each request creates a new session. Long-running tool executions may timeout.

#### Compatibility

| Component | Supported Versions |
|-----------|--------------------|
| Docker Engine | 24.0+ |
| Node.js | 20+ (inside container) |
| PostgreSQL | 14+ (via Supabase) |
| Redis | 6.x, 7.x (optional) |
| MCP Protocol | 1.x |
| Supported MCP Clients | Claude Desktop, Claude Code, any MCP-compatible client |

---

## Release Notes Template

*Future releases will follow this format:*

### Version: X.Y.Z (Month Year)

**Release Date:** Month DD, YYYY  
**Docker Image Tag:** `<version>`  
**Upgrade Path:** From version A.B.C → X.Y.Z

#### New Features
- Feature description

#### Enhancements
- Enhancement description

#### Bug Fixes
- Fix description

#### Breaking Changes
- Description of change and migration steps

#### Known Issues
- Description and workaround

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | April 2026 | VCONIC Engineering | Initial release |
