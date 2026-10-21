/**
 * Plugin read hooks on every read path (issue #100).
 *
 * A privacy plugin hides one vCon and redacts party names on read. Every MCP
 * tool, resource and REST route that returns vCon content must run the hooks,
 * so neither the hidden vCon nor the raw names may reach the caller, and the
 * spy must record the expected hook calls. Before #100 only get_vcon and
 * search_vcons ran them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { PluginManager } from '../src/hooks/plugin-manager.js';
import type { RequestContext, VConPlugin } from '../src/hooks/plugin-interface.js';
import { VConService } from '../src/services/vcon-service.js';
import type { ToolHandlerContext } from '../src/tools/handlers/base.js';
import {
  SearchVConsHandler,
  SearchVConsContentHandler,
  SearchVConsSemanticHandler,
  SearchVConsHybridHandler,
} from '../src/tools/handlers/search.js';
import { UpdateVConHandler } from '../src/tools/handlers/vcon-crud.js';
import { GetTagsHandler, SearchByTagsHandler } from '../src/tools/handlers/tags.js';
import { VConFetchHandler, VConSearchHandler } from '../src/tools/handlers/vcon-contract.js';
import { resolveCoreResource } from '../src/resources/index.js';
import { createRestApi } from '../src/api/rest-router.js';
import type { RestApiContext } from '../src/api/context.js';
import type { VCon } from '../src/types/vcon.js';

vi.mock('../src/observability/instrumentation.js', () => ({
  withSpan: vi.fn((_name: string, fn: any) => fn({ setAttributes: vi.fn(), setStatus: vi.fn() })),
  recordCounter: vi.fn(),
  recordHistogram: vi.fn(),
  logWithContext: vi.fn(),
  attachErrorToSpan: vi.fn(),
}));

vi.mock('../src/utils/embeddings.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  EmbeddingError: class EmbeddingError extends Error {},
}));

const VISIBLE = '11111111-1111-4111-8111-111111111111';
const HIDDEN = '22222222-2222-4222-8222-222222222222';
// Strings that must never reach a caller: the hidden vCon's party and the raw name
// the plugin redacts. "Bob" lives only in the hidden vCon.
const LEAK = /Alice|Bob/;

function makeVCon(uuid: string, name: string): VCon {
  return {
    vcon: '0.4.0',
    uuid,
    created_at: '2026-01-01T00:00:00.000Z',
    subject: 'call',
    parties: [{ name }],
    dialog: [{ type: 'text', start: '2026-01-01T00:00:00.000Z', parties: [0], body: `${name} said hello`, encoding: 'none' } as any],
    analysis: [],
    attachments: [],
  } as VCon;
}

const STORE: Record<string, VCon> = {
  [VISIBLE]: makeVCon(VISIBLE, 'Alice'),
  [HIDDEN]: makeVCon(HIDDEN, 'Bob'),
};
const clone = (uuid: string) => structuredClone(STORE[uuid]);

const redact = (v: VCon): VCon => ({
  ...v,
  parties: (v.parties || []).map(p => ({ ...p, name: '[REDACTED]' })),
  dialog: (v.dialog || []).map(d => ({ ...d, body: '[REDACTED]' })),
});

class PrivacySpyPlugin implements VConPlugin {
  name = 'privacy-spy';
  version = '1.0.0';
  calls: string[] = [];
  async beforeRead(uuid: string, _ctx: RequestContext): Promise<void> {
    this.calls.push('beforeRead');
    if (uuid === HIDDEN) throw new Error('access denied');
  }
  async afterRead(vcon: VCon, _ctx: RequestContext): Promise<VCon> {
    this.calls.push('afterRead');
    return redact(vcon);
  }
  async beforeSearch(criteria: any, _ctx: RequestContext): Promise<any> {
    this.calls.push('beforeSearch');
    return criteria;
  }
  async afterSearch(results: VCon[], _ctx: RequestContext): Promise<VCon[]> {
    this.calls.push('afterSearch');
    return results.filter(v => v.uuid !== HIDDEN).map(redact);
  }
}

function makeQueries() {
  const kw = (id: string) => ({ vcon_id: id, doc_type: 'dialog', ref_index: 0, rank: 1, snippet: `${STORE[id].parties[0].name} said hello` });
  const sem = (id: string) => ({ vcon_id: id, content_type: 'dialog', content_reference: '0', content_text: `${STORE[id].parties[0].name} said hello`, similarity: 0.9 });
  const hyb = (id: string) => ({ vcon_id: id, combined_score: 1, semantic_score: 1, keyword_score: 1 });
  return {
    getVCon: vi.fn(async (id: string) => clone(id)),
    searchVCons: vi.fn(async () => [clone(VISIBLE), clone(HIDDEN)]),
    searchVConsCount: vi.fn(async () => 2),
    keywordSearch: vi.fn(async () => [kw(VISIBLE), kw(HIDDEN)]),
    keywordSearchCount: vi.fn(async () => 2),
    semanticSearch: vi.fn(async () => [sem(VISIBLE), sem(HIDDEN)]),
    hybridSearch: vi.fn(async () => [hyb(VISIBLE), hyb(HIDDEN)]),
    searchByTags: vi.fn(async () => [VISIBLE, HIDDEN]),
    getTags: vi.fn(async () => ({ department: 'sales' })),
    getTag: vi.fn(async () => 'sales'),
    updateVCon: vi.fn(async () => undefined),
  };
}

let plugin: PrivacySpyPlugin;
let queries: ReturnType<typeof makeQueries>;
let pluginManager: PluginManager;
let vconService: VConService;
let ctx: ToolHandlerContext;

beforeEach(() => {
  plugin = new PrivacySpyPlugin();
  pluginManager = new PluginManager();
  pluginManager.registerPlugin(plugin);
  queries = makeQueries();
  vconService = new VConService({ queries: queries as any, pluginManager });
  ctx = {
    queries: queries as any,
    pluginManager,
    vconService,
    dbInspector: {} as any,
    dbAnalytics: {} as any,
    dbSizeAnalyzer: {} as any,
    supabase: {},
  } as ToolHandlerContext;
});

const body = (res: any) => JSON.parse(res.content[0].text);
const ids = (rows: any[]) => rows.map(r => (typeof r === 'string' ? r : r.vcon_id ?? r.uuid ?? r.id));

describe('MCP tools run plugin read hooks (#100)', () => {
  it('vcon_fetch runs beforeRead/afterRead and is blocked by beforeRead', async () => {
    const ok = body(await new VConFetchHandler().handle({ id: VISIBLE, include: ['core', 'parties'] }, ctx));
    expect(ok.ok).toBe(true);
    expect(ok.item.parties[0].name).toBe('[REDACTED]');
    expect(plugin.calls).toEqual(['beforeRead', 'afterRead']);

    const blocked = body(await new VConFetchHandler().handle({ id: HIDDEN, include: ['core', 'parties'] }, ctx));
    expect(blocked.ok).toBe(false);
    expect(JSON.stringify(blocked)).not.toMatch(LEAK);
  });

  it.each(['metadata', 'keyword', 'semantic', 'hybrid'])('vcon_search mode=%s runs beforeSearch/afterSearch', async (mode) => {
    const res = body(await new VConSearchHandler().handle(
      { mode, query: 'hello', include: ['core', 'parties'], limit: 10 }, ctx));
    expect(res.ok).toBe(true);
    expect(ids(res.items)).toEqual([VISIBLE]);
    expect(JSON.stringify(res)).not.toMatch(LEAK);
    expect(plugin.calls).toEqual(['beforeSearch', 'afterSearch', 'beforeRead', 'afterRead']);
  });

  it('search_vcons runs beforeSearch/afterSearch exactly once each', async () => {
    const res = body(await new SearchVConsHandler().handle({ response_format: 'full' }, ctx));
    expect(ids(res.results)).toEqual([VISIBLE]);
    expect(JSON.stringify(res)).not.toMatch(LEAK);
    expect(plugin.calls).toEqual(['beforeSearch', 'afterSearch']);
  });

  it.each(['snippets', 'metadata', 'ids_only'])('search_vcons_content format=%s drops hidden hits and nulls altered snippets', async (fmt) => {
    const res = body(await new SearchVConsContentHandler().handle({ query: 'hello', response_format: fmt }, ctx));
    expect(ids(res.results)).toEqual([VISIBLE]);
    expect(JSON.stringify(res)).not.toMatch(LEAK);
    expect(plugin.calls).toEqual(['beforeSearch', 'afterSearch', 'beforeRead', 'afterRead']);
  });

  it('search_vcons_content full runs search hooks, then read hooks once per vCon', async () => {
    const res = body(await new SearchVConsContentHandler().handle({ query: 'hello', response_format: 'full' }, ctx));
    expect(ids(res.results)).toEqual([VISIBLE]);
    expect(JSON.stringify(res)).not.toMatch(LEAK);
    expect(plugin.calls).toEqual(['beforeSearch', 'afterSearch', 'beforeRead', 'afterRead']);
  });

  it.each(['metadata', 'ids_only', 'full'])('search_vcons_semantic format=%s runs the hooks', async (fmt) => {
    const res = body(await new SearchVConsSemanticHandler().handle({ query: 'hello', response_format: fmt }, ctx));
    expect(ids(res.results)).toEqual([VISIBLE]);
    expect(JSON.stringify(res)).not.toMatch(LEAK);
    expect(plugin.calls.slice(0, 2)).toEqual(['beforeSearch', 'afterSearch']);
  });

  it.each(['metadata', 'ids_only', 'full'])('search_vcons_hybrid format=%s runs the hooks', async (fmt) => {
    const res = body(await new SearchVConsHybridHandler().handle({ query: 'hello', response_format: fmt }, ctx));
    expect(ids(res.results)).toEqual([VISIBLE]);
    expect(JSON.stringify(res)).not.toMatch(LEAK);
    expect(plugin.calls.slice(0, 2)).toEqual(['beforeSearch', 'afterSearch']);
  });

  it('search_by_tags drops hidden uuids and redacts full vCons', async () => {
    const res = body(await new SearchByTagsHandler().handle(
      { tags: { department: 'sales' }, return_full_vcons: true }, ctx));
    expect(res.vcon_uuids).toEqual([VISIBLE]);
    expect(res.count).toBe(1);
    expect(ids(res.vcons)).toEqual([VISIBLE]);
    expect(JSON.stringify(res)).not.toMatch(LEAK);
    expect(plugin.calls).toEqual(['beforeSearch', 'afterSearch', 'beforeRead', 'afterRead']);
  });

  it('get_tags runs beforeRead, which can block', async () => {
    const ok = body(await new GetTagsHandler().handle({ vcon_uuid: VISIBLE }, ctx));
    expect(ok.tags).toEqual({ department: 'sales' });
    expect(plugin.calls).toEqual(['beforeRead']);
    await expect(new GetTagsHandler().handle({ vcon_uuid: HIDDEN }, ctx)).rejects.toThrow(/access denied/);
    expect(queries.getTags).toHaveBeenCalledTimes(1);
  });

  it('no afterSearch hook: hit searches load no vCons (no added DB cost)', async () => {
    const pm = new PluginManager();
    const service = new VConService({ queries: queries as any, pluginManager: pm });
    await new SearchVConsContentHandler().handle({ query: 'hello' }, { ...ctx, pluginManager: pm, vconService: service });
    await new SearchVConsSemanticHandler().handle({ query: 'hello' }, { ...ctx, pluginManager: pm, vconService: service });
    expect(queries.getVCon).not.toHaveBeenCalled();
  });
});

describe('update_vcon and include=tags honor read hooks (#100 gaps)', () => {
  it('update_vcon runs afterRead on the returned vCon', async () => {
    const res = body(await new UpdateVConHandler().handle(
      { uuid: VISIBLE, updates: { subject: 'new' }, return_updated: true }, ctx));
    expect(res.vcon.parties[0].name).toBe('[REDACTED]');
    expect(JSON.stringify(res)).not.toMatch(LEAK);
    expect(plugin.calls).toContain('afterRead');
  });

  describe('tags redaction', () => {
    const tagged = () => {
      const v = clone(VISIBLE);
      v.attachments = [{ type: 'tags', purpose: 'tags', encoding: 'json', body: JSON.stringify(['department:sales']) } as any];
      return v;
    };
    // Strips the tags attachment on read and on search.
    const stripTags = (v: VCon): VCon => ({ ...v, attachments: (v.attachments || []).filter((a: any) => a.type !== 'tags') });

    beforeEach(() => {
      const stripper: VConPlugin = {
        name: 'tag-stripper',
        version: '1.0.0',
        afterRead: async (v) => stripTags(v),
        afterSearch: async (vs) => vs.map(stripTags),
      };
      pluginManager = new PluginManager();
      pluginManager.registerPlugin(stripper);
      queries.getVCon.mockImplementation(async () => tagged());
      queries.searchVCons.mockImplementation(async () => [tagged()]);
      vconService = new VConService({ queries: queries as any, pluginManager });
      ctx = { ...ctx, pluginManager, vconService } as ToolHandlerContext;
    });

    it('vcon_fetch include=tags returns no tags a plugin stripped', async () => {
      const res = body(await new VConFetchHandler().handle({ id: VISIBLE, include: ['core', 'tags'] }, ctx));
      expect(res.item.tags).toEqual({});
    });

    it('vcon_search include=tags returns no tags a plugin stripped', async () => {
      const res = body(await new VConSearchHandler().handle(
        { mode: 'metadata', include: ['core', 'tags'], limit: 10 }, ctx));
      expect(res.items[0].tags).toEqual({});
    });

    it('include=tags still returns tags when no plugin strips them', async () => {
      pluginManager = new PluginManager();
      vconService = new VConService({ queries: queries as any, pluginManager });
      const res = body(await new VConFetchHandler().handle(
        { id: VISIBLE, include: ['core', 'tags'] }, { ...ctx, pluginManager, vconService } as ToolHandlerContext));
      expect(res.item.tags).toEqual({ department: 'sales' });
    });
  });
});

describe('read-only plugin (no afterSearch) still guards search hits', () => {
  beforeEach(() => {
    // ACL on beforeRead plus redaction on afterRead; no search hooks at all.
    const acl: VConPlugin = {
      name: 'acl-redactor',
      version: '1.0.0',
      beforeRead: async (uuid) => { if (uuid === HIDDEN) throw new Error('access denied'); },
      afterRead: async (v) => redact(v),
    };
    pluginManager = new PluginManager();
    pluginManager.registerPlugin(acl);
    vconService = new VConService({ queries: queries as any, pluginManager });
    ctx = { ...ctx, pluginManager, vconService } as ToolHandlerContext;
  });

  it.each(['keyword'])('vcon_search %s hides blocked vCons and nulls snippets', async (mode) => {
    const res = body(await new VConSearchHandler().handle(
      { mode, query: 'hello', include: ['core', 'parties', 'dialog'], limit: 10 }, ctx));
    expect(ids(res.items)).toEqual([VISIBLE]);
    expect(JSON.stringify(res)).not.toMatch(LEAK);
    expect(res.items[0].search.snippet).toBeNull();
  });

  it('vcon_search metadata redacts and hides', async () => {
    const res = body(await new VConSearchHandler().handle(
      { mode: 'metadata', include: ['core', 'parties', 'dialog'], limit: 10 }, ctx));
    expect(ids(res.items)).toEqual([VISIBLE]);
    expect(JSON.stringify(res)).not.toMatch(LEAK);
  });

  it.each(['snippets', 'metadata', 'ids_only'])('search_vcons_content %s drops blocked hits and nulls snippets', async (fmt) => {
    const res = body(await new SearchVConsContentHandler().handle({ query: 'hello', response_format: fmt }, ctx));
    expect(ids(res.results)).toEqual([VISIBLE]);
    expect(JSON.stringify(res)).not.toMatch(LEAK);
  });
});

describe('MCP resources run plugin read hooks (#100)', () => {
  it.each(['', '/parties', '/dialog', '/metadata'])('vcon://v1/vcons/{uuid}%s runs beforeRead/afterRead', async (suffix) => {
    const res = await resolveCoreResource(queries as any, `vcon://v1/vcons/${VISIBLE}${suffix}`, vconService);
    expect(JSON.stringify(res)).not.toMatch(LEAK);
    expect(plugin.calls).toEqual(['beforeRead', 'afterRead']);
    await expect(
      resolveCoreResource(queries as any, `vcon://v1/vcons/${HIDDEN}${suffix}`, vconService)
    ).rejects.toThrow(/access denied/);
  });

  it.each(['vcon://v1/vcons/recent', 'vcon://v1/vcons/recent/ids', 'vcon://v1/vcons/ids'])('%s runs beforeSearch/afterSearch', async (uri) => {
    const res = await resolveCoreResource(queries as any, uri, vconService);
    expect(ids(res!.content.vcons)).toEqual([VISIBLE]);
    expect(JSON.stringify(res)).not.toMatch(LEAK);
    expect(plugin.calls).toEqual(['beforeSearch', 'afterSearch']);
  });
});

describe('REST routes run plugin read hooks (#100)', () => {
  const BASE = '/api/v1';
  let app: ReturnType<typeof createRestApi>;
  let savedAuth: string | undefined;

  beforeEach(() => {
    savedAuth = process.env.API_AUTH_REQUIRED;
    process.env.API_AUTH_REQUIRED = 'false';
    const apiContext: RestApiContext = {
      queries: queries as any,
      pluginManager,
      supabase: {},
      vconService,
      dbInspector: {} as any,
      dbAnalytics: {} as any,
      dbSizeAnalyzer: {} as any,
    };
    app = createRestApi(apiContext);
  });

  afterEach(() => {
    if (savedAuth === undefined) delete process.env.API_AUTH_REQUIRED;
    else process.env.API_AUTH_REQUIRED = savedAuth;
  });

  it.each([
    ['content snippets', '/vcons/search/content?q=hello'],
    ['content full', '/vcons/search/content?q=hello&format=full'],
    ['semantic', '/vcons/search/semantic?q=hello'],
    ['hybrid', '/vcons/search/hybrid?q=hello'],
  ])('GET search %s runs beforeSearch/afterSearch', async (_label, path) => {
    const res = await request(app.callback()).get(`${BASE}${path}`).expect(200);
    expect(ids(res.body.results)).toEqual([VISIBLE]);
    expect(JSON.stringify(res.body)).not.toMatch(LEAK);
    expect(plugin.calls.slice(0, 2)).toEqual(['beforeSearch', 'afterSearch']);
  });

  it('GET /tags/search drops hidden uuids', async () => {
    const res = await request(app.callback())
      .get(`${BASE}/tags/search?tags=${encodeURIComponent('{"department":"sales"}')}`)
      .expect(200);
    expect(res.body.uuids).toEqual([VISIBLE]);
    expect(plugin.calls).toEqual(['beforeSearch', 'afterSearch', 'beforeRead', 'afterRead']);
  });

  it('GET /vcons/:uuid/tags runs beforeRead, which can block', async () => {
    await request(app.callback()).get(`${BASE}/vcons/${VISIBLE}/tags`).expect(200);
    expect(plugin.calls).toEqual(['beforeRead']);
    const blocked = await request(app.callback()).get(`${BASE}/vcons/${HIDDEN}/tags`);
    expect(blocked.status).toBeGreaterThanOrEqual(400);
    expect(queries.getTags).toHaveBeenCalledTimes(1);
  });

  it('GET /vcons/:uuid runs beforeRead/afterRead', async () => {
    const res = await request(app.callback()).get(`${BASE}/vcons/${VISIBLE}`).expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(LEAK);
    expect(plugin.calls).toEqual(['beforeRead', 'afterRead']);
  });

  it('GET /vcons list runs beforeSearch/afterSearch', async () => {
    const res = await request(app.callback()).get(`${BASE}/vcons?format=full`).expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(LEAK);
    expect(plugin.calls).toEqual(['beforeSearch', 'afterSearch']);
  });
});
