import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkTenantModeAtStartup,
  DEFAULT_TAGS_MV_REFRESH_INTERVAL_MS,
  getTagsMvRefreshIntervalMs,
  startTagsMvRefreshTimer,
  startTenantWriter,
  stopTenantWriter,
} from '../../src/server/tenant-writer.js';

const writerEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  TENANT_MODE: 'writer',
  SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests',
  ...extra,
});

const refreshCalls = (supabase: any) =>
  supabase.rpc.mock.calls.filter((c: any[]) => c[0] === 'refresh_vcon_tags_mv_if_stale').length;

describe('checkTenantModeAtStartup', () => {
  it('returns off and checks nothing else when TENANT_MODE is unset', () => {
    expect(checkTenantModeAtStartup({})).toBe('off');
    expect(checkTenantModeAtStartup({ DB_TYPE: 'mongodb', TAGS_MV_REFRESH_INTERVAL_MS: 'junk' })).toBe('off');
  });

  it('stops startup on an unknown TENANT_MODE', () => {
    expect(() => checkTenantModeAtStartup({ TENANT_MODE: 'writr' })).toThrow(/TENANT_MODE must be one of/);
  });

  it('accepts a writer with the service key', () => {
    expect(checkTenantModeAtStartup(writerEnv())).toBe('writer');
  });

  it('refuses a writer without the service key', () => {
    expect(() => checkTenantModeAtStartup(writerEnv({ SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ANON_KEY: 'anon' })))
      .toThrow('TENANT_MODE=writer needs SUPABASE_SERVICE_ROLE_KEY');
  });

  it('refuses a writer on the MongoDB backend', () => {
    expect(() => checkTenantModeAtStartup(writerEnv({ DB_TYPE: 'mongodb' }))).toThrow(/needs the Supabase backend/);
  });

  it('refuses a writer with a bad refresh interval', () => {
    expect(() => checkTenantModeAtStartup(writerEnv({ TAGS_MV_REFRESH_INTERVAL_MS: '500' }))).toThrow(/at least 1000/);
  });

  it('leaves lane to its own checks', () => {
    expect(checkTenantModeAtStartup({ TENANT_MODE: 'lane' })).toBe('lane');
  });
});

describe('getTagsMvRefreshIntervalMs', () => {
  it('defaults to one minute', () => {
    expect(getTagsMvRefreshIntervalMs({})).toBe(DEFAULT_TAGS_MV_REFRESH_INTERVAL_MS);
    expect(DEFAULT_TAGS_MV_REFRESH_INTERVAL_MS).toBe(60_000);
  });

  it('reads a whole number of milliseconds', () => {
    expect(getTagsMvRefreshIntervalMs({ TAGS_MV_REFRESH_INTERVAL_MS: '15000' })).toBe(15_000);
  });

  it('throws on anything else', () => {
    for (const bad of ['0', '-5', '999', '1.5', 'abc', '1e3x']) {
      expect(() => getTagsMvRefreshIntervalMs({ TAGS_MV_REFRESH_INTERVAL_MS: bad }), bad).toThrow();
    }
  });
});

describe('tag view refresh timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopTenantWriter();
    vi.useRealTimers();
  });

  it('refreshes at start and on every tick', async () => {
    const supabase = { rpc: vi.fn(() => Promise.resolve({ data: false, error: null })) } as any;
    const timer = startTagsMvRefreshTimer(supabase, 10_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshCalls(supabase)).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(refreshCalls(supabase)).toBe(4);

    timer.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refreshCalls(supabase)).toBe(4);
  });

  it('keeps ticking after the RPC errors or throws', async () => {
    const supabase = {
      rpc: vi.fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
        .mockResolvedValue({ data: true, error: null }),
    } as any;
    const timer = startTagsMvRefreshTimer(supabase, 5_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refreshCalls(supabase)).toBe(3);
    timer.stop();
  });

  it('does not keep the process alive', () => {
    const unref = vi.fn();
    const spy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref } as any);
    try {
      startTagsMvRefreshTimer({ rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) } as any, 5_000);
      expect(unref).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('startTenantWriter starts one timer at the configured interval, however often it is called', async () => {
    const supabase = { rpc: vi.fn(() => Promise.resolve({ data: false, error: null })) } as any;
    startTenantWriter(supabase, { TAGS_MV_REFRESH_INTERVAL_MS: '2000' });
    startTenantWriter(supabase, { TAGS_MV_REFRESH_INTERVAL_MS: '2000' });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(refreshCalls(supabase)).toBe(3);
  });
});
