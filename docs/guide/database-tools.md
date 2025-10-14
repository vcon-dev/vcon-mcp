# Database Inspection Tools Guide

## Overview

The vCon MCP server provides three powerful tools for database debugging, performance monitoring, and optimization.

## Available Tools

### 1. `get_database_shape` - Database Structure Inspector

Get comprehensive information about your database structure including tables, indexes, sizes, and relationships.

**Use Cases:**
- Understanding database schema
- Checking table and index sizes
- Identifying relationships between tables
- Database documentation

**Parameters:**
```json
{
  "include_counts": true,    // Include row counts (default: true)
  "include_sizes": true,     // Include disk sizes (default: true)
  "include_indexes": true,   // Include index info (default: true)
  "include_columns": false   // Include column details (default: false)
}
```

**Example Request:**
```json
{
  "tool": "get_database_shape",
  "arguments": {
    "include_counts": true,
    "include_sizes": true,
    "include_indexes": true,
    "include_columns": false
  }
}
```

**Example Response:**
```json
{
  "success": true,
  "database_shape": {
    "timestamp": "2024-10-14T12:00:00Z",
    "tables": [
      {
        "name": "vcons",
        "schema": "public",
        "row_count": 4443,
        "total_size": "1024 kB",
        "table_size": "896 kB",
        "indexes_size": "128 kB",
        "indexes": [
          {
            "indexname": "vcons_pkey",
            "index_type": "btree",
            "index_size": "48 kB"
          },
          {
            "indexname": "idx_vcons_uuid",
            "index_type": "btree",
            "index_size": "40 kB"
          }
        ]
      }
    ],
    "relationships": [
      {
        "from_table": "dialog",
        "from_column": "vcon_id",
        "to_table": "vcons",
        "to_column": "id"
      }
    ]
  }
}
```

**What You Get:**
- ✅ Table names and schemas
- ✅ Row counts for each table
- ✅ Disk sizes (table + indexes)
- ✅ Index information (name, type, size)
- ✅ Column definitions (optional)
- ✅ Foreign key relationships

---

### 2. `get_database_stats` - Performance & Usage Statistics

Get detailed performance metrics, cache statistics, and table access patterns.

**Use Cases:**
- Performance monitoring
- Identifying hot tables
- Finding unused indexes
- Cache optimization
- Query pattern analysis

**Parameters:**
```json
{
  "include_query_stats": true,   // Table access patterns (default: true)
  "include_index_usage": true,   // Index usage stats (default: true)
  "include_cache_stats": true,   // Cache hit ratios (default: true)
  "table_name": null             // Optional: specific table
}
```

**Example Request:**
```json
{
  "tool": "get_database_stats",
  "arguments": {
    "include_query_stats": true,
    "include_index_usage": true,
    "include_cache_stats": true
  }
}
```

**Example Response:**
```json
{
  "success": true,
  "database_stats": {
    "timestamp": "2024-10-14T12:00:00Z",
    "cache_stats": {
      "hit_ratio": "0.9850",
      "heap_blocks_hit": 123456,
      "heap_blocks_read": 1876
    },
    "table_stats": [
      {
        "table_name": "vcons",
        "sequential_scans": 45,
        "sequential_rows_read": 199935,
        "index_scans": 8934,
        "index_rows_fetched": 12456,
        "inserts": 4443,
        "updates": 234,
        "deletes": 12,
        "live_rows": 4431,
        "dead_rows": 15
      }
    ],
    "index_usage": [
      {
        "table_name": "vcons",
        "index_name": "idx_vcons_uuid",
        "scans": 8934,
        "rows_read": 8934,
        "rows_fetched": 8934
      }
    ],
    "unused_indexes": [
      {
        "table_name": "old_table",
        "index_name": "idx_old_field",
        "index_size": "24 MB"
      }
    ]
  }
}
```

**What You Get:**

