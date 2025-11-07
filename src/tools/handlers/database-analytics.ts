/**
 * Database Analytics Tool Handlers
 */

import { BaseToolHandler, ToolHandlerContext, ToolResponse } from './base.js';

/**
 * Handler for get_database_analytics tool
 */
export class GetDatabaseAnalyticsHandler extends BaseToolHandler {
  readonly toolName = 'get_database_analytics';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const options = {
      includeGrowthTrends: args?.include_growth_trends as boolean | undefined,
      includeContentAnalytics: args?.include_content_analytics as boolean | undefined,
      includeAttachmentStats: args?.include_attachment_stats as boolean | undefined,
      includeTagAnalytics: args?.include_tag_analytics as boolean | undefined,
      includeHealthMetrics: args?.include_health_metrics as boolean | undefined,
      monthsBack: args?.months_back as number | undefined,
    };

    const analytics = await context.dbAnalytics.getDatabaseAnalytics(options);

    return this.createSuccessResponse({
      database_analytics: analytics
    });
  }
}

/**
 * Handler for get_monthly_growth_analytics tool
 */
export class GetMonthlyGrowthAnalyticsHandler extends BaseToolHandler {
  readonly toolName = 'get_monthly_growth_analytics';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const options = {
      monthsBack: args?.months_back as number | undefined,
      includeProjections: args?.include_projections as boolean | undefined,
      granularity: args?.granularity as 'monthly' | 'weekly' | 'daily' | undefined,
    };

    const growth = await context.dbAnalytics.getMonthlyGrowthAnalytics(options);

    return this.createSuccessResponse({
      monthly_growth_analytics: growth
    });
  }
}

/**
 * Handler for get_attachment_analytics tool
 */
export class GetAttachmentAnalyticsHandler extends BaseToolHandler {
  readonly toolName = 'get_attachment_analytics';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const options = {
      includeSizeDistribution: args?.include_size_distribution as boolean | undefined,
      includeTypeBreakdown: args?.include_type_breakdown as boolean | undefined,
      includeTemporalPatterns: args?.include_temporal_patterns as boolean | undefined,
      topNTypes: args?.top_n_types as number | undefined,
    };

    const analytics = await context.dbAnalytics.getAttachmentAnalytics(options);

    return this.createSuccessResponse({
      attachment_analytics: analytics
    });
  }
}

/**
 * Handler for get_tag_analytics tool
 */
export class GetTagAnalyticsHandler extends BaseToolHandler {
  readonly toolName = 'get_tag_analytics';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const options = {
      includeFrequencyAnalysis: args?.include_frequency_analysis as boolean | undefined,
      includeValueDistribution: args?.include_value_distribution as boolean | undefined,
      includeTemporalTrends: args?.include_temporal_trends as boolean | undefined,
      topNKeys: args?.top_n_keys as number | undefined,
      minUsageCount: args?.min_usage_count as number | undefined,
    };

    const analytics = await context.dbAnalytics.getTagAnalytics(options);

    return this.createSuccessResponse({
      tag_analytics: analytics
    });
  }
}

/**
 * Handler for get_content_analytics tool
 */
export class GetContentAnalyticsHandler extends BaseToolHandler {
  readonly toolName = 'get_content_analytics';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const options = {
      includeDialogAnalysis: args?.include_dialog_analysis as boolean | undefined,
      includeAnalysisBreakdown: args?.include_analysis_breakdown as boolean | undefined,
      includePartyPatterns: args?.include_party_patterns as boolean | undefined,
      includeConversationMetrics: args?.include_conversation_metrics as boolean | undefined,
      includeTemporalContent: args?.include_temporal_content as boolean | undefined,
    };

    const analytics = await context.dbAnalytics.getContentAnalytics(options);

    return this.createSuccessResponse({
      content_analytics: analytics
    });
  }
}

/**
 * Handler for get_database_health_metrics tool
 */
export class GetDatabaseHealthMetricsHandler extends BaseToolHandler {
  readonly toolName = 'get_database_health_metrics';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const options = {
      includePerformanceMetrics: args?.include_performance_metrics as boolean | undefined,
      includeStorageEfficiency: args?.include_storage_efficiency as boolean | undefined,
      includeIndexHealth: args?.include_index_health as boolean | undefined,
      includeConnectionMetrics: args?.include_connection_metrics as boolean | undefined,
      includeRecommendations: args?.include_recommendations as boolean | undefined,
    };

    const health = await context.dbAnalytics.getDatabaseHealthMetrics(options);

    return this.createSuccessResponse({
      database_health_metrics: health
    });
  }
}

