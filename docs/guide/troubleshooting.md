# Troubleshooting

Common issues and solutions for the vCon MCP Server.

## Installation Issues

### Error: "Cannot find module 'dotenv'"

**Symptom:**
```
Error: Cannot find module 'dotenv'
```

**Cause:** Dependencies not installed

**Solution:**
```bash
npm install
```

---

### Error: "ENOENT: no such file or directory, open 'dist/index.js'"

**Symptom:**
```
Error: ENOENT: no such file or directory, open '/path/to/vcon-mcp/dist/index.js'
```

**Cause:** Project not built

**Solution:**
```bash
npm run build
```

---

### Error: "Invalid Supabase URL"

**Symptom:**
```
Error: Invalid Supabase URL or API key
```

**Cause:** Missing or incorrect environment variables

**Solution:**

1. Check `.env` file exists:
   ```bash
   cat .env
   ```

2. Verify format (no quotes needed):
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=eyJ...
   ```

3. Get correct values from Supabase:
   - Dashboard → Settings → API
   - Copy Project URL and anon public key

---

## Database Issues

### Error: "relation 'vcons' does not exist"

**Symptom:**
```
Error: relation "vcons" does not exist
```

**Cause:** Database migrations not applied

**Solution:**

**Option A: Using Supabase CLI**
```bash
npx supabase db push
```

**Option B: Manual via Dashboard**
1. Go to Supabase SQL Editor
2. Run each migration from `supabase/migrations/` in order
3. Verify tables created:
   ```sql
   SELECT table_name FROM information_schema.tables 
   WHERE table_schema = 'public';
   ```

---

### Error: "permission denied for table vcons"

**Symptom:**
```
Error: permission denied for table vcons
```

**Cause:** RLS policies not configured or using wrong key

**Solution:**

1. Check you're using the correct key (anon key, not service role key for testing)
2. Verify RLS policies exist:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'vcons';
   ```
3. If missing, run RLS migration:
   ```bash
   # In Supabase SQL Editor
   -- Run: supabase/migrations/003_rls_policies.sql
   ```

---

### Database connection timeout

**Symptom:**
```
Error: Connection timeout
```

**Cause:** Network issues or invalid URL

**Solution:**

1. Test connection:
   ```bash
   curl "https://your-project.supabase.co/rest/v1/" \
     -H "apikey: your-anon-key"
   ```
   Should return 200 OK

2. Check Supabase project is active (not paused)
3. Verify URL format: `https://PROJECT_ID.supabase.co`

---

## Claude Desktop Issues

### Claude Desktop doesn't show vCon tools

**Symptom:**
Claude doesn't list vCon tools when asked "What tools do you have?"

**Checklist:**

1. ✅ **Built the project**
   ```bash
   npm run build
   ls -la dist/index.js  # Should exist
   ```

2. ✅ **Used absolute path in config**
   ```bash
   # Get absolute path
   cd /path/to/vcon-mcp && pwd
   # Use: /full/path/to/vcon-mcp/dist/index.js
   ```

3. ✅ **Restarted Claude Desktop completely**
   - Quit Claude Desktop (not just close window)
   - Reopen Claude Desktop
   - Start new conversation

4. ✅ **.env file in project root**
   ```bash
   ls -la /path/to/vcon-mcp/.env  # Should exist
   ```

5. ✅ **Valid Supabase credentials**
   ```bash
   cat .env  # Check values
   ```

**Debug Steps:**

1. Test server directly:
   ```bash
   node dist/index.js
   ```
   Should output MCP initialization messages
   Press Ctrl+C to stop

2. Check config syntax:
   ```bash
   # macOS
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```
   Verify valid JSON (no trailing commas, proper brackets)

3. Check logs:
   - Open Claude Desktop
   - Help → View Logs
   - Look for MCP server errors

---

### Error: "spawn node ENOENT"

**Symptom:**
```
Error: spawn node ENOENT
```

**Cause:** Node.js not in PATH for Claude Desktop

**Solution:**

