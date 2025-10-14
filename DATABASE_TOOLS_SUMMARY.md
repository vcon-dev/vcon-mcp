# Database Inspection Tools - Implementation Summary

## Request

The user requested: "I'd like to have a way to return the shape of the database for debugging and performance management."

## Solution Implemented

I've added three new MCP tools that provide comprehensive database inspection, performance monitoring, and debugging capabilities.

## New Tools

### 1. `get_database_shape` - Database Structure Inspector

**Purpose**: Understand database schema, sizes, and relationships

**What it provides:**
- ✅ Complete table list with row counts
- ✅ Disk sizes (table + indexes)
- ✅ Index information (name, type, size, definition)
- ✅ Column details (optional)
- ✅ Foreign key relationships

**Use cases:**
- Database documentation
- Schema understanding
- Capacity planning
- Index auditing

**Example output:**
```json
{
  "tables": [
    {
      "name": "vcons",
      "row_count": 4443,
      "table_size": "896 kB",
      "indexes_size": "128 kB",
      "indexes": [...]
    }
  ],
  "relationships": [...]
}
```

---

### 2. `get_database_stats` - Performance Monitor

**Purpose**: Monitor database performance and identify optimization opportunities

**What it provides:**
- ✅ Cache hit ratios
- ✅ Table access patterns (sequential vs index scans)
- ✅ Index usage statistics
- ✅ Unused indexes
- ✅ Dead row counts
- ✅ Insert/update/delete counts

**Use cases:**
- Performance monitoring
- Identifying slow tables
- Finding unused indexes
- Cache optimization
- Query pattern analysis

**Key metrics:**
```json
{
  "cache_stats": {
    "hit_ratio": "0.9850",  // 98.5% cache hit rate
    "heap_blocks_hit": 123456,
    "heap_blocks_read": 1876
  },
  "table_stats": [...],
  "index_usage": [...],
  "unused_indexes": [...]  // Candidates for removal
}
```

**Actionable insights:**
- Low cache hit ratio → Increase shared_buffers
- High sequential scans → Add indexes
- Unused indexes → Drop to improve write performance
- Many dead rows → Run VACUUM

---

### 3. `analyze_query` - Query Performance Analyzer

**Purpose**: Understand query execution plans

**What it provides:**
- ✅ Query execution plan
- ✅ Cost estimates
- ✅ Index usage analysis

**Limitations:**
- Currently has limited support due to `exec_sql` RPC constraints
- Only SELECT queries allowed (for safety)
- May not work in all configurations

**Alternative**: Connect directly to database with psql and run EXPLAIN commands

---

## Files Created

### Source Code
1. **`src/tools/database-tools.ts`** - Tool definitions (NEW)
2. **`src/db/database-inspector.ts`** - Query functions for inspection (NEW)
3. **`src/index.ts`** - Tool handlers and integration (MODIFIED)

### Documentation
4. **`docs/DATABASE_TOOLS_GUIDE.md`** - Complete usage guide (NEW)
5. **`README.md`** - Updated with new tools (MODIFIED)
6. **`DATABASE_TOOLS_SUMMARY.md`** - This document (NEW)

### Testing
7. **`scripts/test-database-tools.ts`** - Test script demonstrating all tools (NEW)

---

## Technical Implementation

### Database Inspector Class

Created `DatabaseInspector` class with methods:
- `getDatabaseShape()` - Queries pg_tables, information_schema
- `getDatabaseStats()` - Queries pg_stat_* system views
- `analyzeQuery()` - Executes EXPLAIN on queries
- `getConnectionInfo()` - Database metadata

### SQL Queries Used

**For database shape:**
- `pg_tables` - Table information
- `information_schema.columns` - Column details
- `pg_indexes` - Index definitions
- `information_schema.table_constraints` - Foreign keys
- `pg_size_pretty()`, `pg_relation_size()` - Size calculations

**For performance stats:**
- `pg_stat_user_tables` - Table access patterns
- `pg_statio_user_tables` - Cache statistics
- `pg_stat_user_indexes` - Index usage
- Statistical functions for aggregation

---

## Usage Examples

### Check database health
```json
{
  "tool": "get_database_shape",
  "arguments": {
    "include_counts": true,
    "include_sizes": true
  }
}
```

### Monitor performance
```json
{
  "tool": "get_database_stats",
  "arguments": {
    "include_cache_stats": true,
    "include_query_stats": true
  }
}
```

### Find optimization opportunities
```json
{
  "tool": "get_database_stats",
  "arguments": {
    "include_index_usage": true
  }
}
```

---

## Key Features

