/**
 * date_field: filter search dates on vcons.created_at (default) or
 * vcons.conversation_start (earliest dialog start, else earliest attachment
 * start capped at created_at, else created_at).
 *
 * Covers the query layer (column and RPC argument selection, default payloads
 * unchanged), argument parsing and threading in the MCP and REST handlers, and
 * the conversationStartOf helper that fills conversation_start in results.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { VConQueries, dateColumnFor, dateFieldRpcArg } from '../src/db/queries.js';
import { MongoVConQueries } from '../src/db/mongo-queries.js';
import { DatabaseAnalytics } from '../src/db/database-analytics.js';
import { SearchVConsHandler, SearchVConsContentHandler } from '../src/tools/handlers/search.js';
import {
  VConAggregateHandler,
  VConCapabilitiesHandler,
  VConSearchHandler,
} from '../src/tools/handlers/vcon-contract.js';
import { GetContentAnalyticsHandler } from '../src/tools/handlers/database-analytics.js';
import { parseDateField } from '../src/tools/handlers/validation.js';
import { validateDateField } from '../src/api/validation.js';
import { conversationStartOf } from '../src/utils/read-surfaces.js';
import { searchVConsTool, searchVConsContentTool } from '../src/tools/vcon-crud.js';
import { vconSearchTool, vconAggregateTool } from '../src/tools/vcon-contract.js';
import { getContentAnalyticsTool } from '../src/tools/database-analytics.js';
import { VCon } from '../src/types/vcon.js';
import { createTestApp, type TestAppContext } from './api/helpers.js';

vi.mock('../src/observability/instrumentation.js', () => ({
  withSpan: vi.fn((_name: string, fn: any) => fn({ setAttributes: vi.fn(), setStatus: vi.fn() })),
  recordCounter: vi.fn(),
  recordHistogram: vi.fn(),
  logWithContext: vi.fn(),
  attachErrorToSpan: vi.fn(),
}));

const START = '2026-05-01T00:00:00Z';
const END = '2026-05-31T23:59:59Z';

/**
 * Minimal Supabase stand-in: every builder call is logged as [method, ...args]
 * and awaiting a builder resolves to `next()`. rpc() is a plain vi.fn.
 */