#### Cache Statistics
- **Hit Ratio**: Percentage of reads served from cache (higher is better)
- **Blocks Hit**: Number of times data was found in cache
- **Blocks Read**: Number of times data had to be read from disk

**Recommended Action:**
- Hit ratio < 90%: Consider increasing shared_buffers
- Hit ratio > 99%: Cache is well-tuned

#### Table Access Patterns
- **Sequential Scans**: Full table scans (may indicate missing indexes)
- **Index Scans**: Index-based access (efficient)
- **Modifications**: Inserts, updates, deletes
- **Dead Rows**: Rows marked for deletion (may need VACUUM)

**Recommended Actions:**
- High sequential scans on large tables: Add indexes
- Many dead rows: Run VACUUM ANALYZE
- Low index usage: Index might not be optimal

#### Index Usage
- **Scans**: How many times the index was used
- **Rows Fetched**: How many rows were accessed via index

**Recommended Actions:**
- Scans = 0: Index is unused, consider dropping
- Many scans: Index is valuable, keep it

#### Unused Indexes
Lists indexes that have never been used since stats reset.

**Recommended Actions:**
- Drop unused indexes to improve write performance
- Each index slows down INSERT/UPDATE/DELETE operations
- Keep only indexes that provide query benefits

---

### 3. `analyze_query` - Query Performance Analysis

Analyze SQL query execution plans to understand performance characteristics.

**Note:** This tool has limitations with the current database setup. The `exec_sql` RPC may not support EXPLAIN statements. For full query analysis, use direct database access.

**Use Cases:**
- Understanding query performance
- Identifying slow queries
- Optimizing index usage
- Planning query improvements

**Parameters:**
```json
{
  "query": "SELECT ...",          // SQL query to analyze
  "analyze_mode": "explain"       // "explain" or "explain_analyze"
}
```

**Modes:**
- `explain`: Generate execution plan without running query (fast, safe)
- `explain_analyze`: Run query and measure actual performance (slower, provides real metrics)

**Limitations:**
- Only SELECT queries are allowed (for safety)
- May not work with all database configurations
- Requires exec_sql RPC support for EXPLAIN

**Alternative Approach:**
If this tool doesn't work in your environment, you can:
1. Connect directly to the database with `psql`
2. Run `EXPLAIN (ANALYZE, BUFFERS) your_query;`
3. Analyze the output manually

---

## Common Use Cases

### 1. Database Health Check

```bash
# Get complete database overview
Tool: get_database_shape
Arguments: { "include_counts": true, "include_sizes": true }

# Check performance metrics
Tool: get_database_stats
Arguments: { "include_cache_stats": true }
```

Look for:
- Large table sizes (may need partitioning)
- Many dead rows (run VACUUM)
- Low cache hit ratio (tune memory)

### 2. Performance Optimization

```bash
# Find unused indexes
Tool: get_database_stats
Arguments: { "include_index_usage": true }

# Check table access patterns
Tool: get_database_stats
Arguments: { "include_query_stats": true }
```

Actions:
- Drop unused indexes
- Add indexes for high sequential scan tables
- Monitor index vs sequential scan ratios

### 3. Growth Monitoring

```bash
# Track table sizes over time
Tool: get_database_shape
Arguments: { "include_sizes": true, "include_counts": true }
```

Monitor:
- Row count growth
- Disk space usage
- Index size growth

### 4. Index Optimization

```bash
# Get all index information
Tool: get_database_shape
Arguments: { "include_indexes": true, "include_sizes": true }

# Check which indexes are being used
Tool: get_database_stats
Arguments: { "include_index_usage": true }
```

Strategy:
- Drop unused indexes (0 scans)
- Consolidate overlapping indexes
- Add indexes for frequently scanned tables

---

## Performance Metrics Interpretation

### Cache Hit Ratio

| Ratio | Status | Action |
|-------|--------|--------|
| > 99% | Excellent | No action needed |
| 95-99% | Good | Monitor |
| 90-95% | Fair | Consider increasing shared_buffers |
| < 90% | Poor | Increase shared_buffers, check queries |

