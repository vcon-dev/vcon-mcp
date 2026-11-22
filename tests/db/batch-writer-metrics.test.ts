/**
 * The batch commit counters carry no tenant label: tenants are unbounded, metrics are not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const recorded: Array<[string, Record<string, unknown>]> = [];
vi.mock('../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
  recordCounter: (name: string, _v: number, attrs: Record<string, unknown> = {}) => { recorded.push([name, attrs]); },
  recordHistogram: vi.fn(),
  withSpan: async (_n: string, fn: any) => fn({ setAttributes: vi.fn(), setAttribute: vi.fn() }),
}));

import { batchSaveVCon, BATCH_MAX_AGE_MS, _resetBatchWriterForTests } from '../../src/db/batch-writer.js';

afterEach(() => { _resetBatchWriterForTests(); recorded.length = 0; vi.useRealTimers(); });

describe('db.batch.commit', () => {
  it('has no tenant label', async () => {
    vi.useFakeTimers();
    const supabase: any = {
      from: vi.fn(() => ({ upsert: async () => ({ error: null }), insert: async () => ({ error: null }) })),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    };
    const p = batchSaveVCon(
      { vcon: '0.4.0', uuid: '00000000-0000-4000-8000-000000000001', created_at: new Date().toISOString(), parties: [{ name: 'A' }] } as any,
      'tenant-xyz', supabase, null
    );
    await vi.advanceTimersByTimeAsync(BATCH_MAX_AGE_MS + 1);
    await p;
    const commits = recorded.filter(([n]) => n === 'db.batch.commit');
    expect(commits.length).toBeGreaterThan(0);
    for (const [, attrs] of recorded) {
      expect(Object.keys(attrs)).not.toContain('tenant_id');
      expect(JSON.stringify(attrs)).not.toContain('tenant-xyz');
    }
  });
});
