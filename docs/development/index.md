# Development Guide

Everything you need to build, extend, and contribute to the vCon MCP Server.

## Overview

This comprehensive development guide covers all aspects of working with the vCon MCP Server codebase:

- **System Architecture** - Understanding the design and components
- **Building & Testing** - Getting the server running locally
- **Extending Functionality** - Creating plugins and custom tools
- **Contributing** - Guidelines for code, testing, and documentation
- **Best Practices** - Code style, patterns, and standards

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/vcon-dev/vcon-mcp.git
cd vcon-mcp

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your Supabase credentials

# Build the project
npm run build

# Run tests
npm test

# Start development server
npm run dev
```

---

## Documentation Sections

### 📐 [Architecture](./architecture.md)

**Deep dive into system design:**
- Component architecture and layers
- Data flow and request handling
- Plugin system architecture
- Database design and search strategies
- Performance considerations
- Security architecture

**Perfect for:** Understanding how everything fits together

---

### 🔨 [Building from Source](./building.md)

**Complete build guide from scratch:**
- Prerequisites and environment setup
- Database schema setup
- Project structure creation
- Core implementation
- MCP server configuration
- Testing and validation
- Deployment preparation

**Perfect for:** First-time setup and deployment

---

### 🧪 [Testing](./testing.md)

**Comprehensive testing guide:**
- Unit testing with Vitest
- Integration testing patterns
- IETF spec compliance tests
- MCP tool testing
- Test fixtures and utilities
- Coverage requirements
- CI/CD integration

**Perfect for:** Ensuring code quality and correctness

---

### 🔌 [Plugin Development](./plugins.md)

**Create plugins to extend the server:**
- Plugin interface and lifecycle hooks
- Operation hooks (create, read, update, delete, search)
- Registering custom tools and resources
- Plugin configuration
- Example plugins (logging, access control)
- Testing plugins
- Publishing plugins

**Perfect for:** Adding custom functionality without modifying core

---

### 🛠️ [Custom Tools](./custom-tools.md)

**Develop custom MCP tools:**
- Tool structure and schemas
- Input validation with Zod
- Implementing tool handlers
- Database access patterns
- External API integration
- Testing custom tools
- Best practices and examples

**Perfect for:** Adding new capabilities to the MCP interface

---

### 🔧 [Extending the Server](./extending.md)

**Complete extension guide for resources, prompts, tools, and plugins:**
- When to use each extension type
- Adding custom resources (discoverable data access)
- Creating custom prompts (guided query templates)
- Building custom tools (executable operations)
- Packaging as plugins (reusable modules)
- Complete real-world examples
- Best practices and patterns

**Perfect for:** Understanding all extension options and choosing the right approach

---

### 🤖 [Embeddings & Search](./embeddings.md)

**AI-powered semantic search:**
- pgvector extension setup
- Embedding generation (OpenAI, local models)
- Vector indexing (HNSW, IVFFlat)
- Search strategies (keyword, semantic, hybrid)
- Performance optimization
- Cost considerations
- Batch processing

**Perfect for:** Implementing AI-powered search features

---

### 🤝 [Contributing Guide](./contributing.md)

**How to contribute to the project:**
- Code of conduct
- Getting started with contributions
- Development workflow
- Pull request process
- Commit message conventions
- Code review expectations
- Recognition and community

**Perfect for:** New contributors and community guidelines

---

### 📝 [Code Style Guide](./code-style.md)

**Coding standards and best practices:**
- TypeScript style guidelines
- Naming conventions
- File organization patterns
- Comments and documentation
- Error handling patterns
- Testing style
- Git practices

**Perfect for:** Writing consistent, maintainable code

---

### 📚 [Documentation Standards](./documentation.md)

**Writing and maintaining docs:**
- Documentation types (API, guides, examples)
- Writing style and tone
- Markdown standards
- Code example guidelines
- API documentation templates
- User guide structure
- Build and deployment

**Perfect for:** Contributing to documentation

---

## Project Structure

```
vcon-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── types/                # TypeScript type definitions
│   │   ├── vcon.ts          # IETF vCon types
│   │   └── mcp.ts           # MCP protocol types
│   ├── db/                   # Database layer
│   │   ├── client.ts        # Supabase client
│   │   └── queries.ts       # Database queries
│   ├── tools/                # MCP tools
│   │   ├── vcon-crud.ts     # CRUD operations
│   │   ├── search-tools.ts  # Search operations
│   │   └── tag-tools.ts     # Tag management
│   ├── resources/            # MCP resources
│   │   └── index.ts         # Resource handlers
│   ├── prompts/              # MCP prompts
│   │   └── index.ts         # Prompt templates
│   ├── hooks/                # Plugin system
│   │   └── index.ts         # Plugin interface
│   └── utils/                # Utilities
│       ├── validation.ts    # vCon validation
│       └── logger.ts        # Logging utilities
├── tests/                    # Test suites
│   ├── crud.test.ts         # CRUD tests
│   ├── search.test.ts       # Search tests
│   └── fixtures/            # Test data
├── docs/                     # Documentation
│   ├── guide/               # User guides
│   ├── api/                 # API reference
│   ├── development/         # Developer guides
│   ├── examples/            # Code examples
│   └── reference/           # Technical specs
├── supabase/                 # Database
│   └── migrations/          # SQL migrations
├── scripts/                  # Helper scripts
│   └── test-mcp-tools.ts   # Tool testing script
└── .github/                  # GitHub config
    └── workflows/           # CI/CD pipelines
