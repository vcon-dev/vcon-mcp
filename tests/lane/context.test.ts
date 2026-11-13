import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeSupabaseClient, getRedisClient, getSupabaseClient } from '../../src/db/client.js';
import { refreshTagsMvIfStale, skipTagsMvRefresh } from '../../src/db/tags-mv.js';
import { PluginManager } from '../../src/hooks/plugin-manager.js';
import { createLaneContext, createLaneStoreClient, LaneVConQueries } from '../../src/lane/context.js';
import { LANE_TOOL_NAMES } from '../../src/lane/mcp-server.js';
import { VConService } from '../../src/services/vcon-service.js';
import { DeleteVConHandler } from '../../src/tools/handlers/vcon-crud.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { EmbeddingError, generateEmbedding } from '../../src/utils/embeddings.js';
import { fakeStore, TENANT_A, TENANT_B, tenantJwt, UUID_A, UUID_A2, UUID_B } from './helpers.js';

const URL_ = 'http://lane-store.invalid';
const ENV_KEYS = ['TENANT_MODE', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_URL', 'REDIS_URL', 'EMBEDDING_PROVIDER', 'OPENAI_API_KEY'];

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  closeSupabaseClient();
  vi.unstubAllGlobals();
});

describe('lane store client', () => {
  it('sends the token, and only the token, as apikey and Authorization', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'canary-service-key';
    process.env.SUPABASE_ANON_KEY = 'canary-anon-key';
    const store = fakeStore();
    const jwt = tenantJwt(TENANT_A);
    const client = createLaneStoreClient(jwt, { url: URL_, fetch: store.fetch });
    await client.from('vcons').select('uuid').eq('uuid', UUID_A);
    expect(store.requests).toHaveLength(1);
    const { headers, path } = store.requests[0];
    expect(path).toBe('/rest/v1/vcons');
    expect(headers.get('authorization')).toBe(`Bearer ${jwt}`);
    expect(headers.get('apikey')).toBe(jwt);
    for (const [, value] of headers) {
      expect(value).not.toContain('canary-service-key');
      expect(value).not.toContain('canary-anon-key');
    }
  });

  it('builds no auth client: any use of client.auth throws, so nothing can sign in or swap the token', () => {
    const client = createLaneStoreClient(tenantJwt(TENANT_A), { url: URL_ });
    expect(() => client.auth.getSession()).toThrow(/accessToken option/);
  });

  it('notes a 401 from the store on the request context, and only a 401', async () => {
    for (const [status, refused] of [[401, true], [403, false], [500, false], [200, false]] as const) {
      const answer = (async () => new Response('[]', { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
      const ctx = createLaneContext(tenantJwt(TENANT_A), { url: URL_, fetch: answer });
      expect(ctx.storeRefusedToken()).toBe(false);
      await ctx.supabase.from('vcons').select('uuid');
      expect(ctx.storeRefusedToken(), String(status)).toBe(refused);
    }
  });

  it('gives two requests two clients, two query layers and two services', () => {
    const a = createLaneContext(tenantJwt(TENANT_A), { url: URL_ });
    const b = createLaneContext(tenantJwt(TENANT_B), { url: URL_ });
    expect(a.supabase).not.toBe(b.supabase);
    expect(a.queries).not.toBe(b.queries);
    expect(a.vconService).not.toBe(b.vconService);
    expect(a.pluginManager).not.toBe(b.pluginManager);
  });

  it('refuses the operator surfaces instead of reaching the store', () => {
    const ctx = createLaneContext(tenantJwt(TENANT_A), { url: URL_ });
    expect(() => ctx.dbInspector.getConnectionInfo()).toThrow(/not available in TENANT_MODE=lane/);
    expect(() => ctx.dbAnalytics.getDatabaseAnalytics()).toThrow(/not available in TENANT_MODE=lane/);
    expect(() => ctx.dbSizeAnalyzer.getDatabaseSizeInfo()).toThrow(/not available in TENANT_MODE=lane/);
  });
});

describe('LaneVConQueries', () => {
  it('cannot reach the batch writer', async () => {
    const store = fakeStore();
    const queries = new LaneVConQueries(createLaneStoreClient(tenantJwt(TENANT_A), { url: URL_, fetch: store.fetch }));
    await expect(queries.createVCon({ vcon: '0.4.0', uuid: UUID_A, parties: [] } as any)).rejects.toThrow(/does not write vCons/);
    expect(store.requests).toHaveLength(0);
  });

  it('reports 0 rows for another tenant’s uuid and leaves the row', async () => {
    const store = fakeStore();
    const queries = new LaneVConQueries(createLaneStoreClient(tenantJwt(TENANT_A), { url: URL_, fetch: store.fetch }));
    await expect(queries.deleteVCon(UUID_B)).resolves.toBe(0);
    expect(store.rows.some((r) => r.uuid === UUID_B)).toBe(true);
    const del = store.requests.find((r) => r.method === 'DELETE')!;
    expect(del.params.get('uuid')).toBe(`eq.${UUID_B}`);
    expect(del.params.get('select')).toBe('uuid');
    expect(del.headers.get('prefer')).toContain('return=representation');
  });

  it('reports 1 row for its own tenant’s uuid and removes it', async () => {
    const store = fakeStore();
    const queries = new LaneVConQueries(createLaneStoreClient(tenantJwt(TENANT_A), { url: URL_, fetch: store.fetch }));
    await expect(queries.deleteVCon(UUID_A2)).resolves.toBe(1);
    expect(store.rows.some((r) => r.uuid === UUID_A2)).toBe(false);
  });

  it('throws a store error instead of reporting not found', async () => {
    const failing = (async () => new Response(JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
    const queries = new LaneVConQueries(createLaneStoreClient(tenantJwt(TENANT_A), { url: URL_, fetch: failing }));
    await expect(queries.deleteVCon(UUID_A)).rejects.toMatchObject({ message: 'JWT expired' });
  });
});

describe("delete_vcon through the lane's query layer when the delete removes no row", () => {
  // The existence read finds the vCon, then the DELETE matches nothing and PostgREST answers 200 with
  // no rows: what a row-security policy that allows the read but refuses the delete gives. Only the
  // `removed === 0` branch in VConService.delete turns that into "not found".
  it('reports not found, and the row stays', async () => {
    const store = fakeStore();
    store.deleteMatchesNothing = true;
    const queries = new LaneVConQueries(createLaneStoreClient(tenantJwt(TENANT_A), { url: URL_, fetch: store.fetch }));
    const pluginManager = new PluginManager();
    const context = { queries, pluginManager, vconService: new VConService({ queries, pluginManager }) } as any;

    const error = await new DeleteVConHandler().handle({ uuid: UUID_A }, context).catch((e) => e);
    expect(error).toBeInstanceOf(McpError);
    expect(error.code).toBe(ErrorCode.InvalidRequest);
    expect(error.message).toMatch(/not found/);
    // The existence read found the row, and the DELETE was sent and removed nothing.
    expect(store.requests.some((r) => r.method === 'GET' && r.params.get('uuid') === `eq.${UUID_A}`)).toBe(true);
    expect(store.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
    expect(store.rows.some((r) => r.uuid === UUID_A)).toBe(true);
  });
});

describe('VConService.delete with a counting backend', () => {
  const vcon = { vcon: '0.4.0', uuid: UUID_A, parties: [] } as any;

  it('is not found when the delete removed no row', async () => {
    const queries = { getVCon: vi.fn().mockResolvedValue(vcon), deleteVCon: vi.fn().mockResolvedValue(0) } as any;
    const service = new VConService({ queries, pluginManager: new PluginManager() });
    await expect(service.delete(UUID_A)).resolves.toBe(false);
  });

  it('is deleted when the backend counted a row, or reports no count (TENANT_MODE=off)', async () => {
    for (const result of [1, undefined]) {
      const queries = { getVCon: vi.fn().mockResolvedValue(vcon), deleteVCon: vi.fn().mockResolvedValue(result) } as any;
      const service = new VConService({ queries, pluginManager: new PluginManager() });
      await expect(service.delete(UUID_A)).resolves.toBe(true);
    }
  });
});

describe('shared clients in TENANT_MODE=lane', () => {
  it('never builds the shared store client from an env key', () => {
    process.env.TENANT_MODE = 'lane';
    process.env.SUPABASE_URL = URL_;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'canary-service-key';
    closeSupabaseClient();
    expect(() => getSupabaseClient()).toThrow(/TENANT_MODE=lane has no shared store client/);
  });

  it('never opens the Redis cache', () => {
    process.env.TENANT_MODE = 'lane';
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    expect(getRedisClient()).toBeNull();
  });

  it('never refreshes the tag view through a lane client', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = { rpc } as any;
    skipTagsMvRefresh(client);
    await refreshTagsMvIfStale(client);
    expect(rpc).not.toHaveBeenCalled();

    const other = { rpc: vi.fn().mockResolvedValue({ error: null }) } as any;
    await refreshTagsMvIfStale(other);
    expect(other.rpc).toHaveBeenCalledWith('refresh_vcon_tags_mv_if_stale');
  });

  it('never sends the service key to the embedding function', async () => {
    process.env.TENANT_MODE = 'lane';
    process.env.SUPABASE_URL = URL_;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'canary-service-key';
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(generateEmbedding('anything')).rejects.toThrow(EmbeddingError);
    await expect(generateEmbedding('anything')).rejects.toThrow(/TENANT_MODE=lane cannot embed/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('LANE_TOOL_NAMES', () => {
  it('is the five tools the design names', () => {
    expect([...LANE_TOOL_NAMES].sort()).toEqual(
      ['delete_vcon', 'get_vcon', 'search_vcons', 'search_vcons_content', 'search_vcons_semantic']
    );
  });
});
