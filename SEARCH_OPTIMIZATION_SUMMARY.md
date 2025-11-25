# Search Optimization Summary

## Current Status

### Database Size
- **dialog**: 11 GB
- **analysis**: 10 GB  
- **vcon_embeddings**: 5.5 GB
- **parties**: 1.8 GB
- **vcons**: 850 MB

**Total**: ~30 GB of data

### Current Indexes

✅ **Existing (Trigram indexes for fuzzy matching)**:
- `idx_parties_name_trgm` - GIN on parties.name
- `idx_parties_mail_trgm` - GIN on parties.mailto
- `idx_parties_tel_trgm` - GIN on parties.tel
- `idx_dialog_body_trgm` - GIN on dialog.body
- `idx_analysis_body_trgm` - GIN on analysis.body

❌ **Missing (tsvector indexes for full-text search)**:
- No materialized tsvector columns
- No GIN indexes on tsvector columns
- Search functions compute tsvectors on-the-fly (very slow)

## Problem

The search functions are timing out because:

1. **On-the-fly tsvector computation**: Every query computes `to_tsvector()` for every row
2. **Large dataset**: 11GB dialog + 10GB analysis = millions of rows to process
3. **No full-text search indexes**: Only trigram indexes exist (for LIKE queries, not tsvector)
4. **Sequential scans**: Without tsvector indexes, PostgreSQL can't use index scans

**Result**: 30+ second timeouts on keyword and hybrid search queries.

## Solution

### Migration 1: Add Materialized tsvector Columns

**File**: `supabase/migrations/20251125160000_optimize_search_indexes.sql`

**What it does**:
1. Adds tsvector columns to vcons, parties, dialog, and analysis tables
2. Creates GIN indexes on tsvector columns (10-100x faster)
3. Sets up triggers to auto-update tsvectors when data changes
4. Backfills existing data

**Storage impact**: ~10-20% additional storage (~3-6 GB for your database)

**Performance improvement**: 10-100x faster keyword/hybrid search

### Migration 2: Optimize Search Functions

**File**: `supabase/migrations/20251125160001_optimize_search_functions.sql`

**What it does**:
1. Updates `search_vcons_keyword` to use materialized tsvector columns
2. Updates `search_vcons_hybrid` to use materialized tsvector columns
3. Maintains backward compatibility

**Performance improvement**: Uses indexed tsvectors instead of computing on-the-fly

## Implementation Steps

### Step 1: Review the Migrations

```bash
# Review the optimization migration
cat supabase/migrations/20251125160000_optimize_search_indexes.sql

# Review the function updates
cat supabase/migrations/20251125160001_optimize_search_functions.sql
```

### Step 2: Apply Migrations

**Option A: Using Supabase CLI**
```bash
supabase db push
```

**Option B: Manual Application**
```bash
# Connect to your database
psql $DATABASE_URL

# Run the migrations
\i supabase/migrations/20251125160000_optimize_search_indexes.sql
\i supabase/migrations/20251125160001_optimize_search_functions.sql
```

**Option C: Using Supabase Dashboard**
1. Go to SQL Editor
2. Copy and paste the migration SQL
3. Run it

### Step 3: Verify Installation

```bash
# Check if tsvector columns exist
npm run analyze:indexes

# Test search performance
npm run test:search:quick
```

### Step 4: Monitor Performance

After applying the migrations, keyword and hybrid search should complete in:
- **Keyword search**: 100-500ms (was 30+ seconds)
- **Hybrid search**: 200-1000ms (was 30+ seconds)

## Expected Results

### Before Optimization
```
❌ Keyword search: Timeout (30+ seconds)
❌ Hybrid search: Timeout (30+ seconds)
✅ Basic search: Works (fast)
✅ Semantic search: Works (fast)
```

### After Optimization
```
✅ Keyword search: 100-500ms
✅ Hybrid search: 200-1000ms
✅ Basic search: Works (fast)
✅ Semantic search: Works (fast)
```

## Index Strategy Details

### Materialized tsvector Columns

| Table | Column | Index | Update Trigger |
|-------|--------|-------|----------------|
| `vcons` | `subject_tsvector` | `idx_vcons_subject_tsvector_gin` | `trigger_vcons_subject_tsvector` |
| `parties` | `party_tsvector` | `idx_parties_party_tsvector_gin` | `trigger_parties_party_tsvector` |
| `dialog` | `body_tsvector` | `idx_dialog_body_tsvector_gin` | `trigger_dialog_body_tsvector` |
| `analysis` | `body_tsvector` | `idx_analysis_body_tsvector_gin` | `trigger_analysis_body_tsvector` |

### Composite Indexes

