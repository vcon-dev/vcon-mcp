/**
 * MCP Prompts for vCon Query and Retrieval
 * 
 * These prompts help users effectively query and retrieve vCons using
 * the available search and tag tools. They provide guidance on:
 * - Exact match searches (tags, metadata)
 * - Semantic searches (natural language queries)
 * - Hybrid approaches
 * - Date range filtering
 * - Combining multiple criteria
 */

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptDefinition {
  name: string;
  description: string;
  arguments?: PromptArgument[];
}

/**
 * Prompt: Find by Exact Tag Match
 * Use case: "Find all customers from june that were tagged as 'angry'"
 */
export const findByExactTagPrompt: PromptDefinition = {
  name: 'find_by_exact_tags',
  description: 'Find vCons using exact tag matches. Perfect for precise queries like "find all angry customers from June" or "show me high-priority sales calls".',
  arguments: [
    {
      name: 'tag_criteria',
      description: 'Natural language description of tags to match (e.g., "angry customers", "high priority sales", "department support")',
      required: true
    },
    {
      name: 'date_range',
      description: 'Optional date range description (e.g., "from June", "last week", "Q1 2024")',
      required: false
    }
  ]
};

/**
 * Prompt: Find by Semantic Search
 * Use case: "find all the angry customers from june"
 */
export const findBySemanticSearchPrompt: PromptDefinition = {
  name: 'find_by_semantic_search',
  description: 'Find vCons using semantic search to understand meaning and intent. Perfect for natural language queries like "find angry customers" or "locate payment dispute conversations".',
  arguments: [
    {
      name: 'search_description',
      description: 'Natural language description of what you are looking for (e.g., "angry customers", "billing disputes", "positive feedback")',
      required: true
    },
    {
      name: 'date_range',
      description: 'Optional date range description (e.g., "from June", "last month", "this quarter")',
      required: false
    }
  ]
};

/**
 * Prompt: Find by Keyword Content
 * Use case: "find conversations mentioning 'refund' or 'billing issue'"
 */
export const findByKeywordPrompt: PromptDefinition = {
  name: 'find_by_keywords',
  description: 'Find vCons containing specific keywords or phrases in the conversation content. Perfect for exact word matching like "find conversations mentioning \'refund\'" or "search for \'technical support\'".',
  arguments: [
    {
      name: 'keywords',
      description: 'Keywords or phrases to search for (e.g., "refund", "billing issue", "technical support")',
      required: true
    },
    {
      name: 'filters',
      description: 'Optional additional filters like date ranges, tags, or party information',
      required: false
    }
  ]
};

/**
 * Prompt: Find Recent Conversations by Topic
 * Use case: "show me recent support calls"
 */
export const findRecentByTopicPrompt: PromptDefinition = {
  name: 'find_recent_by_topic',
  description: 'Find recent vCons filtered by topic or category. Perfect for queries like "show me recent support calls" or "find this week\'s sales conversations".',
  arguments: [
    {
      name: 'topic',
      description: 'Topic or category to search for (e.g., "support", "sales", "billing")',
      required: true
    },
    {
      name: 'timeframe',
      description: 'Recency timeframe (e.g., "today", "this week", "last 7 days", "this month")',
      required: false
    }
  ]
};

/**
 * Prompt: Find by Customer or Party
 * Use case: "find all conversations with john@example.com"
 */
export const findByPartyPrompt: PromptDefinition = {
  name: 'find_by_customer',
  description: 'Find all vCons involving a specific customer, party, or participant. Perfect for queries like "find all conversations with John Smith" or "show me calls from 555-1234".',
  arguments: [
    {
      name: 'party_identifier',
      description: 'Customer/party identifier: name, email, or phone number',
      required: true
    },
    {
      name: 'date_range',
      description: 'Optional date range to filter results',
      required: false
    }
  ]
};

/**
 * Prompt: Discover Available Tags
 * Use case: "what tags are available for filtering?"
 */
