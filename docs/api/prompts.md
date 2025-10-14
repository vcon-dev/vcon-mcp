# MCP Prompts Reference

Prompts are reusable query templates that help users effectively search and retrieve vCons. They provide guided workflows for common search patterns.

## Overview

The vCon MCP Server provides 9 prompt templates:

1. **[find_by_exact_tags](#find_by_exact_tags)** - Exact tag matching
2. **[find_by_semantic_search](#find_by_semantic_search)** - AI-powered meaning search
3. **[find_by_keywords](#find_by_keywords)** - Keyword/phrase search
4. **[find_recent_by_topic](#find_recent_by_topic)** - Recent conversations by topic
5. **[find_by_customer](#find_by_customer)** - Search by party/customer
6. **[discover_available_tags](#discover_available_tags)** - Explore available tags
7. **[complex_search](#complex_search)** - Multi-criteria searches
8. **[find_similar_conversations](#find_similar_conversations)** - Find similar vCons
9. **[help_me_search](#help_me_search)** - Query strategy guidance

---

## Prompt Definitions

### find_by_exact_tags

Find vCons using exact tag matches for precise queries.

**Arguments:**
- `tag_criteria` (required): Natural language description of tags to match
  - Examples: "angry customers", "high priority sales", "department support"
- `date_range` (optional): Date range description
  - Examples: "from June", "last week", "Q1 2024"

**Best For:**
- Queries with known categories
- Filtering by metadata
- Precise department/priority/status matching

**Example Usage:**
```
Query: "Find all angry customers from June"
tag_criteria: "angry customers"
date_range: "from June"

→ Guides to: search_by_tags with {sentiment: "angry"}
```

**Strategy:**
1. Parse tag criteria to identify key-value pairs
2. Convert date range to ISO 8601
3. Use `search_by_tags` tool
4. Handle exact matching (no fuzzy logic)

---

### find_by_semantic_search

Find vCons using AI-powered semantic search to understand meaning and intent.

**Arguments:**
- `search_description` (required): Natural language description
  - Examples: "angry customers", "billing disputes", "positive feedback"
- `date_range` (optional): Date range description

**Best For:**
- Concept-based queries
- Finding similar meanings
- Natural language questions
- Fuzzy matching needs

**Example Usage:**
```
Query: "Find frustrated customers from last month"
search_description: "frustrated customers"
date_range: "last month"

→ Guides to: search_vcons_semantic
→ Matches: angry, upset, dissatisfied, complaining (similar concepts)
```

**Strategy:**
1. Understand intent (AI embeddings)
2. Find related concepts and synonyms
3. Use `search_vcons_semantic` tool
4. Adjust similarity threshold as needed

---

### find_by_keywords

Find vCons containing specific keywords or phrases.

**Arguments:**
- `keywords` (required): Keywords or phrases to search for
  - Examples: "refund", "billing issue", "technical support"
- `filters` (optional): Additional filters (tags, dates, parties)

**Best For:**
- Exact word matching
- Specific terminology
- Phrase searches
- ID or code lookups

**Example Usage:**
```
Query: "Find conversations mentioning 'refund' or 'billing issue'"
keywords: "refund OR billing issue"
filters: "department: support"

→ Guides to: search_vcons_content
```

**What Gets Searched:**
- ✅ Subject lines
- ✅ Dialog bodies
- ✅ Analysis bodies
- ✅ Party information
- ❌ Attachments (not indexed)

**Strategy:**
1. Extract specific keywords
2. Parse additional filters
3. Use `search_vcons_content` tool
4. Review relevance scores and snippets

---

### find_recent_by_topic

Find recent vCons filtered by topic or category.

**Arguments:**
- `topic` (required): Topic or category
  - Examples: "support", "sales", "billing"
- `timeframe` (optional): Recency timeframe
  - Examples: "today", "this week", "last 7 days", "this month"
  - Default: "recent" (last 30 days)

**Best For:**
- Dashboard views
- Recent activity monitoring
- Time-sensitive queries
- Category browsing

**Example Usage:**
```
Query: "Show me recent support calls"
topic: "support"
timeframe: "this week"

→ Combines date filtering with topic search
```

**Strategy:**
1. Convert timeframe to date range
2. Determine if topic is tag or concept
3. Choose appropriate search tool
4. Apply date filtering

---

### find_by_customer

Find all vCons involving a specific customer, party, or participant.

**Arguments:**
- `party_identifier` (required): Customer/party identifier
  - Email: `john@example.com`
  - Phone: `+1-555-1234`
  - Name: `John Smith`
- `date_range` (optional): Date range to filter

**Best For:**
- Customer history lookup
- Party-specific searches
- Contact tracing
- Relationship mapping

**Example Usage:**
```
Query: "Find all conversations with john@example.com"
party_identifier: "john@example.com"

→ Guides to: search_vcons with party_email filter
```

**Search Behavior:**
- `party_name`: Case-insensitive partial match
- `party_email`: Exact match
- `party_tel`: Exact match

**Strategy:**
1. Identify party type (email/phone/name)
2. Use `search_vcons` with appropriate filter
3. Show all parties in each conversation
4. Suggest follow-up actions

---

### discover_available_tags

Discover what tags are available in the system for filtering.

**Arguments:**
- `tag_category` (optional): Focus on specific tag category
  - Examples: "department", "priority", "sentiment"

**Best For:**
- Exploring data
- Understanding tag schema
- Planning searches
- Documentation

**Example Usage:**
```
Query: "What tags are available for filtering?"
→ Uses: get_unique_tags with include_counts

Response shows:
{
  "department": ["sales", "support", "billing"],
  "priority": ["high", "medium", "low"],
  "sentiment": ["positive", "neutral", "negative"]
}
```

**Strategy:**
1. Use `get_unique_tags` tool
2. Organize by category
3. Show usage counts
4. Suggest example searches

---

### complex_search

Perform complex searches combining multiple criteria: tags, keywords, dates, and semantic meaning.

**Arguments:**
- `search_criteria` (required): Complete search description
  - Example: "high-priority sales calls from Q1 mentioning pricing"

**Best For:**
- Multi-dimensional queries
- Business intelligence
- Complex filtering
- Advanced searches

**Example Usage:**
```
Query: "Find high-priority sales calls from Q1 where customer mentioned pricing"
search_criteria: "high-priority sales calls from Q1 mentioning pricing"

→ Parses into:
  - Tags: {priority: "high", department: "sales"}
  - Date: Q1 2024 (Jan 1 - Mar 31)
  - Content: "pricing"
→ Uses: search_vcons_hybrid or search_vcons_content
```

**Strategy:**
1. Parse criteria into components (tags, dates, keywords, concepts)
2. Choose best search strategy
3. Build comprehensive query
4. Refine results as needed

---

### find_similar_conversations

Find conversations similar to a specific vCon or topic.

**Arguments:**
- `reference` (required): vCon UUID or topic description
- `limit` (optional): Number of results (default: 10)

**Best For:**
- Similar issue lookup
- Pattern discovery
- Related conversation finding
- Contextual search

**Example Usage:**
```
Query: "Find conversations similar to this one"
reference: "123e4567-e89b-12d3-a456-426614174000"
limit: "10"

→ Uses semantic similarity to find related vCons
```

**Strategy:**
1. Determine if reference is UUID or description
2. Extract or generate embedding
3. Use `search_vcons_semantic` with similarity threshold
4. Adjust threshold for precision vs recall

---

### help_me_search

Get guidance on the best way to search for vCons based on your needs.

**Arguments:**
- `what_you_want` (required): Description of what you're trying to find

**Best For:**
- New users
- Complex queries
- Strategy planning
- Tool selection

**Example Usage:**
```
Query: "I want to find frustrated customers who complained about billing"
what_you_want: "frustrated customers who complained about billing"

→ Analyzes query type
→ Recommends: search_vcons_semantic or search_vcons_hybrid
→ Provides step-by-step guidance
```

**Decision Tree:**

| Query Type | Recommended Tool |
|-----------|-----------------|
| Exact tag values | `search_by_tags` |
| Specific keywords | `search_vcons_content` |
| Natural language | `search_vcons_semantic` |
| Mixed criteria | `search_vcons_hybrid` |
| Party information | `search_vcons` (party filters) |
| Date ranges | Any tool + date filters |

---

## Using Prompts

### Claude Desktop

Prompts appear in the prompt selector:

```typescript
// User selects prompt: "find_by_exact_tags"
// Fills in arguments:
//   tag_criteria: "angry customers"
//   date_range: "June 2024"

// Claude receives guidance and executes appropriate tools
```

### Custom MCP Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const client = new Client({
  name: 'my-client',
  version: '1.0.0'
});

// List available prompts
const prompts = await client.listPrompts();

// Get a specific prompt
const prompt = await client.getPrompt({
  name: 'find_by_exact_tags',
  arguments: {
    tag_criteria: 'angry customers',
    date_range: 'June 2024'
  }
});

// The prompt.messages array contains guidance
```

---

## Prompt Strategy Guide

### When to Use Each Prompt

```
📋 Known categories/tags → find_by_exact_tags
🔍 Specific words → find_by_keywords
🤖 Concepts/meaning → find_by_semantic_search
📅 Recent + topic → find_recent_by_topic
👤 Specific person → find_by_customer
🏷️  Explore tags → discover_available_tags
🔧 Multiple criteria → complex_search
🔗 Similar content → find_similar_conversations
❓ Not sure → help_me_search
```

### Query Analysis Flow

```
1. Is it a simple query?
   → Yes: Use specific prompt (tags, keywords, party)
   → No: Continue

2. Does it involve multiple criteria?
   → Yes: Use complex_search
   → No: Continue

3. Is it concept-based or exact words?
   → Concept: Use find_by_semantic_search
   → Exact: Use find_by_keywords

4. Still unsure?
   → Use help_me_search
```

---

## Examples by Use Case

### Customer Service

```typescript
// Find recent angry customers
Prompt: find_recent_by_topic
  topic: "angry customers"
  timeframe: "this week"

// Find all conversations with customer
Prompt: find_by_customer
  party_identifier: "customer@example.com"

// Find billing complaints
Prompt: find_by_keywords
  keywords: "billing complaint refund"
  filters: "department: support"
```

### Sales

```typescript
// Find high-value sales calls
Prompt: find_by_exact_tags
  tag_criteria: "high value sales"
  date_range: "this quarter"

// Find pricing discussions
Prompt: find_by_keywords
  keywords: "pricing discount contract"
  filters: "department: sales"

// Find successful sales patterns
Prompt: find_similar_conversations
  reference: "uuid-of-successful-call"
  limit: "20"
```

### Analytics

```typescript
// Explore available tags
Prompt: discover_available_tags

// Complex multi-criteria search
Prompt: complex_search
  search_criteria: "high-priority support calls from Q1 with negative sentiment"

// Find similar issues
Prompt: find_similar_conversations
  reference: "customer complaint about delays"
  limit: "50"
```

---

## Best Practices

### 1. Start Simple
Begin with specific prompts before moving to complex searches.

### 2. Discover First
Use `discover_available_tags` to understand your data before searching.

### 3. Refine Iteratively
Start broad, then narrow based on results.

### 4. Combine Filters
Use date ranges with every search for better performance.

### 5. Use Right Tool
Let prompts guide you to the appropriate search tool.

---

## Next Steps

- See [Tools Reference](./tools.md) for tool details
- See [Resources Reference](./resources.md) for URI-based access
- See [Search Guide](/guide/search.md) for search strategies
- See [Tag Guide](/guide/tags.md) for tag management

