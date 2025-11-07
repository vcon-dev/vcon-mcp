/**
 * Database Analytics Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GetDatabaseAnalyticsHandler,
  GetMonthlyGrowthAnalyticsHandler,
  GetAttachmentAnalyticsHandler,
  GetTagAnalyticsHandler,
  GetContentAnalyticsHandler,
  GetDatabaseHealthMetricsHandler,
} from '../../../src/tools/handlers/database-analytics.js';
import { ToolHandlerContext } from '../../../src/tools/handlers/base.js';
import { DatabaseAnalytics } from '../../../src/db/database-analytics.js';

// Mock observability
vi.mock('../../../src/observability/instrumentation.js', () => ({
  withSpan: vi.fn((name, fn) => fn({ setAttributes: vi.fn(), setStatus: vi.fn() })),
  recordCounter: vi.fn(),
  recordHistogram: vi.fn(),
  logWithContext: vi.fn(),
  attachErrorToSpan: vi.fn(),
}));

vi.mock('../../../src/observability/attributes.js', () => ({
  ATTR_TOOL_NAME: 'tool.name',
  ATTR_TOOL_SUCCESS: 'tool.success',
}));

describe('Database Analytics Handlers', () => {
  let mockContext: ToolHandlerContext;
  let mockDbAnalytics: any;

  beforeEach(() => {
    mockDbAnalytics = {
      getDatabaseAnalytics: vi.fn(),
      getMonthlyGrowthAnalytics: vi.fn(),
      getAttachmentAnalytics: vi.fn(),
      getTagAnalytics: vi.fn(),
      getContentAnalytics: vi.fn(),
      getDatabaseHealthMetrics: vi.fn(),
    };

    mockContext = {
      queries: {} as any,
      pluginManager: {} as any,
      dbInspector: {} as any,
      dbAnalytics: mockDbAnalytics as unknown as DatabaseAnalytics,
      dbSizeAnalyzer: {} as any,
      supabase: {},
    };
  });

  describe('GetDatabaseAnalyticsHandler', () => {
    it('should call getDatabaseAnalytics with options', async () => {
      const handler = new GetDatabaseAnalyticsHandler();
      const mockAnalytics = { summary: { total_vcons: 100 } };
      mockDbAnalytics.getDatabaseAnalytics.mockResolvedValue(mockAnalytics);

      const result = await handler.handle(
        {
          include_growth_trends: true,
          include_content_analytics: false,
          months_back: 6,
        },
        mockContext
      );

      expect(mockDbAnalytics.getDatabaseAnalytics).toHaveBeenCalledWith({
        includeGrowthTrends: true,
        includeContentAnalytics: false,
        includeAttachmentStats: undefined,
        includeTagAnalytics: undefined,
        includeHealthMetrics: undefined,
        monthsBack: 6,
      });
      expect(result).toHaveProperty('content');
    });

    it('should handle all options', async () => {
      const handler = new GetDatabaseAnalyticsHandler();
      mockDbAnalytics.getDatabaseAnalytics.mockResolvedValue({});

      await handler.handle(
        {
          include_growth_trends: false,
          include_content_analytics: false,
          include_attachment_stats: false,
          include_tag_analytics: false,
          include_health_metrics: false,
          months_back: 12,
        },
        mockContext
      );

      expect(mockDbAnalytics.getDatabaseAnalytics).toHaveBeenCalledWith({
        includeGrowthTrends: false,
        includeContentAnalytics: false,
        includeAttachmentStats: false,
        includeTagAnalytics: false,
        includeHealthMetrics: false,
        monthsBack: 12,
      });
    });
  });

  describe('GetMonthlyGrowthAnalyticsHandler', () => {
    it('should call getMonthlyGrowthAnalytics with options', async () => {
      const handler = new GetMonthlyGrowthAnalyticsHandler();
      mockDbAnalytics.getMonthlyGrowthAnalytics.mockResolvedValue({});

      await handler.handle(
        {
          months_back: 24,
          include_projections: false,
          granularity: 'weekly',
        },
        mockContext
      );

      expect(mockDbAnalytics.getMonthlyGrowthAnalytics).toHaveBeenCalledWith({
        monthsBack: 24,
        includeProjections: false,
        granularity: 'weekly',
      });
    });

    it('should use default options when not provided', async () => {
      const handler = new GetMonthlyGrowthAnalyticsHandler();
      mockDbAnalytics.getMonthlyGrowthAnalytics.mockResolvedValue({});

      await handler.handle({}, mockContext);

      expect(mockDbAnalytics.getMonthlyGrowthAnalytics).toHaveBeenCalledWith({
        monthsBack: undefined,
        includeProjections: undefined,
        granularity: undefined,
      });
    });
  });

  describe('GetAttachmentAnalyticsHandler', () => {
    it('should call getAttachmentAnalytics with options', async () => {
      const handler = new GetAttachmentAnalyticsHandler();
      mockDbAnalytics.getAttachmentAnalytics.mockResolvedValue({});

      await handler.handle(
        {
          include_size_distribution: true,
          include_type_breakdown: false,
          include_temporal_patterns: true,
          top_n_types: 20,
        },
        mockContext
      );

      expect(mockDbAnalytics.getAttachmentAnalytics).toHaveBeenCalledWith({
        includeSizeDistribution: true,
        includeTypeBreakdown: false,
        includeTemporalPatterns: true,
        topNTypes: 20,
      });
    });
  });

  describe('GetTagAnalyticsHandler', () => {
    it('should call getTagAnalytics with options', async () => {
      const handler = new GetTagAnalyticsHandler();
      mockDbAnalytics.getTagAnalytics.mockResolvedValue({});

      await handler.handle(
        {
          include_frequency_analysis: true,
          include_value_distribution: false,
          top_n_keys: 15,
          min_usage_count: 5,
        },
        mockContext
      );

      expect(mockDbAnalytics.getTagAnalytics).toHaveBeenCalledWith({
        includeFrequencyAnalysis: true,
        includeValueDistribution: false,
        includeTemporalTrends: undefined,
        topNKeys: 15,
        minUsageCount: 5,
      });
    });
  });

  describe('GetContentAnalyticsHandler', () => {
    it('should call getContentAnalytics with options', async () => {
      const handler = new GetContentAnalyticsHandler();
      mockDbAnalytics.getContentAnalytics.mockResolvedValue({});

      await handler.handle(
        {
          include_dialog_analysis: true,
          include_analysis_breakdown: false,
          include_party_patterns: true,
        },
        mockContext
      );

      expect(mockDbAnalytics.getContentAnalytics).toHaveBeenCalledWith({
        includeDialogAnalysis: true,
        includeAnalysisBreakdown: false,
        includePartyPatterns: true,
        includeConversationMetrics: undefined,
        includeTemporalContent: undefined,
      });
    });
  });

  describe('GetDatabaseHealthMetricsHandler', () => {
    it('should call getDatabaseHealthMetrics with options', async () => {
      const handler = new GetDatabaseHealthMetricsHandler();
      mockDbAnalytics.getDatabaseHealthMetrics.mockResolvedValue({});

      await handler.handle(
        {
          include_performance_metrics: true,
          include_storage_efficiency: false,
          include_recommendations: true,
        },
        mockContext
      );

      expect(mockDbAnalytics.getDatabaseHealthMetrics).toHaveBeenCalledWith({
        includePerformanceMetrics: true,
        includeStorageEfficiency: false,
        includeIndexHealth: undefined,
        includeConnectionMetrics: undefined,
        includeRecommendations: true,
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle errors from getDatabaseAnalytics', async () => {
      const handler = new GetDatabaseAnalyticsHandler();
      mockDbAnalytics.getDatabaseAnalytics.mockRejectedValue(new Error('Database error'));

      await expect(handler.handle({}, mockContext)).rejects.toThrow('Database error');
    });
  });
});

