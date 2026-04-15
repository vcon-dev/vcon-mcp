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

### 1. `manage_tag` - Add, Update, or Remove a Single Tag

Manage a single tag on a vCon. Use action `"set"` to add or update, `"remove"` to delete.

**Input:**
```typescript
{
  vcon_uuid: string;      // UUID of the vCon (required)
  action: "set" | "remove";  // Action to perform (required)
  key: string;            // Tag key/name (required)
  value?: string | number | boolean;  // Tag value (required when action is "set")
}
```

**Examples:**
```javascript
// Add a string tag
manage_tag({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  action: "set",
  key: "department",
  value: "sales"
})

// Add a number tag
manage_tag({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  action: "set",
  key: "priority",
  value: 5
})

// Add a boolean tag
manage_tag({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  action: "set",
  key: "resolved",
  value: true
})

// Remove a tag
manage_tag({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  action: "remove",
  key: "priority"
})
```

---

### 2. `get_tags` - Get One or All Tags

Retrieve tags from a vCon. Provide a `key` to get one tag value, or omit `key` to get all tags.

**Input:**
```typescript
{
  vcon_uuid: string;      // UUID of the vCon (required)
  key?: string;           // Specific tag key to retrieve (omit for all tags)
  default_value?: string | number | boolean | null;  // Fallback if key not found (default: null)
}
```

**Examples:**
```javascript
// Get a specific tag
get_tags({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  key: "department"
})

// Get a tag with fallback
get_tags({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000",
  key: "priority",
  default_value: "normal"
})

// Get all tags
get_tags({
  vcon_uuid: "123e4567-e89b-12d3-a456-426614174000"
})
```

---

### 3. `remove_all_tags` - Remove All Tags

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
  limit?: number;         // Maximum UUIDs to return (default: 50, max: 100)
  return_full_vcons?: boolean;  // Return full vCon objects (default: auto based on result size)
  max_full_vcons?: number;      // Max full vCon objects to return (default: 20)
}
```

**Behavior:**
- Always returns `vcon_uuids` for all matching vCons (up to `limit`)
- For small result sets (≤20), full vCon objects are returned by default
- For large result sets (>20), only UUIDs are returned by default to prevent response size limits
- Use `get_vcon` to fetch individual vCons by UUID when needed

**Examples:**
```javascript
// Find all sales department vCons (returns UUIDs for large sets)
search_by_tags({
  tags: {
    department: "sales"
  }
})

// Find high-priority open sales calls (small set, returns full vCons)
search_by_tags({
  tags: {
    department: "sales",
    priority: "high",
    status: "open"
  },
  limit: 10
})

// Explicitly request full vCons for large result set (limited to 20)
search_by_tags({
  tags: {
    direction: "out",
    engagement: "true"
  },
  limit: 100,
  return_full_vcons: true,
  max_full_vcons: 20
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
manage_tag({
  vcon_uuid: vcon_uuid,
  action: "set",
  key: "customer_id",
  value: "CUST-12345"
})

manage_tag({
  vcon_uuid: vcon_uuid,
  action: "set",
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
manage_tag({ vcon_uuid: vcon_uuid, action: "set", key: "department", value: "sales" })
manage_tag({ vcon_uuid: vcon_uuid, action: "set", key: "team", value: "enterprise" })
manage_tag({ vcon_uuid: vcon_uuid, action: "set", key: "region", value: "west" })

// Find all sales conversations
search_by_tags({
  tags: { department: "sales" }
})
```

### 3. Status Tracking
```javascript
// Set initial status
manage_tag({
  vcon_uuid: vcon_uuid,
  action: "set",
  key: "status",
  value: "open"
})

// Update when resolved
manage_tag({
  vcon_uuid: vcon_uuid,
  action: "set",
  key: "status",
  value: "resolved"
})

manage_tag({
  vcon_uuid: vcon_uuid,
  action: "set",
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
manage_tag({
  vcon_uuid: vcon_uuid,
  action: "set",
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
manage_tag({ vcon_uuid: vcon_uuid, action: "set", key: "campaign", value: "spring_2024" })
manage_tag({ vcon_uuid: vcon_uuid, action: "set", key: "source", value: "web_chat" })
manage_tag({ vcon_uuid: vcon_uuid, action: "set", key: "promotion", value: "free_trial" })

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
- Use `get_tags` (without a key) to see all current tags

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
manage_tag({ vcon_uuid: call_uuid, action: "set", key: "call_type", value: "inbound" })
manage_tag({ vcon_uuid: call_uuid, action: "set", key: "department", value: "support" })
manage_tag({ vcon_uuid: call_uuid, action: "set", key: "queue", value: "technical" })
manage_tag({ vcon_uuid: call_uuid, action: "set", key: "wait_time_seconds", value: "45" })
manage_tag({ vcon_uuid: call_uuid, action: "set", key: "handled_by", value: "agent_123" })
```

### Chat Support
```javascript
// Tag chat sessions
manage_tag({ vcon_uuid: chat_uuid, action: "set", key: "channel", value: "web_chat" })
manage_tag({ vcon_uuid: chat_uuid, action: "set", key: "topic", value: "billing" })
manage_tag({ vcon_uuid: chat_uuid, action: "set", key: "sentiment", value: "negative" })
manage_tag({ vcon_uuid: chat_uuid, action: "set", key: "escalated", value: "true" })
manage_tag({ vcon_uuid: chat_uuid, action: "set", key: "satisfaction_score", value: "2" })
```

### Email Threads
```javascript
// Tag email conversations
manage_tag({ vcon_uuid: email_uuid, action: "set", key: "thread_id", value: "THREAD-789" })
manage_tag({ vcon_uuid: email_uuid, action: "set", key: "category", value: "inquiry" })
manage_tag({ vcon_uuid: email_uuid, action: "set", key: "product", value: "enterprise_plan" })
manage_tag({ vcon_uuid: email_uuid, action: "set", key: "responded", value: "true" })
manage_tag({ vcon_uuid: email_uuid, action: "set", key: "response_time_hours", value: "2.5" })
```

---

## Migration from Other Systems

If you're migrating from systems that use different tag formats:

### From flat metadata
```javascript
// Old: { metadata: { dept: "sales", pri: 5 } }
// New:
manage_tag({ vcon_uuid: vcon_uuid, action: "set", key: "department", value: "sales" })
manage_tag({ vcon_uuid: vcon_uuid, action: "set", key: "priority", value: "5" })
```

### From nested structures
```javascript
// Old: { tags: { category: { primary: "support", secondary: "billing" } } }
// New: Flatten the structure
manage_tag({ vcon_uuid: vcon_uuid, action: "set", key: "category_primary", value: "support" })
manage_tag({ vcon_uuid: vcon_uuid, action: "set", key: "category_secondary", value: "billing" })
```

---

## API Reference

For the complete API reference, see the tool definitions in `src/tools/tag-tools.ts`.

For database implementation details, see the query methods in `src/db/queries.ts`.

