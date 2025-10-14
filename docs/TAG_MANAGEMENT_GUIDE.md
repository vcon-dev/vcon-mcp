# vCon Tag Management Guide

## Overview

Tags in vCon are key-value pairs that provide simple, flexible metadata for categorization, filtering, and organization. Tags are stored as a special attachment with `type: "tags"`, `encoding: "json"`, and a body containing an array of `"key:value"` strings.

## Storage Format

Tags are stored internally as an attachment in the vCon:

```json
{
  "type": "tags",
  "encoding": "json",
  "body": "[\"department:sales\", \"priority:high\", \"status:open\"]"
}
```

This format is automatically managed by the tag tools - you don't need to interact with attachments directly.

## Available Tools

### 1. `add_tag` - Add or Update a Single Tag

Add or update a tag on a vCon.

**Input:**
```typescript
{
  vcon_uuid: string;      // UUID of the vCon
  key: string;            // Tag key/name
  value: string | number | boolean;  // Tag value
  overwrite?: boolean;    // Whether to overwrite if exists (default: true)
}
```

**Examples:**
```javascript
// Add a string tag
add_tag({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  key: "department",
  value: "sales"
})

// Add a number tag
add_tag({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  key: "priority",
  value: 5
})

// Add a boolean tag
add_tag({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  key: "resolved",
  value: true
})

// Add tag but don't overwrite if it exists
add_tag({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  key: "customer_id",
  value: "CUST-12345",
  overwrite: false
})
```

**Response:**
```json
{
  "success": true,
  "message": "Tag 'department' set on vCon 123e4567-e89b-12d3-a456-426614174000",
  "key": "department",
  "value": "sales"
}
```

---

### 2. `get_tag` - Get a Single Tag Value

Retrieve the value of a specific tag.

**Input:**
```typescript
{
  vcon_uuid: string;      // UUID of the vCon
  key: string;            // Tag key to retrieve
  default_value?: any;    // Value to return if tag doesn't exist
}
```

**Examples:**
```javascript
// Get a tag value
get_tag({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  key: "department"
})

// Get tag with default value
get_tag({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  key: "priority",
  default_value: "normal"
})
```

**Response:**
```json
{
  "success": true,
  "key": "department",
  "value": "sales",
  "exists": true
}
```

---

### 3. `get_all_tags` - Get All Tags

Retrieve all tags from a vCon as a key-value object.

**Input:**
```typescript
{
  vcon_uuid: string;      // UUID of the vCon
}
```

**Example:**
```javascript
get_all_tags({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000"
})
```

**Response:**
```json
{
  "success": true,
  "vcon_uuid": "123e4567-e89b-12d3-a456-426614174000",
  "tags": {
    "department": "sales",
    "priority": "high",
    "status": "open",
    "customer_id": "CUST-12345"
  },
  "count": 4
}
```

---

### 4. `update_tags` - Update Multiple Tags

Update multiple tags at once.

**Input:**
```typescript
{
  vcon_uuid: string;      // UUID of the vCon
  tags: {                 // Object with tag key-value pairs
    [key: string]: string | number | boolean;
  };
  merge?: boolean;        // If true, merge with existing tags (default: true)
}
```

**Examples:**
```javascript
// Merge new tags with existing ones
update_tags({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  tags: {
    region: "west",
    team: "alpha",
    priority: "high"
  },
  merge: true
})

// Replace all tags
update_tags({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  tags: {
    status: "archived",
    archived_at: "2025-10-14"
  },
  merge: false  // This removes all existing tags
})
```

**Response:**
```json
{
  "success": true,
  "message": "Tags merged on vCon 123e4567-e89b-12d3-a456-426614174000",
  "tags": {
    "region": "west",
    "team": "alpha",
    "priority": "high"
  }
}
```

---

### 5. `remove_tag` - Remove a Single Tag

Remove a specific tag from a vCon.

**Input:**
```typescript
{
  vcon_uuid: string;      // UUID of the vCon
  key: string;            // Tag key to remove
}
```

**Example:**
```javascript
remove_tag({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  key: "priority"
})
```

**Response:**
```json
{
  "success": true,
  "message": "Tag 'priority' removed from vCon 123e4567-e89b-12d3-a456-426614174000"
}
```

---

### 6. `remove_all_tags` - Remove All Tags

Remove all tags from a vCon.

**Input:**
```typescript
{
  vcon_uuid: string;      // UUID of the vCon
}
```

**Example:**
```javascript
remove_all_tags({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000"
})
```

**Response:**
```json
{
  "success": true,
  "message": "All tags removed from vCon 123e4567-e89b-12d3-a456-426614174000"
}
```

---

### 7. `search_by_tags` - Search vCons by Tags

Search for vCons that have specific tag values. All specified tags must match (AND logic).

**Input:**
```typescript
{
  tags: {                 // Tag key-value pairs to search for
    [key: string]: string;
  };
  limit?: number;         // Maximum results (default: 50, max: 100)
}
```