export const discoverTagsPrompt: PromptDefinition = {
  name: 'discover_available_tags',
  description: 'Discover what tags are available in the system for filtering. Perfect for exploring your data and understanding what categories, departments, priorities, or other metadata exists.',
  arguments: [
    {
      name: 'tag_category',
      description: 'Optional: Focus on specific tag category (e.g., "department", "priority", "sentiment")',
      required: false
    }
  ]
};

/**
 * Prompt: Complex Multi-Criteria Search
 * Use case: "find high-priority sales calls from Q1 where customer mentioned pricing"
 */
export const complexSearchPrompt: PromptDefinition = {
  name: 'complex_search',
  description: 'Perform complex searches combining multiple criteria: tags, keywords, dates, and semantic meaning. Perfect for queries like "find high-priority sales calls from Q1 mentioning pricing".',
  arguments: [
    {
      name: 'search_criteria',
      description: 'Complete search description including all criteria (e.g., "high-priority sales calls from Q1 mentioning pricing")',
      required: true
    }
  ]
};

/**
 * Prompt: Find Similar Conversations
 * Use case: "find conversations similar to this one"
 */
export const findSimilarPrompt: PromptDefinition = {
  name: 'find_similar_conversations',
  description: 'Find conversations similar to a specific vCon or topic. Uses semantic search to find conceptually related conversations.',
  arguments: [
    {
      name: 'reference',
      description: 'Either a vCon UUID to find similar conversations, or a description of the topic',
      required: true
    },
    {
      name: 'limit',
      description: 'Number of similar conversations to return (default: 10)',
      required: false
    }
  ]
};

/**
 * Prompt: Analyze Query Strategy
 * Use case: Help users understand which search approach to use
 */
export const queryStrategyPrompt: PromptDefinition = {
  name: 'help_me_search',
  description: 'Get guidance on the best way to search for vCons based on your needs. Explains which search tool to use (exact tags, keywords, semantic, or hybrid) and how to structure your query.',
  arguments: [
    {
      name: 'what_you_want',
      description: 'Describe what you are trying to find in natural language',
      required: true
    }
  ]
};

/**
 * All prompts exported as an array for MCP server registration
 */
export const allPrompts: PromptDefinition[] = [
  findByExactTagPrompt,
  findBySemanticSearchPrompt,
  findByKeywordPrompt,
  findRecentByTopicPrompt,
  findByPartyPrompt,
  discoverTagsPrompt,
  complexSearchPrompt,
  findSimilarPrompt,
  queryStrategyPrompt
];

/**
 * Get a prompt definition by name
 */
export function getPrompt(name: string): PromptDefinition | undefined {
  return allPrompts.find(p => p.name === name);
}

/**
 * Generate prompt message based on prompt name and arguments
 */
export function generatePromptMessage(name: string, args: Record<string, string>): string {
  switch (name) {
    case 'find_by_exact_tags':
      return generateFindByExactTagsMessage(args);
    case 'find_by_semantic_search':
      return generateFindBySemanticSearchMessage(args);
    case 'find_by_keywords':
      return generateFindByKeywordsMessage(args);
    case 'find_recent_by_topic':
      return generateFindRecentByTopicMessage(args);
    case 'find_by_customer':
      return generateFindByPartyMessage(args);
    case 'discover_available_tags':
      return generateDiscoverTagsMessage(args);
    case 'complex_search':
      return generateComplexSearchMessage(args);
    case 'find_similar_conversations':
      return generateFindSimilarMessage(args);
    case 'help_me_search':
      return generateQueryStrategyMessage(args);
    default:
      return 'Unknown prompt';
  }
}

// Prompt message generators

