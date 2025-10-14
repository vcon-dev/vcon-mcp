# Tag Management Quick Reference

## 8 Tag Tools Available

### 1. add_tag - Add/Update Single Tag
```javascript
add_tag({
  vcon_uuid: "uuid-here",
  key: "department",
  value: "sales",
  overwrite: true  // optional, default: true
})
```

### 2. get_tag - Get Single Tag
```javascript
get_tag({
  vcon_uuid: "uuid-here",
  key: "department",
  default_value: "unknown"  // optional
})
```

### 3. get_all_tags - Get All Tags
```javascript
get_all_tags({
  vcon_uuid: "uuid-here"
})
// Returns: { department: "sales", priority: "high", ... }
```

### 4. update_tags - Update Multiple Tags
```javascript
update_tags({
  vcon_uuid: "uuid-here",
  tags: {
    department: "sales",
    priority: "high",
    status: "open"
  },
  merge: true  // true=merge, false=replace all
})
```

### 5. remove_tag - Remove Single Tag
```javascript
remove_tag({
  vcon_uuid: "uuid-here",
  key: "priority"
})
```

### 6. remove_all_tags - Remove All Tags
```javascript
remove_all_tags({
  vcon_uuid: "uuid-here"
})
```

### 7. search_by_tags - Search by Tags
```javascript
search_by_tags({
  tags: {
    department: "sales",
    priority: "high"
  },
  limit: 50  // optional, default: 50
})
// Returns: vCon UUIDs and full vCon objects
```

### 8. get_unique_tags - Get All Unique Tags
```javascript
get_unique_tags({
  include_counts: true,    // optional, default: false
  key_filter: "department", // optional, filter by key
  min_count: 5             // optional, default: 1
})
// Returns: {
//   unique_keys: ["department", "priority", "status"],
//   tags_by_key: {
//     department: ["sales", "support", "engineering"],
//     priority: ["high", "medium", "low"],
//     status: ["open", "closed"]
//   },
//   counts_per_value: {
//     department: { sales: 25, support: 18, engineering: 12 }
//   }
// }
```

## Tags in Search Tools

All search tools support tag filtering:

```javascript
search_vcons_content({
  query: "billing issue",
  tags: { department: "support" }
})

search_vcons_semantic({
  query: "refund request",
  tags: { priority: "high" }
})

search_vcons_hybrid({
  query: "customer complaint",
  tags: { status: "open", department: "sales" }
})
```

## Tag Format

Tags are stored as attachment with:
- `type: "tags"`
- `encoding: "json"`
- `body: ["key:value", ...]`

You don't need to manage this format directly - the tools handle it automatically.

## Common Patterns

### Customer Tracking
```javascript
add_tag({ vcon_uuid, key: "customer_id", value: "CUST-12345" })
add_tag({ vcon_uuid, key: "customer_name", value: "Acme Corp" })
```

### Status Workflow
```javascript
update_tags({ vcon_uuid, tags: { status: "open", priority: "high" } })
// Later...
add_tag({ vcon_uuid, key: "status", value: "resolved" })
```

### Campaign Tracking
```javascript
update_tags({ 
  vcon_uuid, 
  tags: { 
    campaign: "spring_2024", 
    source: "web_chat",
    promotion: "free_trial"
  }
})
```

## Value Types

- **String**: `"sales"`, `"john@example.com"`, `"2025-10-14"`
- **Number**: `5`, `99`, `3.14` (stored as string)
- **Boolean**: `true`, `false` (stored as "true"/"false")

## Best Practices

1. Use lowercase_with_underscores for keys
2. Keep values consistent (use enum-like values)
3. Use ISO 8601 for dates
4. Don't store large data in tags
5. Define a tagging schema for your app

## Full Documentation

See `docs/TAG_MANAGEMENT_GUIDE.md` for complete documentation.

