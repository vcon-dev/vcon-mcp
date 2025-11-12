#!/usr/bin/env tsx

/**
 * Test script for database inspection and performance tools
 * Demonstrates database shape, stats, and query analysis
 */

import dotenv from 'dotenv';
import { getSupabaseClient } from '../dist/db/client.js';
import { DatabaseInspector } from '../dist/db/database-inspector.js';

dotenv.config();

async function main() {
  console.log('🔍 Testing Database Inspection Tools\n');

  const supabase = getSupabaseClient();
  const inspector = new DatabaseInspector(supabase);

  // Test 1: Get Database Shape
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 1: Get Database Shape');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const shape = await inspector.getDatabaseShape({
      includeCounts: true,
      includeSizes: true,
      includeIndexes: true,
      includeColumns: false, // Set to true for detailed column info
    });

    console.log(`✅ Found ${shape.tables.length} tables\n`);
    
    // Show summary of each table
    for (const table of shape.tables) {
      console.log(`📊 Table: ${table.name}`);
      console.log(`   Rows: ${table.row_count?.toLocaleString() || 'N/A'}`);
      console.log(`   Size: ${table.table_size || 'N/A'} (+ ${table.indexes_size || 'N/A'} indexes)`);
      console.log(`   Indexes: ${table.indexes?.length || 0}`);
      
      if (table.indexes && table.indexes.length > 0) {
        table.indexes.forEach((idx: any) => {
          console.log(`     - ${idx.indexname} (${idx.index_type})`);
        });
      }
      console.log('');
    }

    // Show relationships
    if (shape.relationships && shape.relationships.length > 0) {
      console.log(`🔗 Foreign Key Relationships: ${shape.relationships.length}`);
      shape.relationships.forEach((rel: any) => {
        console.log(`   ${rel.from_table}.${rel.from_column} → ${rel.to_table}.${rel.to_column}`);
      });
      console.log('');
    }
  } catch (error) {
    console.log(`❌ Failed to get database shape:`);
    console.error(error);
  }

  // Test 2: Get Database Stats
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 2: Get Database Performance Stats');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const stats = await inspector.getDatabaseStats({
      includeQueryStats: true,
      includeIndexUsage: true,
      includeCacheStats: true,
    });

    // Cache statistics
    if (stats.cache_stats) {
      console.log('💾 Cache Performance:');
      console.log(`   Hit Ratio: ${(parseFloat(stats.cache_stats.hit_ratio) * 100).toFixed(2)}%`);
      console.log(`   Blocks Hit: ${stats.cache_stats.heap_blocks_hit.toLocaleString()}`);
      console.log(`   Blocks Read: ${stats.cache_stats.heap_blocks_read.toLocaleString()}`);
      console.log('');
    }

    // Table access patterns
    if (stats.table_stats && stats.table_stats.length > 0) {
      console.log('📈 Table Access Patterns (Top 5):');
      const topTables = stats.table_stats
        .sort((a: any, b: any) => (b.sequential_scans + b.index_scans) - (a.sequential_scans + a.index_scans))
        .slice(0, 5);
      
      topTables.forEach((t: any) => {
        const totalAccess = t.sequential_scans + t.index_scans;
        console.log(`   ${t.table_name}:`);
        console.log(`     Total Access: ${totalAccess.toLocaleString()} (Seq: ${t.sequential_scans.toLocaleString()}, Idx: ${t.index_scans.toLocaleString()})`);
        console.log(`     Rows: ${t.live_rows.toLocaleString()} live, ${t.dead_rows.toLocaleString()} dead`);
        console.log(`     Modifications: ${t.inserts.toLocaleString()} ins, ${t.updates.toLocaleString()} upd, ${t.deletes.toLocaleString()} del`);
      });
      console.log('');
    }

    // Index usage
    if (stats.index_usage && stats.index_usage.length > 0) {
      console.log('🔎 Most Used Indexes (Top 10):');
      const topIndexes = stats.index_usage
        .sort((a: any, b: any) => b.scans - a.scans)
        .slice(0, 10);
      
      topIndexes.forEach((idx: any) => {
        console.log(`   ${idx.index_name} (${idx.table_name}): ${idx.scans.toLocaleString()} scans`);
      });
      console.log('');
    }

    // Unused indexes
    if (stats.unused_indexes && stats.unused_indexes.length > 0) {
      console.log(`⚠️  Unused Indexes: ${stats.unused_indexes.length}`);
      stats.unused_indexes.forEach((idx: any) => {
        console.log(`   ${idx.index_name} (${idx.table_name}) - Size: ${idx.index_size}`);
      });
      console.log('   Consider dropping unused indexes to improve write performance');
      console.log('');
    } else {
      console.log('✅ All indexes are being used\n');
    }
  } catch (error) {
    console.log(`❌ Failed to get database stats:`);
    console.error(error);
  }

  // Test 3: Analyze a Query
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 3: Query Analysis');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Analyze a simple query
    const testQuery = `
      SELECT v.uuid, v.subject, COUNT(d.id) as dialog_count
      FROM vcons v
      LEFT JOIN dialog d ON d.vcon_id = v.id
      GROUP BY v.uuid, v.subject
      LIMIT 10
    `;

    console.log('📝 Analyzing query:');
    console.log(testQuery);
    console.log('');

    const analysis = await inspector.analyzeQuery(testQuery, 'explain');

    if (analysis.plan) {
      console.log('✅ Query plan generated successfully');
      console.log('\n📊 Execution Plan:');
      console.log(JSON.stringify(analysis.plan, null, 2));
    }
  } catch (error) {
    console.log(`❌ Failed to analyze query:`);
    console.error(error);
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Available database inspection tools:');
  console.log('  1. get_database_shape - Table structure, sizes, indexes, relationships');
  console.log('  2. get_database_stats - Performance metrics, cache stats, index usage');
  console.log('  3. analyze_query - Query execution plan and performance analysis');
  console.log('\nThese tools help with:');
  console.log('  - Understanding database structure');
  console.log('  - Identifying performance bottlenecks');
  console.log('  - Finding unused indexes');
  console.log('  - Optimizing slow queries');
  console.log('  - Monitoring table growth and access patterns\n');
}

main().catch(console.error);

