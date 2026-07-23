# Extension Quick Reference

Fast reference for extending vCon MCP Server functionality.

## Extension Type Decision Tree

```
Want to extend the server?
│
├─ Need to add data browsing?
│  └─ Use: RESOURCES
│     └─ Guide: [Custom Resources](#resources)
│
├─ Want to guide users through queries?
│  └─ Use: PROMPTS
│     └─ Guide: [Custom Prompts](#prompts)
│
├─ Need to add executable operations?
│  └─ Use: TOOLS
│     └─ Guide: [Custom Tools](#tools)
│
├─ Want to package multiple features?
│  └─ Use: PLUGINS
│     └─ Guide: [Plugins](#plugins)
│
└─ Need to modify existing behavior?
   └─ Use: HOOKS (via plugins)
      └─ Guide: [Lifecycle Hooks](#hooks)
```

---

## Quick Comparison

| Feature | Resources | Prompts | Tools | Plugins | Hooks |
|---------|-----------|---------|-------|---------|-------|
| **Purpose** | Browse data | Guide queries | Execute ops | Package features | Modify behavior |
| **Complexity** | Low | Low | Medium | High | High |
| **Read/Write** | Read only | N/A | Read/Write | Both | Both |
| **Parameters** | In URI | In template | In schema | All methods | Via context |
| **Discovery** | Auto listed | Auto listed | Auto listed | Auto loaded | N/A |
| **Packaging** | Direct or plugin | Direct only | Direct or plugin | Module | Plugin only |

---

## Resources

**Purpose:** Provide URI-based access to data (read-only).

### Quick Example

```typescript
// 1. Define resource
{
  uri: 'vcon://v1/stats',
  name: 'Statistics',
  description: 'Overall vCon statistics',
  mimeType: 'application/json'
}

// 2. Handle resolution
if (uri === 'vcon://v1/stats') {
  return {
    mimeType: 'application/json',
    content: { total: 100, recent: 10 }
  };
}
```

### When to Use

- ✅ Browsing data
- ✅ Simple queries
- ✅ Dashboard stats
- ❌ Complex filtering
- ❌ Write operations

### Files to Edit

- `src/resources/index.ts` - Add to `getCoreResources()` and `resolveCoreResource()`

**Full Guide:** [Extending - Custom Resources](./extending.md#custom-resources)

---

## Prompts

**Purpose:** Provide template-based guidance for queries.

### Quick Example

```typescript
// 1. Define prompt
export const myPrompt: PromptDefinition = {
  name: 'find_customers',
  description: 'Find customers by criteria',
  arguments: [
    {
      name: 'criteria',
      description: 'Search criteria',
      required: true
    }
  ]
};

// 2. Generate message
function generateMessage(args: Record<string, string>): string {
  return `Find customers: ${args.criteria}
  
## Step 1: Parse criteria...
## Step 2: Choose search tool...
## Step 3: Execute search...`;
}

// 3. Add to exports
export const allPrompts = [
  // ... existing ...
  myPrompt
];
```

### When to Use

- ✅ Guided workflows
- ✅ Complex query patterns
- ✅ Teaching users
- ❌ Simple operations
- ❌ Direct execution

### Files to Edit

- `src/prompts/index.ts` - Add prompt definition and generator function

**Full Guide:** [Extending - Custom Prompts](./extending.md#custom-prompts)

---

## Tools

**Purpose:** Implement executable operations with parameters.

### Quick Example

```typescript
// 1. Define tool
export const myTool = {
  name: 'analyze_sentiment',
  description: 'Analyze sentiment in vCons',
  inputSchema: {
    type: 'object' as const,
    properties: {
      start_date: { type: 'string' },
      end_date: { type: 'string' }
    },
    required: ['start_date', 'end_date']
  }
};

// 2. Implement handler
export async function handleAnalyzeSentiment(
  input: SentimentInput
): Promise<ToolResponse> {
  const result = await performAnalysis(input);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, result })
    }]
  };
}

