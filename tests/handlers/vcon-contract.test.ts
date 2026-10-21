import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findDeniedTerms } from '../helpers/deployment-denylist.js';
import {
  VConFetchHandler,
  VConCapabilitiesHandler,
  VConGraphShapeHandler,
  VConSearchHandler,
  VConTaxonomyHandler,
  DescribeResponseShapeHandler,
} from '../../src/tools/handlers/vcon-contract.js';
import { ToolHandlerContext } from '../../src/tools/handlers/base.js';
import { DatabaseInspector } from '../../src/db/database-inspector.js';
import { DatabaseAnalytics } from '../../src/db/database-analytics.js';
import { DatabaseSizeAnalyzer } from '../../src/db/database-size-analyzer.js';
import { VCon } from '../../src/types/vcon.js';

vi.mock('../../src/observability/instrumentation.js', () => ({
  withSpan: vi.fn((name, fn) => fn({ setAttributes: vi.fn(), setStatus: vi.fn() })),
  recordCounter: vi.fn(),
  recordHistogram: vi.fn(),
  logWithContext: vi.fn(),
  attachErrorToSpan: vi.fn(),
}));

vi.mock('../../src/observability/attributes.js', () => ({
  ATTR_TOOL_NAME: 'tool.name',
  ATTR_TOOL_SUCCESS: 'tool.success',
}));

