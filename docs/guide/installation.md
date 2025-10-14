# Installation Guide

Complete guide to installing and setting up the vCon MCP Server.

## Prerequisites

Before you begin, ensure you have the following installed:

### Required

- **Node.js** 18.0 or higher
  - Check version: `node --version`
  - Download: [nodejs.org](https://nodejs.org/)
  
- **npm** 9.0 or higher (comes with Node.js)
  - Check version: `npm --version`
  
- **Git** (for cloning the repository)
  - Check version: `git --version`
  - Download: [git-scm.com](https://git-scm.com/)

- **Supabase Account** (free tier available)
  - Sign up: [supabase.com](https://supabase.com)

### Optional

- **OpenAI API Key** (for semantic search with embeddings)
  - Sign up: [platform.openai.com](https://platform.openai.com/)

- **Claude Desktop** (for using the server with Claude AI)
  - Download: [claude.ai/download](https://claude.ai/download)

---

## Installation Methods

Choose the installation method that best fits your needs:

- [Method 1: Quick Install (Recommended)](#method-1-quick-install-recommended)
- [Method 2: Development Install](#method-2-development-install)
- [Method 3: npm Global Install](#method-3-npm-global-install)
- [Method 4: Docker Install](#method-4-docker-install-coming-soon)

---

## Method 1: Quick Install (Recommended)

Perfect for getting started quickly with the server.

### Step 1: Clone the Repository

```bash
# Clone from GitHub
git clone https://github.com/vcon-dev/vcon-mcp.git
cd vcon-mcp

# Or if using a different repository
git clone YOUR_REPOSITORY_URL
cd vcon-mcp
```

### Step 2: Install Dependencies

```bash
npm install
```

This will install all required dependencies:
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `@supabase/supabase-js` - Supabase client
- `zod` - Runtime validation
- Development tools (TypeScript, Vitest, etc.)

### Step 3: Set Up Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit the .env file with your credentials
nano .env  # or use your preferred editor
```

Configure the following required variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

**Getting Supabase Credentials:**

1. Go to [supabase.com](https://supabase.com) and sign in
2. Create a new project (or select existing)
3. Go to **Settings** → **API**
4. Copy the **Project URL** to `SUPABASE_URL`
5. Copy the **anon public** key to `SUPABASE_ANON_KEY`

### Step 4: Set Up Database Schema

Run the database migrations to create the required tables:

```bash
# Option A: Using Supabase CLI (recommended)
npx supabase db push

# Option B: Manual via Supabase Dashboard
# 1. Go to your Supabase project
# 2. Navigate to SQL Editor
# 3. Run the migration files from supabase/migrations/ in order
```

**Migration files included:**
- `001_initial_schema.sql` - Core vCon tables
- `002_indexes.sql` - Performance indexes
- `003_rls_policies.sql` - Row-level security
- `004_search_functions.sql` - Full-text search
- `005_vector_extension.sql` - Semantic search (optional)

### Step 5: Build the Project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### Step 6: Verify Installation

```bash
# Run tests to verify everything works
npm test

# Run compliance tests
npm run test:compliance
```

✅ **Installation complete!** Proceed to [Basic Usage](./basic-usage.md).

---

## Method 2: Development Install

For developers who want to contribute or modify the code.

### Step 1: Fork and Clone

```bash
# Fork the repository on GitHub first
# Then clone your fork
git clone https://github.com/YOUR_USERNAME/vcon-mcp.git
cd vcon-mcp

# Add upstream remote
git remote add upstream https://github.com/vcon-dev/vcon-mcp.git
```

### Step 2: Install with Dev Dependencies

```bash
npm install
```

### Step 3: Set Up Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### Step 4: Set Up Database

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref your-project-ref

# Push migrations
supabase db push

# Generate TypeScript types from database
supabase gen types typescript --local > src/types/database.ts
```

### Step 5: Start Development Server

```bash
npm run dev
```

This starts the server in watch mode - changes will reload automatically.

### Step 6: Run Tests in Watch Mode

```bash
npm test -- --watch
```

---

## Method 3: npm Global Install

Install the server globally to use from anywhere (coming soon).

```bash
# Install globally from npm
npm install -g @vcon/mcp-server

# Create a configuration file
mkdir ~/.vcon-mcp
cat > ~/.vcon-mcp/config.json <<EOF
{
  "supabaseUrl": "https://your-project.supabase.co",
  "supabaseKey": "your-anon-key"
}
EOF

# Run the server
vcon-mcp-server
```

---

## Method 4: Docker Install (Coming Soon)

Use Docker for containerized deployment.

```bash
# Pull the image
docker pull vcon/mcp-server:latest

# Run with environment variables
docker run -d \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_ANON_KEY=your-key \
  -p 3000:3000 \
  vcon/mcp-server:latest
```

---

## Configuring Claude Desktop

To use the vCon MCP Server with Claude Desktop:

### Step 1: Locate Config File

The Claude Desktop configuration file location depends on your OS:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

### Step 2: Edit Configuration

Add the vCon MCP Server to your configuration:

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

**Important:** Use the **absolute path** to your `dist/index.js` file.

To find the absolute path:

```bash
# In the vcon-mcp directory
pwd
# Example output: /Users/yourname/projects/vcon-mcp

# Your path will be: /Users/yourname/projects/vcon-mcp/dist/index.js
```

### Step 3: Restart Claude Desktop

1. Quit Claude Desktop completely
2. Reopen Claude Desktop
3. Start a new conversation
4. The vCon tools should now be available

### Step 4: Verify in Claude

Ask Claude:

```
What MCP tools do you have access to?
```

You should see vCon tools listed like:
- `create_vcon`
- `get_vcon`
- `search_vcons`
- `add_analysis`
- And more...

---

## Optional: Semantic Search Setup

To enable AI-powered semantic search:

### Step 1: Enable pgvector Extension

In your Supabase SQL Editor:

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify installation
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### Step 2: Run Vector Migrations

```bash
# In Supabase SQL Editor, run:
supabase/migrations/005_vector_extension.sql
supabase/migrations/006_embeddings_table.sql
```

### Step 3: Add OpenAI API Key

```bash
# Add to your .env file
echo "OPENAI_API_KEY=sk-your-openai-api-key" >> .env
```

### Step 4: Generate Embeddings (Optional)

If you have existing vCons, generate embeddings:

```bash
npm run scripts/generate-embeddings-v2.ts
```

Now you can use semantic search tools like `search_vcons_semantic` and `search_vcons_hybrid`.

---

## Troubleshooting

### Error: "Cannot find module 'dotenv'"

**Solution:** Install dependencies

```bash
npm install
```

### Error: "ENOENT: no such file or directory"

**Solution:** Make sure you built the project

```bash
npm run build
```

### Error: "Invalid Supabase URL"

**Solution:** Check your `.env` file:

```bash
# Verify .env exists
cat .env

# Verify format (no quotes needed)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
```

### Error: "relation 'vcons' does not exist"

**Solution:** Run database migrations

```bash
# Using Supabase CLI
npx supabase db push

# Or manually in Supabase Dashboard SQL Editor
```

### Error: "Permission denied" when running scripts

**Solution:** Make scripts executable

```bash
chmod +x scripts/*.sh
```

### Claude Desktop doesn't show vCon tools

**Checklist:**

1. ✅ Built the project (`npm run build`)
2. ✅ Used absolute path in config
3. ✅ Restarted Claude Desktop completely
4. ✅ .env file in project root
5. ✅ Valid Supabase credentials

**Debug:**

```bash
# Test server directly
node dist/index.js

# Should output MCP initialization messages
# Press Ctrl+C to stop
```

### Tests failing

```bash
# Clean and rebuild
rm -rf node_modules dist
npm install
npm run build

# Run tests with verbose output
npm test -- --reporter=verbose
```

### Database connection issues

```bash
# Test Supabase connection
curl "https://your-project.supabase.co/rest/v1/" \
  -H "apikey: your-anon-key"

# Should return 200 OK
```

---

## Environment Variables Reference

Complete list of supported environment variables:

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `SUPABASE_URL` | ✅ Yes | Your Supabase project URL | - |
| `SUPABASE_ANON_KEY` | ✅ Yes | Supabase anon public key | - |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ No | Service role key (admin operations) | - |
| `OPENAI_API_KEY` | ❌ No | OpenAI API key for embeddings | - |
| `VCON_PLUGINS_PATH` | ❌ No | Comma-separated plugin paths | - |
| `VCON_LICENSE_KEY` | ❌ No | Enterprise license key | - |
| `MCP_SERVER_NAME` | ❌ No | Server name for MCP | `vcon-mcp-server` |
| `LOG_LEVEL` | ❌ No | Logging level (debug/info/warn/error) | `info` |

---

## Verifying Your Installation

### Quick Verification Script

```bash
# Create a test script
cat > test-installation.sh <<'EOF'
#!/bin/bash

echo "=== vCon MCP Server Installation Check ==="
echo ""

# Check Node.js
echo "✓ Checking Node.js..."
node --version

# Check npm
echo "✓ Checking npm..."
npm --version

# Check if built
echo "✓ Checking build..."
if [ -f "dist/index.js" ]; then
  echo "  Build found: dist/index.js"
else
  echo "  ❌ Build not found. Run: npm run build"
fi

# Check .env
echo "✓ Checking environment..."
if [ -f ".env" ]; then
  echo "  .env file found"
else
  echo "  ❌ .env file missing. Run: cp .env.example .env"
fi

# Run tests
echo "✓ Running tests..."
npm test -- --run

echo ""
echo "=== Installation check complete ==="
EOF

chmod +x test-installation.sh
./test-installation.sh
```

### Manual Verification

```bash
# 1. Check Node.js version (18+)
node --version

# 2. Check npm version (9+)
npm --version

# 3. Check dependencies installed
npm list --depth=0

# 4. Check build exists
ls -la dist/index.js

# 5. Check environment file
cat .env

# 6. Run compliance tests
npm run test:compliance

# 7. Test server startup
node dist/index.js
# Press Ctrl+C to stop after seeing initialization messages
```

---

## Updating

To update to the latest version:

```bash
# Pull latest changes
git pull origin main

# Install any new dependencies
npm install

# Rebuild
npm run build

# Run migrations (if any)
npx supabase db push

# Test
npm test
```

---

## Uninstalling

To completely remove the vCon MCP Server:

```bash
# 1. Remove Claude Desktop configuration
# Edit ~/Library/Application Support/Claude/claude_desktop_config.json
# Remove the "vcon" entry from mcpServers

# 2. Remove project directory
cd ..
rm -rf vcon-mcp

# 3. (Optional) Remove database in Supabase
# Go to Supabase Dashboard → Settings → General → Delete Project
```

---

## Next Steps

Once installation is complete:

1. **[Basic Usage Guide](./basic-usage.md)** - Learn to use the server
2. **[Search Guide](./search.md)** - Master search capabilities
3. **[Tag Management](./tags.md)** - Organize your vCons
4. **[API Reference](../api/)** - Detailed tool documentation

---

## Getting Help

If you encounter issues:

1. **Check** [Troubleshooting](#troubleshooting) section above
2. **Search** [GitHub Issues](https://github.com/vcon-dev/vcon-mcp/issues)
3. **Ask** in [GitHub Discussions](https://github.com/vcon-dev/vcon-mcp/discussions)
4. **Report** bugs with detailed error messages

---

**Installation successful?** Continue to [Basic Usage](./basic-usage.md) →

