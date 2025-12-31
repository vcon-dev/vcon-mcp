/**
 * Database Analytics Tools
 * 
 * Comprehensive tools for analyzing database shape, size, growth, and content patterns
 */

import type { ToolCategory } from '../config/tools.js';

/**
 * Tool: Get Database Analytics
 * Returns comprehensive database analytics including size, growth, content distribution
 */
export const getDatabaseAnalyticsTool = {
  name: 'get_database_analytics',
  category: 'analytics' as ToolCategory,
  description: 'Get comprehensive database analytics including total size, monthly growth trends, ' +
    'content distribution, attachment statistics, tag usage patterns, and database health metrics. ' +
    'Provides a complete overview of the vCon database state and usage patterns.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      include_growth_trends: {
        type: 'boolean',
        description: 'Include monthly growth trends and size progression (default: true)',
        default: true
      },
      include_content_analytics: {
        type: 'boolean',
        description: 'Include content analysis (dialog types, analysis types, etc.) (default: true)',
        default: true
      },
      include_attachment_stats: {
        type: 'boolean',
        description: 'Include attachment statistics and file type distribution (default: true)',
        default: true
      },
      include_tag_analytics: {
        type: 'boolean',
        description: 'Include tag usage patterns and distribution (default: true)',
        default: true
      },
      include_health_metrics: {
        type: 'boolean',
        description: 'Include database health metrics and performance indicators (default: true)',
        default: true
      },
      months_back: {
        type: 'number',
        description: 'Number of months to include in growth trends (default: 12)',
        default: 12,
        minimum: 1,
        maximum: 60
      }
    }
  }
};

/**
 * Tool: Get Monthly Growth Analytics
 * Returns detailed monthly growth patterns and projections
 */
export const getMonthlyGrowthTool = {
  name: 'get_monthly_growth_analytics',
  category: 'analytics' as ToolCategory,
  description: 'Get detailed monthly growth analytics including vCon creation trends, ' +
    'size growth patterns, content volume changes, and growth projections. ' +
    'Useful for capacity planning and understanding usage patterns.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      months_back: {
        type: 'number',
        description: 'Number of months to analyze (default: 12)',
        default: 12,
        minimum: 1,
        maximum: 60
      },
      include_projections: {
        type: 'boolean',
        description: 'Include growth projections based on historical data (default: true)',
        default: true
      },
      granularity: {
        type: 'string',
        enum: ['monthly', 'weekly', 'daily'],
        description: 'Time granularity for the analysis (default: monthly)',
        default: 'monthly'
      }
    }
  }
};

/**
 * Tool: Get Attachment Analytics
 * Returns comprehensive attachment statistics and file type analysis
 */
export const getAttachmentAnalyticsTool = {
  name: 'get_attachment_analytics',
  category: 'analytics' as ToolCategory,
  description: 'Get comprehensive attachment analytics including file type distribution, ' +
    'size statistics, attachment frequency, and storage usage patterns. ' +
    'Helps understand what types of files are being stored and their impact on storage.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      include_size_distribution: {
        type: 'boolean',
        description: 'Include detailed size distribution statistics (default: true)',
        default: true
      },
      include_type_breakdown: {
        type: 'boolean',
        description: 'Include file type breakdown and MIME type analysis (default: true)',
        default: true
      },
      include_temporal_patterns: {
        type: 'boolean',
        description: 'Include attachment patterns over time (default: false)',
        default: false
      },
      top_n_types: {
        type: 'number',
        description: 'Number of top file types to include in breakdown (default: 10)',
        default: 10,
        minimum: 1,
        maximum: 50
      }
    }
  }
};

/**
 * Tool: Get Tag Analytics
 * Returns comprehensive tag usage patterns and distribution
 */
export const getTagAnalyticsTool = {
  name: 'get_tag_analytics',
  category: 'analytics' as ToolCategory,
  description: 'Get comprehensive tag analytics including usage patterns, ' +
    'key-value distribution, tag frequency, and tagging trends over time. ' +
    'Helps understand how vCons are being categorized and organized.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      include_frequency_analysis: {
        type: 'boolean',
        description: 'Include tag frequency and usage statistics (default: true)',
        default: true
      },
      include_value_distribution: {
        type: 'boolean',
        description: 'Include value distribution for each tag key (default: true)',
        default: true
      },
      include_temporal_trends: {
        type: 'boolean',
        description: 'Include tagging trends over time (default: false)',
        default: false
      },
      top_n_keys: {
        type: 'number',
        description: 'Number of top tag keys to analyze in detail (default: 20)',
        default: 20,
        minimum: 1,
        maximum: 100
      },
      min_usage_count: {
        type: 'number',
        description: 'Minimum usage count for tags to include in analysis (default: 1)',
        default: 1,
        minimum: 1
      }
    }
  }
};

/**
 * Tool: Get Content Analytics
 * Returns comprehensive content analysis and conversation insights
 */
export const getContentAnalyticsTool = {
  name: 'get_content_analytics',
  category: 'analytics' as ToolCategory,
  description: 'Get comprehensive content analytics including dialog types, ' +
    'analysis distribution, party patterns, and conversation characteristics. ' +
    'Provides insights into the types of conversations being stored.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      include_dialog_analysis: {
        type: 'boolean',
        description: 'Include dialog type and content analysis (default: true)',
        default: true
      },
      include_analysis_breakdown: {
        type: 'boolean',
        description: 'Include analysis type and vendor breakdown (default: true)',
        default: true
      },
      include_party_patterns: {
        type: 'boolean',
        description: 'Include party role and communication pattern analysis (default: true)',
        default: true
      },
      include_conversation_metrics: {
        type: 'boolean',
        description: 'Include conversation length, duration, and complexity metrics (default: true)',
        default: true
      },
      include_temporal_content: {
        type: 'boolean',
        description: 'Include content patterns over time (default: false)',
        default: false
      }
    }
  }
};

/**
 * Tool: Get Database Health Metrics
 * Returns database health indicators and performance recommendations
 */
export const getDatabaseHealthTool = {
  name: 'get_database_health_metrics',
  category: 'analytics' as ToolCategory,
  description: 'Get database health metrics including performance indicators, ' +
    'storage efficiency, index usage, query performance, and optimization recommendations. ' +
    'Helps identify potential issues and optimization opportunities.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      include_performance_metrics: {
        type: 'boolean',
        description: 'Include query performance and execution metrics (default: true)',
        default: true
      },
      include_storage_efficiency: {
        type: 'boolean',
        description: 'Include storage efficiency and fragmentation analysis (default: true)',
        default: true
      },
      include_index_health: {
        type: 'boolean',
        description: 'Include index usage and optimization recommendations (default: true)',
        default: true
      },
      include_connection_metrics: {
        type: 'boolean',
        description: 'Include connection and cache performance metrics (default: true)',
        default: true
      },
      include_recommendations: {
        type: 'boolean',
        description: 'Include optimization recommendations and alerts (default: true)',
        default: true
      }
    }
  }
};

export const allDatabaseAnalyticsTools = [
  getDatabaseAnalyticsTool,
  getMonthlyGrowthTool,
  getAttachmentAnalyticsTool,
  getTagAnalyticsTool,
  getContentAnalyticsTool,
  getDatabaseHealthTool,
];
