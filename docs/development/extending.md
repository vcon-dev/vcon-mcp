# Extending vCon MCP Server

Complete guide to extending the vCon MCP Server with custom functionality.

## Table of Contents

- [Overview](#overview)
- [Extension Methods](#extension-methods)
- [Custom Resources](#custom-resources)
- [Custom Prompts](#custom-prompts)
- [Custom Tools](#custom-tools)
- [Via Plugins](#via-plugins)
- [Complete Examples](#complete-examples)
- [Best Practices](#best-practices)

---

## Overview

The vCon MCP Server can be extended in multiple ways:

1. **Resources** - Provide discoverable, read-only access to data
2. **Prompts** - Offer pre-built prompt templates for common queries
3. **Tools** - Implement executable operations with parameters
4. **Plugins** - Package extensions as reusable, loadable modules
5. **Hooks** - Intercept and modify operations via lifecycle hooks

### When to Use Each

| Extension Type | Use Case | Example |
|---------------|----------|---------|
| **Resource** | Browsing data, simple queries | List recent vCons, get statistics |
| **Prompt** | Guided query templates | "Find angry customers from June" |
| **Tool** | Operations with parameters | Create vCon, search with filters |
| **Plugin** | Packaged functionality | Privacy suite, analytics module |
| **Hook** | Modify existing behavior | Add audit logging, enforce permissions |

---

## Extension Methods

### Method 1: Direct Code Extension

Modify the core codebase directly. Best for:
- Prototype development
- Internal-only customizations
- Learning the system

**Pros:**
- Simple to implement
- No packaging complexity
- Full access to internals

**Cons:**
- Harder to maintain across updates
- Not reusable across projects
- Requires rebuilding the server

### Method 2: Plugin-Based Extension

Package as a plugin. Best for:
- Reusable functionality
- Distribution to others
- Separating proprietary features
- Multi-tenant deployments

**Pros:**
- Clean separation of concerns
- Easy to enable/disable
- Distributable via npm
- No core code changes needed

**Cons:**
- More setup complexity
- Plugin API limitations
- Requires proper packaging

---

## Custom Resources

Resources provide URI-based access to data. They are read-only and discoverable.

### Resource Structure

A resource consists of:

```typescript
interface Resource {
  uri: string;              // Unique identifier (e.g., "vcon://v1/statistics")
  name: string;             // Display name
  description: string;      // What data it provides
  mimeType: string;         // Content type (usually "application/json")
}
```

### Adding Resources Directly

#### Step 1: Define Your Resource

Create or edit `src/resources/index.ts`:

```typescript
export function getCoreResources(): ResourceDescriptor[] {
  return [
    // ... existing resources ...
    
    {
      uri: 'vcon://v1/statistics',
      name: 'vCon Statistics',
      description: 'Overall statistics about all vCons in the database',
      mimeType: 'application/json'
    },
    {
      uri: 'vcon://v1/statistics/daily',
      name: 'Daily Statistics',
      description: 'vCon creation statistics grouped by day',
      mimeType: 'application/json'
    }
  ];
}
```

#### Step 2: Implement Resource Resolution

Add handling for your resource URIs:

```typescript
export async function resolveCoreResource(
  queries: VConQueries, 
  uri: string
): Promise<{ mimeType: string; content: any } | undefined> {
  
  // Handle your custom resource
  if (uri === 'vcon://v1/statistics') {
    const stats = await queries.getOverallStatistics();
    return {
      mimeType: 'application/json',
      content: {
        total_vcons: stats.total,
        total_parties: stats.parties,
        total_dialogs: stats.dialogs,
        date_range: {
          oldest: stats.oldest,
          newest: stats.newest
        }
      }
    };
  }
  
  if (uri === 'vcon://v1/statistics/daily') {
    const dailyStats = await queries.getDailyStatistics();
    return {
      mimeType: 'application/json',
      content: {
        period: 'daily',
        stats: dailyStats
      }
    };
  }
  
  // ... existing resource handling ...
  
  return undefined;
}
```

#### Step 3: Add Database Queries (if needed)

Add methods to `src/db/queries.ts`:

```typescript
export class VConQueries {
  // ... existing methods ...
  
  async getOverallStatistics() {
    const { data, error } = await this.supabase
      .rpc('get_overall_statistics');
    
    if (error) throw error;
    return data;
  }
  
  async getDailyStatistics() {
    const { data, error } = await this.supabase
      .rpc('get_daily_statistics');
    
    if (error) throw error;
    return data;
  }
}
```

### Dynamic Resources with Parameters

Resources can include parameters in the URI:

```typescript
// Resource definition
{
  uri: 'vcon://v1/statistics/period/{days}',
  name: 'Period Statistics',
  description: 'Statistics for last N days. Use vcon://v1/statistics/period/7 for last 7 days.',
  mimeType: 'application/json'
}

// Resolution
const matchPeriod = uri.match(/^vcon:\/\/statistics\/period\/(\d+)$/);
if (matchPeriod) {
  const days = parseInt(matchPeriod[1], 10);
  const stats = await queries.getPeriodStatistics(days);
  return json(stats);
}
```

### Resource Best Practices

1. **Use Clear URI Schemes**
   - Good: `vcon://v1/analytics/sentiment`
   - Bad: `vcon://thing1`

2. **Document Parameter Formats**
   - Include examples in description
   - Specify valid ranges/formats

3. **Keep Resources Lightweight**
   - Resources should return quickly
   - For expensive queries, use tools instead

4. **Return Consistent Formats**
   - Always use the same structure
   - Include metadata (counts, dates, etc.)

---

## Custom Prompts

Prompts are template-based queries that guide users in finding information.

### Prompt Structure

```typescript
interface PromptDefinition {
  name: string;              // Unique identifier
  description: string;       // What the prompt helps with
  arguments?: PromptArgument[];  // Optional parameters
}

interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}
```

### Adding Prompts Directly

#### Step 1: Define Your Prompt

Edit `src/prompts/index.ts`:

```typescript
export const findHighValueCustomersPrompt: PromptDefinition = {
  name: 'find_high_value_customers',
  description: 'Find high-value customers based on conversation patterns and tags. Useful for identifying VIP customers or those requiring special attention.',
  arguments: [
    {
      name: 'value_criteria',
      description: 'Criteria for "high value" (e.g., "frequent callers", "premium tier", "high revenue")',
      required: true
    },
    {
      name: 'time_period',
      description: 'Time period to analyze (e.g., "last month", "Q1 2024")',
      required: false
    }
  ]
};

// Add to exports
export const allPrompts: PromptDefinition[] = [
  // ... existing prompts ...
  findHighValueCustomersPrompt,
];
```

#### Step 2: Implement Prompt Message Generator

Add a generator function for your prompt:

```typescript
function generateFindHighValueCustomersMessage(args: Record<string, string>): string {
  const valueCriteria = args.value_criteria || '';
  const timePeriod = args.time_period || 'all time';
  
  return `Find high-value customers matching: "${valueCriteria}" over ${timePeriod}

## Strategy: Multi-Factor Customer Value Analysis

### Step 1: Identify Value Indicators
Parse "${valueCriteria}" to determine what makes a customer "high value":
- **Frequency**: "frequent callers" → Count conversations per customer
- **Tier**: "premium tier" → Check for tags: {customer_tier: "premium"}
- **Revenue**: "high revenue" → Look for tags: {revenue_category: "high"}
- **Engagement**: "engaged customers" → Analyze conversation lengths and sentiment

### Step 2: Determine Search Approach

#### Option A: Tag-Based (if criteria maps to tags)
Use \`search_by_tags\` for exact matching:
\`\`\`json
{
  "tags": {
    "customer_tier": "premium",
    "status": "active"
  },
  "limit": 100
}
\`\`\`

#### Option B: Pattern Analysis (for behavior-based criteria)
1. Use \`search_vcons\` with date filters to get all conversations
2. Group by customer (party email/phone)
3. Calculate metrics: frequency, avg duration, sentiment
4. Rank and filter by thresholds

### Step 3: Execute Analysis
${timePeriod !== 'all time' ? `
Parse time period "${timePeriod}" to date range:
- "last month" → Last 30 days
- "Q1 2024" → Jan 1 - Mar 31, 2024
- "this year" → Current year start to now
` : 'Search across all available data'}

### Step 4: Present Results
For each high-value customer identified:
- Customer identifier (email/phone/name)
- Value score or ranking
- Supporting metrics (conversation count, total duration, etc.)
- Key conversation themes or topics
- Suggested actions or follow-ups

### Example Query Flow:
1. \`search_by_tags\` or \`search_vcons\` to get candidate conversations
2. Group results by party identifier
3. Calculate aggregate metrics per customer
4. Apply value thresholds
5. Return top N customers with details

### Important Notes:
- Combine multiple data points for accurate value assessment
- Consider recency (recent conversations weighted higher)
- Include both quantitative (counts) and qualitative (sentiment) factors
- Tag customers after identification for future easy filtering
`;
}

// Update the main generator switch
export function generatePromptMessage(name: string, args: Record<string, string>): string {
  switch (name) {
    // ... existing cases ...
    case 'find_high_value_customers':
      return generateFindHighValueCustomersMessage(args);
    default:
      return 'Unknown prompt';
  }
}
```

#### Step 3: Register the Prompt

The prompt is automatically registered via the `allPrompts` array. The server in `src/index.ts` already handles:

```typescript
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: allPrompts.map(p => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments?.map(arg => ({
        name: arg.name,
        description: arg.description,
        required: arg.required
      }))
    }))
  };
});
```

### Prompt Design Guidelines

1. **Clear Strategy Section**
   - Break down the approach step-by-step
   - Explain which tools to use when
   - Provide decision trees for complex queries

2. **Concrete Examples**
   - Show actual tool calls with JSON
   - Include expected output formats
   - Demonstrate error handling

3. **Flexible Parameters**
   - Support natural language inputs
   - Parse and normalize user intent
   - Provide sensible defaults

4. **Actionable Guidance**
   - Tell users exactly what to do next
   - Explain why each step matters
   - Suggest alternatives if primary approach fails

---

## Custom Tools

Tools are the primary way to add executable functionality. See the [Custom Tools Guide](./custom-tools.md) for comprehensive documentation.

### Quick Tool Example

```typescript
// Define tool
export const myAnalyticsTool = {
  name: 'analyze_sentiment_trends',
  description: 'Analyze sentiment trends across conversations over time',
  inputSchema: {
    type: 'object' as const,
    properties: {
      start_date: { type: 'string', format: 'date-time' },
      end_date: { type: 'string', format: 'date-time' },
      group_by: { type: 'string', enum: ['day', 'week', 'month'] }
    },
    required: ['start_date', 'end_date']
  }
};

// Implement handler
export async function handleAnalyzeSentimentTrends(
  input: SentimentTrendsInput
): Promise<ToolResponse> {
  // Implementation here
  const trends = await calculateSentimentTrends(input);
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        trends: trends
      }, null, 2)
    }]
  };
}

