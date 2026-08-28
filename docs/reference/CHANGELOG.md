# Changelog

All notable changes to the vCon MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [1.6.1] - 2026-08-27

### Fixed
- Declared `@opentelemetry/core`, `@opentelemetry/resources` and `@opentelemetry/sdk-metrics`
  as dependencies. `dist/observability/config.js` imports all three at startup, but they were
  never declared; they only resolved in the dev repo because npm hoisted them as transitive
  deps of `@opentelemetry/sdk-node`. On a clean install with a different hoisting layout the
  server died immediately with
  `ERR_MODULE_NOT_FOUND: Cannot find package '@opentelemetry/resources'`, which an MCP client
  surfaces only as `CONNECTION_CLOSED`. Found installing the vCon plugin, whose `.mcp.json`
  launches the server with `npx -y vcon-mcp` (PR #74)

---

## [1.6.0] - 2026-08-27

### Added
- `bin` entry (`vcon-mcp` -> `dist/index.js`), so the server runs with
  `npx -y vcon-mcp`. `package.json` declared `main` and `exports` but no `bin`, so npm
  installed the package without an executable and every adopter had to clone the repo,
  build it, and point their MCP client at an absolute `dist/index.js` path. The entry
  file already carried the shebang; only the wiring was missing (PR #73)

### Changed
- README MCP client configuration examples use `npx -y vcon-mcp` instead of a hard-coded
  `dist/index.js` path, in both the Claude Desktop and read-only deployment samples
- `PUBLISHING_GUIDE.md` documents the tag-push release flow instead of walking a
  maintainer through `npm login` and `npm publish` by hand. Publishing by hand is what
  left v1.4.0 tagged and unpublished for three days; the guide now ends with
  `npm view vcon-mcp version` as the verification step, since the tag, the changelog and
  the registry drift apart independently

---

## [1.5.0] - 2026-08-21

### Added
- Read-only API keys (`API_KEYS_READONLY`). `API_KEYS` was a flat list where every token
  granted full read, write and delete over the REST API, so there was no safe credential to
  hand an external consumer of a hosted dataset. Read-only tokens authenticate but are limited
  to `GET`/`HEAD`/`OPTIONS` on REST (403 otherwise) and to non-write MCP tools, reusing the
  existing `MCP_TOOLS_PROFILE` category metadata rather than a second classification.
  `API_KEYS` keeps full access for backward compatibility; the server warns at startup when no
  read-only keys are configured, a token listed in both variables is read-only (deny wins), an
  MCP session is pinned to the scope of the key that opened it, and plugin tools (which carry
  no category) are dropped from read-only sessions (PR #69)

### Fixed
- Attachment `purpose='tags'` is now treated as equivalent to `type='tags'`. vCon 0.4.0
  classifies attachments with `purpose`, so tags arriving inside a spec-correct document were
  written with `type` NULL and were invisible to every tag read path and to `vcon_tags_mv` —
  silently, with no error. A `BEFORE INSERT OR UPDATE` trigger on `attachments` mirrors `tags`
  across both columns (with a backfill), and `vcon_tags_mv` keys on `coalesce(type, purpose)`.
  Tags written by the server now also carry the spec `purpose` field (PR #66)
- MongoDB backend tag paths (`getTags`, `saveTags`, `searchByTags`, unique-tag discovery) and
  `extractTags` recognize either spelling via a shared `isTagsAttachment()` predicate (PR #66)

### Migration
  normalizing trigger and backfills existing tag attachments. It deliberately does not rebuild
  `vcon_tags_mv`, so it is safe to apply out of order

### Notes
- 1.4.0 was tagged but never published to npm; its CHANGELOG entry was clobbered by the #66
  merge and is restored below. Installing 1.5.0 from npm brings everything since 1.3.0

## [1.4.0] - 2026-08-18

> Tagged but never published to npm; superseded by 1.5.0.

### Added
- Supabase-native `gte-small` embeddings, so a hosted dataset needs no third-party embedding key: `embedSupabase()` runs inside the Supabase project at the native 384 dims, `embed-vcons` accepts `supabase` as a provider (and falls back to it instead of erroring on a missing `OPENAI_API_KEY`), and a new `embed-query` edge function embeds query strings with the same model as the corpus. `EMBEDDING_PROVIDER` forces a specific choice (PR #65)

### Fixed
- **MCP over HTTP was unusable after one request.** `startHttpServer` built a single `StreamableHTTPServerTransport` at startup and reused it for every request; in stateless mode the SDK rejects a reused transport, and because `setupHttpMiddleware` never awaited `handleRequest` the rejection surfaced as an empty-body HTTP 500 — so a hosted server accepted exactly one `initialize` per container start. Each request now reuses the transport for its `Mcp-Session-Id` or gets a fresh transport and MCP Server (PR #68)
- Port resolution used `config.port || ...`, so port 0 (bind any free port) fell through to the default (PR #68)
- Tags stored as a flat JSON object body (`{"source": "gmail", ...}`, produced by external ingest) read back as no tags at all, because every read path required the `["key:value", ...]` array form. `vcon_tags_mv` and a new shared `parseTagsBody()` now accept both shapes; writes still emit the array form (PR #67)
- Query-time embedding was hardcoded to `api.openai.com` with no override, so a locally embedded corpus could not be searched at all; the query path now uses the configured provider and rejects a wrong-dimension response instead of passing it into the vector comparison (PR #65)
- `vcon_embeddings` upserts were not idempotent for subject-level rows: `content_reference` is NULL there and Postgres treats NULLs as distinct in a unique constraint, so each backfill pass inserted another full 384-dim copy with no error (PR #65)

### Migration
- `20260817120000_vcon_tags_mv_object_body.sql` — rebuilds `vcon_tags_mv` on `coalesce(type, purpose)` with support for both tag body shapes
- `20260817210000_vcon_embeddings_unique_nulls_not_distinct.sql` — makes the `vcon_embeddings` unique constraint `NULLS NOT DISTINCT`

---

## [1.3.0] - 2026-06-10

### Added
- Per-group Supabase isolation: an instance is scoped by `SUPABASE_DB_SCHEMA` (default `public`), enabling one MCP server per group via a separate Supabase project (project isolation) or a separate Postgres schema in a shared project (schema isolation) (PR #58)
- `ENV_FILE` support so each instance can load its own `.env.<group>` file
- `VCON_INSTANCE_LABEL` surfaced in startup logs and `GET /api/v1/health` (alongside the active `schema`)
- `start` / `start:group` npm scripts and `scripts/start-group.sh` launcher
- `scripts/bootstrap-schema.sh` (clone `public` into a new schema, with pg version fallback, extension-type preservation, and role grants) and `scripts/migrate-all-groups.sh` (migration fan-out across groups)
- Multi-Supabase Isolation guide; group-isolation env vars documented in installation/configuration/README

### Changed
- MCP server advertises its real package version (was hardcoded `1.0.0`); now sourced from `package.json`
- The Supabase client applies `db.schema` from `SUPABASE_DB_SCHEMA`

---

## [1.2.0] - 2026-04-15

### Added
- REST API parity with MCP tool surface — full HTTP/JSON access at `/api/v1` (PR #46)
- Predictable vCon contract tools: `vcon_fetch`, `vcon_search`, `vcon_capabilities`, `vcon_taxonomy`, `describe_response_shape`
- HTTP transport (`MCP_TRANSPORT=http`) with Streamable HTTP and SSE
- API-key authentication for REST and MCP HTTP endpoints (`API_KEYS`, `API_KEY_HEADER`, `API_AUTH_REQUIRED`)
- Tool profiles and category controls (`MCP_TOOLS_PROFILE`, `MCP_ENABLED_CATEGORIES`, `MCP_DISABLED_CATEGORIES`, `MCP_DISABLED_TOOLS`)
- Docker image published to `public.ecr.aws/r4g1k2s3/vcon-dev/vcon-mcp` with `main-<sha>`, `latest`, and semver tags
- Build provenance exposed via `X-Version`, `X-Git-Commit`, `X-Build-Time` response headers
- Pino structured JSON logging (stderr); OpenTelemetry instrumentation with OTLP exporter option
- DNS rebinding protection options for HTTP transport (`MCP_HTTP_DNS_PROTECTION`, allowed hosts/origins)
- Discovery surfaces and internal knowledge graph

### Changed
- Tool catalog grew from 30 to 35 (5 new contract tools)
- vCon version handling relaxed to accept any string or missing value
- Dialog disposition validation relaxed to accept any string
- Bearer token extraction tolerates leading whitespace in headers

### Fixed
- Upsert vCon on duplicate UUID submission instead of erroring
- Correct body serialization/deserialization for analysis and attachments (CON-352)
- `getTags` no longer crashes on non-array attachment bodies

---

## [1.0.1] - 2025-12 (approximate)

> Date precise to the month only — the npm-published 1.0.1 pre-dated the
> current main lineage and its exact release date isn't in this repo.

### Added
- Comprehensive database documentation for LLMs (architecture, quickstart, schema visual)
- Row Level Security (RLS) support for multi-tenant isolation
- Enhanced database status and analytics scripts
- S3 sync functionality and backfill scripts
- Tenant debugging support
- Versioned resource URIs (vcon://v1/...)
- Backup and restore functionality
- Enhanced embedding generation with backfill options
- Improved database inspection tools

### Changed
- Updated package dependencies
- Enhanced embedding scripts with continuous and backfill modes
- Improved database status reporting with time-ago formatting
- Enhanced dialog, attachment, and analysis type distribution logging

### Fixed
- Removed obsolete test scripts and temporary files
- Improved environment variable management in scripts

---

## [1.0.0] - 2025-10-14

### Added

#### Core Features
- Full CRUD operations for vCons (create, read, update, delete)
- Component management (parties, dialog, attachments, analysis)
- Advanced search capabilities (metadata, content, semantic, hybrid)
- Tag management system with key-value pairs
- Template-based vCon creation
- Batch operations (import, export, bulk updates)
- Validation and data quality checks
- MCP resources for URI-based access
- MCP prompts for query templates
- Plugin system for extensibility

#### Search & Query
- Metadata search with filters (subject, party, date range)
- Full-text content search with PostgreSQL trigrams
- Semantic search with vector embeddings (pgvector)
- Hybrid search combining keyword and semantic
- Tag-based search and filtering
- Aggregation and statistics

#### Database
- Normalized PostgreSQL schema for vCons
- Full IETF spec compliance (draft-ietf-vcon-vcon-core-00)
- Materialized views for tag queries
- HNSW indexes for vector search
- GIN indexes for full-text search
- Foreign key constraints and referential integrity

#### Developer Features
- TypeScript with full type safety
- Zod schemas for validation
- Comprehensive test suite (Vitest)
- Plugin development framework
- Example plugins and code
- MCP Inspector compatibility

#### Documentation
- Complete user guides
- API reference documentation
- Developer guides (architecture, testing, plugins)
- IETF vCon specification reference
- Database schema documentation
- Migration guides and quick references

### Fixed

#### Specification Compliance
- ✅ Analysis uses `schema` not `schema_version` (Section 4.5.6)
- ✅ Analysis `vendor` is required, not optional (Section 4.5.5)
- ✅ Analysis `body` is string type, not object (Section 4.5.7)
- ✅ Party object includes `uuid` field (Section 4.2.12)
- ✅ Party object includes `did` field (Section 4.2.6)
- ✅ Dialog includes `session_id`, `application`, `message_id` fields
- ✅ No default values for `encoding` fields
- ✅ Dialog `type` has proper CHECK constraint
- ✅ vCon includes `extensions` and `must_support` arrays

### Technical Details

#### Dependencies
- `@modelcontextprotocol/sdk` ^0.4.0
- `@supabase/supabase-js` ^2.39.0
- `zod` ^3.22.4
- `typescript` ^5.3.3
- `vitest` ^1.2.0

#### Requirements
- Node.js 18.x or higher
- PostgreSQL 15.x or higher
- Supabase (local or cloud)

#### Database Schema Version
- Version: 1.0.0
- vCon spec compliance: 0.3.0 (draft-ietf-vcon-vcon-core-00)

---

## [0.9.0] - 2025-10-07 (Beta)

### Added
- Initial beta release
- Basic CRUD operations
- Search functionality
- Tag system implementation
- Database schema design

### Known Issues
- Documentation incomplete
- Some edge cases in search not handled
- Performance optimization needed

---

## Development Timeline

### Phase 1: Core Implementation (Completed)
- ✅ Database schema with spec corrections
- ✅ CRUD operations with validation
- ✅ Basic search functionality
- ✅ Tag management system
- ✅ MCP protocol integration

### Phase 2: Advanced Features (Completed)
- ✅ Semantic search with embeddings
- ✅ Hybrid search
- ✅ Plugin system
- ✅ Batch operations
- ✅ Template system

### Phase 3: Documentation (Completed)
- ✅ User guides
- ✅ API documentation
- ✅ Developer guides
- ✅ Reference documentation
- ✅ VitePress site

### Phase 4: Production & Distribution (Completed in 1.2.0)
- ✅ REST API parity with MCP surface
- ✅ HTTP transport with API-key auth
- ✅ Docker image pipeline to ECR
- ✅ Pino structured logging + OpenTelemetry
- ✅ Multi-tenant RLS

### Phase 5: Predictability & Discovery (Completed in 1.2.0)
- ✅ Contract tools: `vcon_fetch`, `vcon_search`, `vcon_capabilities`, `vcon_taxonomy`, `describe_response_shape`
- ✅ Discovery surfaces and internal knowledge graph

### Phase 6: Future Work (Planned)
- ⏳ Privacy Suite plugin (consent, redaction, PII detection)
- ⏳ Compliance tooling hooks (GDPR, CCPA, HIPAA)
- ⏳ Performance hardening on large corpora

---

## Migration Guides

### Migrating to 1.0.0

If you're upgrading from a pre-1.0 version or another vCon implementation:

1. **Read the Migration Guide:** [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)
2. **Check Field Names:** [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
3. **Update Database:** [CORRECTED_SCHEMA.md](./CORRECTED_SCHEMA.md)
4. **Run Tests:** Ensure compliance tests pass

**Critical Changes:**
- Analysis uses `schema` not `schema_version`
- Analysis `vendor` is now required
- Analysis `body` is string, not object
- Party includes `uuid` field
- Dialog includes new fields (`session_id`, `application`, `message_id`)

---

## Version Numbering

We follow [Semantic Versioning](https://semver.org/):

- **Major (X.0.0)**: Breaking changes, incompatible API changes
- **Minor (0.X.0)**: New features, backward compatible
- **Patch (0.0.X)**: Bug fixes, backward compatible

### What Triggers Version Bumps

**Major (Breaking):**
- Database schema changes requiring migration
- API changes incompatible with previous versions
- Required configuration changes

**Minor (Features):**
- New tools, resources, or prompts
- New optional features
- Performance improvements
- Documentation enhancements

**Patch (Fixes):**
- Bug fixes
- Security patches
- Documentation corrections
- Performance optimizations without API changes

---

## Release Notes

### v1.0.0 Release Highlights

This first major release represents a production-ready, fully spec-compliant vCon MCP Server with:

- **100% IETF Spec Compliance** - All known specification issues corrected
- **Production-Ready Database** - Normalized schema with proper constraints and indexes
- **Advanced Search** - Keyword, semantic, and hybrid search capabilities
- **Extensible Architecture** - Plugin system for custom functionality
- **Complete Documentation** - User guides, API reference, developer guides
- **Professional Quality** - TypeScript, comprehensive tests, proper error handling

**Perfect for:**
- Production conversation data management
- AI-powered conversation intelligence
- Compliance and archival systems
- Development and research

**Not Included (Proprietary):**
- Privacy Suite (consent management, PII detection)
- Compliance tools (GDPR, CCPA, HIPAA automation)
- Enterprise support

---

## Future Roadmap

The roadmap below reflects work not yet started or in early planning.
Concrete shipped versions live in the dated entries above.

### Near-term (post-1.2.0)
- Privacy Suite plugin (consent management, PII detection, redaction)
- Compliance tooling hooks (GDPR, CCPA, HIPAA support patterns)
- Performance hardening on large corpora (cold-start full-text search)

### Longer-term
- Cloud-native deployment patterns and horizontal scaling guidance
- Additional storage backends

---

## Contributing

See [CONTRIBUTING.md](../development/contributing.md) for how to contribute to this project.

---

## License

### Open Source Core
The vCon MCP Server is released under the MIT License.

### Proprietary Features
Privacy Suite and enterprise features are available under commercial license.

---

## Support

- **Documentation:** https://vcon-dev.github.io/vcon-mcp/
- **Issues:** https://github.com/vcon-dev/vcon-mcp/issues
- **Discussions:** https://github.com/vcon-dev/vcon-mcp/discussions
- **IETF Working Group:** https://datatracker.ietf.org/wg/vcon/

---

**Note:** This changelog reflects the development history. Earlier versions (pre-1.0) were development/beta releases not intended for production use.

---

*Last Updated: May 18, 2026*

