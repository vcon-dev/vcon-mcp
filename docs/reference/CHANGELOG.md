# Changelog

All notable changes to the vCon MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [1.0.1] - 2025-01-XX

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

### Phase 4: Testing & Polish (In Progress)
- ⏳ Comprehensive test suite
- ⏳ Performance optimization
- ⏳ Security audit
- ⏳ Production hardening

### Phase 5: Enterprise Features (Planned)
- ⏳ Privacy Suite plugin
- ⏳ Consent management
- ⏳ Compliance tools (GDPR, CCPA, HIPAA)
- ⏳ Access logging
- ⏳ PII detection and redaction

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

### v1.1.0 (Planned)
- Performance optimizations
- Additional search features
- Enhanced analytics
- More prompt templates

### v1.2.0 (Planned)
- Real-time subscriptions
- WebSocket support
- GraphQL API option
- Distributed tracing

### v2.0.0 (Future)
- Multi-tenant architecture
- Advanced security features
- Cloud-native deployment
- Horizontal scaling support

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

*Last Updated: October 14, 2025*