// Register in src/index.ts
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  switch (name) {
    case 'analyze_sentiment_trends':
      return handleAnalyzeSentimentTrends(args);
    // ... other cases ...
  }
});
```

For full tool development guide, see [Custom Tools](./custom-tools.md).

---

## Via Plugins

All of the above (resources, prompts, tools, hooks) can be packaged as plugins.

### Plugin Structure

```typescript
import { VConPlugin, RequestContext } from '@vcon/mcp-server/hooks';
import { Tool, Resource } from '@modelcontextprotocol/sdk/types';

export default class MyExtensionPlugin implements VConPlugin {
  name = 'my-extension';
  version = '1.0.0';
  
  // Initialization
  async initialize(config: any): Promise<void> {
    console.error('✅ My Extension Plugin initialized');
    this.config = config;
  }
  
  async shutdown(): Promise<void> {
    console.error('👋 My Extension Plugin shutting down');
  }
  
  // Register custom tools
  registerTools(): Tool[] {
    return [
      {
        name: 'my_custom_tool',
        description: 'Does something custom',
        inputSchema: {
          type: 'object',
          properties: {
            param: { type: 'string' }
          },
          required: ['param']
        }
      }
    ];
  }
  
  // Register custom resources
  registerResources(): Resource[] {
    return [
      {
        uri: 'myplugin://stats',
        name: 'Plugin Statistics',
        description: 'Statistics from my plugin',
        mimeType: 'application/json'
      }
    ];
  }
  