**macOS:**
```json
{
  "mcpServers": {
    "vcon": {
      "command": "/usr/local/bin/node",  // Full path to node
      "args": ["/absolute/path/to/vcon-mcp/dist/index.js"]
    }
  }
}
```

Find node path:
```bash
which node
```

---

### Claude can't find vCons

**Symptom:**
```
No vCons found
```

**Cause:** Empty database

**Solution:**

Create test vCon:
```
Create a vCon with subject "Test" and party "Alice"
```

Verify in database:
```sql
SELECT uuid, subject FROM vcons;
```

---

## Runtime Errors

### Error: "vCon validation failed"

**Symptom:**
```
Error: vCon validation failed: [validation details]
```

**Cause:** Invalid vCon data structure

**Solution:**

1. Check error message for specific field
2. Verify required fields:
   - `vcon` version (e.g., "0.3.0")
   - `uuid` (valid UUID)
   - `created_at` (ISO 8601 timestamp)
   - At least one `party`

3. Use valid values:
   ```typescript
   {
     vcon: "0.3.0",
     uuid: "valid-uuid-here",
     created_at: "2025-01-15T10:00:00Z",
     parties: [{
       name: "Alice"
     }]
   }
   ```

---

### Error: "Analysis vendor required"

**Symptom:**
```
Error: Analysis must have vendor field
```

**Cause:** Missing required `vendor` field in analysis

**Solution:**

Always include `vendor` when adding analysis:
```
Add transcript analysis with vendor "OpenAI"
```

---

### Error: "Invalid UUID format"

**Symptom:**
```
Error: Invalid UUID format
```

**Cause:** Malformed UUID

**Solution:**

Use valid UUID v4 format:
```
abc12345-1234-1234-1234-123456789abc
```

Get UUID from vCon list:
```
Show me recent vCons
```

---

## Search Issues

### Semantic search not working

**Symptom:**
```
Error: Semantic search requires embeddings
```

**Cause:** Embeddings not configured or generated

**Solution:**

1. Enable pgvector extension:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

2. Run vector migrations:
   ```bash
   # In Supabase SQL Editor
   -- Run: supabase/migrations/005_vector_extension.sql
   -- Run: supabase/migrations/006_embeddings_table.sql
   ```

3. Add OpenAI API key:
   ```bash
   echo "OPENAI_API_KEY=sk-your-key" >> .env
   ```

4. Generate embeddings:
   ```bash
   npm run scripts/generate-embeddings-v2.ts
   ```

---

### Search returns no results

**Symptom:**
Search finds nothing when data exists

**Cause:** Various possibilities

**Solutions:**

1. **Check data exists:**
   ```
   Show me all vCons
   ```

2. **Try simpler search:**
   ```
   Find vCons from the last month
   ```

3. **Check search mode:**
   - Basic search: subject/party/dates only
   - Keyword search: full-text in dialog/analysis
   - Semantic search: requires embeddings

4. **Verify content is searchable:**
   - Dialog must have `encoding: "none"` for keyword search
   - Attachments not included in search

---

## Performance Issues

### Slow queries

**Symptom:**
Queries take >2 seconds

**Cause:** Missing indexes or large dataset

**Solution:**

1. Check indexes exist:
   ```sql
   SELECT * FROM pg_indexes WHERE tablename IN ('vcons', 'dialog', 'analysis');
   ```

2. Run index migration:
   ```bash
   # In Supabase SQL Editor
   -- Run: supabase/migrations/002_indexes.sql
   ```

3. Analyze tables:
   ```sql
   ANALYZE vcons;
   ANALYZE dialog;
   ANALYZE analysis;
   ```

4. Check database stats:
   ```
   Show me database performance stats
   ```

---

### Out of memory

**Symptom:**
```
Error: JavaScript heap out of memory
```

**Cause:** Large dataset operations

**Solution:**

1. Increase Node.js memory:
   ```bash
   node --max-old-space-size=4096 dist/index.js
   ```

2. Use pagination in searches:
   ```
   Find first 10 vCons from January
   ```

