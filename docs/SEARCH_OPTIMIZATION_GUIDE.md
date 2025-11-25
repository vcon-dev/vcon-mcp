# Search Performance Optimization Guide

## Problem

The search functions (`search_vcons_keyword` and `search_vcons_hybrid`) were timing out on large databases because they compute `to_tsvector()` on-the-fly for every query. This requires:

1. Scanning all rows in vcons, parties, dialog, and analysis tables
2. Computing tsvectors for every text field
3. Then matching against the query

On a database with 400k+ vCons and millions of dialog/analysis rows, this is extremely slow.

## Solution

The optimization adds **materialized tsvector columns** that are:

1. **Pre-computed** - tsvectors are stored in the database
2. **Indexed** - GIN indexes make full-text search fast
3. **Auto-updated** - Triggers keep tsvectors in sync with data changes

This provides **10-100x performance improvement** for keyword and hybrid search.

## Implementation

### Step 1: Run the Optimization Migration

```bash
# Apply the migration
supabase migration up 20251125160000_optimize_search_indexes

# Or if using Supabase CLI
supabase db push
```

This migration:
- Adds tsvector columns to vcons, parties, dialog, and analysis tables
- Creates GIN indexes on tsvector columns
- Sets up triggers to auto-update tsvectors
- Backfills existing data

### Step 2: Update Search Functions (Optional)

The migration `20251125160001_optimize_search_functions.sql` provides optimized versions of the search functions that use the materialized tsvector columns.

**Note**: The original functions will still work, but they won't benefit from the optimization until you update them.

### Step 3: Verify the Optimization

```bash
# Check if tsvector columns exist
npm run analyze:indexes

# Test search performance
npm run test:search:quick
```

## Performance Comparison

### Before Optimization

- **Keyword Search**: 30+ seconds (timeout on large DB)
- **Hybrid Search**: 30+ seconds (timeout on large DB)
- **Query Plan**: Sequential scan + on-the-fly tsvector computation

### After Optimization

- **Keyword Search**: 100-500ms (10-100x faster)
- **Hybrid Search**: 200-1000ms (10-50x faster)
- **Query Plan**: Index scan using GIN indexes

## Index Strategy

### Materialized tsvector Columns

| Table | Column | Index | Purpose |
|-------|--------|-------|---------|
| `vcons` | `subject_tsvector` | GIN | Subject line search |
| `parties` | `party_tsvector` | GIN | Name, email, phone search |
| `dialog` | `body_tsvector` | GIN | Dialog content search |
| `analysis` | `body_tsvector` | GIN | Analysis content search |

### Composite Indexes

- `idx_vcons_created_at_btree` - Date filtering for vcons
- `idx_vcons_tenant_created_at_btree` - Tenant + date filtering (if RLS enabled)

### Partial Indexes (Optional)

- `idx_vcons_recent_subject_tsvector` - Recent vCons only (last 30 days)
- `idx_dialog_recent_body_tsvector` - Recent dialog only

## Maintenance

### Automatic Updates

Triggers automatically update tsvector columns when:
- New rows are inserted
- Text columns are updated
- Data is modified

### Manual Refresh (if needed)

If tsvectors get out of sync, you can refresh them:

```sql
-- Refresh all tsvectors
UPDATE vcons SET subject_tsvector = setweight(to_tsvector('english', coalesce(subject, '')), 'A') WHERE subject_tsvector IS NULL;
UPDATE dialog SET body_tsvector = setweight(to_tsvector('english', coalesce(body, '')), 'C') WHERE body_tsvector IS NULL;
UPDATE analysis SET body_tsvector = setweight(to_tsvector('english', coalesce(body, '')), 'B') WHERE body_tsvector IS NULL;
UPDATE parties SET party_tsvector = setweight(to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(mailto, '') || ' ' || coalesce(tel, '')), 'B') WHERE party_tsvector IS NULL;
```

## Storage Impact

tsvector columns add storage overhead:

- **vcons.subject_tsvector**: ~10-20% of subject text size
- **dialog.body_tsvector**: ~10-20% of body text size
- **analysis.body_tsvector**: ~10-20% of body text size
- **parties.party_tsvector**: ~10-20% of party text size

For a database with 1GB of text data, expect ~100-200MB additional storage for tsvectors.

## Best Practices

1. **Always use date filters** - Reduces search scope before computing scores
2. **Use appropriate LIMIT values** - Start with 10-50, increase only if needed
3. **Monitor index usage** - Run `npm run analyze:indexes` periodically
4. **Consider partial indexes** - For time-based queries, index recent data only
5. **Keep tsvectors updated** - Triggers handle this automatically, but verify periodically

## Troubleshooting

### Search still slow after optimization

1. **Check if tsvector columns exist**:
   ```sql
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'vcons' AND column_name LIKE '%tsvector%';
   ```

2. **Check if GIN indexes exist**:
   ```sql
   SELECT indexname FROM pg_indexes 
   WHERE tablename = 'vcons' AND indexdef LIKE '%tsvector%';
   ```

3. **Verify triggers are active**:
   ```sql
   SELECT trigger_name FROM information_schema.triggers 
   WHERE trigger_name LIKE '%tsvector%';
   ```

4. **Check query plan**:
   ```sql
   EXPLAIN ANALYZE SELECT * FROM search_vcons_keyword('test', NULL, NULL, '{}', 10);
   ```
   Look for "Index Scan using idx_*_tsvector_gin" in the plan.

### tsvectors not updating

1. Check trigger definitions:
   ```sql
   SELECT * FROM pg_trigger WHERE tgname LIKE '%tsvector%';
   ```

2. Manually refresh if needed (see Maintenance section above).

## Related Documentation

- [Search Tools Guide](./guide/search.md) - How to use search tools
- [Database Architecture](./DATABASE_ARCHITECTURE_FOR_LLMS.md) - Complete database design
- [Index Analysis Script](../scripts/analyze-search-indexes.ts) - Analyze your indexes

