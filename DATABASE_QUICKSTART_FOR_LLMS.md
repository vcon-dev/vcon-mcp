# vCon Database Quick Start for LLMs

**Purpose**: Rapid reference guide for LLMs building applications that interact with the vCon database.

**Read This If**: You need to quickly understand how to create, query, search, and manage vCon data programmatically.

---

## TL;DR - 5 Minute Overview

**What is this database?**
- PostgreSQL database storing IETF-compliant vCon (Virtual Conversation) data
- Normalized relational structure (8 core tables + extensions)
- Built-in full-text search, semantic search, and tag filtering
- Multi-tenant support with Row Level Security (RLS)
- Optional Redis caching for performance

**Main Tables**:
- `vcons` - Conversation containers (parent)
- `parties` - Participants
- `dialog` - Conversation segments
- `analysis` - AI/ML results
- `attachments` - Files and metadata
- `groups` - vCon references
- `vcon_embeddings` - Semantic search vectors

**Access Methods**:
1. Direct SQL queries (PostgreSQL)
2. Supabase client (TypeScript/JavaScript)
3. MCP tools (for AI assistants)
4. REST API (via Supabase)

---

## Quick Start: Create Your First vCon

### Using Supabase Client (TypeScript)

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Step 1: Create vCon
const { data: vconData, error: vconError } = await supabase
  .from('vcons')
  .insert({
    uuid: '550e8400-e29b-41d4-a716-446655440000',
    vcon_version: '0.3.0',
    subject: 'Customer Support Call',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  })
  .select('id, uuid')
  .single();

if (vconError) throw vconError;

// Step 2: Add parties
await supabase.from('parties').insert([
  {
    vcon_id: vconData.id,
    party_index: 0,
    name: 'Alice Agent',
    mailto: 'alice@support.example.com'
  },
  {
    vcon_id: vconData.id,
    party_index: 1,
    name: 'Bob Customer',
    tel: '+1-555-0100'
  }
]);

// Step 3: Add dialog
await supabase.from('dialog').insert({
  vcon_id: vconData.id,
  dialog_index: 0,
  type: 'text',
  body: 'Hello, how can I help you today?',
  encoding: 'none',
  parties: [0, 1]
});

// Step 4: Add analysis
await supabase.from('analysis').insert({
  vcon_id: vconData.id,
  analysis_index: 0,
  type: 'summary',
  vendor: 'OpenAI',  // REQUIRED field
  product: 'GPT-4',
  schema: 'v1.0',    // Note: 'schema' not 'schema_version'
  body: 'Positive customer support interaction regarding billing inquiry.',
  encoding: 'none'
});

// Step 5: Add tags (as attachment)
await supabase.from('attachments').insert({
  vcon_id: vconData.id,
  attachment_index: 0,
  type: 'tags',
  encoding: 'json',
  body: JSON.stringify(['status:open', 'priority:normal', 'category:billing'])
});

console.log('vCon created:', vconData.uuid);
```

### Using Direct SQL

```sql
-- Step 1: Create vCon
INSERT INTO vcons (uuid, vcon_version, subject, created_at, updated_at)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  '0.3.0',
  'Customer Support Call',
  NOW(),
  NOW()
)
RETURNING id, uuid;

-- Step 2: Add parties (use returned id from above)
INSERT INTO parties (vcon_id, party_index, name, mailto) VALUES
  ('...vcon-id...', 0, 'Alice Agent', 'alice@support.example.com'),
  ('...vcon-id...', 1, 'Bob Customer', NULL);

-- Step 3: Add dialog
INSERT INTO dialog (vcon_id, dialog_index, type, body, encoding, parties)
VALUES (
  '...vcon-id...',
  0,
  'text',
  'Hello, how can I help you today?',
  'none',
  ARRAY[0, 1]
);

-- Step 4: Add analysis
INSERT INTO analysis (vcon_id, analysis_index, type, vendor, product, schema, body, encoding)
VALUES (
  '...vcon-id...',
  0,
  'summary',
  'OpenAI',
  'GPT-4',
  'v1.0',
  'Positive customer support interaction regarding billing inquiry.',
  'none'
);

-- Step 5: Add tags
INSERT INTO attachments (vcon_id, attachment_index, type, encoding, body)
VALUES (
  '...vcon-id...',
  0,
  'tags',
  'json',
  '["status:open", "priority:normal", "category:billing"]'
);
```

---

## Quick Start: Retrieve a vCon

### Get Complete vCon by UUID

```typescript
// Get vCon metadata
const { data: vcon } = await supabase
  .from('vcons')
  .select('*')
  .eq('uuid', vconUuid)
  .single();