- `idx_vcons_created_at_btree` - Date filtering
- `idx_vcons_tenant_created_at_btree` - Tenant + date (if RLS enabled)

### Partial Indexes (Optional)

- `idx_vcons_recent_subject_tsvector` - Recent vCons only (last 30 days)
- `idx_dialog_recent_body_tsvector` - Recent dialog only

## Maintenance

### Automatic Updates

Triggers automatically update tsvector columns when:
- New rows are inserted
- Text columns are updated
- Data is modified via UPDATE statements

### Manual Refresh (if needed)

If tsvectors get out of sync:

```sql
-- The migration includes backfill statements
-- But you can re-run them if needed:

UPDATE vcons 
SET subject_tsvector = setweight(to_tsvector('english', coalesce(subject, '')), 'A')
WHERE subject_tsvector IS NULL;

UPDATE dialog 
SET body_tsvector = setweight(to_tsvector('english', coalesce(body, '')), 'C')
WHERE body_tsvector IS NULL;

UPDATE analysis 
SET body_tsvector = setweight(to_tsvector('english', coalesce(body, '')), 'B')
WHERE body_tsvector IS NULL;

UPDATE parties 
SET party_tsvector = setweight(to_tsvector('simple',
  coalesce(name, '') || ' ' || 
  coalesce(mailto, '') || ' ' || 
  coalesce(tel, '')), 'B')
WHERE party_tsvector IS NULL;
```

## Troubleshooting

### Search still slow after optimization

1. **Verify tsvector columns exist**:
   ```sql
   SELECT column_name FROM information_schema.columns 
   WHERE table_name IN ('vcons', 'parties', 'dialog', 'analysis')
     AND column_name LIKE '%tsvector%';
   ```

2. **Verify GIN indexes exist**:
   ```sql
   SELECT indexname, indexdef FROM pg_indexes 
   WHERE indexdef LIKE '%tsvector%' AND indexdef LIKE '%gin%';
   ```

3. **Check query plan**:
   ```sql
   EXPLAIN ANALYZE 
   SELECT * FROM search_vcons_keyword('test', NULL, NULL, '{}', 10);
   ```
   Look for "Index Scan using idx_*_tsvector_gin" in the plan.

4. **Check trigger status**:
   ```sql
   SELECT trigger_name, event_manipulation, event_object_table 
   FROM information_schema.triggers 
   WHERE trigger_name LIKE '%tsvector%';
   ```

### tsvectors not updating

1. Check if triggers are enabled:
   ```sql
   SELECT tgname, tgenabled FROM pg_trigger 
   WHERE tgname LIKE '%tsvector%';
   ```

2. Manually refresh (see Maintenance section above).

## Additional Optimizations

### 1. Increase Statement Timeout (Temporary)

If you need immediate relief while applying migrations:

```sql
-- Increase timeout to 60 seconds (adjust as needed)
ALTER DATABASE your_database SET statement_timeout = '60s';
```

### 2. Use Date Filters

Always use date filters in search queries to reduce scope:

```typescript
// Good: Filters before computing tsvectors
await queries.keywordSearch({
  query: 'support',
  startDate: '2025-11-01T00:00:00Z',
  limit: 10
});

// Bad: Searches entire database
await queries.keywordSearch({
  query: 'support',
  limit: 10
});
```

### 3. Use Smaller Limits

Start with small limits and increase only if needed:

```typescript
// Start small
limit: 10

// Increase if needed
limit: 50
```

## Related Files

- **Migrations**:
  - `supabase/migrations/20251125160000_optimize_search_indexes.sql`
  - `supabase/migrations/20251125160001_optimize_search_functions.sql`

- **Scripts**:
  - `scripts/analyze-search-indexes.ts` - Analyze current index state
  - `scripts/test-search-tools.ts` - Test search functionality
  - `scripts/test-search-quick.ts` - Quick search test

- **Documentation**:
  - `docs/SEARCH_OPTIMIZATION_GUIDE.md` - Detailed optimization guide
  - `docs/guide/search.md` - Search tools usage guide

## Next Steps

1. ✅ Review the migrations
2. ⏳ Apply `20251125160000_optimize_search_indexes.sql`
3. ⏳ Apply `20251125160001_optimize_search_functions.sql` (optional)
4. ⏳ Verify with `npm run analyze:indexes`
5. ⏳ Test with `npm run test:search:quick`
6. ⏳ Monitor performance in production

## Questions?

- Check the [Search Optimization Guide](docs/SEARCH_OPTIMIZATION_GUIDE.md) for detailed information
- Run `npm run analyze:indexes` to check your current state
- Review the migration SQL files for implementation details

