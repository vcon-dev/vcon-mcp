/**
 * Database Size Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  GetDatabaseSizeInfoHandler,
  GetSmartSearchLimitsHandler,
} from '../../../src/tools/handlers/database-size.js';
import { ToolHandlerContext } from '../../../src/tools/handlers/base.js';
import { DatabaseSizeAnalyzer } from '../../../src/db/database-size-analyzer.js';

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

describe('Database Size Handlers', () => {
  let mockContext: ToolHandlerContext;
  let mockDbSizeAnalyzer: any;

  beforeEach(() => {
    mockDbSizeAnalyzer = {
      getDatabaseSizeInfo: vi.fn(),
      getSmartSearchLimits: vi.fn(),
    };

    mockContext = {
      queries: {} as any,
      pluginManager: {} as any,
      dbInspector: {} as any,
      dbAnalytics: {} as any,
      dbSizeAnalyzer: mockDbSizeAnalyzer as unknown as DatabaseSizeAnalyzer,
      supabase: {},
    };
  });

  describe('GetDatabaseSizeInfoHandler', () => {
    it('should call getDatabaseSizeInfo with includeRecommendations', async () => {
      const handler = new GetDatabaseSizeInfoHandler();
      const mockSizeInfo = {
        total_vcons: 100,
        total_size_bytes: 1000000,
        size_category: 'small',
      };
      mockDbSizeAnalyzer.getDatabaseSizeInfo.mockResolvedValue(mockSizeInfo);

      const result = await handler.handle(
        { include_recommendations: true },
        mockContext
      );

      expect(mockDbSizeAnalyzer.getDatabaseSizeInfo).toHaveBeenCalledWith(true);
      expect(result).toHaveProperty('content');
    });

    it('should default includeRecommendations to true', async () => {
      const handler = new GetDatabaseSizeInfoHandler();
      mockDbSizeAnalyzer.getDatabaseSizeInfo.mockResolvedValue({});

      await handler.handle({}, mockContext);

      expect(mockDbSizeAnalyzer.getDatabaseSizeInfo).toHaveBeenCalledWith(true);
    });

    it('should use includeRecommendations from args', async () => {
      const handler = new GetDatabaseSizeInfoHandler();
      mockDbSizeAnalyzer.getDatabaseSizeInfo.mockResolvedValue({});

      await handler.handle({ include_recommendations: false }, mockContext);

      expect(mockDbSizeAnalyzer.getDatabaseSizeInfo).toHaveBeenCalledWith(false);
    });
  });

  describe('GetSmartSearchLimitsHandler', () => {
    it('should call getSmartSearchLimits with queryType and estimatedResultSize', async () => {
      const handler = new GetSmartSearchLimitsHandler();
      const mockLimits = {
        basic_search: { max_results: 50 },
      };
      mockDbSizeAnalyzer.getSmartSearchLimits.mockResolvedValue(mockLimits);

      const result = await handler.handle(
        {
          query_type: 'keyword',
          estimated_result_size: 'medium',
        },
        mockContext
      );

      expect(mockDbSizeAnalyzer.getSmartSearchLimits).toHaveBeenCalledWith(
        'keyword',
        'medium'
      );
      expect(result).toHaveProperty('content');
    });

    it('should default estimatedResultSize to unknown', async () => {
      const handler = new GetSmartSearchLimitsHandler();
      mockDbSizeAnalyzer.getSmartSearchLimits.mockResolvedValue({});

      await handler.handle({ query_type: 'semantic' }, mockContext);

      expect(mockDbSizeAnalyzer.getSmartSearchLimits).toHaveBeenCalledWith(
        'semantic',
        'unknown'
      );
    });

    it('should throw error when queryType is missing', async () => {
      const handler = new GetSmartSearchLimitsHandler();

      await expect(handler.handle({}, mockContext)).rejects.toThrow(McpError);
      await expect(handler.handle({}, mockContext)).rejects.toThrow('query_type is required');
    });

    it('should handle different query types', async () => {
      const handler = new GetSmartSearchLimitsHandler();
      mockDbSizeAnalyzer.getSmartSearchLimits.mockResolvedValue({});

      await handler.handle({ query_type: 'keyword' }, mockContext);
      expect(mockDbSizeAnalyzer.getSmartSearchLimits).toHaveBeenCalledWith('keyword', 'unknown');

      await handler.handle({ query_type: 'semantic' }, mockContext);
      expect(mockDbSizeAnalyzer.getSmartSearchLimits).toHaveBeenCalledWith('semantic', 'unknown');

      await handler.handle({ query_type: 'hybrid' }, mockContext);
      expect(mockDbSizeAnalyzer.getSmartSearchLimits).toHaveBeenCalledWith('hybrid', 'unknown');
    });
  });

  describe('Error Handling', () => {
    it('should handle errors from getDatabaseSizeInfo', async () => {
      const handler = new GetDatabaseSizeInfoHandler();
      mockDbSizeAnalyzer.getDatabaseSizeInfo.mockRejectedValue(new Error('Database error'));

      await expect(handler.handle({}, mockContext)).rejects.toThrow('Database error');
    });

    it('should handle errors from getSmartSearchLimits', async () => {
      const handler = new GetSmartSearchLimitsHandler();
      mockDbSizeAnalyzer.getSmartSearchLimits.mockRejectedValue(new Error('Database error'));

      await expect(
        handler.handle({ query_type: 'keyword' }, mockContext)
      ).rejects.toThrow('Database error');
    });
  });
});

