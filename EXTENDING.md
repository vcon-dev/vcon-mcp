# Extending vCon MCP Server

This guide provides an overview of all the ways you can extend and customize the vCon MCP Server.

## Quick Links

- **[Complete Extension Guide](docs/development/extending.md)** - Comprehensive guide with detailed examples
- **[Quick Reference](docs/development/extension-quick-reference.md)** - Fast lookup and decision tree
- **[Plugin Development](docs/development/plugins.md)** - Complete plugin documentation
- **[Custom Tools](docs/development/custom-tools.md)** - Tool development guide

---

## Extension Options at a Glance

### 1. Resources (Discoverable Data Access)

**What:** URI-based, read-only access to data  
**When:** Browsing data, simple queries, dashboard stats  
**How:** Add to `src/resources/index.ts` or via plugin

```typescript
{
  uri: 'vcon://analytics/summary',
  name: 'Analytics Summary',
  description: 'Overall conversation analytics',
  mimeType: 'application/json'
}
```

**Documentation:** [Extension Guide - Resources](docs/development/extending.md#custom-resources)

---

### 2. Prompts (Guided Query Templates)

**What:** Template-based guidance for queries  
**When:** Help users search effectively, complex query patterns  
**How:** Add to `src/prompts/index.ts`

```typescript
export const myPrompt: PromptDefinition = {
  name: 'find_customers',
  description: 'Find customers by criteria',
  arguments: [
    { name: 'criteria', description: 'Search criteria', required: true }
  ]
};
```

**Documentation:** [Extension Guide - Prompts](docs/development/extending.md#custom-prompts)

---

### 3. Tools (Executable Operations)

**What:** Operations with parameters that execute and return results  
**When:** CRUD operations, analytics, exports, integrations  
**How:** Add to `src/tools/` and register in `src/index.ts` or via plugin

```typescript
export const analyticsTool = {
  name: 'get_analytics',
  description: 'Get conversation analytics',
  inputSchema: {
    type: 'object' as const,
    properties: {
      period: { type: 'string', enum: ['7d', '30d', '90d'] }
    },
    required: ['period']
  }
};
```

**Documentation:** [Custom Tools Guide](docs/development/custom-tools.md)

---

### 4. Plugins (Package Multiple Features)

**What:** Reusable modules that can add resources, tools, and hooks  
**When:** Package related features, distribute functionality, proprietary features  
**How:** Create plugin class implementing `VConPlugin` interface

```typescript
export default class MyPlugin implements VConPlugin {
  name = 'my-plugin';
  version = '1.0.0';
  
  registerTools(): Tool[] { return [/* tools */]; }
  registerResources(): Resource[] { return [/* resources */]; }
  
  async afterCreate(vcon: VCon): Promise<void> {
    // Hook implementation
  }
}
```

**Documentation:** [Plugin Development Guide](docs/development/plugins.md)

---

### 5. Hooks (Modify Core Behavior)

**What:** Lifecycle hooks to intercept and modify operations  
**When:** Audit logging, access control, data transformation  
**How:** Implement hooks in plugin class

Available hooks:
- `beforeCreate`, `afterCreate`
- `beforeRead`, `afterRead`
- `beforeUpdate`, `afterUpdate`
- `beforeDelete`, `afterDelete`
- `beforeSearch`, `afterSearch`

**Documentation:** [Plugin Development - Hooks](docs/development/plugins.md#available-hooks)

---

## Decision Guide

```
What do you want to add?

├─ Browse or display data?
│  └─ Use: RESOURCES
│     └─ Example: vcon://analytics/summary
│
├─ Guide users through queries?
│  └─ Use: PROMPTS
│     └─ Example: find_high_value_customers
│
├─ Execute operations with parameters?
│  └─ Use: TOOLS
│     └─ Example: analyze_sentiment_trends
│
├─ Package multiple features?
│  └─ Use: PLUGINS
│     └─ Example: customer-intelligence-plugin
│
└─ Modify existing behavior?
   └─ Use: HOOKS (via plugins)
      └─ Example: audit-logging-plugin
```

---

## Common Use Cases

### Use Case 1: Add Analytics

**Goal:** Provide analytics and insights

**Solution:**
- **Resource:** `vcon://analytics/summary` for quick stats
- **Tool:** `analyze_trends` for detailed analysis with parameters
- **Prompt:** `analyze_conversation_patterns` to guide users

**Example:** [Extension Guide - Analytics Example](docs/development/extending.md#example-1-analytics-extension)

---

### Use Case 2: Customer Intelligence

**Goal:** Build customer profiles and find similar customers

**Solution:**
- **Plugin:** `customer-intelligence`
  - Resources: Browse profiles
  - Tools: Identify segments, get insights, find similar
  - Hooks: Update profiles on vCon creation

**Example:** [Extension Guide - Customer Intelligence Plugin](docs/development/extending.md#example-2-customer-intelligence-plugin)

---

### Use Case 3: Compliance and Privacy

**Goal:** Add GDPR compliance, consent management, redaction

**Solution:**
- **Plugin:** `compliance-suite`
  - Tools: Check consent, validate compliance
  - Hooks: Enforce permissions, redact PII
  - Resources: Audit logs, compliance reports

**Example:** [Extension Guide - Compliance Pattern](docs/development/extension-quick-reference.md#pattern-3-compliance-suite)

---

## Getting Started

### 1. Choose Your Approach

**Quick Prototype** (modify core directly):
1. Add resource to `src/resources/index.ts`
2. Add tool to `src/tools/my-tools.ts`
3. Register in `src/index.ts`
4. Rebuild: `npm run build`

**Reusable Module** (create plugin):
1. Create `plugins/my-plugin/index.ts`
2. Implement `VConPlugin` interface
3. Set `VCON_PLUGINS_PATH=./plugins/my-plugin/index.js`
4. Start: `npm run dev`

### 2. Read the Documentation

- Start with [Extension Guide](docs/development/extending.md) for comprehensive coverage
- Use [Quick Reference](docs/development/extension-quick-reference.md) for fast lookups
- Dive into [Plugin Guide](docs/development/plugins.md) for plugins
- Check [Custom Tools](docs/development/custom-tools.md) for tool patterns

### 3. Study Examples

- `examples/logging-plugin.js` - Simple plugin example
- `src/resources/index.ts` - Resource examples
- `src/prompts/index.ts` - Prompt examples
- `src/tools/` - Tool examples

### 4. Test Your Extension

```bash
# Build
npm run build

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js

# Or test with Claude Desktop
# Update claude_desktop_config.json and restart Claude
```

---

## File Structure

```
vcon-mcp/
├── src/
│   ├── resources/
│   │   └── index.ts           # Add resources here
│   ├── prompts/
│   │   └── index.ts           # Add prompts here
│   ├── tools/
│   │   ├── vcon-crud.ts       # Core tools
│   │   └── my-tools.ts        # Add custom tools
│   ├── hooks/
│   │   ├── plugin-interface.ts # Plugin interface
│   │   └── plugin-manager.ts   # Plugin system
│   └── index.ts               # Register tools
│
├── plugins/                    # Plugin directory
│   └── my-plugin/
│       ├── package.json
│       └── index.ts           # Plugin implementation
│
└── docs/
    └── development/
        ├── extending.md        # Complete guide
        ├── extension-quick-reference.md
        ├── plugins.md         # Plugin guide
        └── custom-tools.md    # Tool guide
```

---

## Examples by Type

### Resource Example

```typescript
// src/resources/index.ts
export function getCoreResources(): ResourceDescriptor[] {
  return [
    {
      uri: 'vcon://stats',
      name: 'Statistics',
      description: 'Overall vCon statistics',
      mimeType: 'application/json'
    }
  ];
}

export async function resolveCoreResource(
  queries: VConQueries,
  uri: string
): Promise<{ mimeType: string; content: any } | undefined> {
  if (uri === 'vcon://stats') {
    const stats = await queries.getStatistics();
    return { mimeType: 'application/json', content: stats };
  }
}
```

### Prompt Example

```typescript
// src/prompts/index.ts
export const myPrompt: PromptDefinition = {
  name: 'find_patterns',
  description: 'Find patterns in conversations',
  arguments: [
    { name: 'pattern_type', description: 'Type of pattern', required: true }
  ]
};

function generateMessage(args: Record<string, string>): string {
  return `Find patterns: ${args.pattern_type}
  
## Step 1: Identify pattern type
## Step 2: Choose search approach
## Step 3: Execute and analyze`;
}
```

### Tool Example

```typescript
// src/tools/analytics-tools.ts
export const analyticsTool = {
  name: 'get_analytics',
  description: 'Get analytics for a period',
  inputSchema: {
    type: 'object' as const,
    properties: {
      period: { type: 'string' }
    }
  }
};

export async function handleGetAnalytics(input: any): Promise<ToolResponse> {
  const results = await calculateAnalytics(input.period);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, results })
    }]
  };
}
```

### Plugin Example

```typescript
// plugins/my-plugin/index.ts
import { VConPlugin } from '@vcon/mcp-server/hooks';