  // Handle tool calls
  async handleToolCall(
    toolName: string, 
    args: any, 
    context: RequestContext
  ): Promise<any> {
    if (toolName === 'my_custom_tool') {
      return {
        success: true,
        result: `Processed: ${args.param}`
      };
    }
    return undefined;
  }
  
  // Lifecycle hooks
  async afterCreate(vcon: VCon, context: RequestContext): Promise<void> {
    // Do something after vCon creation
    console.error(`📝 vCon created: ${vcon.uuid}`);
  }
  
  async afterRead(vcon: VCon, context: RequestContext): Promise<VCon> {
    // Optionally modify vCon before returning
    return vcon;
  }
}
```

### Adding Resources via Plugin

```typescript
export default class AnalyticsPlugin implements VConPlugin {
  name = 'analytics';
  version = '1.0.0';
  
  private supabase: any;
  
  async initialize(config: any): Promise<void> {
    this.supabase = config.supabase;
  }
  
  registerResources(): Resource[] {
    return [
      {
        uri: 'analytics://summary',
        name: 'Analytics Summary',
        description: 'Summary of conversation analytics',
        mimeType: 'application/json'
      },
      {
        uri: 'analytics://trends/{period}',
        name: 'Trend Analysis',
        description: 'Trend analysis over a period. Use analytics://trends/7d for 7 days.',
        mimeType: 'application/json'
      }
    ];
  }
  
