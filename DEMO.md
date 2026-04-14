# vCon MCP Demo Guide

How to load customer conversations and query them with Claude Desktop.

---

## 1. Import Sample Conversations

Run the import script to load the sample conversations from `hackathon/sample-data/` into Supabase:

```bash
npx tsx scripts/import-demo-conversations.ts
```

To import your own folder of conversations:
```bash
npx tsx scripts/import-demo-conversations.ts /path/to/your/conversations/
```

**Supported formats:**
- Plain-text call transcripts (`Agent Name: ...` / `Customer Name: ...` lines)
- WhatsApp chat exports (`M/D/YY, H:MM AM - Name: message` format)
- Teams JSON exports (with `_simulated.transcript` field)

---

## 2. Configure Claude Desktop

The MCP server is already configured in `~/Library/Application Support/Claude/claude_desktop_config.json`.

**Restart Claude Desktop** after any config change. You should see a hammer icon (🔨) in the chat input indicating MCP tools are available.

If the server isn't connecting, test it from the terminal first:
```bash
node dist/index.js
# Should output: vCon MCP Server running on stdio
```

---

## 3. Demo Prompts

Paste these into Claude Desktop to demonstrate the full capability of the vCon MCP server.

### Explore what's in the database
```
How many conversations are in the vCon database? Give me a breakdown by department and channel.
```

```
List the most recent 5 conversations with their subjects and tags.
```

### Search by topic
```
Find all conversations related to billing or charges. Summarize the issues customers were having.
```

```
Search for conversations where a customer was frustrated or escalated their issue.
```

### Semantic search (requires OpenAI key)
```
Find conversations where customers had login or account access problems.
```

```
Search semantically for conversations about VPN or remote work issues.
```

### Tag-based filtering
```
Show me all high-priority conversations. What did they have in common?
```

```
Find all WhatsApp conversations and summarize the customer sentiment in each.
```

### Add AI analysis to a conversation
```
Get the billing complaint conversation. Analyze the customer sentiment, identify the root cause of the issue, and add that analysis to the vCon record.
```

### Cross-conversation insights
```
Look at all the support conversations in the database. What are the top 3 recurring customer pain points? Which conversations are related to the same underlying issue?
```

### Create a new vCon on the fly
```
Create a vCon for this conversation:
  Customer: Alex Kim, alex.kim@example.com
  Agent: Support Rep Jordan
  
  Alex: I can't export my data to CSV, the button is grayed out.
  Jordan: That feature requires the Business plan. I can upgrade you or export it manually.
  Alex: Please export it manually for now, I'll consider the upgrade.
  Jordan: Done, I've emailed you the CSV. Here's info on the Business plan upgrade.

Tag it with department:technical-support and priority:medium.
```

### Database health check
```
Check the database stats and tell me if there are any performance concerns or missing indexes.
```

---

## 4. What the MCP Server Can Do

| Capability | Example prompt |
|---|---|
| Search by metadata | "Find all billing calls from March" |
| Full-text search | "Find conversations mentioning 'refund'" |
| Semantic search | "Find calls about frustrated customers" |
| Tag management | "Tag the VPN call as priority:high" |
| Add AI analysis | "Summarize this call and save it as analysis" |
| Create vCons | "Create a vCon for this transcript I'll paste" |
| Analytics | "What's the most common issue type?" |
| Database inspection | "How many vCons have embeddings?" |

---

## 5. Troubleshooting

**"No tools available" in Claude Desktop**
- Rebuild: `npm run build` (fix pre-existing TS errors first or use the existing dist)
- Check logs: `~/Library/Logs/Claude/mcp-server-vcon.log`

**Import script fails with auth error**
- Check `.env` has valid `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

**Semantic search returns nothing**
- OpenAI key required in `.env` as `OPENAI_API_KEY`
- Run embeddings sync: `npm run sync:embeddings`
