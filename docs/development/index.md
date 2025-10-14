# Development Guide

Everything you need to build, extend, and contribute to the vCon MCP Server.

## Overview

This section covers:
- Building the server from source
- Understanding the architecture
- Developing plugins
- Running tests
- Contributing to the project

## Quick Start

```bash
# Clone the repository
git clone https://github.com/vcon-dev/vcon-mcp.git
cd vcon-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Start development server
npm run dev
```

## Documentation Sections

### [Architecture](./architecture.md)
Learn about the system design, components, and data flow.

### [Building from Source](./building.md)
Step-by-step guide to building the server, including:
- Prerequisites
- Database setup
- Environment configuration
- Build process
- Deployment

### [Plugin Development](./plugins.md)
Create custom plugins to extend functionality:
- Plugin interface
- Lifecycle hooks
- Custom tools
- Example plugins

### [Testing](./testing.md)
Testing strategies and tools:
- Unit tests
- Integration tests
- Compliance tests
- Test coverage

### [Embeddings](./embeddings.md)
Working with AI embeddings for semantic search:
- Generating embeddings
- Vector storage
- Search optimization
- Supabase pgvector setup

## Project Structure

```
vcon-mcp/
├── src/
│   ├── index.ts              # MCP server entry
│   ├── types/vcon.ts         # IETF vCon types
│   ├── db/                   # Database layer
│   ├── tools/                # MCP tools
│   ├── resources/            # MCP resources
│   ├── prompts/              # MCP prompts
│   ├── hooks/                # Plugin system
│   └── utils/                # Utilities
├── tests/                    # Test suites
├── scripts/                  # Helper scripts
├── supabase/                 # Database migrations
└── docs/                     # Documentation
```

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js 18+
- **Database**: PostgreSQL (via Supabase)
- **Protocol**: MCP (Model Context Protocol)
- **Validation**: Zod
- **Testing**: Vitest
- **Build**: TypeScript Compiler

## Contributing

We welcome contributions! See the [Contributing Guide](./contributing.md) for:
- Code style guidelines
- Pull request process
- Issue reporting
- Documentation standards

## Community

- **GitHub**: https://github.com/vcon-dev/vcon-mcp
- **Issues**: Report bugs and request features
- **Discussions**: Ask questions and share ideas
- **IETF vCon WG**: https://datatracker.ietf.org/wg/vcon/