  async handleResourceRead(uri: string): Promise<any> {
    if (uri === 'analytics://summary') {
      return await this.getAnalyticsSummary();
    }
    
    const trendMatch = uri.match(/^analytics:\/\/trends\/(\w+)$/);
    if (trendMatch) {
      const period = trendMatch[1];
      return await this.getTrendAnalysis(period);
    }
    
    return undefined;
  }
  
  private async getAnalyticsSummary() {
    // Query database for analytics
    const { data } = await this.supabase
      .rpc('get_analytics_summary');
    
    return {
      total_conversations: data.total,
      average_duration: data.avg_duration,
      sentiment_breakdown: data.sentiment,
      updated_at: new Date().toISOString()
    };
  }
  
  private async getTrendAnalysis(period: string) {
    const days = this.parsePeriod(period);
    const { data } = await this.supabase
      .rpc('get_trend_analysis', { days });
    
    return {
      period: period,
      trends: data
    };
  }
  
  private parsePeriod(period: string): number {
    const match = period.match(/^(\d+)d$/);
    return match ? parseInt(match[1]) : 30;
  }
}
```

**Note:** Currently, plugin resources are declared via `registerResources()` but the core server doesn't automatically handle reading them. You need to handle resource reads in your plugin or contribute a PR to add plugin resource resolution to the core.

### Adding Prompts via Plugin

Prompts cannot be directly added via plugins in the current architecture. To add prompts:

1. **Option A:** Contribute them to the core `src/prompts/index.ts`
2. **Option B:** Use your plugin's tools to provide guided workflows instead
3. **Option C:** Add a prompt registration hook (requires core modification)

Example of using tools for prompt-like behavior:

```typescript
export default class GuidedQueryPlugin implements VConPlugin {
  name = 'guided-queries';
  version = '1.0.0';
  
  registerTools(): Tool[] {
    return [
      {
        name: 'guided_customer_search',
        description: 'Guided workflow for finding customers. Asks questions and executes searches based on answers.',
        inputSchema: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              description: 'What you want to find (e.g., "angry customers", "high value accounts")'
            },
            time_frame: {
              type: 'string',
              description: 'Optional time period (e.g., "last month", "Q1")'
            }
          },
          required: ['intent']
        }
      }
    ];
  }
  
  async handleToolCall(toolName: string, args: any, context: RequestContext): Promise<any> {
    if (toolName === 'guided_customer_search') {
      return await this.executeGuidedSearch(args);
    }
  }
  
  private async executeGuidedSearch(args: any) {
    // Analyze intent
    const strategy = this.determineSearchStrategy(args.intent);
    
    // Build guidance
    const guidance = this.buildSearchGuidance(strategy, args);
    
    // Execute searches
    const results = await this.executeSearches(strategy, args);
    
    return {
      strategy: strategy,
      guidance: guidance,
      results: results
    };
  }
}
```

### Loading Plugins

```bash
# Via environment variable
export VCON_PLUGINS_PATH=./my-plugin.js,@mycompany/analytics-plugin

# Multiple plugins
export VCON_PLUGINS_PATH="./plugins/analytics.js,./plugins/compliance.js,@vendor/audit-plugin"

# Start server
npm start
```

For complete plugin development guide, see [Plugin Development](./plugins.md).

---

## Complete Examples

### Example 1: Analytics Extension

A complete analytics extension with resources, prompts, and tools.

#### File: `src/resources/analytics-resources.ts`

```typescript
export function getAnalyticsResources(): ResourceDescriptor[] {
  return [
    {
      uri: 'vcon://v1/analytics/overview',
      name: 'Analytics Overview',
      description: 'High-level analytics overview',
      mimeType: 'application/json'
    }
  ];
}

