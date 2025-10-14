# vCon MCP Prompts Guide

## Overview

Prompts are pre-built query templates that help you effectively search and retrieve vCons using the MCP server's search tools. They guide you on:

- **Exact match searches** using tags
- **Keyword searches** for specific phrases
- **Semantic searches** for natural language queries
- **Complex multi-criteria searches** combining multiple filters
- **Best practices** for different query scenarios

## Available Prompts

### 1. Find by Exact Tags

**Prompt:** `find_by_exact_tags`

**Use when:** You need precise category matching with specific tag values.

**Example queries:**
- "Find all customers from June that were tagged as 'angry'"
- "Show me high-priority sales calls"
- "List all support tickets marked as urgent"

**Arguments:**
- `tag_criteria` (required): Natural language description of tags to match
- `date_range` (optional): Date range description

**What it teaches:**
- How to parse natural language into specific tag key-value pairs
- Converting date descriptions to ISO 8601 format
- Using the `search_by_tags` tool effectively
- When to use `get_unique_tags` to discover available tags

---

### 2. Find by Semantic Search

**Prompt:** `find_by_semantic_search`

**Use when:** You want to find conversations by meaning, not just exact words.

**Example queries:**
- "Find all the angry customers from June"
- "Show me conversations about billing problems"
- "Locate positive customer feedback"

**Arguments:**
- `search_description` (required): Natural language description of what you're looking for
- `date_range` (optional): Date range description

**What it teaches:**
- How semantic search finds meaning beyond keywords
- Understanding similarity thresholds (0.6-0.8)
- Using the `search_vcons_semantic` tool
- When embeddings are required vs. keyword search

---

### 3. Find by Keywords

**Prompt:** `find_by_keywords`

**Use when:** You need to find specific words or phrases in conversation content.

**Example queries:**
- "Find conversations mentioning 'refund'"
- "Search for 'technical support' in dialogs"
- "Locate invoice #12345 discussions"

**Arguments:**
- `keywords` (required): Specific keywords or phrases to search
- `filters` (optional): Additional filters like dates, tags, parties

**What it teaches:**
- Full-text search capabilities
- What content is searchable (dialog, analysis, subject, parties)
- Using the `search_vcons_content` tool
- Interpreting relevance scores and snippets

---

### 4. Find Recent by Topic

**Prompt:** `find_recent_by_topic`

**Use when:** You need recent conversations filtered by topic or category.

**Example queries:**
- "Show me recent support calls"
- "Find this week's sales conversations"
- "List today's billing inquiries"

**Arguments:**
- `topic` (required): Topic or category to search
- `timeframe` (optional): Recency timeframe (default: last 30 days)

**What it teaches:**
- Converting relative time phrases to date ranges
- Choosing between tag-based and semantic search
- Combining date filters with topic searches
- Sorting and presenting time-sensitive results

---

### 5. Find by Customer/Party

**Prompt:** `find_by_customer`

**Use when:** You need all conversations involving a specific person.

**Example queries:**
- "Find all conversations with john@example.com"
- "Show me calls from 555-1234"
- "List all interactions with Jane Smith"

**Arguments:**
- `party_identifier` (required): Name, email, or phone number
- `date_range` (optional): Date range to filter results

**What it teaches:**
- Identifying party type (email vs. phone vs. name)
- Using the appropriate party filter
- Using the `search_vcons` tool with party parameters
- Understanding case-insensitive and partial matching

---

### 6. Discover Available Tags

**Prompt:** `discover_available_tags`

**Use when:** You want to explore what tags exist in your system.

**Example queries:**
- "What tags are available for filtering?"
- "Show me all department tags"
- "List available priority levels"

**Arguments:**
- `tag_category` (optional): Focus on specific tag category

**What it teaches:**
- Using the `get_unique_tags` tool
- Understanding tag structure (key-value pairs)
- Viewing tag usage counts
- Building effective tag-based queries

---

### 7. Complex Multi-Criteria Search

**Prompt:** `complex_search`

**Use when:** You need to combine multiple search criteria.