describe('Redesigned vCon contract handlers', () => {
  let mockContext: ToolHandlerContext;
  let mockQueries: any;

  beforeEach(() => {
    const mockVcon: VCon = {
      vcon: '0.4.0',
      uuid: '11111111-1111-1111-1111-111111111111',
      created_at: '2026-05-11T14:00:00Z',
      subject: 'Upset customer call',
      parties: [{ name: 'Customer' }, { name: 'Agent' }],
      analysis: [
        {
          type: 'summary',
          vendor: 'OpenAI',
          body: 'Customer had a bad experience and requested help.',
          encoding: 'none',
        },
      ],
      attachments: [
        {
          type: 'dealer',
          encoding: 'none',
          body: {
            id: 'dealer-42',
            name: 'Acme Motors',
            outboundPhoneNumber: '+15551234567',
            team: 'west',
          },
        },
      ],
    };

    mockQueries = {
      getVCon: vi.fn().mockResolvedValue(mockVcon),
      getTags: vi.fn().mockResolvedValue({ portal: 'negative_experience' }),
      searchVCons: vi.fn().mockResolvedValue([mockVcon]),
      searchVConsCount: vi.fn().mockResolvedValue(1),
      keywordSearch: vi.fn().mockResolvedValue([
        { vcon_id: mockVcon.uuid, doc_type: 'dialog', ref_index: 0, rank: 0.9, snippet: 'poor experience' },
      ]),
      keywordSearchCount: vi.fn().mockResolvedValue(1),
      semanticSearch: vi.fn().mockResolvedValue([]),
      hybridSearch: vi.fn().mockResolvedValue([]),
      getVconShapeGraph: vi.fn().mockResolvedValue({
        schema_version: '1.0.0',
        generated_at: '2026-05-11T14:00:00Z',
        corpus: { notes: ['test'] },
        nodes: [{ id: 'analysis_type:summary', kind: 'analysis_type', label: 'summary', vcon_count: 1 }],
        edges: [],
      }),
    };

    mockContext = {
      queries: mockQueries,
      pluginManager: { executeHook: vi.fn() } as any,
      dbInspector: {} as DatabaseInspector,
      dbAnalytics: {} as DatabaseAnalytics,
      dbSizeAnalyzer: {} as DatabaseSizeAnalyzer,
      supabase: {},
      vconService: {} as any,
    };
  });

  it('vcon_fetch returns ok/item with default includes', async () => {
    const handler = new VConFetchHandler();

    const result = await handler.handle(
      { id: '11111111-1111-1111-1111-111111111111' },
      mockContext,
    );
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(true);
    expect(response.item.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(response.item.parties).toHaveLength(2);
    expect(response.item.summary).toHaveLength(1);
    expect(response.item.dealer).toBeUndefined();
    expect(response.meta.include).toEqual(['core', 'parties', 'summary']);
  });

  it('vcon_fetch can return dealer and tags without full attachments', async () => {
    const handler = new VConFetchHandler();

    const result = await handler.handle(
      {
        id: '11111111-1111-1111-1111-111111111111',
        include: ['core', 'summary', 'dealer', 'tags'],
      },
      mockContext,
    );
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(true);
    expect(response.item.dealer.name).toBe('Acme Motors');
    expect(response.item.tags.portal).toBe('negative_experience');
    expect(response.item.attachments).toBeUndefined();
  });

  it('vcon_fetch returns ok:false for invalid include values', async () => {
    const handler = new VConFetchHandler();

    const result = await handler.handle(
      {
        id: '11111111-1111-1111-1111-111111111111',
        include: ['core', 'bogus'],
      },
      mockContext,
    );
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe('INVALID_ARGUMENT');
  });

  it('vcon_fetch returns RESPONSE_TOO_LARGE when over budget', async () => {
    const handler = new VConFetchHandler();
    mockQueries.getVCon.mockResolvedValueOnce({
      vcon: '0.4.0',
      uuid: '11111111-1111-1111-1111-111111111111',
      created_at: '2026-05-11T14:00:00Z',
      subject: 'Oversized record',
      parties: [{ name: 'Customer' }],
      analysis: [
        {
          type: 'summary',
          vendor: 'OpenAI',
          body: 'x'.repeat(5000),
          encoding: 'none',
        },
      ],
      attachments: [],
    });

    const result = await handler.handle(
      {
        id: '11111111-1111-1111-1111-111111111111',
        include: ['core', 'summary'],
        max_response_bytes: 1024,
      },
      mockContext,
    );
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe('RESPONSE_TOO_LARGE');
    expect(response.error.max_response_bytes).toBe(1024);
  });

  it('vcon_taxonomy returns neutral dealer guidance with no deployment config', async () => {
    const handler = new VConTaxonomyHandler();

    const result = await handler.handle({}, mockContext);
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(true);
    expect(response.item.dataset).toBeNull();
    expect(response.item.portal_values).toEqual([]);
    expect(response.item.preferred_sources.some((source: any) => source.source === 'attachment:dealer')).toBe(true);
  });

  describe('deployment-specific taxonomy configuration', () => {
    const ENV_KEYS = ['VCON_TAXONOMY_CONFIG', 'VCON_TAXONOMY_DATASET', 'VCON_DEALER_ATTACHMENT_TYPE'] as const;
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
      ENV_KEYS.forEach((k) => delete process.env[k]);
    });

    afterEach(() => {
      ENV_KEYS.forEach((k) => {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      });
    });

    async function callTool(handler: { handle: (a: any, c: ToolHandlerContext) => Promise<any> }, args: any = {}) {
      const result = await handler.handle(args, mockContext);
      return { text: result.content[0].text as string, response: JSON.parse(result.content[0].text) };
    }

    // Regression: the taxonomy used to hardcode one deployment's dataset label, portal
    // values and dealer attachment type into every server's output.
    it('default taxonomy, capabilities and response-shape output carry no deployment identifiers', async () => {
      mockQueries.getTaxonomyCoverageSnapshot = vi.fn().mockResolvedValue({
        vcons_total: 10,
        with_dealer_attachment_pct: 50,
        with_dealer_name_tag_pct: 10,
      });

      const taxonomy = await callTool(new VConTaxonomyHandler());
      const capabilities = await callTool(new VConCapabilitiesHandler());
      const shapes = await callTool(new DescribeResponseShapeHandler(), { tool_name: 'vcon_taxonomy' });

      expect(taxonomy.response.item.dataset).toBeNull();
      expect(taxonomy.response.item.portal_values).toEqual([]);
      expect(taxonomy.response.item.coverage.dealer_attachment.coverage_pct).toBe(50);
      expect(capabilities.response.item.taxonomy_hints.preferred_bad_call_signals).toEqual([]);
      expect(capabilities.response.item.taxonomy_hints.preferred_dealer_source).toBe('attachment:dealer');
      for (const { text } of [taxonomy, capabilities, shapes]) {
        expect(findDeniedTerms(text)).toEqual([]);
      }
    });

    it('restores deployment guidance from env and the JSON config file', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'vcon-taxonomy-'));
      const file = join(dir, 'taxonomy.json');
      const portalValues = [{ value: 'example_signal', description: 'Example.', recommended_use: 'Example use.' }];
      const commonTags = [{ key: 'example_tag', availability: 'preferred', description: 'Example tag.' }];
      const preferredSources = [{ need: 'dealer info', source: 'attachment:example_dealer', fields: ['id'] }];
      const queryRecipes = [{ goal: 'Example goal', recommendation: 'Example recommendation.' }];
      writeFileSync(file, JSON.stringify({
        dataset: 'from-file',
        portal_values: portalValues,
        common_tags: commonTags,
        preferred_sources: preferredSources,
        query_recipes: queryRecipes,
        bad_call_signals: ['example_signal'],
        recommended_patterns: ['Example pattern.'],
      }));
      process.env.VCON_TAXONOMY_CONFIG = file;
      process.env.VCON_TAXONOMY_DATASET = 'example-dataset';
      process.env.VCON_DEALER_ATTACHMENT_TYPE = 'example_dealer';
      mockQueries.getTaxonomyCoverageSnapshot = vi.fn().mockResolvedValue({
        vcons_total: 10,
        with_dealer_attachment_pct: 50,
        with_dealer_name_tag_pct: 10,
      });

      const { response: taxonomy } = await callTool(new VConTaxonomyHandler());
      expect(taxonomy.item.dataset).toBe('example-dataset');
      expect(taxonomy.item.portal_values).toEqual(portalValues);
      expect(taxonomy.item.common_tags).toEqual(commonTags);
      expect(taxonomy.item.preferred_sources).toEqual(preferredSources);
      expect(taxonomy.item.query_recipes).toEqual(queryRecipes);
      expect(taxonomy.item.coverage.example_dealer_attachment.coverage_pct).toBe(50);
      expect(taxonomy.item.coverage.example_dealer_attachment.note).toContain('example_dealer');

      const { response: capabilities } = await callTool(new VConCapabilitiesHandler());
      expect(capabilities.item.taxonomy_hints.preferred_bad_call_signals).toEqual(['example_signal']);
      expect(capabilities.item.taxonomy_hints.preferred_dealer_source).toBe('attachment:example_dealer');
      expect(capabilities.item.search.recommended_patterns).toEqual(['Example pattern.']);

      delete process.env.VCON_TAXONOMY_DATASET;
      const { response: fromFile } = await callTool(new VConTaxonomyHandler());
      expect(fromFile.item.dataset).toBe('from-file');
    });

    it('vcon_fetch reads the dealer from the configured attachment type', async () => {
      process.env.VCON_DEALER_ATTACHMENT_TYPE = 'example_dealer';
      const vcon = await mockQueries.getVCon();
      mockQueries.getVCon = vi.fn().mockResolvedValue({
        ...vcon,
        attachments: [{ ...vcon.attachments[0], type: 'example_dealer' }],
      });

      const result = await new VConFetchHandler().handle(
        { id: '11111111-1111-1111-1111-111111111111', include: ['core', 'dealer'] },
        mockContext,
      );
      expect(JSON.parse(result.content[0].text).item.dealer.name).toBe('Acme Motors');
    });
  });

  it('vcon_capabilities returns supported modes and byte budgets', async () => {
    const handler = new VConCapabilitiesHandler();

    const result = await handler.handle({}, mockContext);
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(true);
    expect(response.item.tools).toContain('vcon_fetch');
    expect(response.item.tools).toContain('vcon_search');
    expect(response.item.tools).toContain('vcon_capabilities');
    expect(response.item.tools).toContain('vcon_graph_shape');
    expect(response.item.shape_graph?.resource_uri).toBe('vcon://v1/graph/shape');
    expect(response.item.response_budgeting.default_max_response_bytes).toBe(250000);
    expect(response.item.fetch.supported_include).toContain('dealer');
    expect(response.item.search.modes).toContain('hybrid');
    expect(response.item.pagination.strategy).toBe('opaque cursor');
  });

  it('vcon_graph_shape returns shape graph payload', async () => {
    const handler = new VConGraphShapeHandler();

    const result = await handler.handle({}, mockContext);
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(true);
    expect(response.item.schema_version).toBe('1.0.0');
    expect(response.item.nodes[0].kind).toBe('analysis_type');
    expect(mockQueries.getVconShapeGraph).toHaveBeenCalled();
  });

  it('vcon_search returns a normalized metadata page', async () => {
    const handler = new VConSearchHandler();

    const result = await handler.handle({
      mode: 'metadata',
      include: ['core', 'summary', 'dealer'],
      limit: 10,
      tags: { portal: 'negative_experience' },
    }, mockContext);
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(true);
    expect(response.items).toHaveLength(1);
    expect(response.items[0].id).toBe('11111111-1111-1111-1111-111111111111');
    expect(response.items[0].dealer.name).toBe('Acme Motors');
    expect(response.page.total).toBe(1);
    expect(response.items[0].search.mode).toBe('metadata');
  });

  it('vcon_search metadata asks the database for one page, not every row up to the cursor', async () => {
    // Regression for CON-993: the handler used to request offset+limit+1 rows and slice,
    // hydrating ~1,000 full vCons at offset 900 until the Supabase client gave out.
    const handler = new VConSearchHandler();
    mockQueries.searchVConsCount.mockResolvedValueOnce(2000);
    const cursor = Buffer.from(JSON.stringify({ offset: 900 })).toString('base64url');

    const result = await handler.handle({ mode: 'metadata', limit: 100, cursor }, mockContext);
    const response = JSON.parse(result.content[0].text);

    expect(mockQueries.searchVCons).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 900, limit: 100 }),
    );
    expect(response.ok).toBe(true);
    expect(response.items).toHaveLength(1);
    expect(response.page.next_cursor).toBe(
      Buffer.from(JSON.stringify({ offset: 1000 })).toString('base64url'),
    );
  });

  it('vcon_search returns a normalized keyword page', async () => {
    const handler = new VConSearchHandler();

    const result = await handler.handle({
      mode: 'keyword',
      query: 'poor experience',
      include: ['core', 'summary'],
      limit: 10,
    }, mockContext);
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(true);
    expect(response.items[0].search.mode).toBe('keyword');
    expect(response.items[0].search.relevance_score).toBe(0.9);
    expect(response.items[0].search.snippet).toBe('poor experience');
    expect(response.page.total).toBe(1);
  });

  it('vcon_search returns RESPONSE_TOO_LARGE when page exceeds budget', async () => {
    const handler = new VConSearchHandler();
    const oversizedVcon = {
      vcon: '0.4.0',
      uuid: '11111111-1111-1111-1111-111111111111',
      created_at: '2026-05-11T14:00:00Z',
      subject: 'Oversized record',
      parties: [{ name: 'Customer' }],
      analysis: [
        {
          type: 'summary',
          vendor: 'OpenAI',
          body: 'x'.repeat(5000),
          encoding: 'none',
        },
      ],
      attachments: [],
    };
    mockQueries.searchVCons.mockResolvedValueOnce([oversizedVcon]);

    const result = await handler.handle({
      mode: 'metadata',
      include: ['core', 'summary'],
      limit: 10,
      max_response_bytes: 1024,
    }, mockContext);
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe('RESPONSE_TOO_LARGE');
    expect(response.error.suggestions.length).toBeGreaterThan(0);
  });

  it('describe_response_shape lists published tool descriptors', async () => {
    const handler = new DescribeResponseShapeHandler();

    const result = await handler.handle({}, mockContext);
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(true);
    expect(response.items.some((item: any) => item.tool_name === 'vcon_fetch')).toBe(true);
    expect(response.items.some((item: any) => item.tool_name === 'vcon_capabilities')).toBe(true);
    expect(response.items.some((item: any) => item.tool_name === 'vcon_graph_shape')).toBe(true);
    expect(response.items.some((item: any) => item.tool_name === 'vcon_search')).toBe(true);
    expect(response.page.count).toBeGreaterThan(0);
  });

  it('describe_response_shape returns a specific schema descriptor', async () => {
    const handler = new DescribeResponseShapeHandler();

    const result = await handler.handle({ tool_name: 'search_by_tags' }, mockContext);
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(true);
    expect(response.item.tool_name).toBe('search_by_tags');
    expect(response.item.response_schema.properties.vcon_uuids).toBeDefined();
  });
});
