# Examples

Practical examples and code snippets for using the vCon MCP Server.

## Overview

This section provides real-world examples of:
- Basic CRUD operations
- Search and query patterns
- Plugin development
- System integration

## Quick Examples

### Create a vCon

```typescript
import { VConQueries } from '@vcon/mcp-server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(url, key);
const queries = new VConQueries(supabase);

const vcon = await queries.createVCon({
  vcon: '0.3.0',
  uuid: crypto.randomUUID(),
  created_at: new Date().toISOString(),
  subject: 'Customer Support Call',
  parties: [
    { name: 'Agent', mailto: 'agent@example.com' },
    { name: 'Customer', tel: '+1-555-0100' }
  ]
});
```

### Search vCons

```typescript
// Keyword search
const results = await queries.searchVConsContent({
  query: 'billing issue refund',
  limit: 10
});

// Tag-based search
const tagged = await queries.searchByTags({
  tags: {
    department: 'support',
    priority: 'high'
  }
});
```

### Add Analysis

```typescript
await queries.addAnalysis(vconUuid, {
  type: 'sentiment',
  vendor: 'OpenAI',
  product: 'GPT-4',
  schema: 'v1.0',
  body: JSON.stringify({
    sentiment: 'positive',
    score: 0.85,
    confidence: 0.92
  }),
  encoding: 'json'
});
```

## Example Categories

### [Basic Operations](./basic-operations.md)
- Creating vCons
- Reading vCons
- Updating vCons
- Deleting vCons
- Adding components (dialog, analysis, attachments)

### [Search Examples](./search-examples.md)
- Keyword search
- Semantic search
- Hybrid search
- Tag filtering
- Date range queries
- Complex filters

### [Plugin Examples](./plugin-examples.md)
- Simple logging plugin
- Access control plugin
- Audit trail plugin
- Custom tool plugin
- Data transformation plugin

### [Integration Examples](./integration-examples.md)
- Claude Desktop integration
- REST API wrapper
- Webhook integration
- CRM integration
- Real-time updates

## Use Case Examples

### Contact Center

```typescript
// Record a customer call
const callVCon = await queries.createVConFromTemplate({
  template_name: 'phone_call',
  subject: 'Customer Inquiry',
  parties: [
    { name: 'Agent Smith', mailto: 'smith@company.com', role: 'agent' },
    { name: 'John Doe', tel: '+1-555-1234', role: 'customer' }
  ]
});

// Add transcription
await queries.addAnalysis(callVCon.uuid, {
  type: 'transcript',
  vendor: 'Deepgram',
  body: 'Customer: I have a question about my bill...',
  encoding: 'none'
});

// Add sentiment
await queries.addAnalysis(callVCon.uuid, {
  type: 'sentiment',
  vendor: 'OpenAI',
  body: JSON.stringify({ sentiment: 'neutral', score: 0.5 }),
  encoding: 'json'
});

// Tag for organization
await queries.addTag(callVCon.uuid, 'department', 'billing');
await queries.addTag(callVCon.uuid, 'resolved', true);
```

### Sales Team

```typescript
// Create sales call vCon
const salesCall = await queries.createVCon({
  vcon: '0.3.0',
  uuid: crypto.randomUUID(),
  created_at: new Date().toISOString(),
  subject: 'Enterprise Demo Call',
  parties: [
    { name: 'Sales Rep', mailto: 'rep@company.com' },
    { name: 'Prospect', mailto: 'prospect@client.com' }
  ]
});

// Extract action items
await queries.addAnalysis(salesCall.uuid, {
  type: 'action_items',
  vendor: 'Claude',
  body: JSON.stringify({
    items: [
      { task: 'Send pricing', owner: 'Sales Rep', due: '2025-10-20' },
      { task: 'Schedule followup', owner: 'Sales Rep', due: '2025-10-22' }
    ]
  }),
  encoding: 'json'
});

// Tag for pipeline
await queries.addTag(salesCall.uuid, 'stage', 'demo');
await queries.addTag(salesCall.uuid, 'deal_size', '50000');
```

## Running Examples

```bash
# Clone repository
git clone https://github.com/vcon-dev/vcon-mcp.git
cd vcon-mcp

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your credentials

# Run example scripts
npx tsx examples/create-vcon.ts
npx tsx examples/search-demo.ts
npx tsx examples/plugin-demo.ts
```

## Next Steps

- Try the [Basic Operations](./basic-operations.md) examples
- Explore [Search Examples](./search-examples.md)
- Build your own [Plugin](./plugin-examples.md)
- See [Integration Examples](./integration-examples.md)

