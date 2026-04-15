# Technical Reference

Complete technical specifications, standards, and quick references for the vCon MCP Server.

## Overview

This reference section provides authoritative technical documentation for:

- **IETF vCon Specifications** - Complete standard definitions
- **Database Schema** - PostgreSQL table structures and relationships
- **MCP Protocol** - Model Context Protocol integration details
- **API Standards** - Tool, resource, and prompt specifications
- **Compliance Matrices** - Regulatory framework mappings
- **Quick References** - Fast lookup guides for common tasks

---

## Essential References

### 🎯 Quick Start References

| Document | Purpose | Time | Audience |
|----------|---------|------|----------|
| [Quick Reference](./QUICK_REFERENCE.md) | Critical field corrections checklist | 5 min | All developers |
| [Glossary](./glossary.md) | Terms and definitions | - | All users |
| [CLI Reference](./cli-reference.md) | Command-line tool usage | 10 min | Developers |

### 📋 Specification References

| Document | Purpose | Time | Audience |
|----------|---------|------|----------|
| [IETF vCon Core](./vcon-spec.md) | Complete vCon specification | 45 min | Implementers |
| [MCP Protocol](./mcp-protocol.md) | Model Context Protocol details | 30 min | Integrators |
| [Agent database schema](./AGENT_DATABASE_SCHEMA.md) | Full PostgreSQL schema (matches migrations) | 25 min | DBAs, agents |
| [Corrected schema (IETF)](./CORRECTED_SCHEMA.md) | IETF-oriented DDL narrative | 20 min | DBAs |
| [Search tools](../guide/search.md) | MCP search tools and behavior | 15 min | Developers |

### 🔧 Implementation References

| Document | Purpose | Time | Audience |
|----------|---------|------|----------|
| [Implementation Corrections](./IMPLEMENTATION_CORRECTIONS.md) | Known issues and fixes | 15 min | Developers |
| [Migration Guide](./MIGRATION_GUIDE.md) | Upgrading existing implementations | 30 min | Migrators |
| [Compliance Matrix](./compliance-matrix.md) | Regulatory requirements mapping | 20 min | Compliance teams |

### 📚 Feature References

| Document | Purpose | Time | Audience |
|----------|---------|------|----------|
| [Open Source Features](./features.md) | Core functionality reference | 30 min | All users |
| [Enterprise Features](./enterprise-features.md) | Proprietary capabilities | 30 min | Enterprise customers |
| [Plugin Architecture](./plugin-architecture.md) | Extension system design | 20 min | Plugin developers |

---

## By Use Case

### 🎯 "I'm implementing vCon for the first time"

1. **Start here:** [Quick Reference](./QUICK_REFERENCE.md) - Know what to avoid
2. **Read:** [IETF vCon Core](./vcon-spec.md) - Understand the standard
3. **Reference:** [Agent database schema](./AGENT_DATABASE_SCHEMA.md) - Implement storage
4. **Verify:** [Implementation Corrections](./IMPLEMENTATION_CORRECTIONS.md) - Check for issues

### 🔄 "I'm migrating existing vCon code"

1. **Audit:** [Implementation Corrections](./IMPLEMENTATION_CORRECTIONS.md) - Identify issues
2. **Plan:** [Migration Guide](./MIGRATION_GUIDE.md) - Follow migration steps
3. **Verify:** [Quick Reference](./QUICK_REFERENCE.md) - Confirm compliance
4. **Test:** [Testing Reference](./testing-reference.md) - Run compliance tests

### 🔍 "I'm reviewing vCon code"

1. **Quick check:** [Quick Reference](./QUICK_REFERENCE.md) - Fast verification
2. **Deep check:** [Implementation Corrections](./IMPLEMENTATION_CORRECTIONS.md) - Known issues
3. **Schema check:** [Agent database schema](./AGENT_DATABASE_SCHEMA.md) - Database compliance
4. **Standards check:** [vCon Spec](./vcon-spec.md) - Spec adherence

### 🛠️ "I'm integrating with MCP"

1. **Protocol:** [MCP Protocol](./mcp-protocol.md) - Understanding MCP
2. **Tools:** [../api/tools.md](../api/tools.md) - Available tools
3. **Resources:** [../api/resources.md](../api/resources.md) - Resource URIs
4. **Prompts:** [../api/prompts.md](../api/prompts.md) - Query templates

### 📊 "I need compliance documentation"

