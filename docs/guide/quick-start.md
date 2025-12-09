# Quick Start

Get the vCon MCP Server running in 5 minutes.

## TL;DR

```bash
# Clone and install
git clone https://github.com/vcon-dev/vcon-mcp.git
cd vcon-mcp
npm install

# Configure
cp .env.example .env
# Edit .env with your Supabase credentials

# Build and test
npm run build
npm test

# Configure Claude Desktop
# Edit ~/Library/Application Support/Claude/claude_desktop_config.json
```

That's it! Continue reading for details.

---

## Step 1: Prerequisites (1 minute)

**Check you have:**

```bash
# Node.js 18+
node --version

# npm 9+
npm --version

# Git
git --version
```

**Don't have them?**
- Install Node.js from [nodejs.org](https://nodejs.org/)
- Install Git from [git-scm.com](https://git-scm.com/)

**Supabase Account:**
- Sign up free at [supabase.com](https://supabase.com)
- Create a new project
- Note your project URL and anon key

---

## Step 2: Install (2 minutes)

```bash
# Clone the repository
git clone https://github.com/vcon-dev/vcon-mcp.git
cd vcon-mcp

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

**Edit `.env` file:**

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

Get these values from:
- Supabase Dashboard → Settings → API

---

## Step 3: Database Setup (1 minute)

**Option A: Using Supabase CLI (recommended)**

```bash
npx supabase db push
```

**Option B: Manual via Dashboard**

1. Open Supabase SQL Editor
2. Run each migration file from `supabase/migrations/` in order

---

## Step 4: Build & Test (1 minute)

```bash
# Build the project
npm run build

# Run tests to verify
npm test
```

✅ If tests pass, you're ready!

---

## Step 5: Configure Claude Desktop (30 seconds)

**Edit config file:**

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**Add this:**

```json
{
  "mcpServers": {
    "vcon": {
      "command": "node",
      "args": [
        "/absolute/path/to/vcon-mcp/dist/index.js"
      ],
      "env": {
        "SUPABASE_URL": "https://your-project.supabase.co",
        "SUPABASE_ANON_KEY": "your-anon-key-here"
      }
    }
  }
}
```

**Find your absolute path:**

```bash
pwd
# Use this path + /dist/index.js
```

**Restart Claude Desktop** completely.

---

## Step 6: Test in Claude (30 seconds)

Open Claude Desktop and ask:

```
What MCP tools do you have available?
```

You should see:
- `create_vcon`
- `get_vcon`
- `search_vcons`
- And more...

**Try it:**

```
Create a vCon for a customer support call between Alice and Bob
```

🎉 **Success!** You're using the vCon MCP Server!

---

## What's Next?

### Start Using

- **[Basic Usage Guide](./basic-usage.md)** - Learn common operations
- **[Search Guide](./search.md)** - Master search capabilities
- **[Tag Management](./tags.md)** - Organize your vCons

### Learn More

- **[Installation Guide](./installation.md)** - Detailed setup options
- **[API Reference](../api/)** - Complete tool documentation
- **[Examples](../examples/)** - Code samples

### Extend

- **[Plugin Development](../development/plugins.md)** - Add custom features
- **[Custom Tools](../development/custom-tools.md)** - Create new tools
- **[Contributing](../development/contributing.md)** - Contribute back

---

## Troubleshooting

### Claude doesn't show vCon tools

**Check:**
1. Did you restart Claude Desktop completely?
2. Is the path absolute (not relative)?
3. Does `dist/index.js` exist?
4. Is your `.env` file in the project root?

**Test server directly:**

```bash
node dist/index.js
# Should show initialization messages
# Press Ctrl+C to stop
```

### Tests fail

```bash
# Clean and rebuild
rm -rf node_modules dist
npm install
npm run build
npm test
```

### Database connection error

**Check your `.env` file:**

```bash
cat .env
# Verify SUPABASE_URL and SUPABASE_ANON_KEY are set
```

**Test connection:**

```bash
curl "https://your-project.supabase.co/rest/v1/" \
  -H "apikey: your-anon-key"
# Should return 200 OK
```

---

## Common First Tasks

### Create Your First vCon

```
Create a vCon with subject "Test Call" and party "Alice"
```

### Search vCons

```
Show me the most recent vCons
```

### Add Analysis

```
Add sentiment analysis to the vCon with score 0.8 from vendor "TestAI"
```

### Tag a vCon

```
Tag this vCon as department:support and priority:high
```

### Search with Tags

```
Find all high priority support vCons
```

---

## Quick Command Reference

### Core Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run build` | Compile TypeScript |
| `npm test` | Run tests |
| `npm run dev` | Start dev server (watch mode) |
| `npm run docs:dev` | Preview documentation |

### Database Operations

| Command | Purpose |
|---------|---------|
| `npm run db:status` | Check comprehensive database status |
| `npm run db:check` | Quick vCon count check |
| `npm run db:analyze` | Analyze daily counts for gaps |
| `npm run db:backup` | Backup database |
| `npm run db:restore` | Restore from backup |

### Data Sync

| Command | Purpose |
|---------|---------|
| `npm run sync` | Full sync: vCons + embeddings + tags |
| `npm run sync:continuous` | Run sync continuously (every 5 min) |
| `npm run sync:vcons` | Load vCons from S3 or local directory |
| `npm run sync:embeddings` | Generate embeddings continuously |
| `npm run sync:tags` | Refresh tags view only |

**Examples:**
```bash
npm run sync:vcons -- --hours=48      # Load last 48 hours
npm run sync:vcons -- /path/to/vcons  # Load from local directory
```

For complete script documentation, see [scripts/README.md](../../scripts/README.md).

---

## Architecture Quick Overview

```
Claude Desktop (AI)
    ↓ (MCP Protocol)
vCon MCP Server (This project)
    ↓ (Supabase Client)
Supabase (PostgreSQL)
```

**Components:**
- **MCP Tools** - AI assistant capabilities
- **Resources** - Read-only data access
- **Prompts** - Search strategy guidance
- **Database** - vCon data storage
- **Plugins** - Custom extensions

---

## Configuration Quick Reference

### Environment Variables

```env
# Required
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Optional
OPENAI_API_KEY=sk-...  # For semantic search
VCON_PLUGINS_PATH=./my-plugin.js  # For plugins
```

### Claude Desktop Config

```json
{
  "mcpServers": {
    "vcon": {
      "command": "node",
      "args": ["/path/to/vcon-mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_ANON_KEY": "..."
      }
    }
  }
}
```

---

## Feature Highlights

### ✅ Implemented

- **Create & Manage vCons** - Full CRUD operations
- **Four Search Modes** - Basic, keyword, semantic, hybrid
- **Tag System** - Flexible metadata organization
- **MCP Resources** - Fast read-only access
- **Query Prompts** - Guided search strategies
- **Database Tools** - Inspect structure and performance
- **Plugin System** - Extensible architecture
- **Type-Safe** - Full TypeScript with validation

### 🔜 Coming Soon

- Real-time subscriptions
- Batch operations
- Additional integrations
- Enhanced analytics

---

## Getting Help

- **Documentation**: Browse `/docs` for detailed guides
- **GitHub Issues**: Report bugs or request features
- **GitHub Discussions**: Ask questions
- **API Reference**: Complete tool documentation

---

## One-Line Install (Alternative)

Coming soon:

```bash
npx create-vcon-mcp-server my-server
```

---

**That's it!** You're ready to use the vCon MCP Server.

**Next:** [Basic Usage Guide](./basic-usage.md) →

**Need more detail?** [Installation Guide](./installation.md) →

**Having issues?** [Troubleshooting](#troubleshooting) ↑

