# vCon MCP Server - Quick Start

## 🎉 Server is Running!

Your MCP server is now running in development mode with **4,443 production vCons** loaded.

## 📊 Current Status

- **Server**: Running on stdio (background process)
- **Database**: Local Supabase at http://127.0.0.1:54321
- **vCons**: 4,443 conversations loaded
- **Parties**: 8,914 participants
- **Dialogs**: 4,346 conversation segments
- **Analysis**: 11,520 AI/ML analysis records

## 🔧 Available MCP Tools

### 1. `search_vcons` - Search for conversations
```typescript
// Example: Find Chevrolet-related conversations
{
  "subject": "Chevrolet",
  "limit": 10
}
```

### 2. `get_vcon` - Get a specific vCon by UUID
```typescript
{
  "uuid": "002c489d-3eec-4596-bc72-da4eb3b05caa"
}
```

### 3. `create_vcon` - Create a new conversation
```typescript
{
  "subject": "Customer Support Call",
  "parties": [
    {
      "name": "Agent",
      "mailto": "agent@example.com"
    },
    {
      "name": "Customer",
      "tel": "+1-555-0100"
    }
  ]
}
```

### 4. `add_dialog` - Add conversation segment
```typescript
{
  "vcon_uuid": "002c489d-3eec-4596-bc72-da4eb3b05caa",
  "dialog": {
    "type": "text",
    "start": "2025-01-01T12:00:00Z",
    "parties": [0, 1],
    "body": "Hello, how can I help you?",
    "encoding": "none"
  }
}
```

### 5. `add_analysis` - Add AI analysis
```typescript
{
  "vcon_uuid": "002c489d-3eec-4596-bc72-da4eb3b05caa",
  "analysis": {
    "type": "sentiment",
    "vendor": "OpenAI",
    "product": "GPT-4",
    "schema": "v1.0",
    "body": "{\"sentiment\": \"positive\", \"score\": 0.85}",
    "encoding": "json"
  }
}
```

### 6. `add_attachment` - Attach files
```typescript
{
  "vcon_uuid": "002c489d-3eec-4596-bc72-da4eb3b05caa",
  "attachment": {
    "type": "application/pdf",
    "body": "base64-encoded-content",
    "encoding": "base64url"
  }
}
```

### 7. `delete_vcon` - Delete a conversation
```typescript
{
  "uuid": "002c489d-3eec-4596-bc72-da4eb3b05caa"
}
```

## 🗄️ Database Access

### Direct PostgreSQL
```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

### Supabase Studio
Open http://127.0.0.1:54323 in your browser

## 🛠️ Management Commands

### Stop the Server
```bash
# Find the process
ps aux | grep "tsx watch" | grep -v grep

# Kill it
kill <PID>
```

### Restart the Server
```bash
cd /Users/thomashowe/Documents/GitHub/vcon-mcp
npm run dev
```

### Rebuild TypeScript
```bash
npm run build
```

### Run Tests
```bash
npm test
```

### Load More vCons
```bash
npx tsx scripts/load-legacy-vcons.ts /path/to/vcon/directory
```

## 📝 Sample Queries

### Search for specific vehicle conversations
```sql
SELECT uuid, subject, created_at 
FROM vcons 
WHERE subject ILIKE '%Chevrolet%' 
LIMIT 10;
```

### Find conversations with specific parties
```sql
SELECT v.uuid, v.subject, p.name, p.mailto
FROM vcons v
JOIN parties p ON p.vcon_id = v.id
WHERE p.name ILIKE '%customer%';
```

### Get analysis summary
```sql
SELECT type, vendor, COUNT(*) as count
FROM analysis
GROUP BY type, vendor
ORDER BY count DESC;
```

## 🔍 Example vCon Data

Your loaded vCons include automotive sales conversations with:
- **Subjects**: Vehicle reservations, inquiries, custom orders
- **Parties**: Sales agents, customers
- **Dialogs**: Text conversations, call recordings
- **Attachments**: Documents, images, PDFs

Sample vCon UUID: `002c489d-3eec-4596-bc72-da4eb3b05caa`
Subject: "Your Custom Vehicle Reservation at Burleson Nissan."

## 🚀 Next Steps

1. **Test with Claude Desktop**: Add the MCP server configuration
2. **Create custom queries**: Use the search_vcons tool to find specific conversations
3. **Add new conversations**: Use create_vcon to add test data
4. **Analyze conversations**: Use add_analysis to add AI insights
5. **Build integrations**: Connect external systems via MCP tools

## 📚 Documentation

- Full documentation: `/Users/thomashowe/Documents/GitHub/vcon-mcp/README.md`
- Getting started: `/Users/thomashowe/Documents/GitHub/vcon-mcp/GETTING_STARTED.md`
- Build guide: `/Users/thomashowe/Documents/GitHub/vcon-mcp/BUILD_GUIDE.md`

## ⚙️ Environment Variables

Current configuration in `.env`:
```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<local-key>
```

## 🐛 Troubleshooting

### Server won't start
```bash
# Check if port is in use
lsof -i :54321

# Restart Supabase
supabase stop
supabase start
```

### Database connection errors
```bash
# Check Supabase status
supabase status

# View logs
supabase logs
```

### vCon loading issues
```bash
# Check validation errors
npx tsx scripts/load-legacy-vcons.ts /path/to/vcons 2>&1 | grep Error
```

---

**Ready to use!** 🎉

The MCP server is running and ready to accept requests via stdio protocol.



