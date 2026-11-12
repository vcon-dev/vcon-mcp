import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkTenantModeAtStartup,
  DEFAULT_TAGS_MV_REFRESH_INTERVAL_MS,
  getTagsMvRefreshIntervalMs,
  startTagsMvRefreshTimer,
  startTenantWriter,
  stopTenantWriter,
  verifyWriterStore,
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

  it('refuses a writer with CURRENT_TENANT_ID set', () => {
    expect(() => checkTenantModeAtStartup(writerEnv({ CURRENT_TENANT_ID: 't-aaaaaaaaaaaaaaaa' })))
      .toThrow('TENANT_MODE=writer serves every tenant; unset CURRENT_TENANT_ID');
  });

  it('accepts a writer with CURRENT_TENANT_ID blank', () => {
    expect(checkTenantModeAtStartup(writerEnv({ CURRENT_TENANT_ID: '' }))).toBe('writer');
    expect(checkTenantModeAtStartup(writerEnv({ CURRENT_TENANT_ID: '  ' }))).toBe('writer');
  });

  it('refuses a writer whose tenant attachment type or path differs from the SQL backfill', () => {
    expect(() => checkTenantModeAtStartup(writerEnv({ TENANT_ATTACHMENT_TYPE: 'account' })))
      .toThrow("TENANT_MODE=writer needs TENANT_ATTACHMENT_TYPE unset or 'tenant'");
    expect(() => checkTenantModeAtStartup(writerEnv({ TENANT_ATTACHMENT_TYPE: ' tenant' })))
      .toThrow(/TENANT_ATTACHMENT_TYPE/);
    expect(() => checkTenantModeAtStartup(writerEnv({ TENANT_JSON_PATH: 'org.id' })))
      .toThrow("TENANT_MODE=writer needs TENANT_JSON_PATH unset or 'id'");
  });

  it('accepts a writer with the default attachment type and path, set or blank', () => {
    expect(checkTenantModeAtStartup(writerEnv({ TENANT_ATTACHMENT_TYPE: 'tenant', TENANT_JSON_PATH: 'id' }))).toBe('writer');
    expect(checkTenantModeAtStartup(writerEnv({ TENANT_ATTACHMENT_TYPE: '', TENANT_JSON_PATH: '' }))).toBe('writer');
  });

  it('off: CURRENT_TENANT_ID and custom tenant settings are accepted as before', () => {
    expect(checkTenantModeAtStartup({
      CURRENT_TENANT_ID: 't-aaaaaaaaaaaaaaaa', TENANT_ATTACHMENT_TYPE: 'account', TENANT_JSON_PATH: 'org.id',
    })).toBe('off');
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

describe('verifyWriterStore', () => {
  type Reply = { data: unknown; error: { code?: string; message?: string } | null };
  const store = (batch: Reply, release: Reply) => ({
    rpc: vi.fn((fn: string) => Promise.resolve(fn === 'save_vcon_batch' ? batch : release)),
  }) as any;
  const OK: Reply = { data: null, error: null };
  const REFUSED: Reply = { data: null, error: { code: '22023', message: 'tenant id must be t- and 16 lowercase hex digits' } };
  const MISSING: Reply = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };

  it('passes when save_vcon_batch runs and the release function refuses the NULL probe', async () => {
    const s = store(OK, REFUSED);
    await expect(verifyWriterStore(s)).resolves.toBeUndefined();
    expect(s.rpc).toHaveBeenCalledWith('save_vcon_batch', {
      p_vcons: [], p_parties: [], p_dialog: [], p_analysis: [], p_attachments: [],
    });
    expect(s.rpc).toHaveBeenCalledWith('release_vcon_from_quarantine', {
      p_vcon_uuid: null, p_tenant_id: null, p_reason: null, p_evidence: null, p_released_by: null,
    });
  });

  it('refuses a store without save_vcon_batch', async () => {
    await expect(verifyWriterStore(store(MISSING, REFUSED))).rejects.toThrow('TENANT_MODE=writer needs save_vcon_batch');
  });

  it('refuses when save_vcon_batch cannot be confirmed', async () => {
    await expect(verifyWriterStore(store({ data: null, error: { code: '08006', message: 'connection failure' } }, REFUSED)))
      .rejects.toThrow('could not confirm save_vcon_batch: 08006: connection failure');
  });

  it('refuses a store without the keep-stored-tenant migration', async () => {
    await expect(verifyWriterStore(store(OK, MISSING))).rejects.toThrow('needs 20261112120000_keep_stored_tenant.sql');
    await expect(verifyWriterStore(store(OK, { data: null, error: { code: '42883', message: 'function does not exist' } })))
      .rejects.toThrow('needs 20261112120000_keep_stored_tenant.sql');
  });

  it('refuses when the release function answers with any other error', async () => {
    await expect(verifyWriterStore(store(OK, { data: null, error: { code: '42501', message: 'permission denied' } })))
      .rejects.toThrow('could not confirm 20261112120000_keep_stored_tenant.sql: 42501: permission denied');
  });
});
