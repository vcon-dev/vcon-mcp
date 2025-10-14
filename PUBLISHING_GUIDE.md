# Documentation Publishing Guide

This guide explains how to publish the vCon MCP Server documentation to various platforms.

## Overview

The documentation is designed to be easily published to:
- **GitHub Pages** - https://yourusername.github.io/vcon-mcp
- **npm** - https://www.npmjs.com/package/@vcon/mcp-server
- **GitBook** - https://your-org.gitbook.io/vcon-mcp
- **GitHub Repository** - README.md overview

All platforms share the same source files in the `docs/` folder, making maintenance easy.

---

## Platform 1: GitHub Pages (VitePress)

### Initial Setup

1. **Enable GitHub Pages in repository settings:**
   ```
   Settings → Pages → Source: GitHub Actions
   ```

2. **Install VitePress locally:**
   ```bash
   npm install -D vitepress
   ```

3. **Test locally:**
   ```bash
   npm run docs:dev
   # Open http://localhost:5173
   ```

### Configuration

Edit `docs/.vitepress/config.ts`:
```typescript
export default defineConfig({
  base: '/vcon-mcp/',  // Match your repo name
  title: "vCon MCP Server",
  // ... other settings
})
```

### Deployment

**Automatic (Recommended):**
```bash
# Push to main branch
git push origin main

# GitHub Actions automatically builds and deploys
# Check Actions tab for deployment status
```

**Manual:**
```bash
# Build documentation
npm run docs:build

# Preview locally
npm run docs:preview

# Deploy using gh-pages branch
npm install -g gh-pages
gh-pages -d docs/.vitepress/dist
```

### Custom Domain

1. Add CNAME file to `docs/public/CNAME`:
   ```
   docs.yourdomain.com
   ```

2. Configure DNS:
   ```
   Type: CNAME
   Name: docs
   Value: yourusername.github.io
   ```

3. Enable HTTPS in GitHub Pages settings

### Troubleshooting

**404 errors:**
- Check `base` path in config.ts matches repo name
- Ensure GitHub Pages is enabled
- Verify Actions workflow completed successfully

**Styles not loading:**
- Check browser console for 404s
- Verify base path is correct
- Clear browser cache

---

## Platform 2: npm Package

### Setup

The main README.md serves as the npm package documentation.

### Package.json Configuration

```json
{
  "name": "@vcon/mcp-server",
  "description": "IETF vCon MCP Server - Conversation Data Management with AI",
  "homepage": "https://yourusername.github.io/vcon-mcp",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/vcon-mcp"
  },
  "keywords": [
    "vcon", "mcp", "ietf", "conversation", "supabase"
  ],
  "readme": "README.md"
}
```

### README Best Practices

Keep README.md focused on:
- Quick installation
- Basic usage
- Key features
- Link to full documentation

**Example structure:**
```markdown
# vCon MCP Server

Brief description

## Installation
npm install @vcon/mcp-server

## Quick Start
[Code example]

## Documentation
See [full documentation](https://yourusername.github.io/vcon-mcp)
```

### Publishing

```bash
# Login to npm
npm login

# Test package
npm pack
# Check the generated .tgz file

# Publish
npm publish --access public

# Update
npm version patch  # or minor, major
npm publish
```

### npm Package Page

Appears at: https://www.npmjs.com/package/@vcon/mcp-server

**Optimization tips:**
- Add badges (version, downloads, license)
- Include a logo
- Keep installation steps clear
- Link prominently to full docs

---

## Platform 3: GitBook

### Initial Setup

1. **Create GitBook space:**
   - Go to https://www.gitbook.com
   - Create new space
   - Choose "GitHub" integration

2. **Connect repository:**
   - Select your GitHub repository
   - GitBook will sync automatically

3. **Configure sync:**
   - Create `.gitbook.yaml` in repo root:
   ```yaml
   root: ./docs/
   structure:
     readme: index.md
     summary: SUMMARY.md
   ```

4. **Create navigation:**
   - Create `docs/SUMMARY.md` with table of contents
   - GitBook uses this for navigation

### SUMMARY.md Structure

```markdown
# Table of Contents

* [Introduction](index.md)

## Guide
* [Getting Started](guide/getting-started.md)
* [Installation](guide/installation.md)
...
```

### Customization

**Custom domain:**
1. Add domain in GitBook settings
2. Configure DNS CNAME to point to GitBook

**Theme & branding:**
- Upload logo in GitBook settings
- Choose color scheme
- Add custom CSS (paid plans)

### Sync Process

```bash
# Push to main branch
git push origin main

# GitBook automatically syncs
# Check GitBook dashboard for sync status
```

### Features

GitBook provides:
- Built-in search
- Version management
- Analytics
- PDF export
- API documentation
- Collaborative editing

---

## Platform 4: GitHub Repository README

### README.md Strategy

Keep the root README.md as a **landing page**:

✅ Include:
- Project description
- Key features (with icons/badges)
- Quick start (installation + basic example)
- Link to full documentation
- Community links (issues, discussions)
- License and contributing info