**Examples:**
```javascript
// Find all sales department vCons
search_by_tags({
  tags: {
    department: "sales"
  }
})

// Find high-priority open sales calls
search_by_tags({
  tags: {
    department: "sales",
    priority: "high",
    status: "open"
  },
  limit: 10
})
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "tags_searched": {
    "department": "sales",
    "priority": "high"
  },
  "vcon_uuids": [
    "123e4567-e89b-12d3-a456-426614174000",
    "987fcdeb-51a2-43f1-b9c6-d8e7f6a5b4c3"
  ],
  "vcons": [
    { /* full vCon object */ },
    { /* full vCon object */ }
  ]
}
```

---

### 8. `get_unique_tags` - Get All Unique Tags

Get a list of all unique tag keys and their possible values across all vCons. This is useful for:
- Discovering what tags are in use
- Building tag selection UIs
- Analytics and reporting
- Understanding your tag taxonomy

**Input:**
```typescript
{
  include_counts?: boolean;  // Include usage counts (default: false)
  key_filter?: string;       // Filter by key substring (case-insensitive)
  min_count?: number;        // Minimum occurrence count (default: 1)
}
```

**Examples:**
```javascript
// Get all unique tags
get_unique_tags({})

// Get all unique tags with usage counts
get_unique_tags({
  include_counts: true
})

// Get only department-related tags
get_unique_tags({
  key_filter: "department",
  include_counts: true
})

// Get tags that appear at least 5 times
get_unique_tags({
  include_counts: true,
  min_count: 5
})
```

**Response (without counts):**
```json
{
  "success": true,
  "unique_keys": [
    "campaign",
    "department",
    "priority",
    "region",
    "status"
  ],
  "unique_key_count": 5,
  "tags_by_key": {
    "campaign": ["spring_2024", "summer_2024", "fall_2024"],
    "department": ["engineering", "sales", "support"],
    "priority": ["high", "low", "medium"],
    "region": ["east", "north", "south", "west"],
    "status": ["closed", "open", "pending"]
  },
  "total_vcons_with_tags": 150,
  "summary": {
    "total_unique_keys": 5,
    "total_vcons": 150,
    "filter_applied": false,
    "min_count_filter": 1
  }
}
```

**Response (with counts):**
```json
{
  "success": true,
  "unique_keys": ["department", "priority", "status"],
  "unique_key_count": 3,
  "tags_by_key": {
    "department": ["engineering", "sales", "support"],
    "priority": ["high", "low", "medium"],
    "status": ["closed", "open"]
  },
  "counts_per_value": {
    "department": {
      "sales": 45,
      "support": 38,
      "engineering": 22
    },
    "priority": {
      "high": 30,
      "medium": 50,
      "low": 25
    },
    "status": {
      "open": 60,
      "closed": 45
    }
  },
  "total_vcons_with_tags": 150,
  "summary": {
    "total_unique_keys": 3,
    "total_vcons": 150,
    "filter_applied": false,
    "min_count_filter": 1
  }
}
```

**Use Cases:**
- **UI Building**: Populate dropdown menus with available tag values
- **Analytics**: Understand tag distribution and usage patterns
- **Data Quality**: Find tags that are rarely used or might be misspelled
- **Tag Cleanup**: Identify tags that should be standardized or removed

---

## Integration with Search Tools

Tags can also be used to filter results in the main search tools:

### Keyword Search with Tags
```javascript
search_vcons_content({
  query: "customer complaint",
  tags: {
    department: "support",
    priority: "high"
  }
})
```

### Semantic Search with Tags
```javascript
search_vcons_semantic({
  query: "billing issues",
  tags: {
    department: "billing",
    status: "open"
  }
})
```

### Hybrid Search with Tags
```javascript
search_vcons_hybrid({
  query: "refund request",
  tags: {
    department: "sales",
    region: "west"
  }
})
```

---

## Tag Discovery and Analytics

### Get All Tags in Your System
```javascript
// Discover all tags
const result = get_unique_tags({ include_counts: true })

// Result shows:
// - All tag keys in use
// - All possible values for each key
// - How many vCons have each value
// - Total vCons with tags
```

### Build Tag Selection UI
```javascript
// Get available department values
const tags = get_unique_tags({
  key_filter: "department"
})

// Use tags.tags_by_key.department to populate dropdown:
// ["sales", "support", "engineering"]
```

### Find Rarely Used Tags
```javascript
// Get tags that appear at least 10 times
const commonTags = get_unique_tags({
  include_counts: true,
  min_count: 10
})

// Tags not in this result appear < 10 times
// Consider standardizing or removing them
```

### Analyze Tag Distribution
```javascript
const analysis = get_unique_tags({
  include_counts: true
})

// Analysis shows:
// - Which departments handle the most conversations
// - Priority distribution across your organization
// - Status breakdown
```

---

## Common Use Cases

### 1. Customer Tracking
```javascript
// Tag a vCon with customer information
add_tag({
  vcon_uuid: vcon_uuid,
  key: "customer_id",
  value: "CUST-12345"
})

add_tag({
  vcon_uuid: vcon_uuid,
  key: "customer_name",
  value: "Acme Corp"
})

// Find all conversations with a specific customer
search_by_tags({
  tags: { customer_id: "CUST-12345" }
})
```

