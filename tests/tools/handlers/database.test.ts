/**
 * Database Inspection Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  GetDatabaseShapeHandler,
  GetDatabaseStatsHandler,
  AnalyzeQueryHandler,
} from '../../../src/tools/handlers/database.js';
import { ToolHandlerContext } from '../../../src/tools/handlers/base.js';
import { DatabaseInspector } from '../../../src/db/database-inspector.js';

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

describe('Database Inspection Handlers', () => {
  let mockContext: ToolHandlerContext;
  let mockDbInspector: any;

  beforeEach(() => {
    mockDbInspector = {
      getDatabaseShape: vi.fn(),
      getDatabaseStats: vi.fn(),
      analyzeQuery: vi.fn(),
    };

    mockContext = {
      queries: {} as any,
      pluginManager: {} as any,
      dbInspector: mockDbInspector as unknown as DatabaseInspector,
      dbAnalytics: {} as any,
      dbSizeAnalyzer: {} as any,
      supabase: {},
    };
  });

  describe('GetDatabaseShapeHandler', () => {
    it('should call getDatabaseShape with options', async () => {
      const handler = new GetDatabaseShapeHandler();
      const mockShape = { tables: [] };
      mockDbInspector.getDatabaseShape.mockResolvedValue(mockShape);

      const result = await handler.handle(
        {
          include_counts: true,
          include_sizes: false,
          include_indexes: true,
          include_columns: false,
        },
        mockContext
      );

      expect(mockDbInspector.getDatabaseShape).toHaveBeenCalledWith({
        includeCounts: true,
        includeSizes: false,
        includeIndexes: true,
        includeColumns: false,
      });
      expect(result).toHaveProperty('content');
    });

    it('should use default options when not provided', async () => {
      const handler = new GetDatabaseShapeHandler();
      mockDbInspector.getDatabaseShape.mockResolvedValue({});

      await handler.handle({}, mockContext);

      expect(mockDbInspector.getDatabaseShape).toHaveBeenCalledWith({
        includeCounts: true,
        includeSizes: true,
        includeIndexes: true,
        includeColumns: false,
      });
    });

    it('should handle all options being false', async () => {
      const handler = new GetDatabaseShapeHandler();
      mockDbInspector.getDatabaseShape.mockResolvedValue({});

      await handler.handle(
        {
          include_counts: false,
          include_sizes: false,
          include_indexes: false,
          include_columns: false,
        },
        mockContext
      );

      expect(mockDbInspector.getDatabaseShape).toHaveBeenCalledWith({
        includeCounts: false,
        includeSizes: false,
        includeIndexes: false,
        includeColumns: false,
      });
    });
  });

  describe('GetDatabaseStatsHandler', () => {
    it('should call getDatabaseStats with options', async () => {
      const handler = new GetDatabaseStatsHandler();
      const mockStats = { cache_stats: {} };
      mockDbInspector.getDatabaseStats.mockResolvedValue(mockStats);

      const result = await handler.handle(
        {
          include_query_stats: true,
          include_index_usage: false,
          include_cache_stats: true,
          table_name: 'vcons',
        },
        mockContext
      );

      expect(mockDbInspector.getDatabaseStats).toHaveBeenCalledWith({
        includeQueryStats: true,
        includeIndexUsage: false,
        includeCacheStats: true,
        tableName: 'vcons',
      });
      expect(result).toHaveProperty('content');
    });

    it('should use default options when not provided', async () => {
      const handler = new GetDatabaseStatsHandler();
      mockDbInspector.getDatabaseStats.mockResolvedValue({});

      await handler.handle({}, mockContext);

      expect(mockDbInspector.getDatabaseStats).toHaveBeenCalledWith({
        includeQueryStats: true,
        includeIndexUsage: true,
        includeCacheStats: true,
        tableName: undefined,
      });
    });

    it('should handle table_name filter', async () => {
      const handler = new GetDatabaseStatsHandler();
      mockDbInspector.getDatabaseStats.mockResolvedValue({});

      await handler.handle({ table_name: 'parties' }, mockContext);

      expect(mockDbInspector.getDatabaseStats).toHaveBeenCalledWith({
        includeQueryStats: true,
        includeIndexUsage: true,
        includeCacheStats: true,
        tableName: 'parties',
      });
    });
  });

  describe('AnalyzeQueryHandler', () => {
    it('should call analyzeQuery with query and analyzeMode', async () => {
      const handler = new AnalyzeQueryHandler();
      const mockAnalysis = { plan: 'Seq Scan' };
      mockDbInspector.analyzeQuery.mockResolvedValue(mockAnalysis);

      const result = await handler.handle(
        {
          query: 'SELECT * FROM vcons',
          analyze_mode: 'explain_analyze',
        },
        mockContext
      );

      expect(mockDbInspector.analyzeQuery).toHaveBeenCalledWith(
        'SELECT * FROM vcons',
        'explain_analyze'
      );
      expect(result).toHaveProperty('content');
    });

    it('should default analyzeMode to explain', async () => {
      const handler = new AnalyzeQueryHandler();
      mockDbInspector.analyzeQuery.mockResolvedValue({});

      await handler.handle({ query: 'SELECT * FROM vcons' }, mockContext);

      expect(mockDbInspector.analyzeQuery).toHaveBeenCalledWith(
        'SELECT * FROM vcons',
        'explain'
      );
    });

    it('should throw error when query is missing', async () => {
      const handler = new AnalyzeQueryHandler();

      await expect(handler.handle({}, mockContext)).rejects.toThrow(McpError);
      await expect(handler.handle({}, mockContext)).rejects.toThrow('query is required');
    });

    it('should handle different analyze modes', async () => {
      const handler = new AnalyzeQueryHandler();
      mockDbInspector.analyzeQuery.mockResolvedValue({});

      await handler.handle(
        { query: 'SELECT * FROM vcons', analyze_mode: 'explain' },
        mockContext
      );
      expect(mockDbInspector.analyzeQuery).toHaveBeenCalledWith('SELECT * FROM vcons', 'explain');

      await handler.handle(
        { query: 'SELECT * FROM vcons', analyze_mode: 'explain_analyze' },
        mockContext
      );
      expect(mockDbInspector.analyzeQuery).toHaveBeenCalledWith(
        'SELECT * FROM vcons',
        'explain_analyze'
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle errors from getDatabaseShape', async () => {
      const handler = new GetDatabaseShapeHandler();
      mockDbInspector.getDatabaseShape.mockRejectedValue(new Error('Database error'));

      await expect(handler.handle({}, mockContext)).rejects.toThrow('Database error');
    });

    it('should handle errors from getDatabaseStats', async () => {
      const handler = new GetDatabaseStatsHandler();
      mockDbInspector.getDatabaseStats.mockRejectedValue(new Error('Database error'));

      await expect(handler.handle({}, mockContext)).rejects.toThrow('Database error');
    });

    it('should handle errors from analyzeQuery', async () => {
      const handler = new AnalyzeQueryHandler();
      mockDbInspector.analyzeQuery.mockRejectedValue(new Error('Query analysis error'));

      await expect(
        handler.handle({ query: 'SELECT * FROM vcons' }, mockContext)
      ).rejects.toThrow('Query analysis error');
    });
  });
});

