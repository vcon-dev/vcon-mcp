# Documentation Guide

## Overview

The vCon MCP Server documentation is organized for easy publishing across multiple platforms:
- **GitHub Pages** - https://vcon-dev.github.io/vcon-mcp
- **npm** - Package documentation
- **GitBook** - Optional alternative hosting
- **GitHub README** - Quick start and overview

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

### Deploy to GitHub Pages

```bash
# Automatically deployed via GitHub Actions
# Push to main branch triggers deployment
git push origin main
```

### Deploy to GitBook

1. Import repository to GitBook
2. Configure GitBook to use `docs/` folder
3. Set up GitBook integration in repository

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

### GitHub Pages
- **URL**: https://vcon-dev.github.io/vcon-mcp
- **Deploy**: Automatic via GitHub Actions
- **Source**: `docs/` folder
- **Build**: VitePress static site

### npm Package
- **URL**: https://www.npmjs.com/package/@vcon/mcp-server
- **Source**: README.md (main page)
- **Links**: Points to GitHub Pages for full docs
- **Include**: Quick start, installation, basic examples

### GitBook (Optional)
- **URL**: https://vcon-dev.gitbook.io/vcon-mcp
- **Source**: `docs/` folder
- **Import**: Connect GitHub repository
- **Sync**: Automatic on push

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
import { VConQueries } from '@vcon/mcp-server';

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

## Automated Workflows

### GitHub Actions

The repository includes automated workflows for:
1. **Deploy Documentation** - Build and deploy to GitHub Pages
2. **Test Links** - Verify all documentation links
3. **Spell Check** - Check spelling in documentation
4. **Update Stats** - Update documentation statistics

### Deployment Pipeline

```
Push to main
    ↓
GitHub Actions triggered
    ↓
Build VitePress site
    ↓
Deploy to GitHub Pages
    ↓
Available at GitHub Pages URL
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

### GitHub Pages
- Deployed to `gh-pages` branch
- Uses custom domain support
- HTTPS enabled by default
- CDN distributed globally

### npm
- README.md is the package home page
- Keep it concise
- Link to full documentation
- Include installation and quick start

### GitBook
- Supports custom domains
- Has built-in search
- Supports versioning
- Can integrate with GitHub

## Migration Status

### Completed
- ✅ README.md - Updated main entry point
- ✅ Documentation structure planned
- ✅ VitePress configuration created
- ✅ GitHub Actions workflow created

### In Progress
- 🔄 Consolidating redundant files
- 🔄 Creating new guide pages
- 🔄 Building API reference
- 🔄 Adding code examples

### Planned
- ⏳ GitBook integration
- ⏳ Search functionality
- ⏳ Versioned documentation
- ⏳ Multi-language support (future)

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

**Last Updated**: October 14, 2025
**Documentation Version**: 1.0.0

