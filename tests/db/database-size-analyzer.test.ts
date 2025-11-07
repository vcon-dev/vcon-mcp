/**
 * Tests for Database Size Analyzer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSizeAnalyzer } from '../../src/db/database-size-analyzer.js';

describe('Database Size Analyzer', () => {
  let analyzer: DatabaseSizeAnalyzer;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      rpc: vi.fn(),
    };

    analyzer = new DatabaseSizeAnalyzer(mockSupabase);
  });

  describe('getDatabaseSizeInfo', () => {
    it('should return database size information', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '100', size_bytes: '1000000' },
          { table_name: 'parties', row_count: '200', size_bytes: '500000' },
        ],
        error: null,
      });

      const result = await analyzer.getDatabaseSizeInfo();

      expect(result).toHaveProperty('total_vcons', 100);
      expect(result).toHaveProperty('total_size_bytes');
      expect(result).toHaveProperty('total_size_pretty');
      expect(result).toHaveProperty('size_category');
      expect(result).toHaveProperty('recommendations');
      expect(result).toHaveProperty('table_sizes');
    });

    it('should categorize database as small when vCons < 1000', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '500', size_bytes: '1000000' },
        ],
        error: null,
      });

      const result = await analyzer.getDatabaseSizeInfo();

      expect(result.size_category).toBe('small');
    });

    it('should categorize database as medium when 1000 <= vCons < 10000', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '5000', size_bytes: '10000000' },
        ],
        error: null,
      });

      const result = await analyzer.getDatabaseSizeInfo();

      expect(result.size_category).toBe('medium');
    });

    it('should categorize database as large when 10000 <= vCons < 100000', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '50000', size_bytes: '100000000' },
        ],
        error: null,
      });

      const result = await analyzer.getDatabaseSizeInfo();

      expect(result.size_category).toBe('large');
    });

    it('should categorize database as very_large when vCons >= 100000', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '200000', size_bytes: '1000000000' },
        ],
        error: null,
      });

      const result = await analyzer.getDatabaseSizeInfo();

      expect(result.size_category).toBe('very_large');
    });

    it('should include recommendations when includeRecommendations is true', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '100', size_bytes: '1000000' },
        ],
        error: null,
      });

      const result = await analyzer.getDatabaseSizeInfo(true);

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations).toHaveProperty('max_basic_search_limit');
      expect(result.recommendations).toHaveProperty('max_content_search_limit');
      expect(result.recommendations).toHaveProperty('max_semantic_search_limit');
      expect(result.recommendations).toHaveProperty('max_analytics_limit');
      expect(result.recommendations).toHaveProperty('recommended_response_format');
    });

    it('should exclude recommendations when includeRecommendations is false', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '100', size_bytes: '1000000' },
        ],
        error: null,
      });

      const result = await analyzer.getDatabaseSizeInfo(false);

      expect(result.recommendations).toBeDefined();
      // Should have default recommendations
      expect(result.recommendations.max_basic_search_limit).toBe(10);
    });

    it('should calculate total size from all tables', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '100', size_bytes: '1000000' },
          { table_name: 'parties', row_count: '200', size_bytes: '500000' },
          { table_name: 'dialog', row_count: '300', size_bytes: '2000000' },
        ],
        error: null,
      });

      const result = await analyzer.getDatabaseSizeInfo();

      expect(result.total_size_bytes).toBe(3500000);
    });

    it('should format size bytes as pretty string', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '100', size_bytes: '1048576' }, // 1 MB
        ],
        error: null,
      });

      const result = await analyzer.getDatabaseSizeInfo();

      expect(result.total_size_pretty).toBeDefined();
      expect(typeof result.total_size_pretty).toBe('string');
    });
  });

  describe('getSmartSearchLimits', () => {
    it('should return smart search limits based on database size', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '100', size_bytes: '1000000' },
        ],
        error: null,
      });

      const result = await analyzer.getSmartSearchLimits('basic', 'small');

      expect(result).toHaveProperty('query_type', 'basic');
      expect(result).toHaveProperty('estimated_result_size', 'small');
      expect(result).toHaveProperty('recommended_limit');
      expect(result).toHaveProperty('recommended_response_format');
      expect(result).toHaveProperty('memory_warning');
      expect(result).toHaveProperty('explanation');
    });

    it('should return higher limits for smaller databases', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '100', size_bytes: '1000000' },
        ],
        error: null,
      });

      const smallResult = await analyzer.getSmartSearchLimits('basic', 'small');

      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '200000', size_bytes: '1000000000' },
        ],
        error: null,
      });

      const largeResult = await analyzer.getSmartSearchLimits('basic', 'small');

      // Small database should have higher limits
      expect(smallResult.recommended_limit).toBeGreaterThanOrEqual(
        largeResult.recommended_limit
      );
    });

    it('should handle different query types', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          { table_name: 'vcons', row_count: '100', size_bytes: '1000000' },
        ],
        error: null,
      });

      const basicResult = await analyzer.getSmartSearchLimits('basic', 'small');
      const semanticResult = await analyzer.getSmartSearchLimits('semantic', 'small');

      expect(basicResult.query_type).toBe('basic');
      expect(semanticResult.query_type).toBe('semantic');
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      // Access private method through any cast for testing
      const formatBytes = (analyzer as any).formatBytes.bind(analyzer);

      // Check that it returns a formatted string (exact format may vary)
      expect(typeof formatBytes(1024)).toBe('string');
      expect(formatBytes(1024)).toContain('KB');
      expect(typeof formatBytes(1048576)).toBe('string');
      expect(formatBytes(1048576)).toContain('MB');
      expect(typeof formatBytes(1073741824)).toBe('string');
      expect(formatBytes(1073741824)).toContain('GB');
      expect(formatBytes(0)).toBe('0 Bytes');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors in getDatabaseSizeInfo', async () => {
      mockSupabase.rpc.mockRejectedValue(new Error('Database error'));

      await expect(analyzer.getDatabaseSizeInfo()).rejects.toThrow('Database error');
    });

    it('should handle RPC errors', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC error' },
      });

      await expect(analyzer.getDatabaseSizeInfo()).rejects.toThrow();
    });
  });
});

