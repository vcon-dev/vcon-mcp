/**
 * Tool schema drift regression tests (CON-1240)
 *
 * Each case pins a place where a tool's published inputSchema disagreed with
 * what the handler or service actually did.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BaseToolHandler, ToolHandlerContext, ToolResponse } from '../../src/tools/handlers/base.js';
import { UpdateVConHandler } from '../../src/tools/handlers/vcon-crud.js';
import {
  SearchVConsSemanticHandler,
  SearchVConsHybridHandler,
} from '../../src/tools/handlers/search.js';
import { SearchByTagsHandler } from '../../src/tools/handlers/tags.js';
import { VConService } from '../../src/services/vcon-service.js';
import {
  updateVConTool,
  searchVConsSemanticTool,
  searchVConsHybridTool,
} from '../../src/tools/vcon-crud.js';
import { getSmartSearchLimitsTool } from '../../src/tools/database-size-tools.js';
import { createFromTemplateTool } from '../../src/tools/templates.js';
import { getSchemaTool } from '../../src/tools/schema-tools.js';
import { searchByTagsTool } from '../../src/tools/tag-tools.js';

vi.mock('../../src/observability/instrumentation.js', () => ({
  withSpan: vi.fn((name, fn) => fn({ setAttributes: vi.fn(), setStatus: vi.fn() })),
  recordCounter: vi.fn(),
  recordHistogram: vi.fn(),
  logWithContext: vi.fn(),
  attachErrorToSpan: vi.fn(),
}));

vi.mock('../../src/observability/attributes.js', () => ({
  ATTR_SEARCH_TYPE: 'search.type',
  ATTR_TOOL_NAME: 'tool.name',
  ATTR_TOOL_SUCCESS: 'tool.success',
  ATTR_VCON_UUID: 'vcon.uuid',
}));

const UUID = '11111111-2222-4333-8444-555555555555';

describe('tool schema drift (CON-1240)', () => {
  let mockQueries: any;
  let mockPluginManager: any;
  let ctx: ToolHandlerContext;

  beforeEach(() => {
    mockQueries = {
      updateVCon: vi.fn().mockResolvedValue(undefined),
      getVCon: vi.fn().mockResolvedValue({ uuid: UUID }),
      semanticSearch: vi.fn().mockResolvedValue([]),
      hybridSearch: vi.fn().mockResolvedValue([]),
      searchByTags: vi.fn().mockResolvedValue([]),
      createVCon: vi.fn().mockResolvedValue({ uuid: UUID, id: '1' }),
    };
    mockPluginManager = { executeHook: vi.fn().mockResolvedValue(undefined), hasHook: vi.fn().mockReturnValue(false) };
    ctx = {
      queries: mockQueries,
      pluginManager: mockPluginManager,
      dbInspector: {},
      dbAnalytics: {},
      dbSizeAnalyzer: {},
      supabase: {},
      vconService: new VConService({ queries: mockQueries, pluginManager: mockPluginManager } as any),
    } as unknown as ToolHandlerContext;
  });

  describe('update_vcon critical / must_support', () => {
    it('declares critical (and the legacy alias) in the schema', () => {
      const props = (updateVConTool.inputSchema.properties.updates as any).properties;
      expect(props).toHaveProperty('critical');
      expect(props).toHaveProperty('must_support');
    });

    it('persists critical', async () => {
      await new UpdateVConHandler().handle({ uuid: UUID, updates: { critical: ['a'] } }, ctx);
      expect(mockQueries.updateVCon).toHaveBeenCalledWith(UUID, { critical: ['a'] });
    });

    it('maps legacy must_support to critical', async () => {
      await new UpdateVConHandler().handle({ uuid: UUID, updates: { must_support: ['a'] } }, ctx);
      expect(mockQueries.updateVCon).toHaveBeenCalledWith(UUID, { critical: ['a'] });
    });

    it('prefers critical when both are given', async () => {
      await new UpdateVConHandler().handle(
        { uuid: UUID, updates: { critical: ['new'], must_support: ['old'] } }, ctx);
      expect(mockQueries.updateVCon).toHaveBeenCalledWith(UUID, { critical: ['new'] });
    });
  });

  describe('VConService.create legacy field names', () => {
    it('maps must_support, appended and mimetype to 0.4.0 names', async () => {
      const service = new VConService({ queries: mockQueries, pluginManager: mockPluginManager } as any);
      const amended = { uuid: UUID };
      const result = await service.create({
        parties: [{ name: 'A' }],
        must_support: ['ext'],
        appended: amended,
        dialog: [{ type: 'text', mimetype: 'text/plain', body: 'hi', encoding: 'none' }],
        analysis: [{ type: 't', vendor: 'v', mimetype: 'text/plain', body: 'x', encoding: 'none' }],
        attachments: [{ type: 'x', mimetype: 'text/plain', body: 'x', encoding: 'none' }],
      } as any);
      const v: any = result.vcon;
      expect(v.critical).toEqual(['ext']);
      expect(v.amended).toEqual(amended);
      expect(v).not.toHaveProperty('must_support');
      expect(v).not.toHaveProperty('appended');
      for (const list of [v.dialog, v.analysis, v.attachments]) {
        expect(list[0].mediatype).toBe('text/plain');
        expect(list[0]).not.toHaveProperty('mimetype');
      }
    });

    it('lets the new name win when both are present', async () => {
      const service = new VConService({ queries: mockQueries, pluginManager: mockPluginManager } as any);
      const result = await service.create({
        parties: [{ name: 'A' }],
        critical: ['new'],
        must_support: ['old'],
        dialog: [{ type: 'text', mediatype: 'text/html', mimetype: 'text/plain', body: 'hi', encoding: 'none' }],
      } as any);
      const v: any = result.vcon;
      expect(v.critical).toEqual(['new']);
      expect(v).not.toHaveProperty('must_support');
      expect(v.dialog[0].mediatype).toBe('text/html');
      expect(v.dialog[0]).not.toHaveProperty('mimetype');
    });
  });

  describe('semantic and hybrid search', () => {
    const embedding = Array(384).fill(0.1);
    const hits = [
      { vcon_id: 'a', content_type: 'dialog', content_reference: '0', content_text: 't', similarity: 0.9 },
      { vcon_id: 'a', content_type: 'analysis', content_reference: '1', content_text: 'u', similarity: 0.8 },
      { vcon_id: 'b', content_type: 'dialog', content_reference: '0', content_text: 'v', similarity: 0.7 },
    ];

    it('no longer advertises include_count, which has no count query behind it', () => {
      expect(searchVConsSemanticTool.inputSchema.properties).not.toHaveProperty('include_count');
      expect(searchVConsHybridTool.inputSchema.properties).not.toHaveProperty('include_count');
    });

    it('semantic honours response_format ids_only', async () => {
      mockQueries.semanticSearch.mockResolvedValue(hits);
      const res = await new SearchVConsSemanticHandler().handle(
        { embedding, response_format: 'ids_only' }, ctx);
      expect(JSON.parse(res.content[0].text).results).toEqual(['a', 'b']);
    });

    it('semantic honours response_format full', async () => {
      mockQueries.semanticSearch.mockResolvedValue(hits);
      mockQueries.getVCon.mockImplementation(async (id: string) => ({ uuid: id }));
      const res = await new SearchVConsSemanticHandler().handle(
        { embedding, response_format: 'full' }, ctx);
      expect(JSON.parse(res.content[0].text).results).toEqual([{ uuid: 'a' }, { uuid: 'b' }]);
    });

    it('full reads through the service so afterRead hooks run', async () => {
      mockQueries.semanticSearch.mockResolvedValue(hits);
      mockQueries.getVCon.mockImplementation(async (id: string) => ({ uuid: id }));
      mockPluginManager.executeHook.mockImplementation(async (name: string, arg: any) =>
        name === 'afterRead' ? { ...arg, redacted_by_hook: true } : undefined);
      const res = await new SearchVConsSemanticHandler().handle(
        { embedding, response_format: 'full' }, ctx);
      expect(JSON.parse(res.content[0].text).results).toEqual([
        { uuid: 'a', redacted_by_hook: true },
        { uuid: 'b', redacted_by_hook: true },
      ]);
      expect(mockPluginManager.executeHook.mock.calls.filter((c: any[]) => c[0] === 'afterRead')).toHaveLength(2);
    });

    it('full skips a vCon deleted between search and fetch instead of failing the call', async () => {
      mockQueries.semanticSearch.mockResolvedValue(hits);
      mockQueries.getVCon.mockImplementation(async (id: string) => {
        if (id === 'a') throw new Error('vCon not found: a');
        return { uuid: id };
      });
      const res = await new SearchVConsSemanticHandler().handle(
        { embedding, response_format: 'full' }, ctx);
      expect(JSON.parse(res.content[0].text).results).toEqual([{ uuid: 'b' }]);
    });

    it('hybrid full skips a failing fetch too', async () => {
      mockQueries.hybridSearch.mockResolvedValue([
        { vcon_id: 'a', combined_score: 1, semantic_score: 1, keyword_score: 1 },
        { vcon_id: 'b', combined_score: 1, semantic_score: 1, keyword_score: 1 },
      ]);
      mockQueries.getVCon.mockImplementation(async (id: string) => {
        if (id === 'b') throw new Error('gone');
        return { uuid: id };
      });
      const res = await new SearchVConsHybridHandler().handle(
        { query: 'q', embedding, response_format: 'full' }, ctx);
      expect(JSON.parse(res.content[0].text).results).toEqual([{ uuid: 'a' }]);
    });

    it('semantic default stays hit-level rows', async () => {
      mockQueries.semanticSearch.mockResolvedValue(hits);
      const res = await new SearchVConsSemanticHandler().handle({ embedding }, ctx);
      const body = JSON.parse(res.content[0].text);
      expect(body.results).toHaveLength(3);
      expect(body.results[0].similarity_score).toBe(0.9);
    });

    it('hybrid honours response_format ids_only', async () => {
      mockQueries.hybridSearch.mockResolvedValue([
        { vcon_id: 'a', combined_score: 1, semantic_score: 1, keyword_score: 1 },
        { vcon_id: 'b', combined_score: 1, semantic_score: 1, keyword_score: 1 },
      ]);
      const res = await new SearchVConsHybridHandler().handle(
        { query: 'q', embedding, response_format: 'ids_only' }, ctx);
      expect(JSON.parse(res.content[0].text).results).toEqual(['a', 'b']);
    });

    it('semantic passes threshold 0 through instead of 0.7', async () => {
      await new SearchVConsSemanticHandler().handle({ embedding, threshold: 0 }, ctx);
      expect(mockQueries.semanticSearch).toHaveBeenCalledWith(expect.objectContaining({ threshold: 0 }));
    });

    it('hybrid passes semantic_weight 0 through instead of 0.6', async () => {
      await new SearchVConsHybridHandler().handle({ query: 'q', embedding, semantic_weight: 0 }, ctx);
      expect(mockQueries.hybridSearch).toHaveBeenCalledWith(expect.objectContaining({ semanticWeight: 0 }));
    });

    it('keeps the defaults when the params are omitted', async () => {
      await new SearchVConsSemanticHandler().handle({ embedding }, ctx);
      expect(mockQueries.semanticSearch).toHaveBeenCalledWith(expect.objectContaining({ threshold: 0.7 }));
      await new SearchVConsHybridHandler().handle({ query: 'q', embedding }, ctx);
      expect(mockQueries.hybridSearch).toHaveBeenCalledWith(expect.objectContaining({ semanticWeight: 0.6 }));
    });
  });

  describe('schema declarations', () => {
    it('get_smart_search_limits requires query_type', () => {
      expect((getSmartSearchLimitsTool.inputSchema as any).required).toContain('query_type');
    });

    it('create_vcon_from_template no longer declares the unused metadata', () => {
      expect(createFromTemplateTool.inputSchema.properties).not.toHaveProperty('metadata');
    });

    it('get_schema no longer declares the unused version', () => {
      expect(getSchemaTool.inputSchema.properties).not.toHaveProperty('version');
    });

    it('search_by_tags documents the auto behaviour instead of a false default', () => {
      const prop: any = (searchByTagsTool.inputSchema.properties as any).return_full_vcons;
      expect(prop).not.toHaveProperty('default');
      expect(prop.description).toMatch(/20 or fewer/);
    });
  });

  describe('search_by_tags return_full_vcons', () => {
    it('returns full vCons automatically for 20 or fewer results when omitted', async () => {
      mockQueries.searchByTags.mockResolvedValue([UUID]);
      const res = await new SearchByTagsHandler().handle({ tags: { k: 'v' } }, ctx);
      expect(JSON.parse(res.content[0].text).vcons).toHaveLength(1);
    });

    it('omits full vCons when explicitly false', async () => {
      mockQueries.searchByTags.mockResolvedValue([UUID]);
      const res = await new SearchByTagsHandler().handle(
        { tags: { k: 'v' }, return_full_vcons: false }, ctx);
      expect(JSON.parse(res.content[0].text)).not.toHaveProperty('vcons');
    });
  });

  describe('ZodError mapping', () => {
    class ZodHandler extends BaseToolHandler {
      readonly toolName = 'zod_tool';
      protected async execute(): Promise<ToolResponse> {
        z.object({ name: z.string(), nested: z.object({ n: z.number() }) })
          .parse({ name: 1, nested: { n: 'x' } });
        return this.createSuccessResponse();
      }
    }

    it('maps ZodError to InvalidParams listing the issues', async () => {
      const err: any = await new ZodHandler().handle({}, ctx).catch(e => e);
      expect(err).toBeInstanceOf(McpError);
      expect(err.code).toBe(ErrorCode.InvalidParams);
      expect(err.message).toContain('name');
      expect(err.message).toContain('nested.n');
      expect(err.message).not.toContain('Tool execution failed');
    });
  });
});
