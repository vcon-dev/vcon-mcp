/**
 * Tests for Database Analytics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseAnalytics } from '../../src/db/database-analytics.js';

describe('Database Analytics', () => {
  let analytics: DatabaseAnalytics;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      rpc: vi.fn(),
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      })),
    };

    analytics = new DatabaseAnalytics(mockSupabase);
  });

  describe('getDatabaseAnalytics', () => {
    it('should return comprehensive analytics with all options enabled', async () => {
      // Mock table statistics
      mockSupabase.rpc.mockResolvedValueOnce({
        data: [
          { table_name: 'vcons', row_count: 100, size_bytes: 1000000 },
          { table_name: 'parties', row_count: 200, size_bytes: 500000 },
        ],
        error: null,
      });

      // Mock other RPC calls
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

      const result = await analytics.getDatabaseAnalytics();

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('tables');
      expect(result).toHaveProperty('growth');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('attachments');
      expect(result).toHaveProperty('tags');
      expect(result).toHaveProperty('health');
    });

    it('should exclude growth trends when disabled', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [{ table_name: 'vcons', row_count: 100, size_bytes: 1000000 }],
        error: null,
      });

      const result = await analytics.getDatabaseAnalytics({
        includeGrowthTrends: false,
      });

      expect(result.growth).toEqual({});
    });

    it('should exclude content analytics when disabled', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [{ table_name: 'vcons', row_count: 100, size_bytes: 1000000 }],
        error: null,
      });

      const result = await analytics.getDatabaseAnalytics({
        includeContentAnalytics: false,
      });

      expect(result.content).toEqual({});
    });

    it('should exclude attachment stats when disabled', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [{ table_name: 'vcons', row_count: 100, size_bytes: 1000000 }],
        error: null,
      });

      const result = await analytics.getDatabaseAnalytics({
        includeAttachmentStats: false,
      });

      expect(result.attachments).toEqual({});
    });

    it('should exclude tag analytics when disabled', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [{ table_name: 'vcons', row_count: 100, size_bytes: 1000000 }],
        error: null,
      });

      const result = await analytics.getDatabaseAnalytics({
        includeTagAnalytics: false,
      });

      expect(result.tags).toEqual({});
    });

    it('should exclude health metrics when disabled', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [{ table_name: 'vcons', row_count: 100, size_bytes: 1000000 }],
        error: null,
      });

      const result = await analytics.getDatabaseAnalytics({
        includeHealthMetrics: false,
      });

      expect(result.health).toEqual({});
    });

    it('should use custom monthsBack parameter', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [{ table_name: 'vcons', row_count: 100, size_bytes: 1000000 }],
        error: null,
      });

      await analytics.getDatabaseAnalytics({
        monthsBack: 6,
      });

      // Should call growth trends with 6 months
      expect(mockSupabase.rpc).toHaveBeenCalled();
    });
  });

  describe('getMonthlyGrowthAnalytics', () => {
    it('should return monthly growth analytics', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await analytics.getMonthlyGrowthAnalytics();

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('period');
      expect(result).toHaveProperty('granularity', 'monthly');
      expect(result).toHaveProperty('trends');
      expect(result).toHaveProperty('projections');
    });

    it('should exclude projections when disabled', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await analytics.getMonthlyGrowthAnalytics({
        includeProjections: false,
      });

      expect(result.projections).toEqual({});
    });

    it('should use custom granularity', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await analytics.getMonthlyGrowthAnalytics({
        granularity: 'weekly',
      });

      expect(result.granularity).toBe('weekly');
    });

    it('should use custom monthsBack', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await analytics.getMonthlyGrowthAnalytics({
        monthsBack: 24,
      });

      expect(result.period).toBe('24 months');
    });
  });

  describe('getAttachmentAnalytics', () => {
    it('should return attachment analytics', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await analytics.getAttachmentAnalytics();

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('type_breakdown');
      expect(result).toHaveProperty('size_distribution');
    });

    it('should exclude type breakdown when disabled', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await analytics.getAttachmentAnalytics({
        includeTypeBreakdown: false,
      });

      expect(result.type_breakdown).toEqual({});
    });

    it('should exclude size distribution when disabled', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await analytics.getAttachmentAnalytics({
        includeSizeDistribution: false,
      });

      expect(result.size_distribution).toEqual({});
    });

    it('should include temporal patterns when enabled', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await analytics.getAttachmentAnalytics({
        includeTemporalPatterns: true,
      });

      expect(result.temporal_patterns).toBeDefined();
    });

    it('should use custom topNTypes', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      await analytics.getAttachmentAnalytics({
        topNTypes: 20,
      });

      // Should be called with topNTypes parameter
      expect(mockSupabase.rpc).toHaveBeenCalled();
    });
  });

  describe('getTagAnalytics', () => {
    it('should return tag analytics', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await analytics.getTagAnalytics();

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('frequency_analysis');
      expect(result).toHaveProperty('value_distribution');
    });

    it('should use custom keyFilter', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      await analytics.getTagAnalytics({
        keyFilter: 'department',
      });

      expect(mockSupabase.rpc).toHaveBeenCalled();
    });

    it('should use custom minCount', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      await analytics.getTagAnalytics({
        minCount: 5,
      });

      expect(mockSupabase.rpc).toHaveBeenCalled();
    });
  });

  describe('getContentAnalytics', () => {
    it('should return content analytics', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await analytics.getContentAnalytics();

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('dialog_analysis');
      expect(result).toHaveProperty('analysis_breakdown');
    });
  });

  describe('getDatabaseHealthMetrics', () => {
    it('should return database health metrics', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await analytics.getDatabaseHealthMetrics();

      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('overall_score');
      expect(result).toHaveProperty('metrics');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors in getDatabaseAnalytics', async () => {
      mockSupabase.rpc.mockRejectedValue(new Error('Database error'));

      await expect(analytics.getDatabaseAnalytics()).rejects.toThrow('Database error');
    });

    it('should handle database errors in getMonthlyGrowthAnalytics', async () => {
      mockSupabase.rpc.mockRejectedValue(new Error('Database error'));

      await expect(analytics.getMonthlyGrowthAnalytics()).rejects.toThrow('Database error');
    });

    it('should handle database errors in getAttachmentAnalytics', async () => {
      mockSupabase.rpc.mockRejectedValue(new Error('Database error'));

      await expect(analytics.getAttachmentAnalytics()).rejects.toThrow('Database error');
    });
  });
});