### 1. Comprehensive Coverage
- All vCon tables analyzed
- Indexes, sizes, relationships
- Performance metrics
- Usage patterns

### 2. Actionable Insights
- Identifies unused indexes
- Highlights tables with dead rows
- Shows cache hit ratios
- Reveals access patterns

### 3. Performance Focus
- Minimal overhead (uses system views)
- Optional detailed information
- Table-specific stats available
- Efficient queries

### 4. Safety
- Read-only operations
- No schema modifications
- Query analysis restricted to SELECT
- Uses service role key for access

---

## Performance Metrics Guide

### Cache Hit Ratio
| Ratio | Status | Action |
|-------|--------|--------|
| > 99% | Excellent | No action |
| 95-99% | Good | Monitor |
| 90-95% | Fair | Consider tuning |
| < 90% | Poor | Increase memory |

### Sequential vs Index Scans
- **High seq scans + large table** = Missing index
- **High index scans** = Good performance
- **Low overall scans** = Low usage table

### Dead Rows
- **< 5%** = OK
- **5-20%** = Schedule VACUUM
- **> 20%** = Run VACUUM immediately

---

## Testing

### Test Script
Run `scripts/test-database-tools.ts` to:
- ✅ Display database structure
- ✅ Show performance metrics
- ✅ Identify optimization opportunities
- ✅ Demonstrate all features

### Test Results
All tests pass successfully:
- ✅ Database shape retrieval works
- ✅ Performance stats work
- ✅ Unused index detection works
- ⚠️ Query analysis has limitations (RPC constraints)

---

## Best Practices

### Regular Monitoring
- **Daily**: Run get_database_stats for cache and hot tables
- **Weekly**: Check database_shape for growth
- **Monthly**: Full analysis for optimization

### Index Management
**Add index when:**
- High sequential scans on large table
- Frequent WHERE/JOIN on column
- Slow queries

**Drop index when:**
- 0 scans in usage stats
- Overlaps with another index
- Write-heavy table

### Maintenance
**Based on stats:**
- VACUUM when dead rows > 10%
- ANALYZE after large data changes
- REINDEX if bloat suspected

---

## Limitations & Known Issues

### 1. Query Analysis
- `exec_sql` RPC may not support EXPLAIN statements
- Workaround: Use direct database connection for EXPLAIN
- Future: May need custom RPC for query analysis

### 2. Performance Impact
- Minimal for database_shape and database_stats
- Size calculations can be slow on very large databases
- Use `include_sizes: false` for faster results

### 3. Permissions
- Requires service role key (not anon key)
- Needs access to pg_stat_* views
- Some metrics require superuser (not applicable in Supabase)

---

## Future Enhancements

### Potential Additions
1. **Historical tracking** - Store metrics over time
2. **Alerting** - Notify on performance degradation
3. **Recommendations** - Auto-suggest optimizations
4. **Query log analysis** - Most frequent/slow queries
5. **Bloat detection** - Identify table/index bloat
6. **Connection monitoring** - Active connections and queries

### Query Analysis Improvements
1. Custom RPC for better EXPLAIN support
2. Query plan visualization
3. Cost comparison for different approaches
4. Index recommendation based on query patterns

---

## Benefits

### For Development
- Understand database structure quickly
- Debug schema issues
- Plan new features with size awareness
- Monitor test database growth

### For Production
- Proactive performance monitoring
- Identify issues before they impact users
- Optimize based on real usage patterns
- Plan capacity upgrades

### For Operations
- Quick health checks
- Troubleshoot performance issues
- Validate optimization efforts
- Document database for team

---

## Documentation

Complete documentation available at:
- **`docs/DATABASE_TOOLS_GUIDE.md`** - Full usage guide with examples
- **`scripts/test-database-tools.ts`** - Working code examples
- **`README.md`** - Tool descriptions

---

## Summary

✅ **Implemented**: Three powerful database inspection tools
✅ **Tested**: All tools work correctly (except query analysis limitations)
✅ **Documented**: Comprehensive guide and examples
✅ **Ready**: Available in MCP server now

These tools provide the database visibility you requested for debugging and performance management. They offer both high-level overviews and detailed metrics, enabling proactive monitoring and optimization of your vCon database.

## Quick Start

1. **Build the project**: `npm run build`
2. **Test the tools**: `npx tsx scripts/test-database-tools.ts`
3. **Use in MCP**: Access via get_database_shape, get_database_stats, analyze_query
4. **Read the guide**: `docs/DATABASE_TOOLS_GUIDE.md`

The database inspection tools are now ready to help you debug and optimize your vCon database!

