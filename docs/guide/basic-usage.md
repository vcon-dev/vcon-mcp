# Basic Usage Guide

Learn how to use the vCon MCP Server with AI assistants and common workflows.

## Prerequisites

Before starting, ensure you have:

- ✅ Completed [Installation](./installation.md)
- ✅ Configured Claude Desktop or another MCP client
- ✅ Database migrations applied
- ✅ Valid Supabase credentials in `.env`

---

## Quick Start

### Your First vCon

Let's create your first vCon using Claude Desktop:

**1. Ask Claude:**

```
Create a vCon for a customer support call between Alice (agent) 
and Bob (customer) discussing a refund request.
```

**Claude will:**
- Use the `create_vcon` tool
- Create parties for Alice and Bob
- Set subject to describe the call
- Return the vCon UUID

**2. View the vCon:**

```
Show me the vCon you just created
```

**3. Add a transcript:**

```
Add a text dialog to this vCon:
Bob: "Hi, I'd like to request a refund for order #12345"
Alice: "I'd be happy to help you with that refund request."
```

**4. Add analysis:**

```
Add sentiment analysis showing positive sentiment (0.8 score) 
from "SentimentAI" vendor
```

Congratulations! You've created a complete vCon with dialog and analysis.

---

## Core Operations

### Creating vCons

#### Basic Creation

```
Create a vCon with subject "Team Meeting" and party "John Doe" 
with email john@example.com
```

#### Using Templates

```
Create a phone_call vCon between two people discussing product pricing
```

Available templates:
- `phone_call` - Two-party phone conversation
- `chat_conversation` - Multi-party text chat
- `email_thread` - Email conversation
- `video_meeting` - Video conference call
- `custom` - Start from scratch

#### With Multiple Parties

```
Create a vCon for a sales call with:
- Sales rep: Alice (alice@company.com)
- Customer: Bob (bob@customer.com)
- Manager: Carol (carol@company.com)
Subject: "Q4 Contract Negotiation"
```

---

### Reading vCons

#### Get by UUID

```
Get the vCon with UUID abc-123-def-456
```

#### Get Recent vCons

```
Show me the 10 most recent vCons
```

Or use the `vcon://recent` resource:

```
Read the vcon://recent resource
```

#### Get Specific Fields

```
Show me just the parties from vCon abc-123
```

Use resources:
- `vcon://uuid/{uuid}/parties` - Just parties
- `vcon://uuid/{uuid}/dialog` - Just dialog
- `vcon://uuid/{uuid}/analysis` - Just analysis
- `vcon://uuid/{uuid}/metadata` - Just metadata

---

### Searching vCons

#### Basic Search (Filtering)

Search by subject, party name, or date:

```
Find vCons from last week about billing
```

```
Find vCons where John Smith was a participant
```

```
Search for vCons created between Jan 1 and Jan 31 with subject "support"
```

#### Keyword Search

Full-text search across dialog and analysis:

```
Search for conversations mentioning "refund" or "return"
```

```
Find vCons where someone said "technical issue"
```

#### Semantic Search

AI-powered search by meaning (requires embeddings):

```
Find conversations where customers were frustrated with delivery
```

```
Search for discussions about product features
```

#### Hybrid Search

Combines keyword and semantic for best results:

```
Search for billing disputes using both exact matches and similar concepts
```

---

### Adding Content

#### Add Dialog

Add conversation segments:

```
Add a recording dialog to vCon abc-123:
- Type: recording
- Start time: 2025-01-15T10:00:00Z
- Duration: 300 seconds
- URL: https://storage.example.com/call123.mp3
```

```
Add a text message:
"Hi, thanks for calling support!"
From party 0 at 10:00 AM
```

#### Add Analysis

Add AI/ML analysis results:

```
Add transcript analysis to vCon abc-123:
- Type: transcript
- Vendor: OpenAI
- Product: Whisper-1
- Body: "Full transcript text here..."
- Dialog: 0 (references first dialog)
```

```
Add sentiment analysis showing negative sentiment (-0.6)
from vendor "SentimentAnalyzer"
```

#### Add Attachments

Attach related files:

```
Add an attachment to vCon abc-123:
- Type: application/pdf
- Party: 1
- Body: base64-encoded PDF content
```

---

### Updating vCons

Update top-level vCon metadata:

```
Update vCon abc-123 with subject "Updated Subject Line"
```

```
Add a "priority" extension with value "high" to vCon abc-123
```

**Note:** To modify parties, dialog, or analysis, add new items. The vCon spec favors immutability.

---

### Tagging & Organization

#### Add Tags

```
Tag vCon abc-123 as:
- department: support
- priority: high
- customer_id: CUST-789
```

#### Search by Tags

```
Find all vCons tagged as department:sales and priority:high
```

```
Show me high priority support tickets from this week
```

#### View All Tags

```
Show me all unique tags in the database
```

#### Remove Tags