// Get parties
const { data: parties } = await supabase
  .from('parties')
  .select('*')
  .eq('vcon_id', vcon.id)
  .order('party_index');

// Get dialog
const { data: dialog } = await supabase
  .from('dialog')
  .select('*')
  .eq('vcon_id', vcon.id)
  .order('dialog_index');

// Get analysis
const { data: analysis } = await supabase
  .from('analysis')
  .select('*')
  .eq('vcon_id', vcon.id)
  .order('analysis_index');

// Get attachments
const { data: attachments } = await supabase
  .from('attachments')
  .select('*')
  .eq('vcon_id', vcon.id)
  .order('attachment_index');

// Assemble complete vCon
const completeVCon = {
  vcon: vcon.vcon_version,
  uuid: vcon.uuid,
  created_at: vcon.created_at,
  updated_at: vcon.updated_at,
  subject: vcon.subject,
  parties,
  dialog,
  analysis,
  attachments
};
```

### Get vCon Metadata Only (Fast)

```typescript
const { data: vcon } = await supabase
  .from('vcons')
  .select('uuid, subject, created_at, updated_at')
  .eq('uuid', vconUuid)
  .single();
```

---

## Quick Start: Search vCons

### 1. Keyword Search (Full-Text)

```typescript
// Search across subject, parties, dialog, and analysis
const { data, error } = await supabase.rpc('search_vcons_keyword', {
  query_text: 'billing refund',
  start_date: null,
  end_date: null,
  tag_filter: {},
  max_results: 50
});

// Result format:
// [
//   {
//     vcon_id: '...',
//     doc_type: 'dialog',
//     ref_index: 0,
//     rank: 0.875,
//     snippet: '...billing <b>refund</b> request...'
//   }
// ]
```

### 2. Semantic Search (AI-Powered)

```typescript
// First, generate embedding for query (using OpenAI or similar)
const queryEmbedding = await generateEmbedding('frustrated customers');

// Search using vector similarity
const { data, error } = await supabase.rpc('search_vcons_semantic', {
  query_embedding: queryEmbedding,
  tag_filter: {},
  match_threshold: 0.75,
  match_count: 20
});

// Result format:
// [
//   {
//     vcon_id: '...',
//     content_type: 'dialog',
//     content_reference: '0',
//     content_text: 'Original dialog text...',
//     similarity: 0.89
//   }
// ]
```

### 3. Hybrid Search (Best of Both)

```typescript
const queryEmbedding = await generateEmbedding('billing issues');

const { data, error } = await supabase.rpc('search_vcons_hybrid', {
  keyword_query: 'billing refund',
  query_embedding: queryEmbedding,
  tag_filter: {},
  semantic_weight: 0.6,  // 60% semantic, 40% keyword
  limit_results: 50
});

// Result format:
// [
//   {
//     vcon_id: '...',
//     combined_score: 0.82,
//     semantic_score: 0.85,
//     keyword_score: 0.78
//   }
// ]
```

### 4. Tag-Based Search

```typescript
// Find vCons with specific tags
const { data, error } = await supabase.rpc('search_vcons_by_tags', {
  required_tags: {
    status: 'open',
    priority: 'high',
    category: 'billing'
  },
  max_results: 100
});

// Returns array of vCon UUIDs
```

### 5. Simple Filter Queries

```typescript
// By date range
const { data } = await supabase
  .from('vcons')
  .select('*')
  .gte('created_at', '2025-01-01')
  .lte('created_at', '2025-12-31')
  .order('created_at', { ascending: false })
  .limit(100);

// By subject keyword
const { data } = await supabase
  .from('vcons')
  .select('*')
  .ilike('subject', '%billing%')
  .limit(50);

// By party email
const { data } = await supabase
  .from('vcons')
  .select('*, parties(*)')
  .eq('parties.mailto', 'user@example.com')
  .limit(50);
```

---

## Quick Start: Update vCon

### Update Metadata

```typescript
const { data, error } = await supabase
  .from('vcons')
  .update({
    subject: 'Updated Subject',
    updated_at: new Date().toISOString()
  })
  .eq('uuid', vconUuid);
```

### Add More Dialog

```typescript
// Get current vCon to find next dialog index
const { data: vcon } = await supabase
  .from('vcons')
  .select('id')
  .eq('uuid', vconUuid)
  .single();

