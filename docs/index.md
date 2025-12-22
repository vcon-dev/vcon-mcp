---
layout: home

hero:
  name: "vCon MCP Server"
  text: "Conversation Data Management with AI"
  tagline: IETF-compliant vCon server with Model Context Protocol integration
  image:
    src: /logo.svg
    alt: vCon MCP Server
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/yourusername/vcon-mcp
    - theme: alt
      text: API Reference
      link: /api/

features:
  - icon: 🎯
    title: IETF vCon Compliant
    details: Implements draft-ietf-vcon-vcon-core-00 specification with full type safety and validation
    
  - icon: 🤖
    title: AI-Ready Integration
    details: Model Context Protocol (MCP) tools for seamless AI assistant integration with Claude, ChatGPT, and more
    
  - icon: 🔍
    title: Advanced Search
    details: Four search modes - basic filtering, keyword search, semantic search with AI embeddings, and hybrid search
    
  - icon: 🏷️
    title: Flexible Tagging
    details: Powerful tag system for organizing and filtering conversations with support for key-value metadata
    
  - icon: 💬
    title: Query Prompts
    details: Pre-built prompts to guide AI assistants in effectively searching and retrieving conversation data
    
  - icon: 🔌
    title: Plugin Architecture
    details: Extensible plugin system for custom functionality, privacy controls, and compliance features
    
  - icon: 🗄️
    title: PostgreSQL Backend
    details: Powered by Supabase with optimized schema, indexes, and pgvector for semantic search
    
  - icon: 📊
    title: Database Tools
    details: Built-in tools for database inspection, performance monitoring, and optimization
    
  - icon: 🔒
    title: Privacy-Ready
    details: Plugin hooks for consent management, redaction, and regulatory compliance (GDPR, HIPAA, CCPA)
    
  - icon: 🚀
    title: Production-Ready
    details: Type-safe TypeScript, comprehensive testing, and deployment guides for production environments
    
  - icon: 📚
    title: Complete Documentation
    details: Extensive guides, API reference, examples, and IETF specification details
    
  - icon: 🌐
    title: Real-time Updates
    details: Supabase real-time subscriptions for live conversation data updates
---

## Quick Start

::: code-group

```bash [npm]
npm install @vcon/mcp-server
```

```bash [yarn]
yarn add @vcon/mcp-server
```

```bash [pnpm]
pnpm add @vcon/mcp-server
```

:::

## What is vCon?

vCon (Virtual Conversation) is an IETF standard for representing conversations in a portable, interoperable format. Think of it as "PDF for conversations" - a standardized container for:

- **Conversations** from any medium (voice, video, text, email)
- **Participants** with identity and privacy controls
- **AI Analysis** from transcription, sentiment, summarization
- **Attachments** like documents, images, or related files
- **Privacy markers** for consent and redaction

## What is MCP?

The Model Context Protocol (MCP) enables AI assistants to use external tools and data sources. This server implements MCP to give AI assistants the ability to create, search, analyze, and manage conversation data.

## Features at a Glance

### Core Capabilities

- ✅ **15+ MCP Tools** - Complete CRUD operations, search, tagging, templates
- ✅ **9 Query Prompts** - Guide AI assistants to search effectively
- ✅ **4 Search Modes** - Basic, keyword, semantic, and hybrid search
- ✅ **Tag System** - Flexible key-value metadata for organization
- ✅ **Database Tools** - Inspection, performance monitoring, optimization
- ✅ **Plugin System** - Extensible architecture for custom features
- ✅ **Type-Safe** - Full TypeScript with Zod validation
- ✅ **Spec-Compliant** - Follows IETF vCon specification exactly

### Use Cases

**Contact Centers**
- Capture and analyze customer calls
- Generate automatic transcripts
- Track agent performance
- Maintain compliance audit trails

**Sales Teams**
- Record sales conversations
- Extract action items
- Analyze conversation patterns
- Generate meeting summaries

**Research**
- Collect conversation datasets
- Analyze communication patterns
- Build ML training data
- Generate insights from dialogue

**Compliance & Legal**
- Maintain conversation archives
- Apply redaction for privacy
- Track consent and permissions
- Generate audit reports

## Architecture

```mermaid
graph TD
    A[AI Assistant<br/>Claude, ChatGPT] -->|MCP Protocol| B[vCon MCP Server]
    B -->|Supabase Client| C[PostgreSQL<br/>+ pgvector]
    B -->|Plugin System| D[Custom Extensions]
    C -->|Real-time| B
    D -->|Hooks| B
```

## Example Usage

### With Claude Desktop

```json
{
  "mcpServers": {
    "vcon": {
      "command": "node",
      "args": ["/path/to/vcon-mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "your-project-url",
        "SUPABASE_ANON_KEY": "your-anon-key"
      }
    }
  }
}
```

Then ask Claude:
- "Search for conversations about billing issues"
- "Create a vCon for a customer support call"
- "Find all high-priority sales conversations from last week"

### Programmatic Usage

```typescript
import { VConQueries } from '@vcon/mcp-server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(url, key);
const queries = new VConQueries(supabase);

// Create a vCon
const vcon = await queries.createVCon({
  vcon: '0.3.0',
  uuid: crypto.randomUUID(),
  created_at: new Date().toISOString(),
  subject: 'Customer Support Call',
  parties: [
    { name: 'Agent', mailto: 'agent@example.com' },
    { name: 'Customer', tel: '+1-555-0100' }
  ]
});

// Search vCons
const results = await queries.searchVCons({
  subject: 'billing',
  limit: 10
});
```

## Community & Support

- 📧 [GitHub Issues](https://github.com/vcon-mcp/issues) - Bug reports & feature requests
- 💬 [GitHub Discussions](https://github.com/vcon-mcp/discussions) - Community discussions
- 📚 [Documentation](https://mcp.conserver.io/) - Complete guides and reference
- 🌐 [IETF vCon Working Group](https://datatracker.ietf.org/wg/vcon/) - Specification development

## License

Released under the [MIT License](https://github.com/vcon-mcp/blob/main/LICENSE).

## Acknowledgments

- **IETF vCon Working Group** for the specification
- **Anthropic** for the Model Context Protocol
- **Supabase** for the PostgreSQL platform
- **Contributors** who helped build this project