function generateFindByExactTagsMessage(args: Record<string, string>): string {
  const tagCriteria = args.tag_criteria || '';
  const dateRange = args.date_range || '';
  
  return `Find vCons using exact tag matching for: "${tagCriteria}"${dateRange ? ` ${dateRange}` : ''}

## Strategy: Exact Tag Match

### Step 1: Identify Tag Keys and Values
Parse the search criteria "${tagCriteria}" to identify specific tag key-value pairs.
Common tag patterns:
- Sentiment: "angry" → {sentiment: "angry"}, "satisfied" → {sentiment: "positive"}
- Department: "sales" → {department: "sales"}, "support" → {department: "support"}
- Priority: "high priority" → {priority: "high"}, "urgent" → {priority: "urgent"}
- Customer ID: "customer 12345" → {customer_id: "12345"}

### Step 2: Add Date Filters (if specified)
${dateRange ? `Parse date range "${dateRange}" and convert to ISO 8601 format:
- "June" → start_date: "2024-06-01T00:00:00Z", end_date: "2024-06-30T23:59:59Z"
- "last week" → Calculate dates for previous 7 days
- "Q1" → January 1 to March 31 of current year` : 'No date range specified. Search all dates.'}

### Step 3: Execute Search
Use the \`search_by_tags\` tool for exact matches:

\`\`\`json
{
  "tags": {
    // Add identified tag key-value pairs here
  },
  "limit": 50
}
\`\`\`

### Step 4: Handle Results
- If results found: Present the matching vCons with their UUIDs and subjects
- If no results: Suggest using \`get_unique_tags\` to discover available tags
- If uncertain about tags: Use \`search_vcons_content\` for keyword search instead

### Important Notes:
- Tag matching is EXACT - "angry" will not match "frustrated" 
- Use \`get_unique_tags\` first if unsure what tag values exist
- All specified tags must match (AND logic)
- For fuzzy matching, use semantic search instead
`;
}

function generateFindBySemanticSearchMessage(args: Record<string, string>): string {
  const searchDescription = args.search_description || '';
  const dateRange = args.date_range || '';
  
  return `Find vCons using semantic search to understand meaning for: "${searchDescription}"${dateRange ? ` ${dateRange}` : ''}

## Strategy: Semantic Search

### Step 1: Understand the Intent
The query "${searchDescription}" will be searched using AI embeddings to find:
- Conversations with similar meaning (not just exact words)
- Related concepts and synonyms
- Contextually similar content

Examples:
- "angry customers" will find: frustrated, upset, dissatisfied, complaining
- "billing disputes" will find: payment issues, invoice problems, charge errors
- "positive feedback" will find: praise, satisfaction, compliments, thank you

### Step 2: Prepare Date Filters (if needed)
${dateRange ? `Convert "${dateRange}" to ISO 8601 format for filtering` : 'No date filtering needed'}

### Step 3: Execute Semantic Search
Use the \`search_vcons_semantic\` tool:

\`\`\`json
{
  "query": "${searchDescription}",
  "threshold": 0.7,
  ${dateRange ? '// Add start_date/end_date here\n  ' : ''}"limit": 50
}
\`\`\`

### Step 4: Parameters to Consider
- \`threshold\`: Similarity threshold (0.6-0.8 recommended)
  - Lower (0.6): More results, less precise
  - Higher (0.8): Fewer results, more precise
- \`limit\`: Number of results (default: 50)

### Step 5: Handle Embeddings
If you get "Embedding generation not yet implemented":
- The system needs pre-computed embeddings
- Fallback to \`search_vcons_content\` for keyword search
- Or use \`search_vcons_hybrid\` which combines both approaches

### Important Notes:
- Semantic search finds meaning, not exact words
- Works across languages and paraphrases
- Requires embeddings to be generated first
- Best for conceptual queries like "find frustrated customers"
`;
}