1. **Overview:** [Compliance Matrix](./compliance-matrix.md) - All regulations
2. **GDPR:** GDPR-specific mappings
3. **CCPA:** CCPA-specific mappings
4. **HIPAA:** HIPAA-specific mappings

---

## Reference Categories

### 📖 Standards & Specifications

#### IETF vCon Standard
- **[vCon Core Specification](./vcon-spec.md)** - Complete IETF draft reference
  - Main vCon object structure
  - Party, Dialog, Analysis, Attachment objects
  - Required vs optional fields
  - Encoding options
  - Extensions and must_support

- **[vCon Data Types](./vcon-data-types.md)** - Type definitions and validation
  - TypeScript interfaces
  - Zod schemas
  - Validation rules
  - Example objects

#### MCP Protocol
- **[MCP Protocol Reference](./mcp-protocol.md)** - Complete MCP documentation
  - Server capabilities
  - Tool invocation
  - Resource access
  - Prompt templates
  - Error handling

- **[MCP Integration Guide](./mcp-integration.md)** - How to integrate with MCP clients
  - Claude Desktop setup
  - Custom client development
  - Protocol compliance
  - Testing tools

### 🗄️ Database & Storage

- **[Agent database schema](./AGENT_DATABASE_SCHEMA.md)** - Deployed PostgreSQL schema (authoritative for agents)
  - Core and operational tables, MVs, tenant columns, RLS summary
  - Pointers to migrations for RPC signatures

- **[Corrected schema](./CORRECTED_SCHEMA.md)** - IETF-oriented DDL (not the full catalog)

- **[Search tools](../guide/search.md)** - MCP search tools
  - Keyword, semantic, hybrid, tags

- **Migrations** under `supabase/migrations/` - Source of truth for `search_vcons_*` SQL functions and index definitions

### 🔧 Implementation Guides

- **[Implementation Corrections](./IMPLEMENTATION_CORRECTIONS.md)** - Known issues and fixes
- **[Migration Guide](./MIGRATION_GUIDE.md)** - Upgrading from older versions
- **[Testing Reference](./testing-reference.md)** - Compliance and validation tests
- **[Error Reference](./error-reference.md)** - Error codes and handling

### 📋 Quick References

- **[Quick Reference](./QUICK_REFERENCE.md)** - Critical corrections checklist
- **[CLI Reference](./cli-reference.md)** - Command-line tools
- **[Glossary](./glossary.md)** - Terms and definitions
- **[FAQ](./faq.md)** - Frequently asked questions

### ✅ Compliance & Standards

- **[Compliance Matrix](./compliance-matrix.md)** - All regulatory frameworks
- **[GDPR Compliance](./gdpr-compliance.md)** - GDPR-specific details
- **[CCPA Compliance](./ccpa-compliance.md)** - CCPA-specific details
- **[HIPAA Compliance](./hipaa-compliance.md)** - HIPAA-specific details
- **[Security Standards](./security-standards.md)** - Security best practices

### 🎨 Feature References

- **[Open Source Features](./features.md)** - Core functionality
- **[Enterprise Features](./enterprise-features.md)** - Proprietary features
- **[Plugin Architecture](./plugin-architecture.md)** - Extension system
- **[Roadmap](./roadmap.md)** - Future features and plans

---

## Critical Corrections Summary

This implementation fixes 7 critical issues found in many vCon implementations:

1. ✅ **Analysis Schema Field** - Uses `schema` not `schema_version` (Section 4.5.6)
2. ✅ **Analysis Vendor Requirement** - `vendor` is required, not optional (Section 4.5.5)
3. ✅ **Analysis Body Type** - `body` is string type, not object (Section 4.5.7)
4. ✅ **Party UUID Field** - Added per spec Section 4.2.12
5. ✅ **Encoding Defaults** - No default values, explicit only
6. ✅ **Dialog Type Constraints** - Must be one of 4 valid types (Section 4.3.1)
7. ✅ **Dialog New Fields** - Added `session_id`, `application`, `message_id`

**See [Quick Reference](./QUICK_REFERENCE.md) for detailed checklist.**

---

## Specification Sources

### Primary Sources

- **IETF vCon Core:** `draft-ietf-vcon-vcon-core-02`
  - Location: `../background_docs/draft-ietf-vcon-vcon-core-02.txt`
  - Working Group: https://datatracker.ietf.org/wg/vcon/