```
Remove the priority tag from vCon abc-123
```

See [Tag Management Guide](./tags.md) for complete tag documentation.

---

### Deleting vCons

```
Delete vCon abc-123
```

**Warning:** This permanently deletes the vCon and all related data (parties, dialog, analysis, attachments). This action cannot be undone.

---

## Common Workflows

### Workflow 1: Customer Support Call

**Step 1: Create vCon**

```
Create a support call vCon between agent Sarah and customer Mike
about a billing issue
```

**Step 2: Add Recording**

```
Add a recording dialog:
- URL: https://recordings.example.com/call-456.mp3
- Duration: 420 seconds
- Start time: now
```

**Step 3: Add Transcript**

```
Add transcript analysis from OpenAI Whisper showing the conversation...
```

**Step 4: Add Sentiment**

```
Add sentiment analysis showing the customer was initially frustrated (-0.4)
but ended satisfied (0.7)
```

**Step 5: Tag for Organization**

```
Tag this vCon:
- department: support
- issue_type: billing
- resolution: resolved
- customer_satisfaction: high
```

**Step 6: Search Later**

```
Find all resolved billing issues from this month where
customer satisfaction was high
```

---

### Workflow 2: Sales Call Analysis

**Step 1: Create from Template**

```
Create a phone_call vCon for a sales discovery call with
prospect Jane at Acme Corp
```

**Step 2: Add Transcript**

```
Add the call transcript as analysis...
```

**Step 3: Extract Action Items**

```
Add analysis of type "action_items" with extracted next steps
```

**Step 4: Generate Summary**

```
Add a summary analysis highlighting key discussion points
and customer pain points
```

**Step 5: Tag**

```
Tag as:
- sales_stage: discovery
- industry: enterprise_software
- deal_size: 50k
- next_action: demo_scheduled
```

---

### Workflow 3: Research Dataset

**Step 1: Batch Create vCons**

```
Create 5 vCons for research interviews about user experience
```

**Step 2: Add Interview Transcripts**

```
For each vCon, add the transcript as a text dialog
```

**Step 3: Add Analysis**

```
Add theme analysis identifying common patterns
```

**Step 4: Search Across Dataset**

```
Search all research vCons for mentions of "usability issues"
```

**Step 5: Export Findings**

```
Get all vCons tagged as research:ux_study and show
their analysis results
```

---

## Using with Claude Desktop

### Example Conversations

#### Natural Language Commands

Claude understands natural language - you don't need precise syntax:

```
❌ create_vcon(subject="test", parties=[...])

✅ Create a vCon for a team meeting
✅ Make a new vCon about product development
✅ Set up a vCon for yesterday's client call
```

#### Complex Queries

```
Find all customer support vCons from last quarter where
the sentiment was negative and the issue was about billing,
then show me the most common complaints
```

Claude will:
1. Search vCons by date range
2. Filter for support + billing tags
3. Filter for negative sentiment
4. Analyze common themes
5. Present findings

#### Multi-Step Operations

```
Create a vCon for a sales call, add the transcript from
the file I shared, analyze the sentiment, extract action items,
and tag it appropriately
```

Claude can chain multiple tool calls automatically.

---

## Tips & Best Practices

### Creating vCons

✅ **DO:**
- Use descriptive subjects
- Add all parties involved
- Include timestamps when known
- Use templates for common scenarios

❌ **DON'T:**
- Create duplicate vCons
- Leave subject empty unless truly unknown
- Forget to specify party roles

### Adding Content

✅ **DO:**
- Reference dialog indexes in analysis
- Include vendor info for all analysis
- Use appropriate encoding (none/json/base64url)
- Add timestamps to dialog

❌ **DON'T:**
- Store large files directly (use URLs instead)
- Mix encoding types inconsistently
- Forget to specify analysis type

### Searching

✅ **DO:**
- Use semantic search for conceptual queries
- Use keyword search for exact terms
- Use hybrid search when uncertain
- Add tags for better organization

❌ **DON'T:**
- Search by vCon content without indexes
- Expect instant results with semantic search (requires embeddings)
- Over-complicate search queries

### Tagging

✅ **DO:**
- Use consistent tag naming (e.g., `department:sales`)
- Tag early and often
- Use hierarchical tags (e.g., `issue:billing:refund`)
- Document your tag schema

❌ **DON'T:**
- Create one-off tag names
- Use spaces in tag keys
- Forget to remove outdated tags

---

## Understanding Resources

Resources provide read-only access to vCon data:

### List Resources

```
What vCon resources are available?
```

### Common Resources

| Resource | Purpose | Example |
|----------|---------|---------|
| `vcon://recent` | 10 most recent vCons | Full vCon objects |
| `vcon://recent/25` | Recent with custom limit | Max 100 |
| `vcon://uuid/{uuid}` | Specific vCon | Complete vCon |
| `vcon://uuid/{uuid}/metadata` | Just metadata | Without dialog/analysis |
| `vcon://uuid/{uuid}/parties` | Just parties | Array of parties |
| `vcon://uuid/{uuid}/dialog` | All dialog | Array of dialog objects |
| `vcon://uuid/{uuid}/analysis` | All analysis | Array of analysis objects |