export async function resolveAnalyticsResource(
  queries: VConQueries,
  uri: string
): Promise<{ mimeType: string; content: any } | undefined> {
  
  if (uri === 'vcon://v1/analytics/overview') {
    const stats = await queries.getAnalyticsOverview();
    return {
      mimeType: 'application/json',
      content: stats
    };
  }
  
  return undefined;
}
```

#### File: `src/prompts/analytics-prompts.ts`

```typescript
export const analyzeConversationPatternsPrompt: PromptDefinition = {
  name: 'analyze_conversation_patterns',
  description: 'Analyze patterns in conversations to identify trends, common topics, and anomalies',
  arguments: [
    {
      name: 'pattern_type',
      description: 'Type of pattern to analyze (e.g., "sentiment trends", "topic clustering", "time patterns")',
      required: true
    },
    {
      name: 'time_period',
      description: 'Time period to analyze',
      required: false
    }
  ]
};

function generateAnalyzeConversationPatternsMessage(args: Record<string, string>): string {
  const patternType = args.pattern_type || '';
  const timePeriod = args.time_period || 'last 30 days';
  
  return `Analyze conversation patterns: "${patternType}" over ${timePeriod}

## Strategy: Pattern Analysis

### Step 1: Gather Conversation Data
Use \`search_vcons\` with date filters to collect conversations:
\`\`\`json
{
  "start_date": "${getStartDate(timePeriod)}",
  "end_date": "${new Date().toISOString()}",
  "limit": 1000
}
\`\`\`

### Step 2: Analyze Based on Pattern Type

${getPatternAnalysisGuidance(patternType)}

### Step 3: Generate Insights
- Identify top patterns
- Compare to historical baselines
- Flag anomalies or unusual trends
- Provide actionable recommendations

### Step 4: Visualize Results
Present findings with:
- Summary statistics
- Key patterns identified
- Trend directions (increasing/decreasing)
- Recommended actions
`;
}
```

#### File: `src/tools/analytics-tools.ts`

```typescript
export const patternAnalysisTool = {
  name: 'analyze_patterns',
  description: 'Analyze patterns in conversation data',
  inputSchema: {
    type: 'object' as const,
    properties: {
      pattern_type: { 
        type: 'string',
        enum: ['sentiment', 'topics', 'duration', 'frequency']
      },
      start_date: { type: 'string', format: 'date-time' },
      end_date: { type: 'string', format: 'date-time' },
      group_by: { 
        type: 'string',
        enum: ['hour', 'day', 'week', 'month'],
        default: 'day'
      }
    },
    required: ['pattern_type', 'start_date', 'end_date']
  }
};

export async function handleAnalyzePatterns(
  input: PatternAnalysisInput
): Promise<ToolResponse> {
  const validated = PatternAnalysisInputSchema.parse(input);
  
  // Get conversation data
  const vcons = await getConversationsInDateRange(
    validated.start_date,
    validated.end_date
  );
  
  // Analyze based on pattern type
  let analysis;
  switch (validated.pattern_type) {
    case 'sentiment':
      analysis = await analyzeSentimentPatterns(vcons, validated.group_by);
      break;
    case 'topics':
      analysis = await analyzeTopicPatterns(vcons, validated.group_by);
      break;
    case 'duration':
      analysis = await analyzeDurationPatterns(vcons, validated.group_by);
      break;
    case 'frequency':
      analysis = await analyzeFrequencyPatterns(vcons, validated.group_by);
      break;
  }
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        pattern_type: validated.pattern_type,
        time_period: {
          start: validated.start_date,
          end: validated.end_date,
          group_by: validated.group_by
        },
        analysis: analysis,
        insights: generateInsights(analysis),
        recommendations: generateRecommendations(analysis)
      }, null, 2)
    }]
  };
}
```

### Example 2: Customer Intelligence Plugin

A complete plugin for customer intelligence features.

#### File: `plugins/customer-intelligence/index.ts`

```typescript
import { VConPlugin, RequestContext } from '@vcon/mcp-server/hooks';
import { VCon } from '@vcon/mcp-server/types';
import { Tool, Resource } from '@modelcontextprotocol/sdk/types';

export default class CustomerIntelligencePlugin implements VConPlugin {
  name = 'customer-intelligence';
  version = '1.0.0';
  
