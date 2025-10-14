# Introduction

Welcome to the vCon MCP Server documentation!

## What is vCon MCP Server?

The vCon MCP Server is a production-ready server that implements the IETF vCon (Virtual Conversation) standard and provides AI assistants with the ability to manage, search, and analyze conversation data through the Model Context Protocol (MCP).

## Key Features

- **IETF vCon Compliant** - Fully implements the draft-ietf-vcon-vcon-core-00 specification
- **AI-Ready** - MCP tools for seamless integration with Claude, ChatGPT, and other AI assistants
- **Advanced Search** - Four search modes including semantic search with AI embeddings
- **Tag System** - Flexible key-value metadata for organizing conversations
- **Plugin Architecture** - Extensible for custom functionality and compliance features
- **Type-Safe** - Full TypeScript implementation with Zod validation
- **Production-Ready** - Comprehensive testing, monitoring, and deployment guides

## What is vCon?

vCon (Virtual Conversation) is an IETF standard for representing conversations in a portable, interoperable format. It's like "PDF for conversations" - a standardized container that includes:

- **Conversations** from any medium (voice, video, text, email)
- **Participants** with identity information
- **AI Analysis** results (transcription, sentiment, summaries)
- **Attachments** (documents, images, files)
- **Privacy markers** for consent and redaction

### Why vCon?

**Portability** - Move conversation data between systems without vendor lock-in

**Interoperability** - Standard format works across tools and platforms

**Privacy-Ready** - Built-in support for consent tracking and data redaction

**AI-Friendly** - Structured format perfect for AI analysis and processing

## What is MCP?

The Model Context Protocol (MCP) is an open standard that enables AI assistants to interact with external tools and data sources. Instead of AI assistants being limited to their training data, MCP allows them to:

- Access real-time data from databases and APIs
- Perform actions using external tools
- Read and write to external systems
- Maintain context across conversations

### MCP + vCon = Powerful Combination

By combining MCP with vCon, AI assistants can:

- **Create** conversation records from transcripts or recordings
- **Search** through historical conversations
- **Analyze** conversations for insights and patterns
- **Tag** conversations for organization
- **Extract** information from past interactions

## Use Cases

### Contact Centers
- Store and search customer interactions
- Analyze agent performance
- Track issue resolution
- Generate compliance reports

### Sales Teams
- Record sales calls and meetings
- Extract action items automatically
- Analyze successful conversation patterns
- Generate meeting summaries

### Research
- Build conversation datasets
- Study communication patterns
- Train ML models
- Analyze language use

### Healthcare
- Document patient consultations
- Maintain HIPAA-compliant records
- Track consent and permissions
- Generate clinical summaries

### Legal & Compliance
- Maintain conversation archives
- Apply redaction for privacy
- Track consent history
- Generate audit trails

## Architecture Overview

```
┌─────────────────────┐
│   AI Assistant      │  (Claude, ChatGPT, etc.)
│   (MCP Client)      │
└──────────┬──────────┘
           │ MCP Protocol (stdio/HTTP)
           │
┌──────────▼──────────┐
│   vCon MCP Server   │  (This project)
│                     │
│  ┌───────────────┐  │
│  │ MCP Tools     │  │  - Create, read, update, delete
│  │               │  │  - Search (4 modes)
│  │               │  │  - Tag management
│  └───────┬───────┘  │  - Templates & schemas
│          │          │
│  ┌───────▼───────┐  │
│  │ Plugin System │  │  - Custom extensions
│  │               │  │  - Privacy & compliance
│  └───────┬───────┘  │  - Access control
│          │          │
│  ┌───────▼───────┐  │
│  │ Database      │  │  - CRUD operations
│  │ Queries       │  │  - Search indexing
│  └───────┬───────┘  │  - Tag filtering
│          │          │
└──────────┼──────────┘
           │ Supabase Client
           │
┌──────────▼──────────┐
│    Supabase         │
│  (PostgreSQL)       │
│                     │
│  ┌───────────────┐  │
│  │ vCon Tables   │  │  - Normalized schema
│  │               │  │  - Optimized indexes
│  └───────────────┘  │  - Foreign keys
│  ┌───────────────┐  │
│  │ pgvector      │  │  - AI embeddings
│  │ (Embeddings)  │  │  - Semantic search
│  └───────────────┘  │
└─────────────────────┘
```

## Next Steps

Ready to get started? Follow our guides:

1. **[Installation](./installation.md)** - Complete installation guide
2. **[Basic Usage](./basic-usage.md)** - Learn the core operations
3. **[Getting Started](./getting-started.md)** - Quick start for developers
4. **[Search Guide](./search.md)** - Master the search capabilities
5. **[Tag Management](./tags.md)** - Organize your conversations
6. **[Prompts Guide](./prompts.md)** - Understand query prompts
7. **[Database Tools](./database-tools.md)** - Inspect your database

## Documentation Structure

- **Guide** - User-friendly tutorials and how-tos
- **API Reference** - Detailed tool and type documentation
- **Development** - Build, extend, and contribute
- **Deployment** - Production setup and best practices
- **Reference** - IETF specification and technical details
- **Examples** - Code examples and integration patterns

## Getting Help

- 📖 Check the [Troubleshooting Guide](./troubleshooting.md)
- 💬 Ask in [GitHub Discussions](https://github.com/yourusername/vcon-mcp/discussions)
- 🐛 Report bugs in [GitHub Issues](https://github.com/yourusername/vcon-mcp/issues)
- 📧 Contact the team at support@example.com

## Contributing

We welcome contributions! See our [Contributing Guide](../development/contributing.md) for details on:

- Reporting bugs
- Suggesting features
- Submitting pull requests
- Writing documentation

## License

This project is released under the MIT License. See the [LICENSE](https://github.com/yourusername/vcon-mcp/blob/main/LICENSE) file for details.

