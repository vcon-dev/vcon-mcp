/**
 * Database Inspection and Performance Tools
 * 
 * Tools for debugging, performance monitoring, and database shape inspection
 */

import type { ToolCategory } from '../config/tools.js';

/**
 * Tool: Get Database Shape
 * Returns comprehensive information about the database structure
 */
export const getDatabaseShapeTool = {
  name: 'get_database_shape',
  category: 'infra' as ToolCategory,
  description: 'Get comprehensive database structure information including tables, indexes, sizes, and relationships. ' +
    'Useful for debugging, performance tuning, and understanding the database schema.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      include_counts: {
        type: 'boolean',
        description: 'Include row counts for each table (default: true)',
        default: true
      },
      include_sizes: {
        type: 'boolean',
        description: 'Include disk size information for tables and indexes (default: true)',
        default: true
      },
      include_indexes: {
        type: 'boolean',
        description: 'Include index information (default: true)',
        default: true
      },
      include_columns: {
        type: 'boolean',
        description: 'Include detailed column information (default: false)',
        default: false
      }
    }
  }
};

/**
 * Tool: Get Database Stats
 * Returns performance and usage statistics
 */
export const getDatabaseStatsTool = {
  name: 'get_database_stats',
  category: 'infra' as ToolCategory,
  description: 'Get database performance and usage statistics including query performance, cache hit ratios, ' +
    'table access patterns, and index usage. Useful for performance monitoring and optimization.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      include_query_stats: {
        type: 'boolean',
        description: 'Include query statistics (default: true)',
        default: true
      },
      include_index_usage: {
        type: 'boolean',
        description: 'Include index usage statistics (default: true)',
        default: true
      },
      include_cache_stats: {
        type: 'boolean',
        description: 'Include cache hit ratio statistics (default: true)',
        default: true
      },
      table_name: {
        type: 'string',
        description: 'Optional: Get statistics for a specific table'
      }
    }
  }
};

/**
 * Tool: Analyze Query Performance
 * Returns query execution plan and performance analysis
 */
export const analyzeQueryTool = {
  name: 'analyze_query',
  category: 'infra' as ToolCategory,
  description: 'Analyze a SQL query to understand its execution plan and performance characteristics. ' +
    'Useful for optimizing slow queries and understanding index usage.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'SQL query to analyze (SELECT queries only for safety)'
      },
      analyze_mode: {
        type: 'string',
        enum: ['explain', 'explain_analyze'],
        description: 'Analysis mode: "explain" (plan only) or "explain_analyze" (execute and measure)',
        default: 'explain'
      }
    },
    required: ['query']
  }
};

export const allDatabaseTools = [
  getDatabaseShapeTool,
  getDatabaseStatsTool,
  analyzeQueryTool,
];