  private supabase: any;
  private customerCache: Map<string, CustomerProfile> = new Map();
  
  async initialize(config: any): Promise<void> {
    this.supabase = config.supabase;
    await this.loadCustomerProfiles();
    console.error('✅ Customer Intelligence Plugin initialized');
  }
  
  async shutdown(): Promise<void> {
    this.customerCache.clear();
  }
  
  // ========== Resources ==========
  
  registerResources(): Resource[] {
    return [
      {
        uri: 'customer://profiles',
        name: 'Customer Profiles',
        description: 'List of all customer profiles with intelligence data',
        mimeType: 'application/json'
      },
      {
        uri: 'customer://profile/{identifier}',
        name: 'Customer Profile',
        description: 'Detailed profile for a specific customer. Use email or phone.',
        mimeType: 'application/json'
      },
      {
        uri: 'customer://segments',
        name: 'Customer Segments',
        description: 'Customer segments based on behavior and value',
        mimeType: 'application/json'
      }
    ];
  }
  
  // Note: Resource reading would need to be handled in plugin or core
  async handleResourceRead(uri: string): Promise<any> {
    if (uri === 'customer://profiles') {
      return Array.from(this.customerCache.values());
    }
    
    const profileMatch = uri.match(/^customer:\/\/profile\/(.+)$/);
    if (profileMatch) {
      const identifier = decodeURIComponent(profileMatch[1]);
      return this.getCustomerProfile(identifier);
    }
    
    if (uri === 'customer://segments') {
      return this.getCustomerSegments();
    }
    
    return undefined;
  }
  
  // ========== Tools ==========
  