3. Use resources for simple reads:
   ```
   Read vcon://uuid/abc-123/metadata
   ```

---

## Testing Issues

### Tests fail with "database connection error"

**Symptom:**
```
Error: Database connection failed
```

**Cause:** Test environment not configured

**Solution:**

1. Create `.env.test` file:
   ```bash
   cp .env .env.test
   ```

2. Use test database (separate from production):
   ```env
   SUPABASE_URL=https://test-project.supabase.co
   SUPABASE_ANON_KEY=test-key
   ```

3. Run migrations on test database

4. Run tests:
   ```bash
   npm test
   ```

---

### Tests pass but code fails

**Symptom:**
Tests succeed but actual usage fails

**Cause:** Different environment (test vs production)

**Solution:**

1. Verify `.env` vs `.env.test` settings
2. Check both databases have same schema
3. Test with production credentials (carefully)
4. Add integration tests:
   ```bash
   npm run test:integration
   ```

---

## Plugin Issues

### Plugin not loading

**Symptom:**
```
Error: Could not load plugin: ./my-plugin.js
```

**Cause:** Plugin path or format incorrect

**Solution:**

1. Verify plugin path:
   ```bash
   ls -la ./my-plugin.js  # Should exist
   ```

2. Check plugin format:
   ```typescript
   export default class MyPlugin {
     name = 'my-plugin';
     version = '1.0.0';
     // ... implementation
   }
   ```

3. Check environment variable:
   ```bash
   echo $VCON_PLUGINS_PATH
   ```

4. Test plugin loading:
   ```bash
   node -e "require('./my-plugin.js')"
   ```

---

## Build Issues

### TypeScript compilation errors

**Symptom:**
```
Error: TypeScript compilation failed
```

**Solution:**

1. Check TypeScript version:
   ```bash
   npx tsc --version  # Should be 5.x
   ```

2. Clean and rebuild:
   ```bash
   rm -rf dist node_modules
   npm install
   npm run build
   ```

3. Fix type errors shown in output

---

### Missing dependencies

**Symptom:**
```
Error: Cannot find module '@modelcontextprotocol/sdk'
```

**Solution:**

```bash
npm install
```

If persists:
```bash
rm -rf node_modules package-lock.json
npm install
```

---

## Getting More Help

### Debug Mode

Enable detailed logging:

```bash
LOG_LEVEL=debug node dist/index.js
```

### Verbose Tests

```bash
npm test -- --reporter=verbose
```

### Check System Status

```bash
# Node.js
node --version

# npm
npm --version

# Dependencies
npm list --depth=0

# Build status
ls -la dist/

# Environment
cat .env
```

### Report Issues

If you can't resolve an issue:

1. **Search existing issues:**
   [GitHub Issues](https://github.com/vcon-dev/vcon-mcp/issues)

2. **Create new issue with:**
   - Error message (full text)
   - Steps to reproduce
   - Environment details (OS, Node.js version, etc.)
   - Relevant config (sanitized, no keys)

3. **Ask in discussions:**
   [GitHub Discussions](https://github.com/vcon-dev/vcon-mcp/discussions)

---

## Quick Fixes

### "It just doesn't work"

Try this sequence:

```bash
# 1. Clean everything
rm -rf node_modules dist

# 2. Reinstall
npm install

# 3. Rebuild
npm run build

# 4. Test
npm test

# 5. Verify env
cat .env

# 6. Test server
node dist/index.js
# Should see initialization messages
# Press Ctrl+C

# 7. Restart Claude Desktop
# Quit completely and reopen
```

### Reset to fresh state

```bash
# Backup first!
cp -r vcon-mcp vcon-mcp.backup

# Clean
git clean -fdx
git reset --hard

# Reinstall
npm install
npm run build

# Reconfigure
cp .env.example .env
# Edit .env with your credentials
```

---

**Still stuck?** [Ask for help](https://github.com/vcon-dev/vcon-mcp/discussions) →

**Found a bug?** [Report it](https://github.com/vcon-dev/vcon-mcp/issues) →