const { data: existingDialog } = await supabase
  .from('dialog')
  .select('dialog_index')
  .eq('vcon_id', vcon.id)
  .order('dialog_index', { ascending: false })
  .limit(1);

const nextIndex = existingDialog[0]?.dialog_index + 1 || 0;

// Insert new dialog
await supabase.from('dialog').insert({
  vcon_id: vcon.id,
  dialog_index: nextIndex,
  type: 'text',
  body: 'Additional message...',
  encoding: 'none',
  parties: [0]
});
```

### Add More Analysis

```typescript
const { data: vcon } = await supabase
  .from('vcons')
  .select('id')
  .eq('uuid', vconUuid)
  .single();

const { data: existingAnalysis } = await supabase
  .from('analysis')
  .select('analysis_index')
  .eq('vcon_id', vcon.id)
  .order('analysis_index', { ascending: false })
  .limit(1);

const nextIndex = existingAnalysis[0]?.analysis_index + 1 || 0;

await supabase.from('analysis').insert({
  vcon_id: vcon.id,
  analysis_index: nextIndex,
  type: 'sentiment',
  vendor: 'AWS',
  product: 'Comprehend',
  schema: 'v2.0',
  body: JSON.stringify({ sentiment: 'POSITIVE', score: 0.92 }),
  encoding: 'json'
});
```

### Update Tags

```typescript
// Find existing tags attachment
const { data: tagsAttachment } = await supabase
  .from('attachments')
  .select('id, body')
  .eq('vcon_id', vconId)
  .eq('type', 'tags')
  .single();

if (tagsAttachment) {
  // Update existing tags
  const currentTags = JSON.parse(tagsAttachment.body);
  const newTags = [...currentTags, 'status:closed', 'resolved:yes'];
  
  await supabase
    .from('attachments')
    .update({ body: JSON.stringify(newTags) })
    .eq('id', tagsAttachment.id);
} else {
  // Create new tags attachment
  const nextIndex = await getNextAttachmentIndex(vconId);
  
  await supabase.from('attachments').insert({
    vcon_id: vconId,
    attachment_index: nextIndex,
    type: 'tags',
    encoding: 'json',
    body: JSON.stringify(['status:closed', 'resolved:yes'])
  });
}
```

---

## Quick Start: Delete vCon

```typescript
// Cascading delete - removes all related data automatically
const { error } = await supabase
  .from('vcons')
  .delete()
  .eq('uuid', vconUuid);

if (!error) {
  console.log('vCon and all related data deleted');
}
```

---

## Quick Start: Multi-Tenant Setup

### Add Tenant to vCon

```typescript
// Add tenant as attachment during vCon creation
await supabase.from('attachments').insert({
  vcon_id: vconData.id,
  attachment_index: 0,
  type: 'tenant',
  encoding: 'json',
  body: JSON.stringify({
    id: 'acme-corp',
    name: 'Acme Corporation'
  })
});

// Populate tenant_id column (run once after adding tenant attachments)
await supabase.rpc('populate_tenant_ids_batch', {
  p_attachment_type: 'tenant',
  p_json_path: 'id',
  p_batch_size: 1000
});
```

### Set Tenant Context (RLS)

```typescript
// Set current tenant for session
await supabase.rpc('set_config', {
  setting: 'app.current_tenant_id',
  value: 'acme-corp',
  is_local: true
});

// Now all queries automatically filter by tenant
const { data } = await supabase.from('vcons').select('*');
// Only returns vCons for 'acme-corp'
```

---

## Quick Reference: Critical Field Names

**Common Mistakes to Avoid**:

| Wrong | Correct | Notes |
|-------|---------|-------|
| `schema_version` | `schema` | Analysis schema field name |
| `analysis.vendor` optional | `analysis.vendor` REQUIRED | Must always provide vendor |
| `body` as JSONB | `body` as TEXT | All body fields are TEXT type |
| `parties` as `parties[]` | `parties` as `INTEGER[]` | Dialog parties are integer array |
| Default encoding values | No default encoding | encoding must be explicitly set or NULL |

**Required vs Optional Fields**:

| Table | Always Required | Often Optional |
|-------|----------------|----------------|
| `vcons` | `uuid`, `vcon_version`, `created_at`, `updated_at` | `subject`, `extensions`, `tenant_id` |
| `parties` | `vcon_id`, `party_index` | All contact fields (tel, mailto, name, etc.) |
| `dialog` | `vcon_id`, `dialog_index`, `type` | `body`, `parties`, `start_time` |
| `analysis` | `vcon_id`, `analysis_index`, `type`, `vendor` | `body`, `product`, `schema` |
| `attachments` | `vcon_id`, `attachment_index` | `type`, `body`, `encoding` |

---

## Quick Reference: Data Types

### Encoding Values

Valid values: `'base64url'`, `'json'`, `'none'`, or `NULL`

```typescript
// Text content - use 'none'
body: 'Hello world',
encoding: 'none'