### Sequential vs Index Scans

| Scenario | Interpretation | Action |
|----------|---------------|--------|
| High seq scans, small table | OK | Small tables are fine to scan |
| High seq scans, large table | Problem | Add index |
| High index scans | Good | Indexes working well |
| Low scans overall | Variable | Check if table is actively used |

### Dead Rows

| Dead Rows | Action |
|-----------|--------|
| < 5% of live rows | OK |
| 5-20% | Schedule VACUUM |
| > 20% | Run VACUUM immediately |

---

## Best Practices

### 1. Regular Health Checks

Run these tools:
- **Daily**: get_database_stats (cache, hot tables)
- **Weekly**: get_database_shape (sizes, growth)
- **Monthly**: Full analysis (unused indexes, optimization opportunities)

### 2. Performance Tuning Workflow

1. **Identify** slow areas using get_database_stats
2. **Analyze** specific queries (if supported)
3. **Optimize** by adding/dropping indexes
4. **Monitor** improvements with stats

### 3. Index Management

**When to add an index:**
- High sequential scans on large table
- Frequent WHERE/JOIN conditions on column
- Slow queries using that column

**When to drop an index:**
- 0 scans in index_usage
- Overlaps with another index
- Table is write-heavy and read-light

### 4. Maintenance Schedule

Based on database stats:
- **VACUUM**: When dead rows > 10%
- **ANALYZE**: After large data changes
- **REINDEX**: If index bloat suspected

---

## Example Workflow: Finding and Fixing Performance Issues

### Step 1: Check Overall Health
```json
{
  "tool": "get_database_stats",
  "arguments": {
    "include_cache_stats": true,
    "include_query_stats": true
  }
}
```

### Step 2: Identify Problem Tables
Look for:
- Tables with high sequential scans
- Tables with many dead rows
- Low cache hit ratios

### Step 3: Check Indexes
```json
{
  "tool": "get_database_shape",
  "arguments": {
    "include_indexes": true
  }
}
```

### Step 4: Review Index Usage
```json
{
  "tool": "get_database_stats",
  "arguments": {
    "include_index_usage": true,
    "table_name": "problematic_table"
  }
}
```

### Step 5: Take Action
- Add missing indexes
- Drop unused indexes
- Run VACUUM on tables with dead rows
- Tune cache settings if needed

---

## Test Script

Run the test script to see all tools in action:

```bash
npx tsx scripts/test-database-tools.ts
```

This will:
- Show database structure
- Display performance metrics
- Identify optimization opportunities
- Demonstrate all available features

---

## Troubleshooting

### "Permission denied" errors
- Ensure you're using SUPABASE_SERVICE_ROLE_KEY (not anon key)
- Check that exec_sql RPC has proper permissions

### "Function not found" errors
- Ensure migrations are applied: `supabase db reset`
- Check that exec_sql RPC exists in your database

### Slow performance
- Run with smaller scope (single table)
- Disable expensive options (include_columns, include_sizes)
- Use table_name parameter to focus on specific tables

---

## Related Documentation

- [Database Migrations](../supabase/migrations/) - Database schema
- [SUPABASE_SEMANTIC_SEARCH_GUIDE.md](../SUPABASE_SEMANTIC_SEARCH_GUIDE.md) - Search performance
- [INGEST_AND_EMBEDDINGS.md](./INGEST_AND_EMBEDDINGS.md) - Data ingestion

---

## Summary

The database inspection tools provide comprehensive visibility into your vCon database:

1. **`get_database_shape`** - Structure, sizes, relationships
2. **`get_database_stats`** - Performance, usage, optimization opportunities
3. **`analyze_query`** - Query execution analysis (limited support)

Use these tools to:
- Monitor database health
- Optimize performance
- Identify bottlenecks
- Plan capacity
- Debug issues

Regular use of these tools will help maintain a healthy, performant database.