// 3. Register in src/index.ts
switch (name) {
  case 'analyze_sentiment':
    return handleAnalyzeSentiment(args);
  // ...
}
```

### When to Use

- ✅ CRUD operations
- ✅ Complex queries
- ✅ Data transformations
- ✅ External integrations
- ❌ Simple data browsing

### Files to Create/Edit

- `src/tools/my-tools.ts` - Define and implement
- `src/index.ts` - Register in switch statement

**Full Guide:** [Custom Tools](./custom-tools.md)

---

## Plugins

**Purpose:** Package resources, prompts, tools, and hooks as reusable modules.

### Quick Example

```typescript
// plugins/my-plugin/index.ts
import { VConPlugin } from 'vcon-mcp/hooks';

export default class MyPlugin implements VConPlugin {
  name = 'my-plugin';
  version = '1.0.0';
  
  async initialize(config: any): Promise<void> {
    console.error('✅ Plugin initialized');
  }
  
  registerTools(): Tool[] {
    return [/* tools */];
  }
  
  registerResources(): Resource[] {
    return [/* resources */];
  }
  
  async handleToolCall(name: string, args: any): Promise<any> {
    // Handle tool execution
  }
  
  // Lifecycle hooks
  async afterCreate(vcon: VCon): Promise<void> {
    // Do something after vCon creation
  }
}
```

### When to Use

- ✅ Multiple related features
- ✅ Reusable functionality
- ✅ Distributable modules
- ✅ Proprietary features
- ❌ Quick prototypes
- ❌ Core modifications

### Setup

```bash
# 1. Create plugin directory
mkdir -p plugins/my-plugin

# 2. Create plugin file
# (code above)

# 3. Load plugin
export VCON_PLUGINS_PATH=./plugins/my-plugin/index.js

# 4. Start server
npm start
```

**Full Guide:** [Plugin Development](./plugins.md)

---

## Hooks

**Purpose:** Intercept and modify operations (via plugins only).

### Available Hooks

| Hook | When Called | Can Block | Can Modify |
|------|-------------|-----------|------------|
| `beforeCreate` | Before vCon created | ✅ Yes | ✅ vCon |
| `afterCreate` | After vCon created | ❌ No | ❌ No |
| `beforeRead` | Before vCon read | ✅ Yes | ❌ No |
| `afterRead` | After vCon read | ❌ No | ✅ vCon |
| `beforeUpdate` | Before vCon updated | ✅ Yes | ✅ Updates |
| `afterUpdate` | After vCon updated | ❌ No | ❌ No |
| `beforeDelete` | Before vCon deleted | ✅ Yes | ❌ No |
| `afterDelete` | After vCon deleted | ❌ No | ❌ No |
| `beforeSearch` | Before search | ❌ No | ✅ Criteria |
| `afterSearch` | After search | ❌ No | ✅ Results |

### Quick Example

```typescript
export default class AuditPlugin implements VConPlugin {
  name = 'audit';
  version = '1.0.0';
  
  // Log all operations
  async afterCreate(vcon: VCon, context: RequestContext): Promise<void> {
    await this.logAudit('create', vcon.uuid, context.userId);
  }
  
  async afterRead(vcon: VCon, context: RequestContext): Promise<VCon> {
    await this.logAudit('read', vcon.uuid, context.userId);
    return vcon;
  }
  
  async beforeDelete(uuid: string, context: RequestContext): Promise<void> {
    // Check if deletion is allowed
    if (!await this.canDelete(uuid, context.userId)) {
      throw new Error('Deletion not permitted');
    }
  }
  
  // Modify search results
  async afterSearch(results: VCon[], context: RequestContext): Promise<VCon[]> {
    // Filter based on permissions
    return results.filter(v => this.canAccess(v, context.userId));
  }
}
```

### When to Use

- ✅ Audit logging
- ✅ Access control
- ✅ Data transformation
- ✅ Validation rules
- ❌ New operations (use tools)
- ❌ Data browsing (use resources)

**Full Guide:** [Plugin Development - Hooks](./plugins.md#available-hooks)

---

## Common Patterns

### Pattern 1: Analytics Dashboard

```
Resource: vcon://v1/analytics/summary
  └─> Quick stats display