// JSON content - use 'json'
body: JSON.stringify({ sentiment: 'positive' }),
encoding: 'json'

// Binary content - use 'base64url'
body: 'iVBORw0KGgoAAAANSUhEU...',
encoding: 'base64url'
```

### Dialog Types

Valid values: `'recording'`, `'text'`, `'transfer'`, `'incomplete'`

```typescript
// Text message
{ type: 'text', body: 'Message content', encoding: 'none' }

// Audio recording
{ type: 'recording', url: 'https://...', mediatype: 'audio/wav' }

// Call transfer
{ type: 'transfer', transferor: 0, transferee: 1 }

// Incomplete recording
{ type: 'incomplete', disposition: 'no-answer' }
```

### Party Event Types

Valid values: `'join'`, `'drop'`, `'hold'`, `'unhold'`, `'mute'`, `'unmute'`

### Dialog Dispositions

Valid values: `'no-answer'`, `'congestion'`, `'failed'`, `'busy'`, `'hung-up'`, `'voicemail-no-message'`

---

## Quick Reference: Performance Tips

### 1. Use Limits

```typescript
// Good - limits result set
.limit(100)

// Bad - could return millions of rows
// (no limit)
```

### 2. Use Indexes

```typescript
// Good - uses index on uuid
.eq('uuid', '...')

// Good - uses index on created_at
.gte('created_at', '2025-01-01')

// Less efficient - full table scan
.like('subject', '%keyword%')  // Use search RPC instead
```

### 3. Fetch Only Needed Fields

```typescript
// Good - only fetches needed columns
.select('uuid, subject, created_at')

// Less efficient - fetches everything
.select('*')
```

### 4. Use Search RPCs

```typescript
// Good - optimized full-text search
await supabase.rpc('search_vcons_keyword', { ... })

// Bad - slow LIKE query
.like('body', '%keyword%')
```

### 5. Cache with Redis

```typescript
// Check cache first
const cached = await redis.get(`vcon:${uuid}`);
if (cached) return JSON.parse(cached);

// Fetch from database
const vcon = await fetchFromDatabase(uuid);

// Store in cache (1 hour TTL)
await redis.setex(`vcon:${uuid}`, 3600, JSON.stringify(vcon));
```

### 6. Batch Operations

```typescript
// Good - single query for multiple inserts
await supabase.from('parties').insert([
  { vcon_id, party_index: 0, name: 'Alice' },
  { vcon_id, party_index: 1, name: 'Bob' },
  { vcon_id, party_index: 2, name: 'Charlie' }
]);

// Bad - multiple queries
await supabase.from('parties').insert({ vcon_id, party_index: 0, name: 'Alice' });
await supabase.from('parties').insert({ vcon_id, party_index: 1, name: 'Bob' });
await supabase.from('parties').insert({ vcon_id, party_index: 2, name: 'Charlie' });
```

---

## Quick Reference: Common Patterns

### Pattern 1: Get vCons by Date Range with Limit

```typescript
const { data } = await supabase
  .from('vcons')
  .select('uuid, subject, created_at')
  .gte('created_at', startDate)
  .lte('created_at', endDate)
  .order('created_at', { ascending: false })
  .limit(100);
```

### Pattern 2: Find vCons by Party

```typescript
const { data } = await supabase
  .from('parties')
  .select('vcon_id, vcons(uuid, subject, created_at)')
  .or(`mailto.eq.${email},tel.eq.${phone}`)
  .limit(50);
```

### Pattern 3: Get vCons with Specific Analysis Type

```typescript
const { data } = await supabase
  .from('analysis')
  .select('vcon_id, type, body, vcons(uuid, subject)')
  .eq('type', 'transcript')
  .limit(50);
```

### Pattern 4: Get Recent vCons with Tags

```typescript
const { data } = await supabase
  .from('vcon_tags_mv')
  .select('vcon_uuid, tags_object')
  .limit(100);