**Example queries:**
- "Find high-priority sales calls from Q1 where customer mentioned pricing"
- "Show angry customers from the support department this month"
- "List urgent billing issues from last week"

**Arguments:**
- `search_criteria` (required): Complete search description with all criteria

**What it teaches:**
- Breaking down complex queries into components
- Choosing the right search strategy for mixed criteria
- Combining tags, keywords, dates, and semantic search
- Using the `search_vcons_hybrid` tool effectively

---

### 8. Find Similar Conversations

**Prompt:** `find_similar_conversations`

**Use when:** You want to find conversations similar to a specific one.

**Example queries:**
- "Find conversations similar to UUID abc-123-def"
- "Show me calls like this customer complaint"
- "Locate similar support tickets"

**Arguments:**
- `reference` (required): vCon UUID or topic description
- `limit` (optional): Number of similar conversations (default: 10)

**What it teaches:**
- Using vCon embeddings for similarity
- Adjusting similarity thresholds
- Understanding semantic similarity scores
- When to use UUID vs. description

---

### 9. Help Me Search

**Prompt:** `help_me_search`

**Use when:** You're unsure which search approach to use.

**Example queries:**
- "How do I find billing disputes?"
- "What's the best way to search for recent angry customers?"
- "Should I use tags or keywords for this search?"

**Arguments:**
- `what_you_want` (required): Description of what you're trying to find

**What it teaches:**
- Decision tree for choosing search tools
- Understanding exact match vs. keyword vs. semantic search
- Query optimization strategies
- Common pitfalls to avoid

---

## How to Use Prompts

### In Claude Desktop or Compatible MCP Clients

1. **List available prompts:**
   The client will automatically discover prompts from the server.

2. **Select a prompt:**
   Choose the prompt that matches your use case.

3. **Fill in arguments:**
   Provide the required information (e.g., search criteria, date range).

4. **Execute:**
   The prompt will guide you with a detailed strategy and example tool calls.

### Example Workflow

**User Goal:** Find angry customers from June

1. **Choose Prompt:** `find_by_exact_tags` (if you have sentiment tags) or `find_by_semantic_search` (for natural language)

2. **Provide Arguments:**
   - `tag_criteria`: "angry customers"
   - `date_range`: "from June"

3. **Follow Guidance:** The prompt will show:
   - How to parse "angry" into `{sentiment: "angry"}`
   - How to convert "June" to ISO 8601 dates
   - Which tool to call (`search_by_tags`)
   - Example JSON for the tool call

4. **Execute Tool:** Use the suggested tool with parameters

5. **Review Results:** Get matching vCons with UUIDs and details

---

## Search Strategy Decision Tree

Use this flowchart to choose the right prompt:

```
Do you know the exact tag value?
├─ YES → Use "find_by_exact_tags"
└─ NO
   ├─ Do you need specific words/phrases?
   │  └─ YES → Use "find_by_keywords"
   └─ NO
      ├─ Are you searching by meaning/concept?
      │  └─ YES → Use "find_by_semantic_search"
      └─ NO
         ├─ Is this a person/party search?
         │  └─ YES → Use "find_by_customer"
         └─ NO
            ├─ Multiple criteria?
            │  └─ YES → Use "complex_search"
            └─ UNSURE → Use "help_me_search"
```

---

## Prompt Benefits

### 1. Educational

Prompts teach you:
- How the search tools work
- Best practices for each scenario
- Parameter optimization
- Error handling and fallbacks

### 2. Efficient

Prompts provide:
- Pre-structured queries
- Example JSON for tool calls
- Step-by-step guidance
- Time-saving templates

### 3. Comprehensive

Prompts cover:
- All search tool variations
- Date parsing and formatting
- Tag discovery and usage
- Multi-criteria combining

---

## Search Tool Reference

Here's a quick reference of the tools prompts will guide you to use:

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `search_vcons` | Basic metadata search | party_name, party_email, subject, dates |
| `search_vcons_content` | Keyword search | query, tags, dates |
| `search_vcons_semantic` | Semantic/meaning search | query, threshold, tags |
| `search_vcons_hybrid` | Combined approach | query, semantic_weight, tags |
| `search_by_tags` | Exact tag matching | tags (object), limit |
| `get_unique_tags` | Discover available tags | include_counts, key_filter |
| `get_vcon` | Retrieve specific vCon | uuid |