- **IETF vCon Privacy Primer:** `draft-ietf-vcon-privacy-primer-00`
  - Location: `../background_docs/draft-ietf-vcon-privacy-primer-00.txt`

- **vCon Consent (Draft):** `draft-howe-vcon-consent-00`
  - Location: `../background_docs/draft-howe-vcon-consent-00.txt`

### Related Standards

- **SCITT Architecture:** `draft-ietf-scitt-architecture-15`
  - For transparency service integration
  - Location: `../background_docs/draft-ietf-scitt-architecture-15.txt`

- **AI Preferences Vocabulary:** `draft-ietf-aipref-vocab-01`
  - For AI-related metadata
  - Location: `../background_docs/draft-ietf-aipref-vocab-01.txt`

---

## Version Information

### Current Version
- **Server Version:** 1.2.0
- **vCon Spec Version:** 0.4.0 (draft-ietf-vcon-vcon-core-02)
- **Schema Version:** 1.2.0
- **Last Updated:** April 2026

### Version History
See [Changelog](./CHANGELOG.md) for complete version history.

### Compatibility
- **Node.js:** 18.x or higher
- **PostgreSQL:** 15.x or higher
- **Supabase:** Latest stable
- **MCP SDK:** 0.4.x

---

## Contributing to Reference Docs

### Reporting Issues

Found an error in the reference documentation?

1. Check if it's already in [Implementation Corrections](./IMPLEMENTATION_CORRECTIONS.md)
2. Open an issue on GitHub with:
   - Document name and section
   - Expected vs actual content
   - IETF spec reference (if applicable)

### Submitting Updates

To update reference documentation:

1. Verify against IETF spec
2. Update relevant markdown file
3. Update cross-references
4. Submit pull request with changes

See [Contributing Guide](../development/contributing.md) for details.

---

## Additional Resources

### Documentation

- **[User Guides](../guide/)** - How to use the server
- **[API Reference](../api/)** - Complete API documentation
- **[Developer Guides](../development/)** - Building and extending
- **[Examples](../examples/)** - Code examples and tutorials

### External Links

- **IETF vCon Working Group:** https://datatracker.ietf.org/wg/vcon/
- **MCP Protocol:** https://modelcontextprotocol.io/
- **Supabase Docs:** https://supabase.com/docs
- **pgvector:** https://github.com/pgvector/pgvector

### Community

- **GitHub:** https://github.com/vcon-dev/vcon-mcp
- **Issues:** Report bugs and request features
- **Discussions:** Ask questions and share ideas

---

## Quick Navigation

### By Role

**Developers:**
[Quick Reference](./QUICK_REFERENCE.md) → [vCon Spec](./vcon-spec.md) → [Agent database schema](./AGENT_DATABASE_SCHEMA.md) → [API Docs](../api/)

**DBAs:**
[Agent database schema](./AGENT_DATABASE_SCHEMA.md) → [Search tools](../guide/search.md) → [Performance Tuning](./performance.md)

**Integrators:**
[MCP Protocol](./mcp-protocol.md) → [API Reference](../api/tools.md) → [Integration Guide](./mcp-integration.md)

**Compliance Teams:**
[Compliance Matrix](./compliance-matrix.md) → [GDPR](./gdpr-compliance.md) → [CCPA](./ccpa-compliance.md)

### By Task

**Setting up:**
[Quick Start](../guide/getting-started.md) → [Agent database schema](./AGENT_DATABASE_SCHEMA.md) → [Testing](./testing-reference.md)

**Migrating:**
[Implementation Corrections](./IMPLEMENTATION_CORRECTIONS.md) → [Migration Guide](./MIGRATION_GUIDE.md) → [Testing](./testing-reference.md)

**Extending:**
[Plugin Architecture](./plugin-architecture.md) → [Custom Tools](../development/custom-tools.md) → [API Reference](../api/)

**Troubleshooting:**
[Error Reference](./error-reference.md) → [FAQ](./faq.md) → [GitHub Issues](https://github.com/vcon-dev/vcon-mcp/issues)

---

**Need help?** Check the [FAQ](./faq.md) or ask in [GitHub Discussions](https://github.com/vcon-dev/vcon-mcp/discussions).

**Found an issue?** Report it in [GitHub Issues](https://github.com/vcon-dev/vcon-mcp/issues) with the `documentation` label.

---

*Reference documentation is the authoritative source for implementation details. When in doubt, consult the IETF specifications.*

