/**
 * Database Size Tool Handlers
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BaseToolHandler, ToolHandlerContext, ToolResponse } from './base.js';

/**
 * Handler for get_database_size_info tool
 */
export class GetDatabaseSizeInfoHandler extends BaseToolHandler {
  readonly toolName = 'get_database_size_info';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const includeRecommendations = (args?.include_recommendations as boolean | undefined) ?? true;

    const sizeInfo = await context.dbSizeAnalyzer.getDatabaseSizeInfo(includeRecommendations);

    return this.createSuccessResponse({
      database_size_info: sizeInfo
    });
  }
}

/**
 * Handler for get_smart_search_limits tool
 */
export class GetSmartSearchLimitsHandler extends BaseToolHandler {
  readonly toolName = 'get_smart_search_limits';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const queryType = args?.query_type as string;
    const estimatedResultSize = (args?.estimated_result_size as string | undefined) || 'unknown';

    if (!queryType) {
      throw new McpError(ErrorCode.InvalidParams, 'query_type is required');
    }

    const smartLimits = await context.dbSizeAnalyzer.getSmartSearchLimits(queryType, estimatedResultSize);

    return this.createSuccessResponse({
      smart_limits: smartLimits
    });
  }
}

