/**
 * TENANT_MODE=lane over real HTTP with a real MCP client, against a stand-in store (./helpers.ts) that
 * answers each request with only its bearer's tenant's rows.
 *
 * Covers: five tools listed, every other tool, resource, prompt and REST route refused, 401 before any
 * store call without a usable bearer, the request's JWT and nothing else reaching the store as both
 * Authorization and apikey, the portal's call shapes, delete_vcon zero rows as not found, concurrent
 * tenants never sharing a client, and the bearer never logged.
 *
 * TODO(strict pack): the same shapes against real PostgREST, real supabase-js and pgvector with tenant A's
 * token against tenant B's uuid and text. That test belongs in the strict-pack harness.
 */

import http from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startLaneHttpServer } from '../../src/lane/http.js';
import { LANE_TOOL_NAMES } from '../../src/lane/mcp-server.js';
import { allContractTools } from '../../src/tools/vcon-contract.js';
import { allDatabaseAnalyticsTools } from '../../src/tools/database-analytics.js';
import { allDatabaseSizeTools } from '../../src/tools/database-size-tools.js';
import { allDatabaseTools } from '../../src/tools/database-tools.js';
import { getExamplesTool, getSchemaTool } from '../../src/tools/schema-tools.js';
import { allTagTools } from '../../src/tools/tag-tools.js';
import { createFromTemplateTool } from '../../src/tools/templates.js';
import { allTools } from '../../src/tools/vcon-crud.js';
import {
  CANARY_A, CANARY_B, fakeStore, TENANT_A, TENANT_B, tenantJwt, UUID_A, UUID_A2, UUID_B, type FakeStore,
} from './helpers.js';

const realFetch = globalThis.fetch;
const CANARY_ENV = {
  SUPABASE_SERVICE_ROLE_KEY: 'canary-service-key-5d1e',
  SUPABASE_ANON_KEY: 'canary-anon-key-a83b',
  API_KEYS: 'canary-api-key-0c44',
};
const ENV_KEYS = ['TENANT_MODE', 'EMBEDDING_PROVIDER', 'OPENAI_API_KEY', ...Object.keys(CANARY_ENV)];

let store: FakeStore;
let server: http.Server;
let base: string;
let savedEnv: Record<string, string | undefined>;

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // Keys a lane must never send, set here so a fallback would show up in the store's request log.
  Object.assign(process.env, CANARY_ENV, { TENANT_MODE: 'lane' });
  store = fakeStore();
  server = await startLaneHttpServer(
    { host: '127.0.0.1', port: 0, restBasePath: '/api/v1' },
    { url: 'http://lane-store.invalid', schema: 'public', fetch: store.fetch }
  );
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  store.rows = fakeStore().rows;
  store.requests.length = 0;
  store.delayMs = 0;
  store.deleteMatchesNothing = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.EMBEDDING_PROVIDER;
  delete process.env.OPENAI_API_KEY;
});

async function connect(jwt: string): Promise<Client> {
  const client = new Client({ name: 'lane-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${jwt}` } },
    fetch: realFetch,
  }));
  return client;
}

/** The tool result as parsed JSON. */
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[]).map((c) => c.text).join('');
  return { ...JSON.parse(text), __text: text, __isError: r.isError };
}

function rawPost(headers: Record<string, string>, body: object): Promise<Response> {
  return realFetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
}

const ALL_TOOL_NAMES = [
  ...allTools, ...allContractTools, createFromTemplateTool, getSchemaTool, getExamplesTool,
  ...allDatabaseTools, ...allDatabaseAnalyticsTools, ...allDatabaseSizeTools, ...allTagTools,
].map((t: { name: string }) => t.name);

describe('tools/list', () => {
  it('lists exactly the five lane tools', async () => {
    const client = await connect(tenantJwt(TENANT_A));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...LANE_TOOL_NAMES].sort());
    expect(tools.every((t) => !('category' in t))).toBe(true);
    await client.close();
    expect(store.requests).toHaveLength(0);
  });
});