---

## Common Use Cases

### Customer Service
- **Find escalated issues:** `find_by_exact_tags` with priority tags
- **Search complaints:** `find_by_semantic_search` for "complaints" or "issues"
- **Track customer history:** `find_by_customer` with email/phone

### Sales
- **High-value opportunities:** `find_by_exact_tags` with priority + department
- **Pricing discussions:** `find_by_keywords` searching for "pricing" or "quote"
- **Recent qualified leads:** `find_recent_by_topic` with "sales" topic

### Analytics
- **Sentiment analysis:** `find_by_exact_tags` or `find_by_semantic_search` for sentiment
- **Topic clustering:** `find_similar_conversations` to group related calls
- **Trend discovery:** `find_recent_by_topic` with time ranges

### Compliance
- **Audit trails:** `find_by_customer` for specific party interactions
- **Keyword monitoring:** `find_by_keywords` for compliance terms
- **Tag validation:** `discover_available_tags` to review taxonomy

---

## Tips and Best Practices

### Start Broad, Then Narrow
1. Begin with `discover_available_tags` to see what's possible
2. Use `help_me_search` to understand the best approach
3. Execute the recommended search
4. Refine with additional filters if needed

### Use Date Filters Effectively
- **Relative:** "last week", "this month", "Q1"
- **Absolute:** "June 2024", "2024-01-01 to 2024-03-31"
- **Recent:** Defaults to last 30 days in most prompts

### Tag Strategy
- Use `get_unique_tags` first to discover what tags exist
- Tag searches are EXACT - "angry" won't match "frustrated"
- Combine tags with AND logic (all must match)
- Consider semantic search for fuzzy matching

### Semantic Search Considerations
- Requires pre-generated embeddings
- Works across synonyms and paraphrases
- Adjust threshold based on precision needs:
  - 0.6-0.7: Broader results
  - 0.7-0.8: Balanced
  - 0.8-0.9: Very similar only

### Performance Optimization
- Always use date filters for "recent" queries
- Limit results to what you need (10-50)
- Use tags to pre-filter before content search
- Start with exact matches, fall back to semantic

---

## Integration with Other Features

### With Resources
After finding vCons, access them via resources:
```
vcon://{uuid}
```

### With Tags
Use prompts to search, then use tag tools to organize:
- `manage_tag` - Add/update/remove tags
- `get_tags` - View existing tags
- `remove_all_tags` - Clear tags

### With Database Tools
Combine prompt-guided searches with:
- `get_database_stats` - Analyze search performance
- `analyze_query` - Optimize slow searches

---

## Troubleshooting

### "No results found"
1. Try `discover_available_tags` to verify tags exist
2. Broaden date range or remove filters
3. Use semantic search for fuzzy matching
4. Check if embeddings are generated (for semantic search)

### "Embedding generation not yet implemented"
1. Fall back to `search_vcons_content` for keywords
2. Or generate embeddings using provided scripts
3. Or use `search_vcons_hybrid` with low semantic weight

### Too many results
1. Add date range filters
2. Include more specific tags
3. Use more specific keywords
4. Increase semantic threshold

### Wrong results
1. Verify tag values with `get_unique_tags`
2. Check date format (should be ISO 8601)
3. Try different search strategy (exact vs. semantic)
4. Use `help_me_search` prompt for guidance

---

## Next Steps

- **Try the prompts:** Start with `help_me_search` to explore
- **Learn the tools:** Each prompt teaches specific tool usage
- **Optimize queries:** Use insights to build better searches
- **Discover your data:** Use `discover_available_tags` to understand your corpus

For more information:
- [SEARCH_TOOLS_GUIDE.md](./SEARCH_TOOLS_GUIDE.md) - Detailed search tool documentation
- [TAG_MANAGEMENT_GUIDE.md](./TAG_MANAGEMENT_GUIDE.md) - Tag system documentation
- [QUICK_START.md](../QUICK_START.md) - Getting started guide

