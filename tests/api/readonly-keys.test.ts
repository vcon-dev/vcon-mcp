/**
 * Read-only API key tests.
 *
 * API_KEYS = full read/write/delete. API_KEYS_READONLY = authenticates, GET only
 * on REST, read-only tool set over MCP.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getAuthConfig, validateHttpRequestAuth } from '../../src/api/auth.js';
import { createTestApp, sampleVCon, type TestAppContext } from './helpers.js';

vi.mock('../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
  recordCounter: vi.fn(),
}));
vi.mock('../../src/observability/attributes.js', () => ({
  ATTR_SEARCH_TYPE: 'search.type',
}));

const BASE = '/api/v1';
const RW = 'rw-token';
const RO = 'ro-token';

describe('read-only REST keys', () => {
  let ctx: TestAppContext;
  let savedAuthRequired: string | undefined;

  beforeEach(() => {
    savedAuthRequired = process.env.API_AUTH_REQUIRED;
    vi.stubEnv('API_KEYS', RW);
    vi.stubEnv('API_KEYS_READONLY', RO);
    ctx = createTestApp({ authRequired: true });
  });

  afterEach(() => {
    // createTestApp assigns API_AUTH_REQUIRED directly, so stubs don't cover it
    if (savedAuthRequired === undefined) delete process.env.API_AUTH_REQUIRED;
    else process.env.API_AUTH_REQUIRED = savedAuthRequired;
    vi.unstubAllEnvs();
  });

  it('allows GET /vcons with a read-only key', async () => {
    await request(ctx.app.callback())
      .get(`${BASE}/vcons`)
      .set('Authorization', `Bearer ${RO}`)
      .expect(200);
  });

  it('rejects POST /vcons with a read-only key', async () => {
    const res = await request(ctx.app.callback())
      .post(`${BASE}/vcons`)
      .set('Authorization', `Bearer ${RO}`)
      .send({ vcon: sampleVCon() })
      .expect(403);

    expect(res.body.error).toBe('Forbidden');
    expect(ctx.mocks.vconService.create).not.toHaveBeenCalled();
  });

  it('rejects DELETE /vcons/{uuid} with a read-only key', async () => {
    const res = await request(ctx.app.callback())
      .delete(`${BASE}/vcons/${sampleVCon().uuid}`)
      .set('Authorization', `Bearer ${RO}`)
      .expect(403);

    expect(res.body.error).toBe('Forbidden');
    expect(ctx.mocks.queries.deleteVCon).not.toHaveBeenCalled();
  });

  it('still allows writes with a full-access key', async () => {
    await request(ctx.app.callback())
      .post(`${BASE}/vcons`)
      .set('Authorization', `Bearer ${RW}`)
      .send({ vcon: sampleVCon() })
      .expect(201);
  });

  it('rejects unknown keys with 401, not 403', async () => {
    await request(ctx.app.callback())
      .get(`${BASE}/vcons`)
      .set('Authorization', 'Bearer nope')
      .expect(401);
  });
});

describe('getAuthConfig scopes', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('treats a token listed in both lists as read-only', () => {
    vi.stubEnv('API_KEYS', `${RW},shared`);
    vi.stubEnv('API_KEYS_READONLY', 'shared');
    const config = getAuthConfig();
    expect(config.apiKeys).toEqual([RW]);
    expect(config.readonlyKeys).toEqual(['shared']);
  });

  it('keeps legacy API_KEYS full-access when no read-only keys are set', () => {
    vi.stubEnv('API_KEYS', RW);
    vi.stubEnv('API_KEYS_READONLY', '');
    const req = { headers: { authorization: `Bearer ${RW}` }, socket: {} } as any;
    expect(validateHttpRequestAuth(req, getAuthConfig())).toEqual({ ok: true, readonly: false });
  });

  it('flags a read-only token on the MCP endpoint', () => {
    vi.stubEnv('API_KEYS', RW);
    vi.stubEnv('API_KEYS_READONLY', RO);
    const req = { headers: { authorization: `Bearer ${RO}` }, socket: {} } as any;
    expect(validateHttpRequestAuth(req, getAuthConfig())).toEqual({ ok: true, readonly: true });
  });
});

describe('read-only MCP tool set', () => {
  async function callTool(readonly: boolean, name: string, args: object = {}) {
    const { registerHandlers } = await import('../../src/server/handlers.js');
    const server = new Server({ name: 't', version: '0' }, { capabilities: { tools: {} } });
    const handlers = new Map<string, any>();
    // Capture the registered handlers instead of standing up a transport.
    (server as any).setRequestHandler = (schema: any, handler: any) => {
      handlers.set(schema === ListToolsRequestSchema ? 'list' : schema === CallToolRequestSchema ? 'call' : 'other', handler);
    };

    registerHandlers(
      {
        server,
        queries: {} as any,
        dbInspector: {} as any,
        dbAnalytics: {} as any,
        dbSizeAnalyzer: {} as any,
        supabase: {},
        redis: null,
        pluginManager: { getAdditionalTools: async () => [], getAdditionalResources: async () => [] } as any,
        handlerRegistry: { get: () => undefined } as any,
        vconService: {} as any,
      },
      { readonly }
    );

    return {
      list: () => handlers.get('list')({} as any),
      call: () => handlers.get('call')({ params: { name, arguments: args } } as any),
    };
  }

  it('rejects a write tool for a read-only session', async () => {
    const { call } = await callTool(true, 'create_vcon');
    await expect(call()).rejects.toThrow(/read-only API key/);
  });

  it('does not list write tools for a read-only session', async () => {
    const { list } = await callTool(true, 'create_vcon');
    const names = (await list()).tools.map((t: any) => t.name);
    expect(names).not.toContain('create_vcon');
    expect(names).not.toContain('delete_vcon');
    expect(names).toContain('get_vcon');
  });

  it('allows write tools for a full-access session', async () => {
    const { list } = await callTool(false, 'create_vcon');
    const names = (await list()).tools.map((t: any) => t.name);
    expect(names).toContain('create_vcon');
  });
});
