/**
 * CON-1243: the "RPC missing, using non-atomic fallback" warning describes the
 * deployment, so it must be logged once per process, not on every removal.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/observability/instrumentation.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, logWithContext: vi.fn() };
});

import { logWithContext } from '../src/observability/instrumentation.js';
import { VConQueries, _resetCompactionFallbackWarningForTests } from '../src/db/queries.js';
import { _resetBatchWriterForTests } from '../src/db/batch-writer.js';

const UUID = '11111111-1111-1111-1111-111111111111';

function makeSupabase() {
  const rows = [{ id: 'a0', analysis_index: 0 }];
  const chain: any = {};
  for (const m of ['select', 'delete', 'update', 'eq', 'gte', 'order']) chain[m] = vi.fn(() => chain);
  chain.single = vi.fn().mockResolvedValue({ data: { id: 'vid' }, error: null });
  chain.then = (resolve: any) => resolve({ data: rows, error: null });
  return {
    from: vi.fn(() => chain),
    rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
  } as any;
}

describe('compaction fallback warning', () => {
  beforeEach(() => {
    _resetBatchWriterForTests();
    _resetCompactionFallbackWarningForTests();
    vi.mocked(logWithContext).mockClear();
  });

  it('logs once across two fallback removals, and still falls back both times', async () => {
    const supabase = makeSupabase();
    const q = new VConQueries(supabase);
    await q.removeAnalysis(UUID, 0);
    await q.removeAnalysis(UUID, 0);

    const warns = vi.mocked(logWithContext).mock.calls.filter(
      c => c[0] === 'warn' && String(c[1]).includes('remove_vcon_child_and_compact'),
    );
    expect(warns).toHaveLength(1);
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.from.mock.calls.filter((c: any[]) => c[0] === 'analysis').length).toBeGreaterThanOrEqual(2);
  });
});