function generateFindByKeywordsMessage(args: Record<string, string>): string {
  const keywords = args.keywords || '';
  const filters = args.filters || '';
  
  return `Find vCons containing specific keywords: "${keywords}"${filters ? ` with filters: ${filters}` : ''}

## Strategy: Keyword Content Search

### Step 1: Identify Keywords
Extract specific keywords or phrases from: "${keywords}"
- Use exact words that should appear in conversations
- Can include multiple keywords (e.g., "refund OR billing")
- Supports partial matches and typo tolerance

### Step 2: Parse Additional Filters
${filters ? `Process additional filters: "${filters}"
- Date ranges (e.g., "last month", "June 2024")
- Tags (e.g., "department: sales")
- Party information (e.g., "john@example.com")` : 'No additional filters specified'}

### Step 3: Execute Keyword Search
Use the \`search_vcons_content\` tool for full-text search:

\`\`\`json
{
  "query": "${keywords}",
  ${filters ? '// Add parsed filters here (tags, start_date, end_date)\n  ' : ''}"limit": 50
}
\`\`\`

### Step 4: Interpret Results
Results include:
- \`relevance_score\`: How well the vCon matches (higher is better)
- \`snippet\`: Text excerpt showing where keywords appear
- \`content_type\`: Where match was found (dialog, analysis, subject, party)
- \`content_index\`: Which dialog/analysis element matched

### Step 5: Refine Search if Needed
- Too many results: Add more specific keywords or date filters
- Too few results: Try broader keywords or remove filters
- No results: Try semantic search for concept-based matching

### What Gets Searched:
✅ Subject lines
✅ Dialog bodies (conversation text, transcripts)
✅ Analysis bodies (summaries, sentiment, notes)
✅ Party information (names, emails, phone numbers)
❌ Attachments (not indexed)

### Important Notes:
- Searches actual content, not just metadata
- Supports typo tolerance via trigram matching
- Results are ranked by relevance
- Use for exact word/phrase matching
`;
}

function generateFindRecentByTopicMessage(args: Record<string, string>): string {
  const topic = args.topic || '';
  const timeframe = args.timeframe || 'recent';
  
  return `Find recent vCons about: "${topic}" within timeframe: "${timeframe}"

## Strategy: Recent + Topic Filtering

### Step 1: Convert Timeframe to Dates
Parse "${timeframe}" and calculate date range:
- "today": Start of today to now
- "this week": Start of current week to now
- "last 7 days": 7 days ago to now
- "this month": Start of current month to now
- "recent" (default): Last 30 days

### Step 2: Determine Topic Search Method
For topic "${topic}", choose the best approach:

#### Option A: Tag-Based (if topic is a tag)
If "${topic}" matches common tags (department, category, type):
\`\`\`json
{
  "tags": {
    "department": "${topic}"  // or other appropriate tag key
  },
  // Add date filters
  "limit": 50
}
\`\`\`
Tool: \`search_by_tags\`

#### Option B: Semantic Search (for concept-based topics)
If "${topic}" is a concept (e.g., "support issues", "billing questions"):
\`\`\`json
{
  "query": "${topic}",
  // Add date filters as start_date
  "limit": 50
}
\`\`\`
Tool: \`search_vcons_semantic\` or \`search_vcons_content\`

### Step 3: Execute Search with Date Filtering
Always include date filtering for "recent" queries:
- \`start_date\`: Beginning of timeframe (ISO 8601)
- \`end_date\`: End of timeframe or now (ISO 8601)

### Step 4: Sort Results
Results from search tools are already sorted by:
- Tag search: creation date (newest first)
- Content search: relevance score
- Semantic search: similarity score

Present results with:
- vCon UUID
- Subject
- Creation date
- Relevant tags
- Brief snippet or summary

### Important Notes:
- Combine date filtering with any search type
- "Recent" is relative to current date
- Use \`search_vcons\` tool with date filters for pure date-based queries
- Add tags for more precise filtering
`;
}