  registerTools(): Tool[] {
    return [
      {
        name: 'identify_customer_segment',
        description: 'Identify which segment a customer belongs to based on their conversation history',
        inputSchema: {
          type: 'object',
          properties: {
            customer_identifier: {
              type: 'string',
              description: 'Customer email, phone, or name'
            },
            recalculate: {
              type: 'boolean',
              description: 'Force recalculation of segment',
              default: false
            }
          },
          required: ['customer_identifier']
        }
      },
      {
        name: 'get_customer_insights',
        description: 'Get AI-generated insights about a customer based on all their conversations',
        inputSchema: {
          type: 'object',
          properties: {
            customer_identifier: { type: 'string' },
            insight_types: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['sentiment', 'topics', 'behavior', 'value', 'risk']
              }
            }
          },
          required: ['customer_identifier']
        }
      },
      {
        name: 'find_similar_customers',
        description: 'Find customers with similar conversation patterns and behaviors',
        inputSchema: {
          type: 'object',
          properties: {
            customer_identifier: { type: 'string' },
            similarity_factors: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['topics', 'sentiment', 'frequency', 'value', 'behavior']
              }
            },
            limit: { type: 'number', default: 10 }
          },
          required: ['customer_identifier']
        }
      }
    ];
  }
  
  async handleToolCall(
    toolName: string,
    args: any,
    context: RequestContext
  ): Promise<any> {
    
    switch (toolName) {
      case 'identify_customer_segment':
        return await this.identifyCustomerSegment(args);
      
      case 'get_customer_insights':
        return await this.getCustomerInsights(args);
      
      case 'find_similar_customers':
        return await this.findSimilarCustomers(args);
      
      default:
        return undefined;
    }
  }
  
  // ========== Hooks ==========
  
  async afterCreate(vcon: VCon, context: RequestContext): Promise<void> {
    // Update customer profiles when new conversation is created
    for (const party of vcon.parties || []) {
      if (party.mailto || party.tel) {
        const identifier = party.mailto || party.tel;
        await this.updateCustomerProfile(identifier, vcon);
      }
    }
  }
  
  async afterRead(vcon: VCon, context: RequestContext): Promise<VCon> {
    // Enrich vCon with customer intelligence data
    if (vcon.parties) {
      vcon.parties = await Promise.all(
        vcon.parties.map(async (party) => {
          const identifier = party.mailto || party.tel || party.name;
          if (identifier) {
            const profile = await this.getCustomerProfile(identifier);
            return {
              ...party,
              // Add intelligence as metadata
              metadata: {
                segment: profile?.segment,
                value_score: profile?.value_score,
                risk_score: profile?.risk_score
              }
            };
          }
          return party;
        })
      );
    }
    return vcon;
  }
  
  // ========== Private Methods ==========
  
  private async loadCustomerProfiles(): Promise<void> {
    const { data } = await this.supabase
      .from('customer_profiles')
      .select('*');
    
    if (data) {
      for (const profile of data) {
        this.customerCache.set(profile.identifier, profile);
      }
    }
  }
  
  private async getCustomerProfile(identifier: string): Promise<CustomerProfile> {
    // Check cache first
    if (this.customerCache.has(identifier)) {
      return this.customerCache.get(identifier)!;
    }
    
    // Load from database
    const { data } = await this.supabase
      .from('customer_profiles')
      .select('*')
      .eq('identifier', identifier)
      .single();
    
    if (data) {
      this.customerCache.set(identifier, data);
      return data;
    }
    
    // Create new profile
    return this.createCustomerProfile(identifier);
  }
  
  private async updateCustomerProfile(
    identifier: string,
    vcon: VCon
  ): Promise<void> {
    const profile = await this.getCustomerProfile(identifier);
    
    // Update profile with new conversation data
    profile.total_conversations++;
    profile.last_contact = vcon.created_at;
    profile.topics = this.extractTopics(vcon);
    profile.sentiment_score = this.calculateAverageSentiment(vcon);
    profile.value_score = this.calculateValueScore(profile);
    profile.risk_score = this.calculateRiskScore(profile);
    profile.segment = this.determineSegment(profile);
    
    // Save to database
    await this.supabase
      .from('customer_profiles')
      .upsert(profile);
    
    // Update cache
    this.customerCache.set(identifier, profile);
  }
  
  private async identifyCustomerSegment(args: any): Promise<any> {
    const profile = await this.getCustomerProfile(args.customer_identifier);
    
    if (args.recalculate) {
      await this.recalculateSegment(profile);
    }
    
    return {
      success: true,
      customer: args.customer_identifier,
      segment: profile.segment,
      segment_characteristics: this.getSegmentCharacteristics(profile.segment),
      confidence: profile.segment_confidence,
      last_updated: profile.updated_at
    };
  }
  
  private async getCustomerInsights(args: any): Promise<any> {
    const profile = await this.getCustomerProfile(args.customer_identifier);
    const insights: any = {};
    
    for (const insightType of args.insight_types || ['sentiment', 'topics', 'value']) {
      switch (insightType) {
        case 'sentiment':
          insights.sentiment = await this.generateSentimentInsights(profile);
          break;
        case 'topics':
          insights.topics = await this.generateTopicInsights(profile);
          break;
        case 'behavior':
          insights.behavior = await this.generateBehaviorInsights(profile);
          break;
        case 'value':
          insights.value = await this.generateValueInsights(profile);
          break;
        case 'risk':
          insights.risk = await this.generateRiskInsights(profile);
          break;
      }
    }
    
    return {
      success: true,
      customer: args.customer_identifier,
      insights: insights,
      recommendations: this.generateRecommendations(insights),
      generated_at: new Date().toISOString()
    };
  }
  
  private async findSimilarCustomers(args: any): Promise<any> {
    const targetProfile = await this.getCustomerProfile(args.customer_identifier);
    const allProfiles = Array.from(this.customerCache.values());
    
    // Calculate similarity scores
    const similarities = allProfiles
      .filter(p => p.identifier !== targetProfile.identifier)
      .map(p => ({
        customer: p.identifier,
        similarity_score: this.calculateSimilarity(
          targetProfile,
          p,
          args.similarity_factors || ['topics', 'sentiment', 'behavior']
        ),
        shared_characteristics: this.getSharedCharacteristics(targetProfile, p)
      }))
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, args.limit || 10);
    
    return {
      success: true,
      target_customer: args.customer_identifier,
      similar_customers: similarities,
      similarity_factors: args.similarity_factors
    };
  }
  
  // Implement other private helper methods...
  private extractTopics(vcon: VCon): string[] { return []; }
  private calculateAverageSentiment(vcon: VCon): number { return 0; }
  private calculateValueScore(profile: CustomerProfile): number { return 0; }
  private calculateRiskScore(profile: CustomerProfile): number { return 0; }
  private determineSegment(profile: CustomerProfile): string { return 'unknown'; }
  private getSegmentCharacteristics(segment: string): any { return {}; }
  private calculateSimilarity(p1: CustomerProfile, p2: CustomerProfile, factors: string[]): number { return 0; }
  private getSharedCharacteristics(p1: CustomerProfile, p2: CustomerProfile): any { return {}; }
  // ... etc
}