describe('refusals', () => {
  it('refuses every other tool before any store call', async () => {
    const others = [...new Set(ALL_TOOL_NAMES)].filter((n) => !LANE_TOOL_NAMES.includes(n));
    expect(others.length).toBeGreaterThan(30);
    const client = await connect(tenantJwt(TENANT_A));
    for (const name of [...others, 'not_a_tool']) {
      await expect(client.callTool({ name, arguments: { uuid: UUID_A, vcon_uuid: UUID_A } }), name)
        .rejects.toMatchObject({ code: -32601 });
    }
    await client.close();
    expect(store.requests).toHaveLength(0);
  });

  it('refuses every resource and prompt method', async () => {
    const client = await connect(tenantJwt(TENANT_A));
    expect(client.getServerCapabilities()).toEqual({ tools: {} });
    await expect(client.listResources()).rejects.toMatchObject({ code: -32601 });
    await expect(client.listResourceTemplates()).rejects.toMatchObject({ code: -32601 });
    await expect(client.readResource({ uri: `vcon://v1/vcons/${UUID_A}` })).rejects.toMatchObject({ code: -32601 });
    await expect(client.listPrompts()).rejects.toMatchObject({ code: -32601 });
    await expect(client.getPrompt({ name: 'find_by_tags' })).rejects.toMatchObject({ code: -32601 });
    await client.close();
    expect(store.requests).toHaveLength(0);
  });

  it('refuses every REST route but health, with or without a bearer, and health makes no store call', async () => {
    const routes: [string, string][] = [
      ['GET', '/api/v1/vcons'], ['POST', '/api/v1/vcons'], ['POST', '/api/v1/vcons/batch'],
      ['GET', `/api/v1/vcons/${UUID_A}`], ['DELETE', `/api/v1/vcons/${UUID_A}`], ['GET', '/api/v1/tags'],
      ['GET', '/api/v1/search/content?q=x'], ['GET', '/api/v1/database/shape'], ['GET', '/api/v1/analytics'],
      ['GET', '/api/v1/discovery/attachments/types'], ['GET', '/api/v1/version'], ['GET', '/api/v1/schema'],
      ['POST', '/api/v1/health'],
    ];
    for (const auth of [{}, { authorization: `Bearer ${tenantJwt(TENANT_A)}` }]) {
      for (const [method, path] of routes) {
        const res = await realFetch(`${base}${path}`, { method, headers: auth });
        expect(res.status, `${method} ${path}`).toBe(404);
        expect((await res.json()).message).toMatch(/not served in TENANT_MODE=lane/);
      }
    }
    const health = await realFetch(`${base}/api/v1/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'healthy', tenant_mode: 'lane', database: 'not_checked' });
    expect(store.requests).toHaveLength(0);
  });

  it('answers 401 before any store call to no bearer or one that is not a tenant token', async () => {
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_vcon', arguments: { uuid: UUID_A } } };
    const refused: Record<string, string>[] = [
      {},
      { authorization: 'Bearer not-a-jwt' },
      { authorization: 'Basic dXNlcjpwYXNz' },
      { authorization: `Bearer ${CANARY_ENV.API_KEYS}` },
      { 'x-api-key': CANARY_ENV.API_KEYS },
      { authorization: `Bearer ${b64({ alg: 'HS256' })}.${b64({ role: 'service_role', tenant_id: TENANT_A })}.c2ln` },
      { authorization: `Bearer ${b64({ alg: 'HS256' })}.${b64({ role: 'authenticated' })}.c2ln` },
      { authorization: `Bearer ${b64({ alg: 'none' })}.${b64({ role: 'authenticated', tenant_id: TENANT_A })}.` },
    ];
    for (const headers of refused) {
      for (const method of ['POST', 'GET', 'DELETE']) {
        const res = method === 'POST'
          ? await rawPost(headers, body)
          : await realFetch(`${base}/mcp`, { method, headers: { accept: 'text/event-stream', ...headers } });
        expect(res.status, `${method} ${JSON.stringify(headers).slice(0, 60)}`).toBe(401);
        expect(res.headers.get('www-authenticate')).toBe('Bearer realm="vCon MCP lane"');
      }
    }
    expect(store.requests).toHaveLength(0);
  });

  it('answers GET and DELETE with 405: a stateless lane has no stream or session', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await realFetch(`${base}/mcp`, {
        method, headers: { authorization: `Bearer ${tenantJwt(TENANT_A)}`, accept: 'text/event-stream' },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
    expect(store.requests).toHaveLength(0);
  });
});

describe('what reaches the store', () => {
  it('is the request JWT as Authorization and apikey, and nothing else', async () => {
    const jwt = tenantJwt(TENANT_A);
    const client = await connect(jwt);
    await call(client, 'get_vcon', { uuid: UUID_A });
    await call(client, 'search_vcons', { limit: 5, response_format: 'ids_only', include_count: true, tags: { synthetic: 'e2e' } });
    await call(client, 'search_vcons_content', { query: 'call', limit: 5, response_format: 'ids_only' });
    await client.close();

    expect(store.requests.length).toBeGreaterThan(5);
    for (const r of store.requests) {
      expect(r.headers.get('authorization')).toBe(`Bearer ${jwt}`);
      expect(r.headers.get('apikey')).toBe(jwt);
      for (const [, value] of r.headers) {
        for (const canary of Object.values(CANARY_ENV)) expect(value).not.toContain(canary);
      }
    }
    // The tenant token may not refresh the tag view; the writer does.
    expect(store.requests.some((r) => r.path.includes('refresh_vcon_tags_mv'))).toBe(false);
  });
});

describe('the portal call shapes, as tenant A', () => {
  let client: Client;
  beforeEach(async () => { client = await connect(tenantJwt(TENANT_A)); });
  afterEach(async () => { await client.close(); });

  const range = { start_date: '2026-10-30T00:00:00.000Z', end_date: '2026-11-05T00:00:00.000Z' };

  it('search_vcons ids_only with a count (traffic and list counts)', async () => {
    const r = await call(client, 'search_vcons', { ...range, limit: 10, response_format: 'ids_only', include_count: true });
    expect(r.results).toEqual([UUID_A2, UUID_A]);
    expect(r.total_count).toBe(2);
    expect(r.__text).not.toContain(UUID_B);
  });

  it('search_vcons ids_only with a tags filter and a count (synthetic exclusion)', async () => {
    const r = await call(client, 'search_vcons', { ...range, limit: 1, response_format: 'ids_only', include_count: true, tags: { synthetic: 'e2e' } });
    expect(r.results).toEqual([UUID_A]);
    expect(r.total_count).toBe(1);
  });

  it('search_vcons ids_only with a subject filter (list_vcons)', async () => {
    const r = await call(client, 'search_vcons', { ...range, limit: 10, response_format: 'ids_only', include_count: true, subject: 'second' });
    expect(r.results).toEqual([UUID_A2]);
    expect(r.total_count).toBe(1);
  });

  it('search_vcons metadata (the calls page)', async () => {
    const r = await call(client, 'search_vcons', { limit: 50, response_format: 'metadata', ...range });
    expect(r.results.map((x: any) => x.uuid)).toEqual([UUID_A2, UUID_A]);
    expect(r.results.every((x: any) => typeof x.created_at === 'string')).toBe(true);
    expect(r.__text).not.toContain(CANARY_B);
  });

  it('search_vcons_content ids_only finds its own text and not another tenant’s', async () => {
    const own = await call(client, 'search_vcons_content', { query: CANARY_A, ...range, limit: 10, response_format: 'ids_only' });
    expect(own.results).toEqual([UUID_A]);
    const foreign = await call(client, 'search_vcons_content', { query: CANARY_B, ...range, limit: 10, response_format: 'ids_only' });
    expect(foreign.results).toEqual([]);
  });

  it('search_vcons_semantic ids_only by query text with an embedding provider', async () => {
    process.env.EMBEDDING_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const embed = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://api.openai.com/')) return realFetch(input, init);
      return new Response(JSON.stringify({ data: [{ embedding: new Array(384).fill(0.01) }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', embed);
    const r = await call(client, 'search_vcons_semantic', { query: 'billing question', limit: 16, response_format: 'ids_only' });
    expect(r.results).toEqual([UUID_A, UUID_A2]);
    expect(r.__text).not.toContain(UUID_B);
    // The tenant token goes to the store only, never to the embedding provider.
    const openai = embed.mock.calls.filter(([u]) => String(u).startsWith('https://api.openai.com/'));
    expect(openai).toHaveLength(1);
    expect(JSON.stringify(openai[0][1]?.headers)).not.toContain('eyJ');
  });

  it('search_vcons_semantic by query text fails, sending no key anywhere, with no embedding provider', async () => {
    const spy = vi.fn(realFetch);
    vi.stubGlobal('fetch', spy);
    const r = await client.callTool({ name: 'search_vcons_semantic', arguments: { query: 'x', limit: 4, response_format: 'ids_only' } })
      .catch((e) => e);
    expect(String(r.message)).toMatch(/EMBEDDING_PROVIDER=openai/);
    expect(spy.mock.calls.some(([u]) => !String(u).startsWith(base))).toBe(false);
    expect(store.requests).toHaveLength(0);
  });

  it('get_vcon reads its own vCon and not another tenant’s', async () => {
    const own = await call(client, 'get_vcon', { uuid: UUID_A });
    expect(own.vcon.uuid).toBe(UUID_A);
    expect(own.__text).toContain(CANARY_A);
    await expect(client.callTool({ name: 'get_vcon', arguments: { uuid: UUID_B } })).rejects.toThrow(/not found/i);
  });
});

describe('delete_vcon', () => {
  it('reports another tenant’s uuid as not found and leaves the vCon', async () => {
    const client = await connect(tenantJwt(TENANT_A));
    await expect(client.callTool({ name: 'delete_vcon', arguments: { uuid: UUID_B } })).rejects.toThrow(/not found/);
    await client.close();
    expect(store.rows.some((r) => r.uuid === UUID_B)).toBe(true);
  });

  it('reports a delete that removed no row as not found', async () => {
    store.deleteMatchesNothing = true;
    const client = await connect(tenantJwt(TENANT_A));
    await expect(client.callTool({ name: 'delete_vcon', arguments: { uuid: UUID_A } })).rejects.toThrow(/not found/);
    await client.close();
    expect(store.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
    expect(store.rows.some((r) => r.uuid === UUID_A)).toBe(true);
  });

  it('deletes its own tenant’s vCon with the request token', async () => {
    const jwt = tenantJwt(TENANT_A);
    const client = await connect(jwt);
    const r = await call(client, 'delete_vcon', { uuid: UUID_A2 });
    expect(r.success).toBe(true);
    await client.close();
    const del = store.requests.filter((x) => x.method === 'DELETE');
    expect(del).toHaveLength(1);
    expect(del[0].params.get('uuid')).toBe(`eq.${UUID_A2}`);
    expect(del[0].headers.get('authorization')).toBe(`Bearer ${jwt}`);
    expect(store.rows.some((x) => x.uuid === UUID_A2)).toBe(false);
  });
});

describe('concurrent tenants', () => {
  it('never share a client: each store request carries the token of the request that made it', async () => {
    store.delayMs = 15;
    const [a, b] = await Promise.all([connect(tenantJwt(TENANT_A)), connect(tenantJwt(TENANT_B))]);
    const rounds = await Promise.all(Array.from({ length: 4 }, () => Promise.all([
      call(a, 'get_vcon', { uuid: UUID_A }),
      call(b, 'get_vcon', { uuid: UUID_B }),
      call(a, 'search_vcons', { limit: 10, response_format: 'ids_only' }),
      call(b, 'search_vcons', { limit: 10, response_format: 'ids_only' }),
    ])));
    for (const [ga, gb, sa, sb] of rounds) {
      expect(ga.__text).toContain(CANARY_A);
      expect(ga.__text).not.toContain(CANARY_B);
      expect(gb.__text).toContain(CANARY_B);
      expect(gb.__text).not.toContain(CANARY_A);
      expect(sa.results).toEqual([UUID_A2, UUID_A]);
      expect(sb.results).toEqual([UUID_B]);
    }
    // Every request for a uuid was made with that uuid's tenant's token.
    const owner: Record<string, string> = { [UUID_A]: TENANT_A, [UUID_A2]: TENANT_A, [UUID_B]: TENANT_B };
    for (const r of store.requests) {
      const uuid = r.params.get('uuid')?.replace(/^eq\./, '');
      if (uuid) expect(r.tenant).toBe(owner[uuid]);
    }
    await Promise.all([a.close(), b.close()]);
  });
});

describe('logging', () => {
  it('never logs the bearer, and logs the tenant from the claim', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    for (const m of ['error', 'warn', 'info', 'log', 'debug'] as const) vi.spyOn(console, m).mockImplementation(capture);
    const outWrite = vi.spyOn(process.stdout, 'write').mockImplementation((c: any) => { lines.push(String(c)); return true; });
    const errWrite = vi.spyOn(process.stderr, 'write').mockImplementation((c: any) => { lines.push(String(c)); return true; });

    const jwt = tenantJwt(TENANT_A);
    const client = await connect(jwt);
    await call(client, 'get_vcon', { uuid: UUID_A });
    await client.callTool({ name: 'get_vcon', arguments: { uuid: UUID_B } }).catch(() => {});
    await client.callTool({ name: 'create_vcon', arguments: {} }).catch(() => {});
    await client.close();
    await rawPost({ authorization: 'Bearer secret-looking-token-value' }, { jsonrpc: '2.0', id: 1, method: 'tools/list' });

    outWrite.mockRestore();
    errWrite.mockRestore();
    const all = lines.join('\n');
    expect(all).toContain(TENANT_A);
    expect(all).not.toContain(jwt);
    for (const part of jwt.split('.')) expect(all).not.toContain(part);
    expect(all).not.toContain('secret-looking-token-value');
  });
});