export default class MyPlugin implements VConPlugin {
  name = 'my-plugin';
  version = '1.0.0';
  
  async initialize(config: any): Promise<void> {
    console.error('Plugin initialized');
  }
  
  registerTools(): Tool[] {
    return [{
      name: 'my_tool',
      description: 'My custom tool',
      inputSchema: { type: 'object', properties: {} }
    }];
  }
  
  async handleToolCall(toolName: string, args: any): Promise<any> {
    if (toolName === 'my_tool') {
      return { success: true, result: 'done' };
    }
  }
  
  async afterCreate(vcon: VCon): Promise<void> {
    console.error(`vCon created: ${vcon.uuid}`);
  }
}
```

---

## Environment Variables

```bash
# Core
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-key

# Plugin loading
VCON_PLUGINS_PATH=./plugin1.js,@vendor/plugin2,./plugin3.js

# Plugin configuration
VCON_LICENSE_KEY=your-license
VCON_OFFLINE_MODE=false
```

---

## Best Practices

1. **Start Simple** - Begin with direct extension, migrate to plugins as needed
2. **Document Everything** - Add clear descriptions and examples
3. **Test Thoroughly** - Write tests for all custom functionality
4. **Follow Patterns** - Study existing resources, tools, and plugins
5. **Handle Errors** - Always validate inputs and handle errors gracefully
6. **Use TypeScript** - Take advantage of type safety
7. **Version Control** - Use semantic versioning for plugins

---

## Need Help?

- **Documentation Issues**: Open an issue on GitHub
- **Extension Questions**: Use GitHub Discussions
- **Plugin Development**: Check [Plugin Guide](docs/development/plugins.md)
- **Examples**: Browse `examples/` and `src/` directories

---

## Next Steps

1. **Read** the [Complete Extension Guide](docs/development/extending.md)
2. **Try** adding a simple resource or tool
3. **Build** a plugin for your use case
4. **Share** your extensions with the community

---

**Ready to extend?** Pick an approach and start building! 🚀