interface CustomerProfile {
  identifier: string;
  total_conversations: number;
  last_contact: string;
  topics: string[];
  sentiment_score: number;
  value_score: number;
  risk_score: number;
  segment: string;
  segment_confidence: number;
  updated_at: string;
}
```

#### Usage:

```bash
# Install dependencies
npm install

# Build plugin
npm run build

# Configure
export VCON_PLUGINS_PATH=./plugins/customer-intelligence/dist/index.js

# Start server
npm start
```

---

## Best Practices

### 1. Naming Conventions

**Resources:**
- Use versioned URI schemes: `vcon://v1/...`, `analytics://v1/...`, `customer://v1/...`
- Include parameters in description: `customer://v1/profile/{email}`
- Keep URIs short and memorable

**Prompts:**
- Use verb-noun format: `find_angry_customers`, `analyze_sentiment_trends`
- Make descriptions action-oriented
- Include use cases in description

**Tools:**
- Use verb-noun format: `get_statistics`, `analyze_patterns`
- Be specific about what the tool does
- Include parameter descriptions

### 2. Error Handling

```typescript
// Always wrap in try-catch
export async function handleMyTool(input: any): Promise<ToolResponse> {
  try {
    const validated = MyInputSchema.parse(input);
    const result = await performOperation(validated);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ success: true, result })
      }]
    };
  } catch (error) {
    // Provide detailed error information
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          error_type: error.constructor.name,
          timestamp: new Date().toISOString()
        })
      }],
      isError: true
    };
  }
}
```

### 3. Documentation

Always document your extensions:

```typescript
/**
 * Analyze Sentiment Trends Tool
 * 
 * Analyzes sentiment trends across conversations over a specified time period.
 * Groups results by hour, day, week, or month and calculates aggregate sentiment scores.
 * 
 * @param input - SentimentTrendsInput with start_date, end_date, and group_by
 * @returns ToolResponse with sentiment trend analysis and insights
 * 
 * @example
 * ```typescript
 * const result = await handleAnalyzeSentimentTrends({
 *   start_date: '2025-01-01T00:00:00Z',
 *   end_date: '2025-01-31T23:59:59Z',
 *   group_by: 'day'
 * });
 * ```
 * 
 * @throws {McpError} If date range is invalid or exceeds limits
 */
export async function handleAnalyzeSentimentTrends(
  input: SentimentTrendsInput
): Promise<ToolResponse> {
  // Implementation
}
```

### 4. Testing

Test all extensions thoroughly:

```typescript
describe('Customer Intelligence Plugin', () => {
  let plugin: CustomerIntelligencePlugin;
  
  beforeEach(async () => {
    plugin = new CustomerIntelligencePlugin({});
    await plugin.initialize({ supabase: mockSupabase });
  });
  
  it('should register tools', () => {
    const tools = plugin.registerTools();
    expect(tools).toHaveLength(3);
    expect(tools[0].name).toBe('identify_customer_segment');
  });
  
  it('should register resources', () => {
    const resources = plugin.registerResources();
    expect(resources).toHaveLength(3);
    expect(resources[0].uri).toBe('customer://profiles');
  });
  
  it('should identify customer segment', async () => {
    const result = await plugin.handleToolCall(
      'identify_customer_segment',
      { customer_identifier: 'test@example.com' },
      { timestamp: new Date() }
    );
    
    expect(result.success).toBe(true);
    expect(result.segment).toBeDefined();
  });
});
```

### 5. Performance

- Cache frequently accessed data
- Use database indexes for queries
- Implement pagination for large result sets
- Consider rate limiting for expensive operations
- Profile and optimize slow operations

### 6. Security

- Validate all inputs
- Sanitize user-provided data
- Check permissions in hooks
- Never log sensitive information
- Use parameterized queries to prevent SQL injection

---

## Next Steps

- [Plugin Development Guide](./plugins.md) - Complete plugin development documentation
- [Custom Tools Guide](./custom-tools.md) - Comprehensive tool development guide
- [API Reference](../api/) - Full API documentation
- [Examples](../../examples/) - Example plugins and extensions

---

## Getting Help

- **GitHub Issues**: Report bugs or request features
- **Discussions**: Ask questions and share ideas
- **Examples**: Check `examples/` directory for reference implementations
- **Source Code**: Review `src/` for core implementation details

---

**Happy Extending!**

