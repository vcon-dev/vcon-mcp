# Frequently Asked Questions

Common questions about the vCon MCP Server.

## General

### What is vCon?

vCon (Virtual Conversation) is an IETF standard format for representing conversations in a portable, interoperable way. Think of it as "PDF for conversations" - a standardized container that includes:

- Conversation content (voice, video, text, email)
- Participants (parties) with identity information
- AI analysis results (transcripts, sentiment, summaries)
- Attachments (documents, images, files)
- Privacy markers for consent and redaction

**Learn more:** [IETF vCon Specification](../reference/vcon-spec.md)

---

### What is MCP?

MCP (Model Context Protocol) is an open standard that enables AI assistants to interact with external tools and data sources. Instead of being limited to training data, AI assistants can:

- Access real-time data from databases and APIs
- Perform actions using external tools
- Read and write to external systems
- Maintain context across conversations

**Learn more:** [modelcontextprotocol.io](https://modelcontextprotocol.io/)

---

### Why use vCon MCP Server?

The vCon MCP Server gives AI assistants like Claude the ability to:

- **Store** conversation data in a standard format
- **Search** through historical conversations
- **Analyze** conversations for insights
- **Organize** with tags and metadata
- **Query** using natural language

It combines the power of IETF vCon with the flexibility of MCP.

---

### Is it free?

**Yes!** The vCon MCP Server is open source under the MIT License. The core features are completely free to use.

**Dependencies:**
- Node.js - Free, open source
- Supabase - Free tier available (upgrade for production)
- OpenAI (optional) - Pay per use for semantic search embeddings

**Optional:**
- Enterprise plugins - May require licenses
- Professional support - Contact for pricing

---

### What's the catch?

No catch! This is a genuine open-source project implementing IETF standards.

**Costs you might incur:**
- Supabase (free tier usually sufficient for development)
- OpenAI API (only if using semantic search)
- Hosting (if deploying to production)

---

## Installation & Setup

### Do I need to know TypeScript?

**For using:** No, just use Claude Desktop with natural language.

**For extending:** Basic TypeScript knowledge helpful for plugins/custom tools.

**For contributing:** Yes, the project is written in TypeScript.

---

### Can I use it without Claude Desktop?

**Yes!** The server works with any MCP client:

- Claude Desktop (easiest)
- Custom MCP clients
- Direct API calls to Supabase
- Command-line tools (coming soon)

---

### Do I need a Supabase account?

**Yes,** Supabase is required for database storage. The free tier is sufficient for:

- Development
- Small projects
- Testing
- Personal use

Upgrade to paid tier for:
- Production deployments
- Large datasets (>500MB)
- High traffic
- Priority support

**Alternative:** You can use self-hosted PostgreSQL with pgvector, but you'll need to adapt the code.

---

### Can I use a different database?

The server is built for Supabase/PostgreSQL. To use another database:

1. **PostgreSQL-compatible** (e.g., Amazon RDS, Google Cloud SQL) - Relatively easy
2. **Other SQL** (MySQL, SQLite) - Requires schema adaptation
3. **NoSQL** (MongoDB, DynamoDB) - Requires major refactoring

**Recommendation:** Stick with Supabase for best experience.

---

### How long does setup take?

**Quick setup:** 5 minutes (using Quick Start)
**Complete setup:** 15-30 minutes (including database configuration)
**Development setup:** 1-2 hours (including reading docs)

---

## Features & Capabilities

### What can I store in a vCon?

A vCon can contain:

- **Dialog**: Recordings, transcripts, text messages, video calls
- **Parties**: Participants with names, emails, phone numbers, roles
- **Analysis**: AI-generated insights (transcripts, sentiment, summaries)
- **Attachments**: Related files, documents, images
- **Metadata**: Subject, timestamps, extensions
- **Tags**: Custom key-value pairs for organization

**Essentially:** Any conversation data plus related analysis and files.

---

### How does search work?

Four search modes:

1. **Basic filtering** - By subject, party name, dates
2. **Keyword search** - Full-text search across dialog and analysis
3. **Semantic search** - AI-powered meaning-based search (requires embeddings)
4. **Hybrid search** - Combines keyword and semantic for best results

---

### Do I need OpenAI for search?

**No** for basic, keyword, and hybrid keyword-based search.

**Yes** for semantic search (requires embeddings):
- OpenAI API for generating embeddings
- Or use local embedding models (more setup)

**Recommendation:** Start without OpenAI, add semantic search later if needed.

---

### What's the difference between tools, resources, and prompts?

- **Tools** - Actions AI can perform (create, search, update, delete)
- **Resources** - Read-only data access (like URLs)
- **Prompts** - Guidance for effective searching

Example:
- **Tool:** `create_vcon` - Creates new vCon
- **Resource:** `vcon://recent` - Reads recent vCons
- **Prompt:** `find_by_tags` - Guides tag-based search

---

### Can I use this in production?

**Yes,** with proper configuration:

1. Use Supabase paid tier (not free tier)
2. Configure Row Level Security (RLS)
3. Set up monitoring and logging
4. Use service role key for admin operations
5. Enable backups
6. Configure rate limiting

See [Production Deployment](../deployment/) for details.

---

## Data & Privacy

### Is my conversation data secure?

Security depends on your configuration:

**Built-in security:**
- Supabase uses encrypted connections (TLS)
- Row Level Security (RLS) for multi-tenancy
- API key authentication
- No data stored on our servers (you control the database)

**Your responsibility:**
- Keep API keys secure
- Configure RLS policies properly
- Use HTTPS for client connections
- Regular security audits

---

### Can I use this for HIPAA/GDPR compliance?

The server **supports** compliance features but is not automatically compliant:

**What's included:**
- Consent tracking fields
- Redaction support
- Privacy markers
- Audit trail capabilities
- Plugin hooks for compliance

**What you need to do:**
- Configure compliance plugins
- Set up proper access controls
- Implement data retention policies
- Conduct security assessments
- Sign BAA with Supabase (for HIPAA)

**Recommendation:** Consult with compliance experts for production use.

---

### Where is data stored?

Your data lives in your Supabase project:

- **Default:** Supabase cloud (US, EU, or Asia depending on project region)
- **Optional:** Self-hosted PostgreSQL (full control)

**The vCon MCP Server never stores your data** - it only facilitates access.

---

### Can I export my data?

**Yes!** Multiple options:

1. **Supabase Dashboard** - Export to CSV, JSON
2. **PostgreSQL tools** - pg_dump, pg_restore
3. **API** - Fetch via REST API
4. **Batch export** - Coming soon

vCon format is portable - you can move to any system that supports the standard.

---

## Technical Questions

### What is the vCon specification version?

This implementation follows **`draft-ietf-vcon-vcon-core-00`**.

**Important:** This implementation corrects several common mistakes found in other implementations. See [Specification Corrections](../reference/corrections.md) for details.

---

### Why not use the vcon package from npm?

Many existing vCon implementations have errors:

❌ **Common mistakes:**
- Wrong field names (`schema_version` instead of `schema`)
- Missing required fields (`vendor` in analysis)
- Wrong data types (`body` as object instead of string)
- Default encoding values (spec says no defaults)

✅ **This implementation:**
- 100% spec-compliant
- All corrections applied
- Thoroughly tested
- Well-documented

---

### What Node.js version do I need?

**Minimum:** Node.js 18.0

**Recommended:** Node.js 20.x (LTS)

**Why 18+:** Required for:
- ESM module support
- Modern JavaScript features
- Supabase SDK compatibility

Check version:
```bash
node --version
```

---

### Can I use this with Python?

Not directly, but you can:

1. **Use Supabase REST API** - Call from Python
2. **Create Python MCP client** - Implement MCP protocol
3. **Use subprocess** - Call Node.js server from Python

**Recommendation:** Use Supabase REST API for Python integration.

---

### Why TypeScript?

TypeScript provides:

- **Type safety** - Catch errors at compile time
- **Better IDE support** - Autocomplete, inline docs
- **Maintainability** - Easier to refactor
- **Documentation** - Types are self-documenting
- **vCon spec compliance** - Types match spec exactly

---

## Usage Questions

### How do I phrase questions to Claude?

Use natural language - Claude understands intent:

✅ **Good examples:**
- "Create a vCon for a customer support call"
- "Find conversations about billing issues"
- "Show me negative sentiment calls from last week"

❌ **Don't use:**
- Function syntax: `create_vcon({...})`
- SQL queries directly
- Technical field names (Claude handles this)

---

### Can Claude make mistakes?

**Yes,** AI assistants can:

- Misinterpret your request
- Use wrong search strategy
- Generate invalid UUIDs
- Miss edge cases

**Best practices:**
- Be specific in requests
- Verify critical operations
- Use test data first
- Review results before acting

---

### How do I undo an operation?

**Create/Update:** Can't undo - vCon spec favors immutability
**Delete:** Can't undo - permanent deletion

**Best practices:**
- Test with non-production data first
- Keep database backups
- Use version control for configs
- Review before deleting

---

### Can I bulk import conversations?

**Yes,** multiple options:

1. **Ask Claude to create multiple:**
   ```
   Create 10 vCons for the conversations in this spreadsheet
   ```

2. **Use scripts:**
   ```bash
   npm run scripts/load-vcons.ts
   ```

3. **Direct database insert:**
   ```sql
   INSERT INTO vcons ...
   ```

See [Examples](../examples/) for details.

---

## Performance & Scaling

### How many vCons can I store?

**Limits depend on Supabase tier:**

- **Free tier:** 500MB database (thousands of vCons)
- **Pro tier:** 8GB database (hundreds of thousands)
- **Enterprise:** Custom (millions+)

**Also consider:**
- File attachments (use external storage)
- Search performance (use indexes)
- API rate limits

---

### How fast is search?

**Typical response times:**

- **By UUID:** <100ms (indexed)
- **Basic filtering:** <500ms (indexed)
- **Keyword search:** 500ms-2s (depends on dataset)
- **Semantic search:** 1-3s (vector similarity)

**Optimization tips:**
- Add indexes for common queries
- Use tags to pre-filter
- Limit result sets
- Cache frequent queries

---

### Can I use this at scale?

**Yes,** with proper architecture:

1. **Database:** Supabase Enterprise or self-hosted PostgreSQL
2. **Connection pooling:** PgBouncer
3. **Caching:** Redis for frequent queries
4. **Load balancing:** Multiple server instances
5. **Monitoring:** Performance tracking

See [Performance Guide](../deployment/performance.md) for details.

---

## Customization & Extension

### Can I add custom fields to vCons?

**Yes,** using extensions:

```
Add extension "priority" with value "high" to this vCon
```

Extensions are part of the vCon spec for custom metadata.

---

### How do I create a plugin?

See [Plugin Development Guide](../development/plugins.md).

**Quick example:**
```typescript
export default class MyPlugin {
  name = 'my-plugin';
  version = '1.0.0';
  
  async afterCreate(vcon, context) {
    console.log(`Created: ${vcon.uuid}`);
  }
}
```

---

### Can I add custom tools?

**Yes!** See [Custom Tools Guide](../development/custom-tools.md).

Example: Add a tool to export vCons to PDF.

---

## Troubleshooting

### Claude doesn't see the tools

**Common fixes:**

1. Restart Claude Desktop completely
2. Check config file path (must be absolute)
3. Verify `dist/index.js` exists
4. Check `.env` file has Supabase credentials
5. Test server: `node dist/index.js`

See [Troubleshooting Guide](./troubleshooting.md) for more.

---

### Search returns no results

**Possible causes:**

1. Database is empty - create test vCon
2. Wrong search mode - try basic filtering first
3. No matching results - broaden criteria
4. Indexes missing - run migration

---

### Tests fail

```bash
# Clean and rebuild
rm -rf node_modules dist
npm install
npm run build
npm test
```

See [Troubleshooting Guide](./troubleshooting.md) for more.

---

## Contributing

### How can I contribute?

Many ways to help:

- **Report bugs** - GitHub Issues
- **Suggest features** - GitHub Discussions
- **Fix issues** - Submit PRs
- **Improve docs** - Edit documentation
- **Answer questions** - Help in Discussions
- **Share examples** - Real-world use cases

See [Contributing Guide](../development/contributing.md) for details.

---

### Do I need to sign a CLA?

**No CLA required.** By contributing, you agree your contributions are licensed under MIT License.

---

### What if I found a security issue?

**Please report privately** instead of public issues:

1. Email maintainers (see README)
2. Include detailed description
3. Wait for response before public disclosure

---

## Getting Help

### Where can I get help?

1. **Documentation** - Browse `/docs`
2. **Troubleshooting** - [Troubleshooting Guide](./troubleshooting.md)
3. **GitHub Discussions** - Ask questions
4. **GitHub Issues** - Report bugs
5. **Community Discord** - Real-time chat (coming soon)

---

### How do I report a bug?

1. Search existing issues first
2. Create new issue with:
   - Clear title
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details
   - Error messages (full text)

---

### Can I get commercial support?

Professional support available:

- Priority bug fixes
- Custom feature development
- Deployment assistance
- Training and consulting

Contact for details (see README).

---

## Roadmap

### What's coming next?

**v1.1.0:**
- Real-time subscriptions
- Batch operations
- Enhanced analytics
- More examples

**v1.2.0:**
- CLI tool
- More integrations
- Advanced plugins
- Performance optimizations

**v2.0.0:**
- Multi-tenant architecture
- GraphQL API
- Real-time collaboration
- Enterprise features

See [Changelog](../reference/CHANGELOG.md) for details.

---

### Can I request features?

**Yes!** Feature requests welcome:

1. Check existing feature requests
2. Create GitHub Discussion or Issue
3. Describe use case and benefits
4. Discuss with community
5. Vote on features you want

Popular requests prioritized in roadmap.

---

## Still Have Questions?

- **Ask in Discussions:** [GitHub Discussions](https://github.com/vcon-dev/vcon-mcp/discussions)
- **Check Documentation:** Browse `/docs` for detailed guides
- **Join Community:** Discord (coming soon)

---

**Didn't find your answer?** [Ask a question](https://github.com/vcon-dev/vcon-mcp/discussions/new) →

