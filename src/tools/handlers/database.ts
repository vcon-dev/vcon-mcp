/**
 * Database Inspection Tool Handlers
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BaseToolHandler, ToolHandlerContext, ToolResponse } from './base.js';

/**
 * Handler for get_database_shape tool
 */
export class GetDatabaseShapeHandler extends BaseToolHandler {
  readonly toolName = 'get_database_shape';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const includeCounts = (args?.include_counts as boolean | undefined) ?? true;
    const includeSizes = (args?.include_sizes as boolean | undefined) ?? true;
    const includeIndexes = (args?.include_indexes as boolean | undefined) ?? true;
    const includeColumns = (args?.include_columns as boolean | undefined) ?? false;

    const shape = await context.dbInspector.getDatabaseShape({
      includeCounts,
      includeSizes,
      includeIndexes,
      includeColumns,
    });

    return this.createSuccessResponse({
      database_shape: shape
    });
  }
}

/**
 * Handler for get_database_stats tool
 */
export class GetDatabaseStatsHandler extends BaseToolHandler {
  readonly toolName = 'get_database_stats';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const includeQueryStats = (args?.include_query_stats as boolean | undefined) ?? true;
    const includeIndexUsage = (args?.include_index_usage as boolean | undefined) ?? true;
    const includeCacheStats = (args?.include_cache_stats as boolean | undefined) ?? true;
    const tableName = args?.table_name as string | undefined;

    const stats = await context.dbInspector.getDatabaseStats({
      includeQueryStats,
      includeIndexUsage,
      includeCacheStats,
      tableName,
    });

    return this.createSuccessResponse({
      database_stats: stats
    });
  }
}

/**
 * Handler for analyze_query tool
 */
export class AnalyzeQueryHandler extends BaseToolHandler {
  readonly toolName = 'analyze_query';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const query = args?.query as string;
    const analyzeMode = (args?.analyze_mode as 'explain' | 'explain_analyze' | undefined) || 'explain';

    if (!query) {
      throw new McpError(ErrorCode.InvalidParams, 'query is required');
    }

    const analysis = await context.dbInspector.analyzeQuery(query, analyzeMode);

    return this.createSuccessResponse({
      query_analysis: analysis
    });
  }
}

