/**
 * Tag Handler Tests
 * 
 * Tests for tag management tool handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  ManageTagHandler,
  GetTagsHandler,
  RemoveAllTagsHandler,
  SearchByTagsHandler,
  GetUniqueTagsHandler,
} from '../../src/tools/handlers/tags.js';
import { ToolHandlerContext } from '../../src/tools/handlers/base.js';
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

describe('Tag Handlers', () => {
  let mockContext: ToolHandlerContext;
  let mockQueries: any;
  let mockPluginManager: any;

  beforeEach(() => {
    mockQueries = {
      addTag: vi.fn(),
      getTag: vi.fn(),
      getTags: vi.fn(),
      removeTag: vi.fn(),
      removeAllTags: vi.fn(),
      searchByTags: vi.fn(),
      getUniqueTags: vi.fn(),
      getVCon: vi.fn(),
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

  describe('ManageTagHandler', () => {
    it('should set a tag', async () => {
      const handler = new ManageTagHandler();
      const uuid = crypto.randomUUID();

      mockQueries.addTag.mockResolvedValue(undefined);

      const result = await handler.handle({
        vcon_uuid: uuid,
        action: 'set',
        key: 'department',
        value: 'sales',
      }, mockContext);

      expect(mockQueries.addTag).toHaveBeenCalledWith(uuid, 'department', 'sales', true);
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.action).toBe('set');
      expect(response.key).toBe('department');
    });

    it('should remove a tag', async () => {
      const handler = new ManageTagHandler();
      const uuid = crypto.randomUUID();

      mockQueries.removeTag.mockResolvedValue(undefined);

      const result = await handler.handle({
        vcon_uuid: uuid,
        action: 'remove',
        key: 'department',
      }, mockContext);

      expect(mockQueries.removeTag).toHaveBeenCalledWith(uuid, 'department');
      const response = JSON.parse(result.content[0].text);
      expect(response.action).toBe('remove');
    });

    it('should throw error if action is invalid', async () => {
      const handler = new ManageTagHandler();
      await expect(handler.handle({
        vcon_uuid: crypto.randomUUID(),
        action: 'invalid',
        key: 'test',
      }, mockContext)).rejects.toThrow(McpError);
    });

    it('should throw error if value is missing for set action', async () => {
      const handler = new ManageTagHandler();
      await expect(handler.handle({
        vcon_uuid: crypto.randomUUID(),
        action: 'set',
        key: 'test',
      }, mockContext)).rejects.toThrow(McpError);
    });
  });

  describe('GetTagsHandler', () => {
    it('should get all tags', async () => {
      const handler = new GetTagsHandler();
      const uuid = crypto.randomUUID();
      const tags = { department: 'sales', priority: 'high' };

      mockQueries.getTags.mockResolvedValue(tags);

      const result = await handler.handle({
        vcon_uuid: uuid,
      }, mockContext);

      expect(mockQueries.getTags).toHaveBeenCalledWith(uuid);
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.tags).toEqual(tags);
      expect(response.count).toBe(2);
    });

    it('should get a single tag', async () => {
      const handler = new GetTagsHandler();
      const uuid = crypto.randomUUID();

      mockQueries.getTag.mockResolvedValue('sales');

      const result = await handler.handle({
        vcon_uuid: uuid,
        key: 'department',
      }, mockContext);

      expect(mockQueries.getTag).toHaveBeenCalledWith(uuid, 'department', undefined);
      const response = JSON.parse(result.content[0].text);
      expect(response.key).toBe('department');
      expect(response.value).toBe('sales');
    });

    it('should use default value when tag does not exist', async () => {
      const handler = new GetTagsHandler();
      const uuid = crypto.randomUUID();

      mockQueries.getTag.mockResolvedValue('default');

      const result = await handler.handle({
        vcon_uuid: uuid,
        key: 'nonexistent',
        default_value: 'default',
      }, mockContext);

      expect(mockQueries.getTag).toHaveBeenCalledWith(uuid, 'nonexistent', 'default');
      const response = JSON.parse(result.content[0].text);
      expect(response.value).toBe('default');
      expect(response.exists).toBe(false);
    });
  });

  describe('RemoveAllTagsHandler', () => {
    it('should remove all tags', async () => {
      const handler = new RemoveAllTagsHandler();
      const uuid = crypto.randomUUID();

      mockQueries.removeAllTags.mockResolvedValue(undefined);

      const result = await handler.handle({
        vcon_uuid: uuid,
      }, mockContext);

      expect(mockQueries.removeAllTags).toHaveBeenCalledWith(uuid);
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.message).toContain('All tags removed');
    });
  });

  describe('SearchByTagsHandler', () => {
    it('should search vCons by tags', async () => {
      const handler = new SearchByTagsHandler();
      const uuid1 = crypto.randomUUID();
      const uuid2 = crypto.randomUUID();

      mockQueries.searchByTags.mockResolvedValue([uuid1, uuid2]);

      const result = await handler.handle({
        tags: { department: 'sales' },
        limit: 50,
      }, mockContext);

      expect(mockQueries.searchByTags).toHaveBeenCalledWith({ department: 'sales' }, 50);
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.count).toBe(2);
      expect(response.vcon_uuids).toEqual([uuid1, uuid2]);
    });

    it('should return full vCons when requested', async () => {
      const handler = new SearchByTagsHandler();
      const uuid = crypto.randomUUID();
      const vcon = {
        vcon: '0.3.0',
        uuid,
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test' }],
      };

      mockQueries.searchByTags.mockResolvedValue([uuid]);
      mockQueries.getVCon.mockResolvedValue(vcon);

      const result = await handler.handle({
        tags: { department: 'sales' },
        return_full_vcons: true,
        max_full_vcons: 10,
      }, mockContext);

      expect(mockQueries.getVCon).toHaveBeenCalledWith(uuid);
      const response = JSON.parse(result.content[0].text);
      expect(response.vcons).toBeDefined();
      expect(response.vcons.length).toBe(1);
    });

    it('should throw error if tags object is missing', async () => {
      const handler = new SearchByTagsHandler();
      await expect(handler.handle({}, mockContext)).rejects.toThrow(McpError);
    });

    it('should throw error if tags object is empty', async () => {
      const handler = new SearchByTagsHandler();
      await expect(handler.handle({
        tags: {},
      }, mockContext)).rejects.toThrow(McpError);
    });
  });

  describe('GetUniqueTagsHandler', () => {
    it('should get unique tags', async () => {
      const handler = new GetUniqueTagsHandler();
      const mockResult = {
        keys: ['department', 'priority'],
        tagsByKey: {
          department: ['sales', 'support'],
          priority: ['high', 'low'],
        },
        countsPerValue: {
          'department:sales': 10,
          'department:support': 5,
        },
        totalVCons: 15,
      };

      mockQueries.getUniqueTags.mockResolvedValue(mockResult);

      const result = await handler.handle({
        include_counts: true,
      }, mockContext);

      expect(mockQueries.getUniqueTags).toHaveBeenCalledWith({
        includeCounts: true,
        keyFilter: undefined,
        minCount: 1,
      });
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.unique_keys).toEqual(['department', 'priority']);
      expect(response.total_vcons_with_tags).toBe(15);
    });

    it('should apply filters when provided', async () => {
      const handler = new GetUniqueTagsHandler();
      mockQueries.getUniqueTags.mockResolvedValue({
        keys: [],
        tagsByKey: {},
        countsPerValue: {},
        totalVCons: 0,
      });

      await handler.handle({
        key_filter: 'department',
        min_count: 5,
      }, mockContext);

      expect(mockQueries.getUniqueTags).toHaveBeenCalledWith({
        includeCounts: false,
        keyFilter: 'department',
        minCount: 5,
      });
    });
  });
});