function generateFindByPartyMessage(args: Record<string, string>): string {
  const partyIdentifier = args.party_identifier || '';
  const dateRange = args.date_range || '';
  
  return `Find all vCons involving party: "${partyIdentifier}"${dateRange ? ` ${dateRange}` : ''}

## Strategy: Party-Based Search

### Step 1: Identify Party Type
Parse "${partyIdentifier}" to determine the identifier type:
- Email: Contains "@" → Use \`party_email\` parameter
- Phone: Numbers/dashes → Use \`party_tel\` parameter  
- Name: Text only → Use \`party_name\` parameter

### Step 2: Prepare Date Filters (if specified)
${dateRange ? `Convert "${dateRange}" to ISO 8601 date range` : 'Search all dates'}

### Step 3: Execute Party Search
Use the \`search_vcons\` tool with party filters:

\`\`\`json
{
  ${partyIdentifier.includes('@') ? `"party_email": "${partyIdentifier}"` : 
     /\d/.test(partyIdentifier) ? `"party_tel": "${partyIdentifier}"` :
     `"party_name": "${partyIdentifier}"`},
  ${dateRange ? '// Add start_date and end_date here\n  ' : ''}"limit": 100
}
\`\`\`

### Step 4: Present Results
For each matching vCon, show:
- vCon UUID
- Subject
- Creation date
- All parties involved
- Party role in conversation (if identifiable from party data)

### Step 5: Consider Follow-Up Actions
- View specific conversation: Use \`get_vcon\` with UUID
- Analyze patterns: Look at subjects, dates, other parties
- Add tags: Use \`manage_tag\` to categorize related conversations

### Search Behavior:
- \`party_name\`: Case-insensitive partial match (e.g., "John" matches "John Smith")
- \`party_email\`: Exact match
- \`party_tel\`: Exact match (consider phone number format variations)

### Important Notes:
- A vCon can have multiple parties (participants)
- Search matches if ANY party matches the criteria
- Party information is stored in the \`parties\` array
- Use quotes for exact name matching
`;
}

function generateDiscoverTagsMessage(args: Record<string, string>): string {
  const tagCategory = args.tag_category || '';
  
  return `Discover available tags in the system${tagCategory ? ` for category: "${tagCategory}"` : ''}

## Strategy: Tag Discovery

### Step 1: Get All Unique Tags
Use the \`get_unique_tags\` tool to see what tags exist:

\`\`\`json
{
  "include_counts": true,
  ${tagCategory ? `"key_filter": "${tagCategory}",\n  ` : ''}"min_count": 1
}
\`\`\`

### Step 2: Interpret Results
The response will show all unique tag keys and their values across all vCons:

Example output format:
\`\`\`json
{
  "department": ["sales", "support", "billing"],
  "priority": ["high", "medium", "low"],
  "sentiment": ["positive", "neutral", "negative"],
  "region": ["east", "west", "central"]
}
\`\`\`

With counts (if requested):
\`\`\`json
{
  "department": {
    "sales": 45,
    "support": 123,
    "billing": 28
  }
}
\`\`\`

### Step 3: Present Tag Categories
Organize tags by category for easy understanding:
- **Department Tags**: sales, support, engineering
- **Priority Tags**: high, medium, low, urgent
- **Sentiment Tags**: positive, negative, neutral, angry, satisfied
- **Custom Tags**: Any application-specific tags

### Step 4: Suggest Usage
For each tag category, show example searches:
- "Find high-priority sales calls" → {priority: "high", department: "sales"}
- "Show angry customers" → {sentiment: "angry"}
- "List support tickets" → {department: "support"}

### Parameters Explained:
- \`include_counts\`: Show how many vCons have each tag value
- \`key_filter\`: Focus on specific tag keys (e.g., "priority", "depart")
- \`min_count\`: Only show tags used at least N times

### Important Notes:
- Tags are key-value pairs stored as vCon attachments
- Tags are user-defined and application-specific
- Use \`manage_tag\` to add new tags to vCons
- Common tag keys: department, priority, sentiment, status, type
`;
}

