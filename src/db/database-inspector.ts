/**
 * Database Inspector - Queries for database shape and performance analysis
 */

import { SupabaseClient } from '@supabase/supabase-js';

import { IDatabaseInspector, InspectorOptions, InspectorStatsOptions } from './types.js';

export class SupabaseDatabaseInspector implements IDatabaseInspector {
  constructor(private supabase: SupabaseClient) { }

  /**
   * Get comprehensive database shape information
   */
  async getDatabaseShape(options: {
    includeCounts?: boolean;
    includeSizes?: boolean;
    includeIndexes?: boolean;
    includeColumns?: boolean;
  }) {
    const {
      includeCounts = true,
      includeSizes = true,
      includeIndexes = true,
      includeColumns = false,
    } = options;

    const shape: any = {
      timestamp: new Date().toISOString(),
      tables: [],
    };

    // Get table information
    const tablesQuery = `
      SELECT 
        schemaname,
        tablename,
        ${includeSizes ? "pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size," : ''}
        ${includeSizes ? "pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size," : ''}
        ${includeSizes ? "pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as indexes_size," : ''}
        hasindexes
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;

    const { data: tables, error: tablesError } = await this.supabase.rpc('exec_sql', {
      q: tablesQuery,
      params: {}
    });

    if (tablesError) throw tablesError;

    // Process each table
    for (const table of tables || []) {
      const tableInfo: any = {
        name: table.tablename,
        schema: table.schemaname,
      };

      if (includeSizes) {
        tableInfo.total_size = table.total_size;
        tableInfo.table_size = table.table_size;
        tableInfo.indexes_size = table.indexes_size;
      }

      // Get row count
      if (includeCounts) {
        const { data: countData, error: countError } = await this.supabase.rpc('exec_sql', {
          q: `SELECT COUNT(*) as count FROM ${table.tablename}`,
          params: {}
        });

        if (!countError && countData && countData.length > 0) {
          tableInfo.row_count = parseInt(countData[0].count);
        }
      }

      // Get column information
      if (includeColumns) {
        const columnsQuery = `
          SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default,
            character_maximum_length
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = '${table.tablename}'
          ORDER BY ordinal_position
        `;

        const { data: columns, error: columnsError } = await this.supabase.rpc('exec_sql', {
          q: columnsQuery,
          params: {}
        });

        if (!columnsError) {
          tableInfo.columns = columns;
        }
      }

      // Get indexes
      if (includeIndexes) {
        const indexesQuery = `
          SELECT 
            i.indexname,
            i.indexdef,
            ${includeSizes ? "pg_size_pretty(pg_relation_size(i.schemaname||'.'||i.indexname)) as index_size," : ''}
            am.amname as index_type
          FROM pg_indexes i
          LEFT JOIN pg_class c ON c.relname = i.indexname
          LEFT JOIN pg_am am ON c.relam = am.oid
          WHERE i.schemaname = 'public' AND i.tablename = '${table.tablename}'
          ORDER BY i.indexname
        `;

        const { data: indexes, error: indexesError } = await this.supabase.rpc('exec_sql', {
          q: indexesQuery,
          params: {}
        });

        if (!indexesError) {
          tableInfo.indexes = indexes;
        }
      }

      shape.tables.push(tableInfo);
    }

    // Get relationships (foreign keys)
    const relationshipsQuery = `
      SELECT
        tc.table_name as from_table,
        kcu.column_name as from_column,
        ccu.table_name as to_table,
        ccu.column_name as to_column,
        tc.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name
    `;

    const { data: relationships, error: relationshipsError } = await this.supabase.rpc('exec_sql', {
      q: relationshipsQuery,
      params: {}
    });

    if (!relationshipsError) {
      shape.relationships = relationships;
    }

    return shape;
  }

  /**
   * Get database performance statistics
   */
  async getDatabaseStats(options: {
    includeQueryStats?: boolean;
    includeIndexUsage?: boolean;
    includeCacheStats?: boolean;
    tableName?: string;
  }) {
    const {
      includeQueryStats = true,
      includeIndexUsage = true,
      includeCacheStats = true,
      tableName,
    } = options;

    const stats: any = {
      timestamp: new Date().toISOString(),
    };

    // Cache hit ratio
    if (includeCacheStats) {
      const cacheQuery = `
        SELECT 
          sum(heap_blks_read) as heap_read,
          sum(heap_blks_hit) as heap_hit,
          sum(heap_blks_hit) / NULLIF((sum(heap_blks_hit) + sum(heap_blks_read)), 0) as cache_hit_ratio
        FROM pg_statio_user_tables
      `;

      const { data: cacheData, error: cacheError } = await this.supabase.rpc('exec_sql', {
        q: cacheQuery,
        params: {}
      });

      if (!cacheError && cacheData && cacheData.length > 0) {
        stats.cache_stats = {
          hit_ratio: parseFloat(cacheData[0].cache_hit_ratio || 0).toFixed(4),
          heap_blocks_hit: parseInt(cacheData[0].heap_hit || 0),
          heap_blocks_read: parseInt(cacheData[0].heap_read || 0),
        };
      }
    }

    // Table access statistics
    if (includeQueryStats) {
      const tableStatsQuery = `
        SELECT 
          schemaname,
          relname as table_name,
          seq_scan,
          seq_tup_read,
          idx_scan,
          idx_tup_fetch,
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes,
          n_live_tup as live_rows,
          n_dead_tup as dead_rows
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ${tableName ? `AND relname = '${tableName}'` : ''}
        ORDER BY seq_scan + idx_scan DESC
      `;

      const { data: tableStats, error: tableStatsError } = await this.supabase.rpc('exec_sql', {
        q: tableStatsQuery,
        params: {}
      });

      if (!tableStatsError) {
        stats.table_stats = tableStats?.map((t: any) => ({
          table_name: t.table_name,
          sequential_scans: parseInt(t.seq_scan || 0),
          sequential_rows_read: parseInt(t.seq_tup_read || 0),
          index_scans: parseInt(t.idx_scan || 0),
          index_rows_fetched: parseInt(t.idx_tup_fetch || 0),
          inserts: parseInt(t.inserts || 0),
          updates: parseInt(t.updates || 0),
          deletes: parseInt(t.deletes || 0),
          live_rows: parseInt(t.live_rows || 0),
          dead_rows: parseInt(t.dead_rows || 0),
        }));
      }
    }

    // Index usage statistics
    if (includeIndexUsage) {
      const indexUsageQuery = `
        SELECT 
          schemaname,
          tablename as table_name,
          indexname as index_name,
          idx_scan as scans,
          idx_tup_read as rows_read,
          idx_tup_fetch as rows_fetched
        FROM pg_stat_user_indexes
        WHERE schemaname = 'public'
        ${tableName ? `AND tablename = '${tableName}'` : ''}
        ORDER BY idx_scan DESC
      `;

      const { data: indexUsage, error: indexUsageError } = await this.supabase.rpc('exec_sql', {
        q: indexUsageQuery,
        params: {}
      });

      if (!indexUsageError) {
        stats.index_usage = indexUsage?.map((i: any) => ({
          table_name: i.table_name,
          index_name: i.index_name,
          scans: parseInt(i.scans || 0),
          rows_read: parseInt(i.rows_read || 0),
          rows_fetched: parseInt(i.rows_fetched || 0),
        }));
      }
    }

    // Find unused indexes
    if (includeIndexUsage && !tableName) {
      const unusedIndexesQuery = `
        SELECT 
          schemaname,
          tablename as table_name,
          indexname as index_name,
          pg_size_pretty(pg_relation_size(schemaname||'.'||indexname)) as index_size
        FROM pg_stat_user_indexes
        WHERE schemaname = 'public'
          AND idx_scan = 0
          AND indexname NOT LIKE '%_pkey'
        ORDER BY pg_relation_size(schemaname||'.'||indexname) DESC
      `;

      const { data: unusedIndexes, error: unusedError } = await this.supabase.rpc('exec_sql', {
        q: unusedIndexesQuery,
        params: {}
      });

      if (!unusedError) {
        stats.unused_indexes = unusedIndexes;
      }
    }

    return stats;
  }

  /**
   * Analyze a query's execution plan
   */
  async analyzeQuery(query: string, analyzeMode: 'explain' | 'explain_analyze' = 'explain') {
    // Safety check: only allow SELECT queries
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery.startsWith('select')) {
      throw new Error('Only SELECT queries are allowed for analysis');
    }

    // Use text format instead of JSON for better compatibility
    const explainQuery = analyzeMode === 'explain_analyze'
      ? `EXPLAIN (ANALYZE, BUFFERS) ${query}`
      : `EXPLAIN ${query}`;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: explainQuery,
      params: {}
    });

    if (error) throw error;

    // The result is an array of rows with the explain output
    const planText = data?.map((row: any) => {
      // Each row might have different keys, try common ones
      return row['QUERY PLAN'] || row.plan || Object.values(row)[0];
    }).join('\n');

    return {
      timestamp: new Date().toISOString(),
      query: query,
      mode: analyzeMode,
      plan_text: planText,
      plan_rows: data,
      executed: analyzeMode === 'explain_analyze',
    };
  }

  /**
   * Get database connection info
   */
  async getConnectionInfo() {
    const query = `
      SELECT 
        current_database() as database_name,
        current_schema() as current_schema,
        version() as postgres_version,
        pg_size_pretty(pg_database_size(current_database())) as database_size
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;

    return data && data.length > 0 ? data[0] : null;
  }
}