### 2. Department Organization
```javascript
// Tag conversations by department
update_tags({
  vcon_uuid: vcon_uuid,
  tags: {
    department: "sales",
    team: "enterprise",
    region: "west"
  }
})

// Find all sales conversations
search_by_tags({
  tags: { department: "sales" }
})
```

### 3. Status Tracking
```javascript
// Set initial status
add_tag({
  vcon_uuid: vcon_uuid,
  key: "status",
  value: "open"
})

// Update when resolved
add_tag({
  vcon_uuid: vcon_uuid,
  key: "status",
  value: "resolved"
})

add_tag({
  vcon_uuid: vcon_uuid,
  key: "resolved_at",
  value: new Date().toISOString()
})

// Find all open issues
search_by_tags({
  tags: { status: "open" }
})
```

### 4. Priority Management
```javascript
// Set priority level
add_tag({
  vcon_uuid: vcon_uuid,
  key: "priority",
  value: "high"
})

// Find high priority items
search_by_tags({
  tags: { priority: "high" }
})
```

### 5. Campaign Tracking
```javascript
// Tag conversations from a campaign
update_tags({
  vcon_uuid: vcon_uuid,
  tags: {
    campaign: "spring_2024",
    source: "web_chat",
    promotion: "free_trial"
  }
})

// Analyze campaign performance
search_by_tags({
  tags: { campaign: "spring_2024" }
})
```

---

## Best Practices

### Tag Naming
- Use lowercase with underscores: `customer_id`, `created_date`
- Be consistent across your application
- Avoid spaces in tag keys
- Use descriptive names: `priority` instead of `p`

### Tag Values
- Keep values simple and consistent
- Use a predefined set of values for categorical tags (e.g., status: "open", "closed", "pending")
- For dates, use ISO 8601 format: "2025-10-14T10:30:00Z"
- For booleans, use "true" or "false" strings

### Performance
- Use tags for filtering, not for storing large amounts of data
- Limit the number of tags per vCon to what's needed
- Tags are indexed for fast searching
- Consider using the materialized view for tag-heavy queries

### Organization
- Define a tagging schema for your application
- Document which tags are used and their possible values
- Use tags hierarchically: `department`, then `team`, then `region`

---

## Technical Details

### Storage
- Tags are stored as an attachment with `type: "tags"`
- The attachment has `encoding: "json"`
- The body contains a JSON array of "key:value" strings
- Example: `["department:sales", "priority:high"]`

### Querying
- Tags are indexed using a GIN index for fast containment queries
- A materialized view (`vcon_tags_mv`) provides optimized tag queries
- Search functions use JSONB containment operators (`@>`)

### Updates
- Adding/updating tags modifies the tags attachment
- If no tags attachment exists, one is created
- The vCon's `updated_at` timestamp is updated on tag changes
- Tags are atomic - you can't have partial updates

---

## Troubleshooting

### Tag not appearing after adding
- Check that the vCon UUID is correct
- Verify the tag was added successfully (check response)
- Use `get_all_tags` to see all current tags

### Search returning unexpected results
- Remember that `search_by_tags` uses AND logic (all tags must match)
- Check that tag values match exactly (case-sensitive)
- Verify tags are strings in the search query

### Performance issues
- Consider refreshing the materialized view: `REFRESH MATERIALIZED VIEW vcon_tags_mv;`
- Check index usage with `EXPLAIN ANALYZE`
- Limit the number of tags per vCon

---

## Examples in Different Scenarios

### Phone Call Center
```javascript
// Tag incoming calls
update_tags({
  vcon_uuid: call_uuid,
  tags: {
    call_type: "inbound",
    department: "support",
    queue: "technical",
    wait_time_seconds: "45",
    handled_by: "agent_123"
  }
})
```

### Chat Support
```javascript
// Tag chat sessions
update_tags({
  vcon_uuid: chat_uuid,
  tags: {
    channel: "web_chat",
    topic: "billing",
    sentiment: "negative",
    escalated: "true",
    satisfaction_score: "2"
  }
})
```

### Email Threads
```javascript
// Tag email conversations
update_tags({
  vcon_uuid: email_uuid,
  tags: {
    thread_id: "THREAD-789",
    category: "inquiry",
    product: "enterprise_plan",
    responded: "true",
    response_time_hours: "2.5"
  }
})
```

---

## Migration from Other Systems

If you're migrating from systems that use different tag formats:

### From flat metadata
```javascript
// Old: { metadata: { dept: "sales", pri: 5 } }
// New:
update_tags({
  vcon_uuid: vcon_uuid,
  tags: {
    department: "sales",
    priority: "5"
  }
})
```

### From nested structures
```javascript
// Old: { tags: { category: { primary: "support", secondary: "billing" } } }
// New: Flatten the structure
update_tags({
  vcon_uuid: vcon_uuid,
  tags: {
    category_primary: "support",
    category_secondary: "billing"
  }
})
```

---

## API Reference

For the complete API reference, see the tool definitions in `src/tools/tag-tools.ts`.

For database implementation details, see the query methods in `src/db/queries.ts`.