```

---

## Tech Stack

### Core Technologies

- **Language**: TypeScript 5.x
- **Runtime**: Node.js 18+
- **Database**: PostgreSQL 15+ (via Supabase)
- **Protocol**: MCP (Model Context Protocol)
- **Validation**: Zod
- **Testing**: Vitest
- **Build**: TypeScript Compiler
- **Documentation**: VitePress

### Key Libraries

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `@supabase/supabase-js` - Database client
- `zod` - Runtime type validation
- `vitest` - Testing framework
- `pgvector` - Vector similarity search

---

## Development Workflow

### 1. Set Up Environment

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Initialize database
# Run migrations in Supabase dashboard
```

### 2. Make Changes

```bash
# Create feature branch
git checkout -b feature/your-feature

# Make your changes
# Edit src/ files

# Build and test
npm run build
npm test
```

### 3. Test Locally

```bash
# Run dev server
npm run dev

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js

# Or test with Claude Desktop
# Update claude_desktop_config.json
```

### 4. Submit Changes

```bash
# Run linter
npm run lint

# Run tests
npm test

# Commit changes
git add .
git commit -m "feat(scope): description"

# Push and create PR
git push origin feature/your-feature
```

---

## Learning Path

### For New Contributors

1. **Start Here**:
   - Read [Architecture](./architecture.md) to understand the system
   - Follow [Building Guide](./building.md) to set up locally
   - Review [Code Style Guide](./code-style.md) for standards

2. **Make Your First Contribution**:
   - Check issues tagged with `good-first-issue`
   - Read [Contributing Guide](./contributing.md)
   - Start with documentation or tests

3. **Advance Your Skills**:
   - Review [Extending Guide](./extending.md) to understand all options
   - Create a [Plugin](./plugins.md) to add functionality
   - Develop a [Custom Tool](./custom-tools.md)
   - Implement [Advanced Search](./embeddings.md)

### For Advanced Developers

1. **Deep Dive**:
   - Study the [Architecture](./architecture.md) in detail
   - Review database schema and RPC functions
   - Understand plugin system internals

2. **Extend the System**:
   - Master the [Extension Guide](./extending.md)
   - Build complex plugins with resources and tools
   - Add new search algorithms
   - Optimize performance

3. **Contribute Back**:
   - Improve core functionality
   - Enhance documentation
   - Mentor new contributors

---

## Testing Your Changes

### Unit Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- search.test.ts

# Run with coverage
npm run test:coverage

# Watch mode
npm test -- --watch
```

### Integration Tests

```bash
# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js

# Test with real client
# Configure Claude Desktop and test manually
```

### Compliance Tests

```bash
# Run IETF spec compliance tests
npm run test:compliance
```

---

## Getting Help

### Resources

- **Documentation**: Browse `/docs` for comprehensive guides
- **GitHub Issues**: Search for similar issues or questions
- **GitHub Discussions**: Ask questions and share ideas
- **Code Examples**: Check `/tests` and `/docs/examples`
- **IETF Spec**: Read the vCon specification for details

### Where to Ask

- **Questions**: GitHub Discussions
- **Bugs**: GitHub Issues with bug report template
- **Features**: GitHub Issues with feature request template
- **Security**: Email maintainers privately

---

## Contributing

We welcome contributions of all types:

- **Code**: New features, bug fixes, optimizations
- **Documentation**: Guides, examples, API docs
- **Testing**: Test cases, fixtures, tools
- **Design**: Architecture proposals, refactoring
- **Community**: Answering questions, reviewing PRs

See [Contributing Guide](./contributing.md) for detailed instructions.

---

## Community

- **GitHub**: https://github.com/vcon-dev/vcon-mcp
- **Issues**: Report bugs and request features
- **Discussions**: Ask questions and share ideas
- **IETF vCon WG**: https://datatracker.ietf.org/wg/vcon/

---

## License

The vCon MCP Server is released under the MIT License. See [LICENSE](../../LICENSE) for details.

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Ready to contribute?** Start with the [Contributing Guide](./contributing.md) and choose a task that interests you!

**Need help?** Don't hesitate to ask questions in GitHub Discussions. We're here to help! 🚀