### Using Resources

```
Read vcon://recent
```

```
Read vcon://uuid/abc-123-def/parties
```

Resources are faster than tools for simple reads.

---

## Understanding Prompts

Prompts guide Claude in using the right search strategy:

### Available Prompts

1. **find_by_exact_tags** - Precise tag matches
2. **find_by_semantic_search** - Meaning-based search
3. **find_by_keywords** - Text search
4. **find_recent_by_topic** - Recent vCons on topic
5. **find_by_customer** - Customer-specific vCons
6. **discover_available_tags** - Explore tag schema
7. **complex_search** - Multi-criteria queries
8. **find_similar_conversations** - Similar to example
9. **help_me_search** - Search strategy help

### Using Prompts

Claude automatically selects the right prompt, but you can request:

```
Use exact tag matching to find high-priority sales calls
```

```
Help me search for what I'm looking for
```

See [Prompts Guide](./prompts.md) for detailed documentation.

---

## Error Handling

### Common Errors

#### "vCon not found"

```
❌ Get vCon abc-123
   Error: vCon with UUID abc-123 not found
```

**Solution:** Check the UUID is correct:

```
✅ Show me recent vCons to find the correct UUID
```

#### "Invalid vCon data"

```
❌ Create vCon without parties
   Error: vCon must have at least one party
```

**Solution:** Include required fields:

```
✅ Create vCon with subject "Meeting" and party "Alice"
```

#### "Search returned no results"

```
❌ Find vCons about "xyz" from 2020
   No results found
```

**Solution:** Broaden search criteria:

```
✅ Show me all vCons from 2020 first
```

---

## Performance Tips

### For Large Datasets

1. **Use tags** for filtering before search
2. **Use date ranges** to limit scope
3. **Use resources** for simple reads
4. **Index dialog content** for keyword search
5. **Generate embeddings** for semantic search

### For Fast Queries

1. **Query by UUID** when known (fastest)
2. **Use resources** instead of tools for reads
3. **Limit results** to what you need
4. **Cache frequently accessed vCons**

---

## Database Tools

The server includes database inspection tools:

### View Database Structure

```
Show me the database structure
```

Uses `get_database_shape` tool.

### View Performance Stats

```
What are the database performance stats?
```

Uses `get_database_stats` tool.

### Analyze Query Performance

```
Analyze this query: SELECT * FROM vcons WHERE subject LIKE '%test%'
```

Uses `analyze_query` tool.

See [Database Tools Guide](./database-tools.md) for details.

---

## Next Steps

### Learn More

- **[Search Guide](./search.md)** - Master all search capabilities
- **[Tag Management](./tags.md)** - Organize with tags
- **[Prompts Guide](./prompts.md)** - Understand prompts
- **[API Reference](../api/)** - Complete tool documentation

### Advanced Usage

- **[Plugin Development](../development/plugins.md)** - Extend functionality
- **[Custom Tools](../development/custom-tools.md)** - Add your own tools
- **[Embeddings & Search](../development/embeddings.md)** - Set up semantic search

### Examples

- **[Code Examples](../examples/)** - Real-world examples
- **[Integration Patterns](../examples/)** - Integration guides

---

## Getting Help

### Quick Help in Claude

```
How do I create a vCon?
```

```
What search tools are available?
```

```
Help me search for frustrated customers
```

### Documentation

- **[Installation Guide](./installation.md)** - Setup troubleshooting
- **[API Reference](../api/)** - Tool parameters
- **[Reference Docs](../reference/)** - Technical specifications

### Community

- **GitHub Issues** - Bug reports
- **GitHub Discussions** - Questions and ideas
- **Discord** - Real-time chat (coming soon)

---

## Quick Reference

### Most Common Commands

| Task | Example |
|------|---------|
| Create vCon | `Create a vCon for a support call` |
| Get vCon | `Show me vCon abc-123` |
| Search | `Find vCons about billing from last week` |
| Add dialog | `Add a text dialog saying "Hello"` |
| Add analysis | `Add sentiment analysis from OpenAI` |
| Tag | `Tag this vCon as priority:high` |
| Delete | `Delete vCon abc-123` |

### Key Concepts

- **vCon** - Container for conversation data
- **Party** - Participant in conversation
- **Dialog** - Conversation segment (recording, text, etc.)
- **Analysis** - AI/ML results (transcript, sentiment, etc.)
- **Attachment** - Related files
- **Tags** - Metadata for organization
- **Resources** - Read-only data access
- **Prompts** - Search strategy guidance

---

**Ready to dive deeper?** Continue to [Search Guide](./search.md) →

