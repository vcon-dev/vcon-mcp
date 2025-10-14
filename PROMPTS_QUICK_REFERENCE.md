# vCon MCP Prompts - Quick Reference

## What Are Prompts?

Prompts are **query templates** that teach you how to effectively search and retrieve vCons. They provide step-by-step guidance for different search scenarios.

## Quick Selection Guide

| I want to... | Use this prompt | Example |
|--------------|----------------|---------|
| Find by exact tag value | `find_by_exact_tags` | "angry customers from June" |
| Find by meaning/concept | `find_by_semantic_search` | "frustrated users" finds "angry", "upset" |
| Find specific words | `find_by_keywords` | "refund" or "billing issue" |
| Find recent conversations | `find_recent_by_topic` | "today's support calls" |
| Find by person | `find_by_customer` | "all calls with john@example.com" |
| Explore available tags | `discover_available_tags` | "what tags exist?" |
| Complex multi-filter | `complex_search` | "high-priority sales from Q1 mentioning pricing" |
| Find similar vCons | `find_similar_conversations` | "like this complaint" |
| Get search advice | `help_me_search` | "how should I search for X?" |

## Decision Tree

```
START HERE: What type of search?

┌─ Exact category/tag match? → find_by_exact_tags
│  Example: "high priority sales calls"
│
┌─ Specific words/phrases? → find_by_keywords
│  Example: "refund request" "invoice #12345"
│
┌─ Meaning/concept? → find_by_semantic_search
│  Example: "angry customers" finds frustrated, upset, complaining
│
┌─ Specific person? → find_by_customer
│  Example: "john@example.com" or "Jane Smith"
│
┌─ Recent + topic? → find_recent_by_topic
│  Example: "this week's support calls"
│
┌─ Multiple criteria? → complex_search
│  Example: tags + dates + keywords combined
│
└─ Not sure? → help_me_search
   Get personalized guidance
```

## Search Tool Comparison

| Search Type | Finds | Best For | Tool Used |
|-------------|-------|----------|-----------|
| **Exact Tag** | Precise matches | Known categories | `search_by_tags` |
| **Keyword** | Specific words | Exact phrases | `search_vcons_content` |
| **Semantic** | Similar meaning | Natural language | `search_vcons_semantic` |
| **Hybrid** | Keywords + meaning | Comprehensive | `search_vcons_hybrid` |
| **Party** | By participant | Customer history | `search_vcons` |

## Common Patterns

### Pattern 1: "Find [sentiment] [role] from [time]"
**Example:** "Find angry customers from June"

**Choose:**
- Exact tags exist? → `find_by_exact_tags`
- No tags? → `find_by_semantic_search`

### Pattern 2: "Find conversations mentioning [term]"
**Example:** "Find conversations mentioning refund"

**Choose:** `find_by_keywords`

### Pattern 3: "Find recent [topic] [calls/conversations]"
**Example:** "Find recent support calls"

**Choose:** `find_recent_by_topic`

### Pattern 4: "Find all [person] conversations"
**Example:** "Find all john@example.com conversations"

**Choose:** `find_by_customer`

### Pattern 5: "Find [priority] [department] [timeframe] about [topic]"
**Example:** "Find high-priority sales calls from Q1 about pricing"

**Choose:** `complex_search`

## Parameter Quick Reference

### Date Formats
Prompts parse natural language:
- "June" → June 1-30 of current year
- "last week" → Previous 7 days
- "Q1" → Jan 1 - Mar 31
- "today" → Start of today to now
- "this month" → Start of current month to now

Converted to ISO 8601: `YYYY-MM-DDTHH:MM:SSZ`

### Tag Format
Tags are key-value pairs:
```json
{
  "department": "sales",
  "priority": "high",
  "sentiment": "angry"
}
```

### Thresholds
Semantic search similarity:
- `0.6-0.7`: Broader, more results
- `0.7-0.8`: Balanced (default)
- `0.8-0.9`: Very similar only

## Example Workflows

### Workflow 1: Customer Service
**Goal:** Find escalated customer complaints

```
1. Use: discover_available_tags
   → Learn: {priority: "high", department: "support"}

2. Use: find_by_exact_tags
   Args: tag_criteria="high priority support"
         date_range="this month"
   
3. Execute: search_by_tags with {priority: "high", department: "support"}
```

### Workflow 2: Sales Analysis
**Goal:** Analyze pricing discussions

```
1. Use: find_by_keywords
   Args: keywords="pricing OR quote OR discount"
         filters="department: sales, last quarter"

2. Execute: search_vcons_content with query + filters

3. Use: find_similar_conversations
   Args: reference=<found UUID>
   → Find related pricing conversations
```

### Workflow 3: Compliance Audit
**Goal:** Review specific customer interactions

```
1. Use: find_by_customer
   Args: party_identifier="jane.doe@example.com"
         date_range="2024"

2. Execute: search_vcons with party_email

3. Review: All Jane Doe conversations for compliance
```

## Prompt Arguments

### Required vs Optional

| Prompt | Required Args | Optional Args |
|--------|---------------|---------------|
| `find_by_exact_tags` | tag_criteria | date_range |
| `find_by_semantic_search` | search_description | date_range |
| `find_by_keywords` | keywords | filters |
| `find_recent_by_topic` | topic | timeframe |
| `find_by_customer` | party_identifier | date_range |
| `discover_available_tags` | none | tag_category |
| `complex_search` | search_criteria | none |
| `find_similar_conversations` | reference | limit |
| `help_me_search` | what_you_want | none |

## Tips & Tricks

### ✅ Do This
- Start with `discover_available_tags` to explore your data
- Use date filters for "recent" queries
- Combine tag filters with content search
- Try `help_me_search` when unsure
- Use semantic search for concept-based queries

### ❌ Avoid This
- Don't assume tag values - discover them first
- Don't use semantic search for exact word matching
- Don't forget date filters for large datasets
- Don't set limits too low (default 50 is good)
- Don't use party_name for email addresses

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No results | Use `discover_available_tags`, broaden date range |
| Too many results | Add more filters, narrow date range |
| Wrong results | Verify tags with `get_unique_tags`, check date format |
| "Embedding not implemented" | Use `search_vcons_content` instead |
| Unsure which tool | Use `help_me_search` prompt |

## Related Documentation

- **[PROMPTS_GUIDE.md](./docs/PROMPTS_GUIDE.md)** - Comprehensive prompt documentation
- **[SEARCH_TOOLS_GUIDE.md](./docs/SEARCH_TOOLS_GUIDE.md)** - Detailed search tool reference
- **[TAG_MANAGEMENT_GUIDE.md](./docs/TAG_MANAGEMENT_GUIDE.md)** - Tag system guide
- **[QUICK_START.md](./QUICK_START.md)** - Getting started with vCon MCP

## Support

Not sure which prompt to use?
→ Try `help_me_search` with your query description!

Want to explore your data?
→ Try `discover_available_tags` to see what's available!

Need examples?
→ See [PROMPTS_GUIDE.md](./docs/PROMPTS_GUIDE.md) for detailed examples!