Tools: 
  └─> analyze_trends (detailed analysis)
  └─> export_report (data export)

Prompt: analyze_conversation_patterns
  └─> Guides users through analysis
```

### Pattern 2: Customer Intelligence

```
Plugin: customer-intelligence
  ├─> Resources:
  │   ├─> customer://profiles (browse)
  │   └─> customer://profile/{id} (detail)
  │
  ├─> Tools:
  │   ├─> identify_segment (classify)
  │   ├─> get_insights (analyze)
  │   └─> find_similar (compare)
  │
  └─> Hooks:
      ├─> afterCreate (update profiles)
      └─> afterRead (enrich data)
```

### Pattern 3: Compliance Suite

```
Plugin: compliance
  ├─> Tools:
  │   ├─> check_compliance (validate)
  │   ├─> generate_audit (report)
  │   └─> apply_retention (cleanup)
  │
  └─> Hooks:
      ├─> beforeCreate (validate)
      ├─> beforeRead (check permissions)
      ├─> afterRead (redact PII)
      └─> beforeDelete (check retention)
```

---

## File Locations

### Direct Extension

```
src/
├── resources/
│   └── index.ts              # Add resources here
├── prompts/
│   └── index.ts              # Add prompts here
├── tools/
│   ├── my-tools.ts          # Create tool files
│   └── index.ts             # Export tools
└── index.ts                  # Register tools
```

### Plugin Extension

```
plugins/
└── my-plugin/
    ├── package.json         # Plugin metadata
    ├── index.ts             # Plugin class
    ├── tools.ts             # Tool definitions
    ├── resources.ts         # Resource handlers
    └── hooks.ts             # Lifecycle hooks
```

---

## Testing Your Extension

### Test Resources

```bash
# Via MCP Inspector
npm run test:console

# Access resource
resources/list
resources/read vcon://v1/stats
```

### Test Tools

```bash
# Via MCP Inspector
npm run test:console

# Then use:
tools/list
tools/call my_tool {"param": "value"}

# Via test script
npm run test:tools
```

### Test Prompts

```bash
# Via MCP Inspector
npm run test:console

# Then use:
prompts/list
prompts/get my_prompt {"arg": "value"}
```

### Test Plugins

```bash
# Set plugin path
export VCON_PLUGINS_PATH=./plugins/my-plugin/index.js

# Start server (check logs)
npm start

# Verify plugin loaded
# Look for: "📦 Registering plugin: my-plugin"
```

---

## Environment Variables

```bash
# Core configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-key

# Plugin loading (comma-separated)
VCON_PLUGINS_PATH=./plugin1.js,@vendor/plugin2,./plugin3.js

# Plugin configuration
VCON_LICENSE_KEY=your-license-key
VCON_OFFLINE_MODE=false
```

---

## Next Steps

Choose your extension approach:

1. **Quick Prototype** → Add directly to core
   - [Resources](./extending.md#custom-resources)
   - [Prompts](./extending.md#custom-prompts)
   - [Tools](./custom-tools.md)

2. **Reusable Module** → Create plugin
   - [Plugin Guide](./plugins.md)
   - [Complete Examples](./extending.md#complete-examples)

3. **Modify Behavior** → Use hooks
   - [Lifecycle Hooks](./plugins.md#available-hooks)
   - [Hook Examples](./extending.md#via-plugins)

---

## Complete Documentation

- **[Extension Guide](./extending.md)** - Comprehensive guide with examples
- **[Plugin Development](./plugins.md)** - Complete plugin documentation
- **[Custom Tools](./custom-tools.md)** - Tool development guide
- **[Architecture](./architecture.md)** - System design and internals

---

## Getting Help

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: Questions and community support
- **Examples Directory**: `examples/` for reference implementations
- **Source Code**: `src/` for core implementation details

---

**Ready to extend?** Pick an approach above and start building!

