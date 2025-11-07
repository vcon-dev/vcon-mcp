/**
 * Search Handler Tests
 * 
 * Tests for search tool handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  SearchVConsHandler,
  SearchVConsContentHandler,
  SearchVConsSemanticHandler,
  SearchVConsHybridHandler,
} from '../../src/tools/handlers/search.js';
import { ToolHandlerContext } from '../../src/tools/handlers/base.js';
import { VCon } from '../../src/types/vcon.js';
import { VConQueries } from '../../src/db/queries.js';
import { PluginManager } from '../../src/hooks/plugin-manager.js';
import { DatabaseInspector } from '../../src/db/database-inspector.js';
import { DatabaseAnalytics } from '../../src/db/database-analytics.js';
import { DatabaseSizeAnalyzer } from '../../src/db/database-size-analyzer.js';

// Mock observability
vi.mock('../../src/observability/instrumentation.js', () => ({
  withSpan: vi.fn((name, fn) => fn({ setAttributes: vi.fn(), setStatus: vi.fn() })),
  recordCounter: vi.fn(),
  recordHistogram: vi.fn(),
  logWithContext: vi.fn(),
  attachErrorToSpan: vi.fn(),
}));

vi.mock('../../src/observability/attributes.js', () => ({
  ATTR_SEARCH_TYPE: 'search.type',
  ATTR_SEARCH_RESULTS_COUNT: 'search.results.count',
  ATTR_TOOL_NAME: 'tool.name',
  ATTR_TOOL_SUCCESS: 'tool.success',
}));

describe('Search Handlers', () => {
  let mockContext: ToolHandlerContext;
  let mockQueries: any;
  let mockPluginManager: any;

  beforeEach(() => {
    mockQueries = {
      searchVCons: vi.fn(),
      searchVConsCount: vi.fn(),
      keywordSearch: vi.fn(),
      keywordSearchCount: vi.fn(),
      semanticSearch: vi.fn(),
      hybridSearch: vi.fn(),
    };

    mockPluginManager = {
      executeHook: vi.fn(),
    };

    mockContext = {
      queries: mockQueries as any,
      pluginManager: mockPluginManager as any,
      dbInspector: {} as DatabaseInspector,
      dbAnalytics: {} as DatabaseAnalytics,
      dbSizeAnalyzer: {} as DatabaseSizeAnalyzer,
      supabase: {},
    };
  });

  describe('SearchVConsHandler', () => {
    it('should search vCons with default parameters', async () => {
      const handler = new SearchVConsHandler();
      const mockResults: VCon[] = [
        {
          vcon: '0.3.0',
          uuid: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          parties: [{ name: 'Test' }],
        },
      ];

      mockQueries.searchVCons.mockResolvedValue(mockResults);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await handler.handle({}, mockContext);

      expect(mockQueries.searchVCons).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 })
      );
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.count).toBe(1);
      expect(response.response_format).toBe('metadata');
    });

    it('should format results as ids_only when requested', async () => {
      const handler = new SearchVConsHandler();
      const uuid1 = crypto.randomUUID();
      const uuid2 = crypto.randomUUID();
      const mockResults: VCon[] = [
        { vcon: '0.3.0', uuid: uuid1, created_at: new Date().toISOString(), parties: [{ name: 'Test' }] },
        { vcon: '0.3.0', uuid: uuid2, created_at: new Date().toISOString(), parties: [{ name: 'Test' }] },
      ];

      mockQueries.searchVCons.mockResolvedValue(mockResults);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await handler.handle({
        response_format: 'ids_only',
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.results).toEqual([uuid1, uuid2]);
    });

    it('should include total count when requested', async () => {
      const handler = new SearchVConsHandler();
      const mockResults: VCon[] = [
        { vcon: '0.3.0', uuid: crypto.randomUUID(), created_at: new Date().toISOString(), parties: [{ name: 'Test' }] },
      ];

      mockQueries.searchVCons.mockResolvedValue(mockResults);
      mockQueries.searchVConsCount.mockResolvedValue(100);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await handler.handle({
        include_count: true,
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.total_count).toBe(100);
    });

    it('should apply plugin filters from beforeSearch hook', async () => {
      const handler = new SearchVConsHandler();
      const modifiedFilters = { subject: 'Modified', limit: 20 };
      mockQueries.searchVCons.mockResolvedValue([]);
      mockPluginManager.executeHook.mockImplementation((hook: string) => {
        if (hook === 'beforeSearch') return Promise.resolve(modifiedFilters);
        return Promise.resolve(undefined);
      });

      await handler.handle({}, mockContext);

      expect(mockQueries.searchVCons).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Modified', limit: 20 })
      );
    });

    it('should handle database connection errors gracefully', async () => {
      const handler = new SearchVConsHandler();
      const dbError = new TypeError('fetch failed');
      mockQueries.searchVCons.mockRejectedValue(dbError);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      await expect(handler.handle({}, mockContext)).rejects.toThrow(McpError);
      await expect(handler.handle({}, mockContext)).rejects.toThrow('Database connection failed');
    });
  });

  describe('SearchVConsContentHandler', () => {
    it('should perform keyword search', async () => {
      const handler = new SearchVConsContentHandler();
      const mockResults = [
        { vcon_id: 'uuid1', doc_type: 'dialog', ref_index: 0, rank: 0.9, snippet: 'test snippet' },
      ];

      mockQueries.keywordSearch.mockResolvedValue(mockResults);

      const result = await handler.handle({
        query: 'test query',
      }, mockContext);

      expect(mockQueries.keywordSearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'test query' })
      );
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.count).toBe(1);
    });

    it('should throw error if query is missing', async () => {
      const handler = new SearchVConsContentHandler();
      await expect(handler.handle({}, mockContext)).rejects.toThrow(McpError);
    });

    it('should format results as snippets when requested', async () => {
      const handler = new SearchVConsContentHandler();
      const mockResults = [
        { vcon_id: 'uuid1', doc_type: 'dialog', ref_index: 0, rank: 0.9, snippet: 'test snippet' },
      ];

      mockQueries.keywordSearch.mockResolvedValue(mockResults);

      const result = await handler.handle({
        query: 'test',
        response_format: 'snippets',
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.results[0].snippet).toBe('test snippet');
    });
  });

  describe('SearchVConsSemanticHandler', () => {
    it('should perform semantic search with embedding', async () => {
      const handler = new SearchVConsSemanticHandler();
      const embedding = Array(384).fill(0.1);
      const mockResults = [
        { vcon_id: 'uuid1', content_type: 'dialog', content_reference: '0', content_text: 'test', similarity: 0.95 },
      ];

      mockQueries.semanticSearch.mockResolvedValue(mockResults);

      const result = await handler.handle({
        embedding,
      }, mockContext);

      expect(mockQueries.semanticSearch).toHaveBeenCalledWith(
        expect.objectContaining({ embedding })
      );
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
    });

    it('should throw error if embedding has wrong dimensions', async () => {
      const handler = new SearchVConsSemanticHandler();
      await expect(handler.handle({
        embedding: [1, 2, 3], // Wrong size
      }, mockContext)).rejects.toThrow(McpError);
    });

    it('should throw error if neither embedding nor query provided', async () => {
      const handler = new SearchVConsSemanticHandler();
      await expect(handler.handle({}, mockContext)).rejects.toThrow(McpError);
    });
  });

  describe('SearchVConsHybridHandler', () => {
    it('should perform hybrid search with query', async () => {
      const handler = new SearchVConsHybridHandler();
      const mockResults = [
        { vcon_id: 'uuid1', combined_score: 0.9, semantic_score: 0.8, keyword_score: 0.7 },
      ];

      mockQueries.hybridSearch.mockResolvedValue(mockResults);

      const result = await handler.handle({
        query: 'test query',
      }, mockContext);

      expect(mockQueries.hybridSearch).toHaveBeenCalled();
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
    });

    it('should throw error if query is missing', async () => {
      const handler = new SearchVConsHybridHandler();
      await expect(handler.handle({}, mockContext)).rejects.toThrow(McpError);
    });

    it('should use provided embedding if valid', async () => {
      const handler = new SearchVConsHybridHandler();
      const embedding = Array(384).fill(0.1);
      mockQueries.hybridSearch.mockResolvedValue([]);

      await handler.handle({
        query: 'test',
        embedding,
      }, mockContext);

      expect(mockQueries.hybridSearch).toHaveBeenCalledWith(
        expect.objectContaining({ embedding })
      );
    });
  });
});