function recordingSupabase(next: () => any = () => ({ data: [], error: null, count: 0 })) {
  const calls: any[][] = [];
  const builder = (): any => {
    const b: any = {};
    for (const m of ['select', 'ilike', 'gte', 'lte', 'order', 'range', 'in', 'eq', 'limit']) {
      b[m] = (...args: any[]) => {
        calls.push([m, ...args]);
        return b;
      };
    }
    b.then = (resolve: any, reject: any) => Promise.resolve(next()).then(resolve, reject);
    return b;
  };
  const supabase: any = {
    calls,
    from: vi.fn((table: string) => {
      calls.push(['from', table]);
      return builder();
    }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  return supabase;
}

describe('date_field: query layer helpers', () => {
  it('maps date_field to a vcons column, defaulting to created_at', () => {
    expect(dateColumnFor(undefined)).toBe('created_at');
    expect(dateColumnFor('created')).toBe('created_at');
    expect(dateColumnFor('conversation')).toBe('conversation_start');
  });

  it('adds an RPC date_field argument only for conversation', () => {
    expect(dateFieldRpcArg(undefined)).toEqual({});
    expect(dateFieldRpcArg('created')).toEqual({});
    expect(dateFieldRpcArg('conversation')).toEqual({ date_field: 'conversation' });
  });
});

describe('date_field: SupabaseVConQueries', () => {
  let supabase: any;
  let queries: VConQueries;

  beforeEach(() => {
    supabase = recordingSupabase();
    queries = new VConQueries(supabase);
    vi.spyOn(queries, 'getVCon').mockImplementation(async (uuid: string) => ({ uuid } as any));
  });

  it('keywordSearch default sends the old RPC payload, with no date_field key', async () => {
    await queries.keywordSearch({ query: 'billing', startDate: START, endDate: END });
    const [name, args] = supabase.rpc.mock.calls[0];
    expect(name).toBe('search_vcons_keyword');
    expect(args).toEqual({
      query_text: 'billing',
      start_date: START,
      end_date: END,
      tag_filter: {},
      max_results: 50,
    });
    expect('date_field' in args).toBe(false);
  });

  it('keywordSearch with conversation passes date_field to the RPC', async () => {
    await queries.keywordSearch({ query: 'billing', startDate: START, dateField: 'conversation' });
    expect(supabase.rpc.mock.calls[0][1]).toMatchObject({ date_field: 'conversation', start_date: START });
  });

  it('keywordSearchCount threads dateField into keywordSearch', async () => {
    await queries.keywordSearchCount({ query: 'billing', startDate: START, dateField: 'conversation' });
    expect(supabase.rpc.mock.calls[0][1]).toMatchObject({ date_field: 'conversation' });
  });

  it('searchVCons (no tags) filters and orders on created_at by default', async () => {
    await queries.searchVCons({ startDate: START, endDate: END });
    expect(supabase.calls).toContainEqual(['gte', 'created_at', START]);
    expect(supabase.calls).toContainEqual(['lte', 'created_at', END]);
    expect(supabase.calls).toContainEqual(['order', 'created_at', { ascending: false }]);
    expect(supabase.calls.some((c: any[]) => c.includes('conversation_start'))).toBe(false);
  });

  it('searchVCons (no tags) targets conversation_start with dateField=conversation', async () => {
    await queries.searchVCons({ startDate: START, endDate: END, dateField: 'conversation' });
    expect(supabase.calls).toContainEqual(['gte', 'conversation_start', START]);
    expect(supabase.calls).toContainEqual(['lte', 'conversation_start', END]);
    expect(supabase.calls).toContainEqual(['order', 'conversation_start', { ascending: false }]);
    expect(supabase.calls.some((c: any[]) => c[0] !== 'select' && c.includes('created_at'))).toBe(false);
  });

  it('searchVCons party path selects and sorts by the chosen column', async () => {
    let n = 0;
    supabase = recordingSupabase(() => {
      n++;
      // 1st await: party lookup; 2nd: the vcons chunk query
      if (n === 1) return { data: [{ vcon_id: 'a' }], error: null };
      return {
        data: [
          { uuid: 'u-old', id: 'a', conversation_start: '2026-05-01T00:00:00Z' },
          { uuid: 'u-new', id: 'b', conversation_start: '2026-05-20T00:00:00Z' },
        ],
        error: null,
      };
    });
    queries = new VConQueries(supabase);
    vi.spyOn(queries, 'getVCon').mockImplementation(async (uuid: string) => ({ uuid } as any));

    const results = await queries.searchVCons({ partyName: 'x', startDate: START, dateField: 'conversation' });

    expect(supabase.calls).toContainEqual(['select', 'uuid, id, conversation_start']);
    expect(supabase.calls).toContainEqual(['gte', 'conversation_start', START]);
    expect(results.map(v => v.uuid)).toEqual(['u-new', 'u-old']);
  });

  it('searchVCons with tags passes date_field to search_vcons_by_tags_and_date only for conversation', async () => {
    await queries.searchVCons({ tags: { a: 'b' }, startDate: START });
    expect(supabase.rpc.mock.calls[0]).toEqual([
      'search_vcons_by_tags_and_date',
      { tag_filter: { a: 'b' }, vcon_created_after: START, vcon_created_before: null, max_results: 10 },
    ]);

    supabase.rpc.mockClear();
    await queries.searchVCons({ tags: { a: 'b' }, startDate: START, dateField: 'conversation' });
    expect(supabase.rpc.mock.calls[0][1]).toMatchObject({ date_field: 'conversation' });
  });

  it('searchVConsCount date-only path sends date_field to the count RPC', async () => {
    supabase.rpc.mockResolvedValue({ data: 3, error: null });
    await queries.searchVConsCount({ startDate: START, endDate: END });
    expect(supabase.rpc.mock.calls[0]).toEqual([
      'search_vcons_by_tags_and_date_count',
      { tag_filter: {}, vcon_created_after: START, vcon_created_before: END },
    ]);

    supabase.rpc.mockClear();
    const n = await queries.searchVConsCount({ startDate: START, endDate: END, dateField: 'conversation' });
    expect(supabase.rpc.mock.calls[0][1]).toEqual({
      tag_filter: {},
      vcon_created_after: START,
      vcon_created_before: END,
      date_field: 'conversation',
    });
    expect(n).toBe(3);
  });

  it('searchVConsCount subject path filters on conversation_start', async () => {
    await queries.searchVConsCount({ subject: 's', startDate: START, dateField: 'conversation' });
    expect(supabase.calls).toContainEqual(['gte', 'conversation_start', START]);
  });

  it('searchVConsCount dealer and tag+dealer RPCs carry date_field', async () => {
    supabase.rpc.mockResolvedValue({ data: 1, error: null });
    await queries.searchVConsCount({ dealerId: '7', startDate: START, dateField: 'conversation' });
    expect(supabase.rpc.mock.calls[0][0]).toBe('count_vcons_for_dealer_filter');
    expect(supabase.rpc.mock.calls[0][1]).toMatchObject({ date_field: 'conversation' });

    supabase.rpc.mockClear();
    await queries.searchVConsCount({ dealerId: '7', tags: { a: 'b' }, dateField: 'conversation' });
    expect(supabase.rpc.mock.calls[0][0]).toBe('count_vcons_tags_and_dealer');
    expect(supabase.rpc.mock.calls[0][1]).toMatchObject({ date_field: 'conversation' });

    supabase.rpc.mockClear();
    await queries.searchVConsCount({ dealerId: '7', startDate: START });
    expect('date_field' in supabase.rpc.mock.calls[0][1]).toBe(false);
  });

  it('aggregateVconsByDealerStats carries date_field only for conversation', async () => {
    await queries.aggregateVconsByDealerStats({ tagFilter: {}, minBaseline: 1, limit: 5 });
    expect('date_field' in supabase.rpc.mock.calls[0][1]).toBe(false);

    supabase.rpc.mockClear();
    await queries.aggregateVconsByDealerStats({ tagFilter: {}, minBaseline: 1, limit: 5, dateField: 'conversation' });
    expect(supabase.rpc.mock.calls[0][1]).toMatchObject({ date_field: 'conversation' });
  });
});

describe('date_field: MongoDB backend', () => {
  it('rejects conversation instead of silently filtering on created_at', async () => {
    const mongo = new MongoVConQueries({ collection: vi.fn() } as any);
    await expect(mongo.searchVCons({ dateField: 'conversation' })).rejects.toThrow(/not supported by the MongoDB backend/);
    await expect(mongo.searchVConsCount({ dateField: 'conversation' })).rejects.toThrow(/MongoDB/);
    await expect(mongo.keywordSearch({ query: 'x', dateField: 'conversation' })).rejects.toThrow(/MongoDB/);
    await expect(mongo.keywordSearchCount({ query: 'x', dateField: 'conversation' })).rejects.toThrow(/MongoDB/);
  });
});

describe('date_field: content analytics SQL', () => {
  it('scopes the vcons filter by the chosen column', async () => {
    const supabase: any = { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };
    const analytics = new DatabaseAnalytics(supabase);
    const opts = {
      startDate: START,
      endDate: END,
      includeDialogAnalysis: false,
      includeAnalysisBreakdown: false,
      includePartyPatterns: false,
      includeConversationMetrics: false,
    };

    await analytics.getContentAnalytics(opts);
    const defaultSql = supabase.rpc.mock.calls.map((c: any[]) => c[1]?.q).join('\n');
    expect(defaultSql).toContain(`v.created_at >= '${START}'`);
    expect(defaultSql).not.toContain('conversation_start');

    supabase.rpc.mockClear();
    const result = await analytics.getContentAnalytics({ ...opts, dateField: 'conversation' });
    const convSql = supabase.rpc.mock.calls.map((c: any[]) => c[1]?.q).join('\n');
    expect(convSql).toContain(`v.conversation_start >= '${START}'`);
    expect(convSql).toContain(`v.conversation_start < '${END}'`);
    expect(result.date_range).toEqual({ start_date: START, end_date: END, date_field: 'conversation' });
  });
});

describe('date_field: argument parsing', () => {
  it('parseDateField accepts the enum, treats empty as absent, rejects anything else', () => {
    expect(parseDateField(undefined)).toBeUndefined();
    expect(parseDateField(null)).toBeUndefined();
    expect(parseDateField('')).toBeUndefined();
    expect(parseDateField('created')).toBe('created');
    expect(parseDateField('conversation')).toBe('conversation');
    expect(() => parseDateField('dialog')).toThrow(McpError);
  });

  it('validateDateField (REST) mirrors parseDateField without throwing', () => {
    expect(validateDateField(undefined)).toEqual({ result: { valid: true, errors: [] }, value: undefined });
    expect(validateDateField('conversation').value).toBe('conversation');
    expect(validateDateField('nope').result.valid).toBe(false);
  });

  it('every date-filtering tool schema advertises date_field', () => {
    for (const tool of [searchVConsTool, searchVConsContentTool, getContentAnalyticsTool]) {
      expect((tool.inputSchema.properties as any).date_field.enum).toEqual(['created', 'conversation']);
    }
    for (const tool of [vconSearchTool, vconAggregateTool]) {
      expect((tool.inputSchema.properties as any).filters.properties.date_field.enum).toEqual(['created', 'conversation']);
    }
  });
});

describe('date_field: MCP handler threading', () => {
  let queries: any;
  let context: any;
  const vcon: VCon = {
    vcon: '0.4.0',
    uuid: '11111111-1111-1111-1111-111111111111',
    created_at: '2026-10-01T00:00:00Z',
    parties: [],
    dialog: [{ type: 'text', start: '2026-05-03T09:00:00Z' } as any],
  };

  beforeEach(() => {
    queries = {
      searchVCons: vi.fn().mockResolvedValue([vcon]),
      searchVConsCount: vi.fn().mockResolvedValue(1),
      keywordSearch: vi.fn().mockResolvedValue([]),
      keywordSearchCount: vi.fn().mockResolvedValue(0),
      aggregateVconsByDealerStats: vi.fn().mockResolvedValue([]),
      getVCon: vi.fn().mockResolvedValue(vcon),
      getTags: vi.fn().mockResolvedValue({}),
    };
    context = {
      queries,
      pluginManager: { executeHook: vi.fn() },
      dbAnalytics: { getContentAnalytics: vi.fn().mockResolvedValue({}) },
    };
  });

  it('search_vcons omits dateField by default and passes it through when set', async () => {
    const handler = new SearchVConsHandler();
    await handler.handle({ start_date: START, include_count: true }, context);
    expect('dateField' in queries.searchVCons.mock.calls[0][0]).toBe(false);
    expect('dateField' in queries.searchVConsCount.mock.calls[0][0]).toBe(false);

    await handler.handle({ start_date: START, date_field: 'conversation', include_count: true }, context);
    expect(queries.searchVCons.mock.calls[1][0]).toMatchObject({ startDate: START, dateField: 'conversation' });
    expect(queries.searchVConsCount.mock.calls[1][0]).toMatchObject({ dateField: 'conversation' });
  });

  it('search_vcons rejects an unknown date_field', async () => {
    const handler = new SearchVConsHandler();
    await expect(handler.handle({ date_field: 'updated' }, context)).rejects.toThrow(/date_field must be one of/);
    expect(queries.searchVCons).not.toHaveBeenCalled();
  });

  it('search_vcons metadata rows include conversation_start', async () => {
    const handler = new SearchVConsHandler();
    const res = await handler.handle({}, context);
    const body = JSON.parse(res.content[0].text);
    expect(body.results[0].created_at).toBe('2026-10-01T00:00:00Z');
    expect(body.results[0].conversation_start).toBe('2026-05-03T09:00:00Z');
  });

  it('search_vcons_content passes dateField to keywordSearch and its count', async () => {
    const handler = new SearchVConsContentHandler();
    await handler.handle({ query: 'q', date_field: 'conversation', include_count: true }, context);
    expect(queries.keywordSearch.mock.calls[0][0]).toMatchObject({ dateField: 'conversation' });
    expect(queries.keywordSearchCount.mock.calls[0][0]).toMatchObject({ dateField: 'conversation' });
  });

  it('vcon_search threads filters.date_field in metadata and keyword modes', async () => {
    const handler = new VConSearchHandler();
    await handler.handle({ mode: 'metadata', filters: { start_date: START, date_field: 'conversation' } }, context);
    expect(queries.searchVCons.mock.calls[0][0]).toMatchObject({ dateField: 'conversation' });
    expect(queries.searchVConsCount.mock.calls[0][0]).toMatchObject({ dateField: 'conversation' });

    await handler.handle({ mode: 'keyword', query: 'q', filters: { date_field: 'conversation' } }, context);
    expect(queries.keywordSearch.mock.calls[0][0]).toMatchObject({ dateField: 'conversation' });
    expect(queries.keywordSearchCount.mock.calls[0][0]).toMatchObject({ dateField: 'conversation' });
  });

  it('vcon_search default leaves dateField out and returns conversation_start in core', async () => {
    const handler = new VConSearchHandler();
    const res = await handler.handle({ mode: 'metadata', include: ['core'] }, context);
    expect('dateField' in queries.searchVCons.mock.calls[0][0]).toBe(false);
    const body = JSON.parse(res.content[0].text);
    expect(body.items[0].conversation_start).toBe('2026-05-03T09:00:00Z');
  });

  it('vcon_search returns INVALID_ARGUMENT for a bad filters.date_field', async () => {
    const handler = new VConSearchHandler();
    const res = await handler.handle({ mode: 'metadata', filters: { date_field: 'bogus' } }, context);
    const body = JSON.parse(res.content[0].text);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INVALID_ARGUMENT');
    expect(queries.searchVCons).not.toHaveBeenCalled();
  });

  it('vcon_aggregate threads filters.date_field', async () => {
    const handler = new VConAggregateHandler();
    await handler.handle({ filters: { date_field: 'conversation' } }, context);
    expect(queries.aggregateVconsByDealerStats.mock.calls[0][0]).toMatchObject({ dateField: 'conversation' });

    await handler.handle({}, context);
    expect('dateField' in queries.aggregateVconsByDealerStats.mock.calls[1][0]).toBe(false);
  });

  it('get_content_analytics threads date_field', async () => {
    const handler = new GetContentAnalyticsHandler();
    await handler.handle({ start_date: START, date_field: 'conversation' }, context);
    expect(context.dbAnalytics.getContentAnalytics.mock.calls[0][0]).toMatchObject({ dateField: 'conversation' });
  });

  it('vcon_capabilities lists the date fields', async () => {
    const handler = new VConCapabilitiesHandler();
    const res = await handler.handle({}, context);
    const body = JSON.parse(res.content[0].text);
    expect(body.item.search.date_fields).toEqual(['created', 'conversation']);
    expect(body.item.search.default_date_field).toBe('created');
  });
});

describe('date_field: REST routes', () => {
  let ctx: TestAppContext;
  const BASE = '/api/v1';
  let savedAuthRequired: string | undefined;

  beforeEach(() => {
    savedAuthRequired = process.env.API_AUTH_REQUIRED;
    ctx = createTestApp();
  });

  afterEach(() => {
    if (savedAuthRequired !== undefined) process.env.API_AUTH_REQUIRED = savedAuthRequired;
    else delete process.env.API_AUTH_REQUIRED;
  });

  it('GET /vcons passes date_field to searchPage and rejects bad values with 400', async () => {
    await request(ctx.app.callback()).get(`${BASE}/vcons?start_date=2026-05-01&date_field=conversation`).expect(200);
    expect(ctx.mocks.vconService.searchPage.mock.calls[0][0]).toMatchObject({ dateField: 'conversation' });

    await request(ctx.app.callback()).get(`${BASE}/vcons?date_field=nope`).expect(400);
  });

  it('GET /vcons/search/content passes date_field to keywordSearch', async () => {
    ctx.mocks.queries.keywordSearch.mockResolvedValueOnce([]);
    await request(ctx.app.callback()).get(`${BASE}/vcons/search/content?q=x&date_field=conversation`).expect(200);
    expect(ctx.mocks.queries.keywordSearch.mock.calls[0][0]).toMatchObject({ dateField: 'conversation' });
  });
});

describe('conversationStartOf', () => {
  const base: VCon = { vcon: '0.4.0', uuid: 'u', created_at: '2026-10-01T00:00:00Z', parties: [] };

  it('falls back to created_at with no dated children', () => {
    expect(conversationStartOf(base)).toBe('2026-10-01T00:00:00Z');
    expect(conversationStartOf({ ...base, dialog: [{ type: 'text' } as any] })).toBe('2026-10-01T00:00:00Z');
  });

  it('prefers the earliest dialog start over attachments, even when later than created_at', () => {
    expect(conversationStartOf({
      ...base,
      dialog: [{ type: 'text', start: '2026-05-10T00:00:00Z' } as any, { type: 'text', start: '2026-05-03T00:00:00Z' } as any],
      attachments: [{ purpose: 'x', start: '2026-04-01T00:00:00Z' } as any],
    })).toBe('2026-05-03T00:00:00Z');

    expect(conversationStartOf({
      ...base,
      dialog: [{ type: 'text', start: '2026-12-01T00:00:00Z' } as any],
    })).toBe('2026-12-01T00:00:00Z');
  });

  it('uses the earliest attachment start when there is no dialog start, capped at created_at', () => {
    expect(conversationStartOf({
      ...base,
      attachments: [{ purpose: 'x', start: '2026-05-05T00:00:00Z' } as any, { purpose: 'y', start: '2026-05-01T00:00:00Z' } as any],
    })).toBe('2026-05-01T00:00:00Z');

    // Every attachment stamped after created_at (write-time stamps): created_at wins
    expect(conversationStartOf({
      ...base,
      created_at: '2026-01-01T00:00:00Z',
      attachments: [{ purpose: 'x', start: '2026-02-01T00:00:00Z' } as any],
    })).toBe('2026-01-01T00:00:00Z');
  });

  it('ignores placeholder starts before 1990', () => {
    expect(conversationStartOf({
      ...base,
      dialog: [{ type: 'text', start: '1970-01-01T00:00:00Z' } as any],
      attachments: [{ purpose: 'x', start: '2026-05-05T00:00:00Z' } as any],
    })).toBe('2026-05-05T00:00:00Z');

    expect(conversationStartOf({
      ...base,
      attachments: [{ purpose: 'x', start: '1970-01-01T00:00:00Z' } as any],
    })).toBe('2026-10-01T00:00:00Z');
  });

  it('compares instants, not strings, and skips unparseable values', () => {
    expect(conversationStartOf({
      ...base,
      dialog: [
        { type: 'text', start: '2026-05-03T05:00:00+04:00' } as any, // 01:00Z
        { type: 'text', start: '2026-05-03T02:00:00Z' } as any,
        { type: 'text', start: 'not a date' } as any,
      ],
    })).toBe('2026-05-03T05:00:00+04:00');
  });
});
