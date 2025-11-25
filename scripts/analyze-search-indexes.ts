#!/usr/bin/env tsx

/**
 * Analyze database indexes for search optimization
 * Provides recommendations for improving search performance
 */

import dotenv from 'dotenv';
import { getSupabaseClient } from '../dist/db/client.js';

dotenv.config();

async function main() {
  console.log('📊 Analyzing Search Indexes\n');

  const supabase = getSupabaseClient();

  // Check for tsvector columns
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('1. Checking for tsvector columns');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: tsvectorColumns, error: tsvectorError } = await supabase.rpc('exec_sql', {
    q: `
      SELECT 
        table_name,
        column_name,
        data_type
      FROM information_schema.columns
      WHERE column_name LIKE '%tsvector%'
      ORDER BY table_name, column_name
    `,
    params: {}
  });

  if (tsvectorError) {
    console.log('⚠️  Could not check tsvector columns:', tsvectorError.message);
  } else if (tsvectorColumns && tsvectorColumns.length > 0) {
    console.log('✅ Found tsvector columns:');
    tsvectorColumns.forEach((col: any) => {
      console.log(`   - ${col.table_name}.${col.column_name} (${col.data_type})`);
    });
  } else {
    console.log('❌ No tsvector columns found');
    console.log('   Recommendation: Run migration 20251125160000_optimize_search_indexes.sql');
    console.log('   This will add materialized tsvector columns for faster search.');
  }

  // Check for GIN indexes on tsvector
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('2. Checking for GIN indexes on tsvector');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: ginIndexes, error: ginError } = await supabase.rpc('exec_sql', {
    q: `
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE indexdef LIKE '%tsvector%'
         OR indexdef LIKE '%gin%'
      ORDER BY tablename, indexname
    `,
    params: {}
  });

  if (ginError) {
    console.log('⚠️  Could not check GIN indexes:', ginError.message);
  } else if (ginIndexes && ginIndexes.length > 0) {
    console.log('✅ Found GIN indexes:');
    ginIndexes.forEach((idx: any) => {
      const isTsvector = idx.indexdef.includes('tsvector');
      const marker = isTsvector ? '✅' : '⚠️';
      console.log(`   ${marker} ${idx.tablename}.${idx.indexname}`);
      if (isTsvector) {
        console.log(`      (tsvector index - optimized for full-text search)`);
      }
    });
  } else {
    console.log('❌ No GIN indexes found on tsvector columns');
  }

  // Check table sizes
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('3. Table Sizes');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: tableSizes, error: sizeError } = await supabase.rpc('exec_sql', {
    q: `
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
        pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('vcons', 'parties', 'dialog', 'analysis', 'vcon_embeddings')
      ORDER BY size_bytes DESC
    `,
    params: {}
  });

  if (sizeError) {
    console.log('⚠️  Could not check table sizes:', sizeError.message);
  } else if (tableSizes && tableSizes.length > 0) {
    tableSizes.forEach((tbl: any) => {
      console.log(`   ${tbl.tablename}: ${tbl.size}`);
    });
  }

  // Check index usage statistics
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('4. Index Usage Statistics');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { data: indexStats, error: statsError } = await supabase.rpc('exec_sql', {
    q: `
      SELECT 
        schemaname,
        tablename,
        indexname,
        idx_scan AS index_scans,
        idx_tup_read AS tuples_read,
        idx_tup_fetch AS tuples_fetched
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('vcons', 'parties', 'dialog', 'analysis')
      ORDER BY idx_scan DESC
      LIMIT 20
    `,
    params: {}
  });

  if (statsError) {
    console.log('⚠️  Could not check index statistics:', statsError.message);
    console.log('   (This requires pg_stat_statements extension)');
  } else if (indexStats && indexStats.length > 0) {
    console.log('Top 20 most-used indexes:');
    indexStats.forEach((stat: any) => {
      const usage = stat.index_scans > 0 ? '✅' : '⚠️';
      console.log(`   ${usage} ${stat.tablename}.${stat.indexname}`);
      console.log(`      Scans: ${stat.index_scans}, Tuples: ${stat.tuples_read}`);
    });
  }

  // Recommendations
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 Recommendations');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const hasTsvector = tsvectorColumns && tsvectorColumns.length > 0;
  const hasGinOnTsvector = ginIndexes && ginIndexes.some((idx: any) => 
    idx.indexdef.includes('tsvector')
  );

  if (!hasTsvector) {
    console.log('1. ⚠️  Add materialized tsvector columns');
    console.log('   Run: supabase/migrations/20251125160000_optimize_search_indexes.sql');
    console.log('   This will add tsvector columns that are updated via triggers.');
    console.log('');
  }

  if (!hasGinOnTsvector) {
    console.log('2. ⚠️  Add GIN indexes on tsvector columns');
    console.log('   The migration above includes GIN indexes.');
    console.log('   These make full-text search 10-100x faster.');
    console.log('');
  }

  console.log('3. ✅ Use date filters in search queries');
  console.log('   Filter by created_at BEFORE computing tsvectors.');
  console.log('   Example: start_date and end_date parameters.');
  console.log('');

  console.log('4. ✅ Use appropriate LIMIT values');
  console.log('   Start with small limits (10-50) for testing.');
  console.log('   Increase only if needed.');
  console.log('');

  console.log('5. ✅ Consider partial indexes for recent data');
  console.log('   Most queries search recent vCons.');
  console.log('   Partial indexes on recent data are smaller and faster.');
  console.log('');

  console.log('6. ⚠️  Monitor query performance');
  console.log('   Use EXPLAIN ANALYZE on slow queries.');
  console.log('   Check if indexes are being used.');
  console.log('');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(console.error);