function generateComplexSearchMessage(args: Record<string, string>): string {
  const criteria = args.search_criteria || '';
  
  return `Perform complex multi-criteria search: "${criteria}"

## Strategy: Complex Search with Multiple Criteria

### Step 1: Parse Search Criteria
Break down "${criteria}" into components:

1. **Tag Filters**: Exact matches (department, priority, status, etc.)
   - Extract: department=sales, priority=high
   
2. **Date Ranges**: Time-based filters
   - Extract: "Q1", "from June", "last month"
   
3. **Content Keywords**: Words to search for
   - Extract: "pricing", "discount", "refund"
   
4. **Semantic Intent**: Meaning-based queries
   - Extract: concepts like "customer complaints", "positive feedback"

### Step 2: Choose Search Strategy

#### Strategy A: Tag-Based + Date Filter
If criteria is primarily tags and dates:
\`\`\`
Tool: search_by_tags
Add: Date range parameters
\`\`\`

#### Strategy B: Keyword + Filters
If criteria includes specific words:
\`\`\`
Tool: search_vcons_content
Add: Tags and date parameters
\`\`\`

#### Strategy C: Hybrid Search
If criteria mixes exact keywords and concepts:
\`\`\`
Tool: search_vcons_hybrid
Add: Tags and date parameters
Adjust: semantic_weight based on keyword vs concept balance
\`\`\`

### Step 3: Execute Search with All Filters
Build comprehensive query:

\`\`\`json
{
  "query": "extracted keywords or semantic description",
  "tags": {
    // Extracted tag key-value pairs
  },
  "start_date": "ISO 8601 date",
  "end_date": "ISO 8601 date",
  "limit": 50
}
\`\`\`

### Step 4: Refine Results
If results are:
- **Too broad**: Add more specific tags or narrow date range
- **Too narrow**: Remove some filters or use semantic search
- **Off target**: Adjust semantic_weight or try different tool

### Example Breakdown: "high-priority sales calls from Q1 mentioning pricing"
1. Tags: {priority: "high", department: "sales"}
2. Date: Q1 2024 (Jan 1 - Mar 31)
3. Content: "pricing"
4. Tool: \`search_vcons_content\` or \`search_vcons_hybrid\`

### Step 5: Present Results
Show matching vCons with:
- How they matched each criterion
- Relevance/similarity score
- Snippet showing matched content
- Suggested follow-up actions

### Important Notes:
- Complex queries may require multiple tool calls
- Start with most restrictive filters first
- Can chain searches (e.g., get by tag, then filter by content)
- Use hybrid search for best balance of precision and recall
`;
}

function generateFindSimilarMessage(args: Record<string, string>): string {
  const reference = args.reference || '';
  const limit = args.limit || '10';
  
  return `Find conversations similar to: "${reference}"

## Strategy: Similarity Search

### Step 1: Determine Reference Type
Is "${reference}" a:
- **vCon UUID**: 8-4-4-4-12 hex format
- **Topic description**: Natural language description

### Step 2A: If Reference is a UUID
Use the vCon's existing embedding to find similar conversations:

1. Get the reference vCon:
\`\`\`json
{
  "uuid": "${reference}"
}
\`\`\`
Tool: \`get_vcon\`

2. Extract key topics or use embedding for semantic search
3. Find similar vCons based on content similarity

### Step 2B: If Reference is a Description
Use the description as a semantic query:

\`\`\`json
{
  "query": "${reference}",
  "threshold": 0.7,
  "limit": ${limit}
}
\`\`\`
Tool: \`search_vcons_semantic\`

### Step 3: Adjust Similarity Threshold
Balance between precision and recall:
- **High threshold (0.8-0.9)**: Very similar conversations only
- **Medium threshold (0.6-0.7)**: Moderately similar conversations
- **Low threshold (0.4-0.6)**: Broadly related conversations

### Step 4: Present Similar Conversations
For each result, show:
- vCon UUID
- Subject
- Similarity score
- Key similarities (shared topics, parties, sentiment)
- Creation date
- Relevant tags

### Step 5: Enable Further Exploration
Suggest actions:
- View full vCon: \`get_vcon\`
- Find more like this: Repeat with new UUID
- Filter by tags: Add tag criteria to narrow results

### Use Cases:
- "Find conversations like this complaint" → Similar customer issues
- "Show me similar sales calls" → Calls with similar topics/outcomes
- "Find related support tickets" → Tickets about same product/issue

### Important Notes:
- Semantic search finds meaning, not exact matches
- Requires embeddings to be generated
- Similarity is based on conversation content, not metadata
- Can combine with tag filters for more precise results
`;
}

