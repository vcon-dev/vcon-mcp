import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  VConFetchHandler,
  VConCapabilitiesHandler,
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
          type: 'strolid_dealer',
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

  it('vcon_taxonomy returns portal and dealer guidance', async () => {
    const handler = new VConTaxonomyHandler();

    const result = await handler.handle({}, mockContext);
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(true);
    expect(response.item.portal_values.some((value: any) => value.value === 'negative_experience')).toBe(true);
    expect(response.item.preferred_sources.some((source: any) => source.source === 'attachment:strolid_dealer')).toBe(true);
  });

  it('vcon_capabilities returns supported modes and byte budgets', async () => {
    const handler = new VConCapabilitiesHandler();

    const result = await handler.handle({}, mockContext);
    const response = JSON.parse(result.content[0].text);

    expect(response.ok).toBe(true);
    expect(response.item.tools).toContain('vcon_fetch');
    expect(response.item.tools).toContain('vcon_search');
    expect(response.item.tools).toContain('vcon_capabilities');
    expect(response.item.response_budgeting.default_max_response_bytes).toBe(250000);
    expect(response.item.fetch.supported_include).toContain('dealer');
    expect(response.item.search.modes).toContain('hybrid');
    expect(response.item.pagination.strategy).toBe('opaque cursor');
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
