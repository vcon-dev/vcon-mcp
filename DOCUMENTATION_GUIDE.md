# Documentation Guide

## Overview

The vCon MCP Server documentation is organized for publishing across these surfaces:
- **Published docs site** - https://mcp.conserver.io/ (GitBook, kept in sync from `docs/` via GitBook git-sync)
- **GitHub README** - Quick start and overview (also the npm package home page)
- **Local preview** - VitePress (`npm run docs:dev`) for authoring `docs/`

## Documentation Structure

```
docs/
├── guide/           # User Guide - Getting started and usage
├── api/             # API Reference - Detailed tool/function docs
├── development/     # Developer Guide - Building and extending
├── deployment/      # Deployment Guide - Production setup
├── reference/       # Technical Reference - IETF spec compliance
└── examples/        # Code Examples - Practical examples
```

## For Different Audiences

### New Users
1. **README.md** - Project overview
2. **docs/guide/getting-started.md** - Quick start
3. **docs/guide/basic-usage.md** - First steps
4. **docs/guide/search.md** - Search features
5. **docs/guide/tags.md** - Organization

### Developers
1. **docs/development/architecture.md** - System design
2. **docs/development/building.md** - Build from source
3. **docs/development/plugins.md** - Plugin development
4. **docs/api/** - Complete API reference

### Production Deployment
1. **docs/deployment/production.md** - Deploy guide
2. **docs/deployment/security.md** - Security practices
3. **docs/deployment/performance.md** - Performance tuning

## Building Documentation

### Using VitePress (Recommended)

```bash
# Install VitePress
npm install -D vitepress

# Start dev server
npm run docs:dev

# Build for production
npm run docs:build

# Preview production build
npm run docs:preview
```

### Publish to the docs site (GitBook)

The published site at https://mcp.conserver.io/ is a GitBook space connected to this repo via GitBook git-sync. Merging changes under `docs/` to `main` propagates to GitBook automatically; there is no GitHub Actions job that deploys docs.

```bash
# Edit under docs/, preview locally, then merge to main
npm run docs:dev
git push origin main   # GitBook git-sync picks up docs/ changes
```

### npm Package Documentation

The main README.md serves as the npm package documentation and includes:
- Installation instructions
- Quick start guide
- Link to full documentation
- Basic examples

## Maintaining Documentation

### Single Source of Truth

All documentation lives in the `docs/` folder using Markdown files. These files are:
- Version controlled in git
- Built into static sites for hosting
- Easy to update and maintain
- Platform-agnostic

### Updating Documentation

1. Edit Markdown files in `docs/` folder
2. Test locally with `npm run docs:dev`
3. Commit changes
4. Push to trigger automatic deployment

### Cross-Linking

Use relative links between documentation pages:

```markdown
See the [Search Guide](./search.md) for details.
See the [API Reference](../api/tools.md) for complete documentation.
```

### Adding New Pages

1. Create Markdown file in appropriate folder
2. Add to navigation in `docs/.vitepress/config.ts`
3. Link from relevant pages

## Documentation Platforms

### GitBook (published docs site)
- **URL**: https://mcp.conserver.io/
- **Source**: `docs/` folder
- **Sync**: GitBook git-sync from `main` (no GitHub Actions involved)

### npm Package
- **URL**: https://www.npmjs.com/package/vcon-mcp
- **Source**: README.md (main page)
- **Links**: Points to the published docs site for full docs
- **Include**: Quick start, installation, basic examples

### GitHub Repository
- **URL**: https://github.com/vcon-dev/vcon-mcp
- **Source**: README.md (main page)
- **Organization**: Clean root with links to full docs
- **Include**: Badges, quick start, key features

## Documentation Standards

### Markdown Style

- Use ATX-style headers (`#`, `##`, `###`)
- Use fenced code blocks with language identifiers
- Use relative links for internal navigation
- Include code examples for all features
- Add tables for structured data

### Code Examples

```typescript
// Always include complete, runnable examples
import { VConQueries } from 'vcon-mcp';

const queries = new VConQueries(supabase);
const vcon = await queries.getVCon(uuid);
```

### File Naming

- Use kebab-case: `getting-started.md`
- Be descriptive: `plugin-development.md` not `plugins.md`
- Use `.md` extension for all markdown files

### Front Matter

Each page should include front matter:

```yaml
---
title: Getting Started
description: Quick start guide for vCon MCP Server
---
```

## Automation

### GitHub Actions

The repository's workflows (`.github/workflows/`) cover code, not docs:
- **Tests** (`test.yml`)
- **Publish to npm** (`publish.yml`)
- **Build and Push to ECR Public** (`docker-ecr.yml`)

There is currently no Actions workflow that builds or deploys documentation, and no link-check or spell-check job. Docs authoring uses VitePress locally; publishing to https://mcp.conserver.io/ happens through GitBook git-sync when `docs/` changes land on `main`.

### Publishing Pipeline

```
Edit docs/ locally  →  preview with npm run docs:dev  →  merge to main
    →  GitBook git-sync  →  live at mcp.conserver.io
```

## Documentation Checklist

When adding new features:
- [ ] Update API reference
- [ ] Add usage examples
- [ ] Update relevant guides
- [ ] Add to changelog
- [ ] Test all links
- [ ] Build and preview locally
- [ ] Update navigation if needed

## Platform-Specific Notes

### GitBook (mcp.conserver.io)
- Custom domain (`mcp.conserver.io`) with built-in search
- Synced from `docs/` on `main` via git-sync
- Supports versioning

### npm
- README.md is the package home page
- Keep it concise
- Link to full documentation
- Include installation and quick start

## Support

For documentation issues:
- Open an issue on GitHub
- Check existing documentation
- Review examples folder
- Ask in discussions

## Contributing

See [Contributing Guide](./docs/development/contributing.md) for details on:
- Documentation standards
- How to add new pages
- Review process
- Style guide

---

**Last Updated**: July 23, 2026
**Applies to**: vcon-mcp 1.3.0

