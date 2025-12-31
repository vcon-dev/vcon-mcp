/**
 * Database Size and Performance Tools
 * 
 * Tools for understanding database size and providing smart defaults
 */

import type { ToolCategory } from '../config/tools.js';

/**
 * Tool: Get Database Size Info
 * Returns database size information and recommendations for query limits
 */
export const getDatabaseSizeInfoTool = {
  name: 'get_database_size_info',
  category: 'infra' as ToolCategory,
  description: 'Get database size information and smart recommendations for query limits. ' +
    'Use this before running large queries to understand the database scale and get appropriate limits.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      include_recommendations: {
        type: 'boolean',
        description: 'Include smart recommendations for query limits (default: true)',
        default: true
      }
    }
  }
};

/**
 * Tool: Get Smart Search Limits
 * Returns recommended limits based on database size and query type
 */
export const getSmartSearchLimitsTool = {
  name: 'get_smart_search_limits',
  category: 'infra' as ToolCategory,
  description: 'Get smart search limits based on database size and query complexity. ' +
    'Helps prevent memory exhaustion by suggesting appropriate limits for different query types.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query_type: {
        type: 'string',
        enum: ['basic', 'content', 'semantic', 'hybrid', 'analytics'],
        description: 'Type of query to get limits for'
      },
      estimated_result_size: {
        type: 'string',
        enum: ['small', 'medium', 'large', 'unknown'],
        description: 'Estimated size of expected results',
        default: 'unknown'
      }
    }
  }
};

export const allDatabaseSizeTools = [
  getDatabaseSizeInfoTool,
  getSmartSearchLimitsTool,
];