```

### Pattern 5: Count vCons by Date

```typescript
const { data } = await supabase
  .rpc('count_vcons_by_date', {
    start_date: '2025-01-01',
    end_date: '2025-12-31',
    interval: 'day'
  });
```

---

## Error Handling

### Common Errors and Solutions

**Error: `analysis.vendor` cannot be null**
```typescript
// Wrong
analysis: { type: 'summary', body: '...' }

// Right
analysis: { type: 'summary', vendor: 'OpenAI', body: '...' }
```

**Error: column "schema_version" does not exist**
```typescript
// Wrong
analysis: { schema_version: 'v1.0' }

// Right
analysis: { schema: 'v1.0' }
```

**Error: invalid input value for enum encoding**
```typescript
// Wrong
encoding: 'text'

// Right
encoding: 'none'  // or 'json' or 'base64url'
```

**Error: value too long for type character varying(10)**
```typescript
// Wrong
vcon_version: '0.3.0-extended'

// Right
vcon_version: '0.3.0'
```

**Error: duplicate key value violates unique constraint**
```typescript
// Wrong - reusing party_index
insert({ vcon_id, party_index: 0, ... })
insert({ vcon_id, party_index: 0, ... })  // Error!

// Right - increment party_index
insert({ vcon_id, party_index: 0, ... })
insert({ vcon_id, party_index: 1, ... })
```

---

## Testing Your Integration

### Minimal Test Script

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

async function testVConOperations() {
  console.log('1. Creating vCon...');
  const vconUuid = crypto.randomUUID();
  
  const { data: vcon } = await supabase
    .from('vcons')
    .insert({
      uuid: vconUuid,
      vcon_version: '0.3.0',
      subject: 'Test vCon',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select('id, uuid')
    .single();
  
  console.log('2. Adding party...');
  await supabase.from('parties').insert({
    vcon_id: vcon!.id,
    party_index: 0,
    name: 'Test User',
    mailto: 'test@example.com'
  });
  
  console.log('3. Adding dialog...');
  await supabase.from('dialog').insert({
    vcon_id: vcon!.id,
    dialog_index: 0,
    type: 'text',
    body: 'Test message',
    encoding: 'none'
  });
  
  console.log('4. Retrieving vCon...');
  const { data: retrieved } = await supabase
    .from('vcons')
    .select('*, parties(*), dialog(*)')
    .eq('uuid', vconUuid)
    .single();
  
  console.log('5. Deleting vCon...');
  await supabase.from('vcons').delete().eq('uuid', vconUuid);
  
  console.log('✅ All tests passed!');
}

testVConOperations().catch(console.error);
```

---

## Next Steps

1. **Read the Full Architecture**: See `DATABASE_ARCHITECTURE_FOR_LLMS.md`
2. **Check Migration Files**: `supabase/migrations/` for schema details
3. **Review Query Implementation**: `src/db/queries.ts` for production patterns
4. **Test Search Features**: `scripts/test-search-tools.ts`
5. **Setup Multi-Tenancy**: `docs/guide/rls-multi-tenant.md`
6. **Enable Caching**: `docs/guide/redis-supabase-integration.md`

---

## Summary

**Key Takeaways**:
1. vCon is a standardized conversation container (IETF spec)
2. Database is normalized (8 core tables) for efficient querying
3. Use search RPCs, don't write your own full-text search
4. Always provide `vendor` field in analysis (required)
5. Field is `schema`, not `schema_version`
6. All `body` fields are TEXT type
7. Use tags for efficient filtering
8. Enable RLS for multi-tenant apps
9. Cache with Redis for production performance
10. Always use limits and indexes

**Most Common Operations**:
- Create: Insert into `vcons`, then child tables
- Retrieve: Join `vcons` with child tables
- Search: Use `search_vcons_keyword()` or `search_vcons_semantic()`
- Filter: Use tags via `search_vcons_by_tags()`
- Update: Update `vcons` or insert new child records
- Delete: Delete from `vcons` (cascades to children)

**Performance Checklist**:
- ✅ Use `LIMIT` on all queries
- ✅ Filter by indexed fields (uuid, created_at, tenant_id)
- ✅ Use search RPCs for full-text search
- ✅ Cache frequently accessed vCons with Redis
- ✅ Batch insert operations when possible
- ✅ Select only needed columns

You're now ready to build applications on the vCon database! 🚀