❌ Don't include:
- Detailed API reference (link to docs)
- Long tutorials (link to docs)
- Implementation details (link to docs)

### Badges

Add badges for quick info:
```markdown
![Version](https://img.shields.io/npm/v/@vcon/mcp-server)
![License](https://img.shields.io/badge/license-MIT-blue)
![GitHub Stars](https://img.shields.io/github/stars/yourusername/vcon-mcp)
![Downloads](https://img.shields.io/npm/dm/@vcon/mcp-server)
```

### Structure

```markdown
# Project Name

Description

[Badges]

## Features
- Feature 1
- Feature 2

## Quick Start
npm install + basic example

## Documentation
Link to GitHub Pages

## Community
Links to issues, discussions, etc.

## License
```

---

## Workflow: Making Documentation Updates

### Step 1: Edit Documentation

```bash
# Edit files in docs/ folder
vim docs/guide/getting-started.md

# Test locally
npm run docs:dev
```

### Step 2: Commit & Push

```bash
git add docs/
git commit -m "docs: update getting started guide"
git push origin main
```

### Step 3: Automatic Deployment

- ✅ GitHub Actions builds and deploys to GitHub Pages
- ✅ GitBook syncs automatically
- ✅ npm package unchanged (unless you bump version)
- ✅ GitHub README.md updates automatically

### Step 4: Verify

1. **GitHub Pages:** Check https://yourusername.github.io/vcon-mcp
2. **GitBook:** Check your GitBook space
3. **GitHub:** Refresh repository page

---

## Multi-Platform Comparison

| Feature | GitHub Pages | npm | GitBook | GitHub |
|---------|-------------|-----|---------|--------|
| Automatic Sync | ✅ Actions | ❌ Manual | ✅ Auto | ✅ Git |
| Search | ✅ Built-in | ❌ No | ✅ Advanced | ❌ No |
| Versioning | ⚠️ Manual | ✅ Built-in | ✅ Built-in | ✅ Git |
| Custom Domain | ✅ Yes | N/A | ✅ Yes | ✅ Yes |
| Analytics | ⚠️ External | ✅ npm stats | ✅ Built-in | ✅ Insights |
| Cost | ✅ Free | ✅ Free | ⚠️ Paid features | ✅ Free |
| Speed | ⚡ Very Fast | N/A | ⚡ Fast | ⚡ Fast |

---

## Best Practices

### Documentation Writing

1. **Use clear headers** - Make scanning easy
2. **Include examples** - Show, don't just tell
3. **Test all code** - Ensure examples work
4. **Link between pages** - Use relative links
5. **Keep it updated** - Documentation = code

### Maintenance

1. **Review regularly** - Check for outdated info
2. **Monitor feedback** - Watch issues and discussions
3. **Update for releases** - Document breaking changes
4. **Test links** - Use link checker tools
5. **Check spelling** - Use spell checker

### Cross-Platform

1. **Single source** - Maintain docs/ folder only
2. **Relative links** - Work across all platforms
3. **Markdown standard** - CommonMark compatible
4. **Platform-specific** - Use each platform's strengths

---

## Troubleshooting

### GitHub Pages not updating

```bash
# Check Actions tab for errors
# Verify workflow file exists: .github/workflows/deploy-docs.yml
# Check GitHub Pages settings

# Manual trigger
gh workflow run deploy-docs.yml
```

### GitBook not syncing

```bash
# Check .gitbook.yaml in repo root
# Verify GitHub integration in GitBook settings
# Check GitBook sync logs
# Try manual sync in GitBook dashboard
```

### npm README not updating

```bash
# npm caches READMEs
# Wait 1-2 hours or
# Bump version and republish
npm version patch
npm publish
```

### Build errors

```bash
# Clear cache
rm -rf node_modules/.vite

# Rebuild
npm run docs:build

# Check for broken links
npx broken-link-checker http://localhost:5173
```

---

## Checklist for Publishing

### Initial Setup
- [ ] GitHub Pages enabled
- [ ] VitePress installed and configured
- [ ] GitBook space created (optional)
- [ ] npm package published
- [ ] GitHub Actions workflow tested

### For Each Release
- [ ] Update version in package.json
- [ ] Update CHANGELOG.md
- [ ] Review all documentation
- [ ] Test all examples
- [ ] Build and preview locally
- [ ] Push to main branch
- [ ] Verify GitHub Pages deployment
- [ ] Verify GitBook sync (if using)
- [ ] Publish to npm (if package changed)
- [ ] Announce release

---

## Next Steps

1. **Customize URLs:** Update all placeholder URLs in configs
2. **Add content:** Start with guide/getting-started.md
3. **Test locally:** Run `npm run docs:dev`
4. **Deploy:** Push to trigger automatic deployment
5. **Verify:** Check all platforms
6. **Share:** Announce your documentation

## Support

For help with publishing:
- VitePress: https://vitepress.dev
- GitHub Pages: https://pages.github.com
- GitBook: https://docs.gitbook.com
- npm: https://docs.npmjs.com

---

**Happy Publishing! 🚀**