function generateQueryStrategyMessage(args: Record<string, string>): string {
  const whatYouWant = args.what_you_want || '';
  
  return `Help me search: "${whatYouWant}"

## Query Strategy Guidance

### Analyzing Your Search Need

For your query: "${whatYouWant}"

### Step 1: Identify Query Type

**Is this an EXACT MATCH query?**
- Contains specific tag values (e.g., "department=sales", "priority=high")
- Needs precise category matching
- → Use \`search_by_tags\` or \`get_unique_tags\` (to discover tags first)

**Is this a KEYWORD query?**
- Contains specific words or phrases that must appear
- Needs exact terminology (e.g., "refund", "invoice #12345")
- → Use \`search_vcons_content\`

**Is this a CONCEPT/MEANING query?**
- Describes sentiment or intent (e.g., "angry customers", "positive feedback")
- Uses natural language (e.g., "billing problems", "technical issues")
- → Use \`search_vcons_semantic\` or \`search_vcons_hybrid\`

**Is this a PARTY/CUSTOMER query?**
- Looking for conversations with specific person
- Has email, phone, or name
- → Use \`search_vcons\` with party filters

**Is this a DATE/TIME query?**
- Focused on time period (e.g., "last week", "Q1", "recent")
- → Use date filters with any search tool

### Step 2: Choose the Right Tool

| Query Characteristic | Best Tool | Reason |
|---------------------|-----------|---------|
| Exact tag values | \`search_by_tags\` | Precise category matching |
| Specific keywords | \`search_vcons_content\` | Full-text search with ranking |
| Natural language | \`search_vcons_semantic\` | AI understands meaning |
| Mixed criteria | \`search_vcons_hybrid\` | Combines keyword + semantic |
| Party information | \`search_vcons\` | Party-specific filters |
| Date ranges only | \`search_vcons\` | Simple date filtering |

### Step 3: Build Your Query

Based on analysis, here's the recommended approach for "${whatYouWant}":

[Analysis will be provided based on the specific query]

### Step 4: Examples by Query Type

**Example 1: Exact Tags**
- Query: "Find angry customers"
- If you have tag {sentiment: "angry"} → \`search_by_tags\`
- Check available tags first: \`get_unique_tags\`

**Example 2: Keywords**
- Query: "Find conversations mentioning refund"
- Use: \`search_vcons_content\` with query="refund"

**Example 3: Semantic**
- Query: "Find frustrated customers complaining about delays"
- Use: \`search_vcons_semantic\` with natural language query

**Example 4: Party**
- Query: "All calls with john@example.com"
- Use: \`search_vcons\` with party_email="john@example.com"

**Example 5: Complex**
- Query: "High priority sales calls from June mentioning pricing"
- Use: \`search_vcons_content\` or \`search_vcons_hybrid\`
- Include: tags={priority:"high", department:"sales"}, dates, query="pricing"

### Step 5: Optimization Tips

- **Start specific, broaden if needed**: Begin with strict filters, relax if no results
- **Use tags when available**: Much faster than content search
- **Combine filters**: Date + tags + content for precision
- **Try different thresholds**: Adjust semantic threshold based on results
- **Discover first**: Use \`get_unique_tags\` to see what's available

### Common Pitfalls to Avoid

❌ Using semantic search when you need exact tag matching
❌ Forgetting date filters for "recent" queries
❌ Not checking available tags before searching
❌ Using wrong party filter type (email vs phone vs name)
❌ Setting limits too low (might miss relevant results)

### Next Steps

1. Determine which tool best fits your query type
2. Prepare all necessary parameters (tags, dates, keywords)
3. Execute the search
4. Review results and refine if needed
`;
}


