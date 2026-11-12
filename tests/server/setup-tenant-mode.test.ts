/**
 * setupServer and TENANT_MODE: the mode is checked before anything connects,
 * and only a writer starts the tag view refresh timer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn((_fn: string, _args?: unknown) => Promise.resolve({ data: false, error: null as unknown }));
const getSupabaseClient = vi.fn(() => ({ rpc }));

vi.mock('../../src/db/client.js', () => ({
  getSupabaseClient: () => getSupabaseClient(),
  getRedisClient: vi.fn(() => null),
}));

vi.mock('../../src/hooks/plugin-manager.js', () => ({
  PluginManager: vi.fn().mockImplementation(() => ({
    registerPlugin: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/tools/handlers/index.js', () => ({
  createHandlerRegistry: vi.fn(() => ({ get: vi.fn(), register: vi.fn() })),
}));

const { setupServer } = await import('../../src/server/setup.js');
const { stopTenantWriter } = await import('../../src/server/tenant-writer.js');

const ENV_KEYS = ['TENANT_MODE', 'SUPABASE_SERVICE_ROLE_KEY', 'DB_TYPE', 'RLS_ENABLED', 'TAGS_MV_REFRESH_INTERVAL_MS',
  'CURRENT_TENANT_ID', 'TENANT_ATTACHMENT_TYPE', 'TENANT_JSON_PATH'];
const refreshCalls = () => rpc.mock.calls.filter((c: any[]) => c[0] === 'refresh_vcon_tags_mv_if_stale').length;

describe('setupServer with TENANT_MODE', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    rpc.mockReset();
    rpc.mockImplementation(() => Promise.resolve({ data: false, error: null }));
    getSupabaseClient.mockClear();
  });

  afterEach(() => {
    stopTenantWriter();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('off: no refresh timer', async () => {
    await setupServer();
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshCalls()).toBe(0);
  });

  it('writer: starts the refresh timer', async () => {
    process.env.TENANT_MODE = 'writer';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests';
    await setupServer();
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshCalls()).toBe(1);
  });

  it('writer: a store without save_vcon_batch stops startup, and no timer starts', async () => {
    process.env.TENANT_MODE = 'writer';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests';
    rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'save_vcon_batch'
      ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.save_vcon_batch' } }
      : { data: false, error: null }));
    await expect(setupServer()).rejects.toThrow('TENANT_MODE=writer needs save_vcon_batch');
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshCalls()).toBe(0);
  });

  it('writer with CURRENT_TENANT_ID stops before connecting', async () => {
    process.env.TENANT_MODE = 'writer';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests';
    process.env.CURRENT_TENANT_ID = 't-aaaaaaaaaaaaaaaa';
    await expect(setupServer()).rejects.toThrow('unset CURRENT_TENANT_ID');
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  it('writer without the service key stops before connecting', async () => {
    process.env.TENANT_MODE = 'writer';
    await expect(setupServer()).rejects.toThrow('TENANT_MODE=writer needs SUPABASE_SERVICE_ROLE_KEY');
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  it('an unknown TENANT_MODE stops before connecting', async () => {
    process.env.TENANT_MODE = 'shared';
    await expect(setupServer()).rejects.toThrow(/TENANT_MODE must be one of/);
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });
});
