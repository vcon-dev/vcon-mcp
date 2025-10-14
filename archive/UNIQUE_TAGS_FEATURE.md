# Get Unique Tags Feature

## Overview

Added `get_unique_tags` tool to retrieve all unique tag keys and values across all vCons. This is the 8th tag management tool.

## What It Does

Aggregates and returns:
- All unique tag keys in your system
- All possible values for each key
- Optional usage counts for each value
- Total number of vCons with tags

## Use Cases

### 1. **UI Building**
Build tag selection dropdowns with actual values from your database:
```javascript
const result = get_unique_tags({ key_filter: "department" })
// Returns: { department: ["sales", "support", "engineering"] }
// Use this to populate a dropdown menu
```

### 2. **Tag Discovery**
Discover what tags are being used:
```javascript
const result = get_unique_tags({})
// Returns all tag keys: ["department", "priority", "status", "region", ...]
```

### 3. **Analytics**
Understand tag distribution:
```javascript
const result = get_unique_tags({ include_counts: true })
// Shows: department: { sales: 45, support: 38, engineering: 22 }
```

### 4. **Data Quality**
Find rarely used or inconsistent tags:
```javascript
const result = get_unique_tags({ include_counts: true, min_count: 5 })
// Only shows tags used 5+ times
// Missing tags might be typos or should be standardized
```

## API

**Tool Name:** `get_unique_tags`

**Parameters:**
```typescript
{
  include_counts?: boolean;  // Include usage counts (default: false)
  key_filter?: string;       // Filter by key substring (default: none)
  min_count?: number;        // Minimum occurrences (default: 1)
}
```

**Response:**
```typescript
{
  success: true,
  unique_keys: string[];                        // All unique tag keys
  unique_key_count: number;                     // Count of keys
  tags_by_key: {                                // Values for each key
    [key: string]: string[];
  };
  counts_per_value?: {                          // Optional counts
    [key: string]: {
      [value: string]: number;
    };
  };
  total_vcons_with_tags: number;                // Total vCons
  summary: {
    total_unique_keys: number;
    total_vcons: number;
    filter_applied: boolean;
    min_count_filter: number;
  }
}
```

## Examples

### Get All Tags
```javascript
get_unique_tags({})
```

### Get Tags with Counts
```javascript
get_unique_tags({ include_counts: true })
```

Returns:
```json
{
  "unique_keys": ["department", "priority", "status"],
  "tags_by_key": {
    "department": ["sales", "support", "engineering"],
    "priority": ["high", "medium", "low"],
    "status": ["open", "closed"]
  },
  "counts_per_value": {
    "department": {
      "sales": 45,
      "support": 38,
      "engineering": 22
    }
  },
  "total_vcons_with_tags": 150
}
```

### Filter by Key
```javascript
get_unique_tags({ 
  key_filter: "department",
  include_counts: true 
})
```

Returns only tags with "department" in the key name.

### Common Tags Only
```javascript
get_unique_tags({ 
  include_counts: true,
  min_count: 10 
})
```

Returns only tags that appear at least 10 times.

## Implementation Details

### Query Method
Added `getUniqueTags()` to `VConQueries` class:
- Fetches all tags attachments from database
- Parses JSON arrays of "key:value" strings
- Aggregates unique keys and values
- Optionally counts occurrences
- Applies filters (key_filter, min_count)

### Performance
- Single database query to get all tags attachments
- In-memory aggregation and filtering
- Efficient for up to tens of thousands of vCons
- For larger datasets, consider caching or materialized views

### Algorithm
1. Query all attachments with `type: "tags"`
2. Parse each body: `["key:value", ...]`
3. Split on first `:` to get key and value
4. Track unique values per key in a Set
5. Optionally count occurrences in a map
6. Apply filters (key substring match, min count)
7. Sort results and return

## Files Modified

1. **src/tools/tag-tools.ts** - Added tool definition
2. **src/db/queries.ts** - Added getUniqueTags() method (90 lines)
3. **src/index.ts** - Added tool handler
4. **docs/TAG_MANAGEMENT_GUIDE.md** - Added documentation
5. **TAG_QUICK_REFERENCE.md** - Added quick reference
6. **scripts/test-tags.ts** - Added to test script

## Testing

Test with:
```bash
npx tsx scripts/test-tags.ts
```

Or manually:
```javascript
import { getSupabaseClient } from './src/db/client.js';
import { VConQueries } from './src/db/queries.js';

const supabase = getSupabaseClient();
const queries = new VConQueries(supabase);

const result = await queries.getUniqueTags({
  includeCounts: true,
  minCount: 1
});

console.log(result);
```

## Real-World Scenarios

### Building a Dashboard
```javascript
// Get tag statistics
const stats = await get_unique_tags({ include_counts: true })

// Display:
// - Most used departments
// - Priority distribution
// - Status breakdown
// - Total conversations
```

### Tag Standardization
```javascript
// Find all variations
const all = await get_unique_tags({ include_counts: true })

// Look for:
// - "dept" vs "department"
// - "hi" vs "high" vs "high-priority"
// - Typos like "suport" vs "support"

// Then standardize using update_tags
```

### Dynamic Form Building
```javascript
// Build a search form dynamically
const tags = await get_unique_tags({ min_count: 5 })

// For each key in tags.unique_keys:
//   Create a dropdown with values from tags.tags_by_key[key]
```

### Reporting
```javascript
// Generate report on tag usage
const report = await get_unique_tags({ include_counts: true })

// Calculate:
// - Which departments are busiest
// - Average priority levels
// - Open vs closed ratios
// - Regional distribution
```

## Benefits

1. **Discovery**: Find what tags exist without querying individual vCons
2. **Efficiency**: Single query instead of N queries
3. **Flexibility**: Filter and aggregate as needed
4. **UI Ready**: Perfect for building interfaces
5. **Analytics**: Understand your data distribution
6. **Quality**: Identify inconsistencies and typos

## Status

✅ Implemented  
✅ Tested  
✅ Documented  
✅ Ready to use

## Next Steps

Consider adding:
- Caching for large datasets
- Tag value suggestions based on popularity
- Tag hierarchy/grouping
- Tag usage over time (trending)

