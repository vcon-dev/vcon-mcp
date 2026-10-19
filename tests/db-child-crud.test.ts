/**
 * Supabase query tests for the index-addressed child CRUD methods
 * (update/remove dialog/analysis/attachment, add/update/remove party).
 *
 * Uses a tailored chainable mock so we can assert the operation TYPE (update vs
 * delete), the target table, and payload shaping (PUT-null clearing, column
 * remapping, placeholder columns) without a live database.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VConQueries } from '../src/db/queries.js';
import { _resetBatchWriterForTests, assembleVCon } from '../src/db/batch-writer.js';
import { ChildIndexError } from '../src/utils/vcon-children.js';

type Call = { op: string; args: any[] };

/**
 * `thenResult` is what any awaited chain (terminal `.select()`, `.delete()`,
 * `.insert()`, `.order()`) resolves to. `.single()` always resolves the vcons
 * id (resolveVConId); `.maybeSingle()` resolves an existing dialog row.
 */
function makeMock(
  thenResult: any = { data: [{ id: 'child-1' }], error: null },
  rpcResult: any = { data: null, error: null },
) {
  const calls: Call[] = [];
  const chain: any = {};
  const record = (op: string) => (...args: any[]) => { calls.push({ op, args }); return chain; };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'gte', 'lte', 'order', 'limit', 'in']) {
    chain[m] = vi.fn(record(m));
  }
  chain.single = vi.fn().mockResolvedValue({ data: { id: 'vid' }, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'did-1', type: 'recording' }, error: null });
  chain.then = (resolve: any) => resolve(thenResult);
  const supabase: any = {
    from: vi.fn((t: string) => { calls.push({ op: 'from', args: [t] }); return chain; }),
    rpc: vi.fn((fn: string, args: any) => { calls.push({ op: 'rpc', args: [fn, args] }); return Promise.resolve(rpcResult); }),
  };
  return { supabase, calls };
}

const tablesTouched = (calls: Call[]) => calls.filter(c => c.op === 'from').map(c => c.args[0]);
const payloadsOf = (calls: Call[], op: string) => calls.filter(c => c.op === op).map(c => c.args[0]);

const UUID = '11111111-1111-1111-1111-111111111111';

describe('Supabase child CRUD', () => {
  beforeEach(() => _resetBatchWriterForTests());

  it('addParty inserts into parties and returns the next index', async () => {
    // resolveVConId.single -> {id}, then MAX(party_index) select -> [] (thenResult.data),
    // so nextIndex falls back to 0.
    const { supabase, calls } = makeMock({ data: [], error: null });
    const q = new VConQueries(supabase);
    const res = await q.addParty(UUID, { name: 'Dave' });
    expect(res.index).toBe(0);
    expect(tablesTouched(calls)).toContain('parties');
    expect(payloadsOf(calls, 'insert')[0]).toMatchObject({ party_index: 0, name: 'Dave', vcon_id: 'vid' });
  });

  it('updateParty UPDATEs (not deletes) and nulls omitted fields (PUT)', async () => {
    const { supabase, calls } = makeMock();
    const q = new VConQueries(supabase);
    await q.updateParty(UUID, 1, { name: 'Bob2' });
    expect(payloadsOf(calls, 'delete')).toHaveLength(0);
    const p = payloadsOf(calls, 'update')[0];
    expect(p.name).toBe('Bob2');
    expect(p.tel).toBeNull();          // omitted -> cleared
    expect(p.mailto).toBeNull();
    expect(p).not.toHaveProperty('vcon_id');     // identity columns stripped from SET
    expect(p).not.toHaveProperty('party_index');
  });

  it('removeParty writes an empty placeholder via UPDATE (no delete, no renumber)', async () => {
    const { supabase, calls } = makeMock();
    const q = new VConQueries(supabase);
    await q.removeParty(UUID, 0);
    expect(payloadsOf(calls, 'delete')).toHaveLength(0);
    const p = payloadsOf(calls, 'update')[0];
    expect(p.name).toBeNull();
    expect(p.tel).toBeNull();
  });

  it('removeParty with anonymize writes {name:"anonymous"}', async () => {
    const { supabase, calls } = makeMock();
    const q = new VConQueries(supabase);
    await q.removeParty(UUID, 0, { anonymize: true });
    expect(payloadsOf(calls, 'update')[0].name).toBe('anonymous');
  });

  it('updateAnalysis maps dialog->dialog_indices and serializes body', async () => {
    const { supabase, calls } = makeMock();
    const q = new VConQueries(supabase);
    // encoding 'none' with an object body -> serializeBody stringifies it.
    await q.updateAnalysis(UUID, 2, { type: 'summary', vendor: 'V', dialog: 3, body: { a: 1 }, encoding: 'none' });
    expect(tablesTouched(calls)).toContain('analysis');
    const p = payloadsOf(calls, 'update')[0];
    expect(p.dialog_indices).toEqual([3]);
    expect(p.vendor).toBe('V');
    expect(p.body).toBe('{"a":1}');               // serialized for encoding 'none'
  });

  it('updateAttachment maps mediatype->mimetype', async () => {
    const { supabase, calls } = makeMock();
    const q = new VConQueries(supabase);
    await q.updateAttachment(UUID, 0, { purpose: 'doc', mediatype: 'text/plain', body: 'x', encoding: 'none' });
    const p = payloadsOf(calls, 'update')[0];
    expect(p.mimetype).toBe('text/plain');
    expect(p.purpose).toBe('doc');
  });

  it('updateDialog carries party_history in extra and only clears the legacy table', async () => {
    const { supabase, calls } = makeMock();
    const q = new VConQueries(supabase);
    const history = [{ party: 0, time: '2026-01-01T00:00:00Z', event: 'join' as const }];
    await q.updateDialog(UUID, 0, { type: 'text', body: 'hi', parties: [0, 1], party_history: history });
    const p = payloadsOf(calls, 'update')[0];
    expect(p.extra).toEqual({ party_history: history });
    // legacy party_history rows are deleted, never re-inserted (CON-1243)
    expect(tablesTouched(calls)).toContain('party_history');
    expect(payloadsOf(calls, 'insert')).toHaveLength(0);
  });

  it('addDialog writes party_history once, in dialog.extra, and it round-trips through assembleVCon', async () => {
    const { supabase, calls } = makeMock({ data: [], error: null });
    const q = new VConQueries(supabase);
    const history = [
      { party: 0, time: '2026-01-01T00:00:00Z', event: 'join' as const },
      { party: 1, time: '2026-01-01T00:01:00Z', event: 'drop' as const },
    ];
    await q.addDialog(UUID, { type: 'text', body: 'hi', encoding: 'none', parties: [0, 1], party_history: history });

    expect(tablesTouched(calls)).not.toContain('party_history');
    const inserts = payloadsOf(calls, 'insert');
    expect(inserts).toHaveLength(1);
    const row = inserts[0];
    expect(row.extra).toEqual({ party_history: history });

    // getVCon assembles from the dialog row alone (it never selects party_history)
    const vcon = assembleVCon({ uuid: UUID }, [], [row], [], []);
    expect(vcon.dialog?.[0].party_history).toEqual(history);
  });

  it('removeDialog keeps type, nulls content, and clears party_history', async () => {
    const { supabase, calls } = makeMock();
    const q = new VConQueries(supabase);
    await q.removeDialog(UUID, 0);
    const p = payloadsOf(calls, 'update')[0];
    expect(p.type).toBe('recording');   // from maybeSingle existing row
    expect(p.body).toBeNull();
    expect(p.parties).toBeNull();
    expect(tablesTouched(calls)).toContain('party_history');
  });

  it('removeAnalysis compacts atomically through the RPC with the right args', async () => {
    const { supabase, calls } = makeMock();
    const q = new VConQueries(supabase);
    await q.removeAnalysis(UUID, 2);
    expect(supabase.rpc).toHaveBeenCalledWith('remove_vcon_child_and_compact', {
      p_table: 'analysis', p_vcon_id: 'vid', p_index: 2,
    });
    // nothing done client-side on the analysis table
    expect(payloadsOf(calls, 'delete')).toHaveLength(0);
    expect(payloadsOf(calls, 'insert')).toHaveLength(0);
    expect(payloadsOf(calls, 'update')).toHaveLength(0);
  });

  it('removeAttachment compacts through the RPC on the attachments table', async () => {
    const { supabase } = makeMock();
    const q = new VConQueries(supabase);
    await q.removeAttachment(UUID, 0);
    expect(supabase.rpc).toHaveBeenCalledWith('remove_vcon_child_and_compact', {
      p_table: 'attachments', p_vcon_id: 'vid', p_index: 0,
    });
  });

  it('maps the RPC not-found error (P0002) to ChildIndexError', async () => {
    const { supabase } = makeMock(undefined, { data: null, error: { code: 'P0002', message: 'analysis index 9 not found' } });
    const q = new VConQueries(supabase);
    await expect(q.removeAnalysis(UUID, 9)).rejects.toBeInstanceOf(ChildIndexError);
  });

  it('an RPC failure propagates with no client-side writes and no fallback', async () => {
    const boom = { code: '23505', message: 'duplicate key' };
    const { supabase, calls } = makeMock(undefined, { data: null, error: boom });
    const q = new VConQueries(supabase);
    await expect(q.removeAnalysis(UUID, 0)).rejects.toBe(boom);
    expect(tablesTouched(calls)).not.toContain('analysis');
    expect(payloadsOf(calls, 'delete')).toHaveLength(0);
    expect(payloadsOf(calls, 'insert')).toHaveLength(0);
  });

  it('falls back when the RPC is missing (PGRST202): deletes only the target, shifts the rest by UPDATE', async () => {
    const rows = [
      { id: 'a0', analysis_index: 0 },
      { id: 'a1', analysis_index: 1 },
      { id: 'a2', analysis_index: 2 },
    ];
    const { supabase, calls } = makeMock(
      { data: rows, error: null },
      { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } },
    );
    const q = new VConQueries(supabase);
    await q.removeAnalysis(UUID, 0);
    // the only delete is by the target row's id, never a >= range
    expect(calls.filter(c => c.op === 'delete')).toHaveLength(1);
    expect(calls.some(c => c.op === 'gte' && calls.indexOf(c) > calls.findIndex(d => d.op === 'delete'))).toBe(false);
    expect(calls).toContainEqual({ op: 'eq', args: ['id', 'a0'] });
    // later rows shift down one at a time, ascending, with no reinsert
    expect(payloadsOf(calls, 'update')).toEqual([{ analysis_index: 0 }, { analysis_index: 1 }]);
    expect(payloadsOf(calls, 'insert')).toHaveLength(0);
  });

  it('fallback stops on a failed shift without deleting any row but the target', async () => {
    // Old path: delete the whole >= index range, then reinsert. A failed reinsert lost rows.
    const rows = [{ id: 'a0', analysis_index: 0 }, { id: 'a1', analysis_index: 1 }];
    const { supabase, calls } = makeMock(
      { data: rows, error: null },
      { data: null, error: { code: '42883', message: 'function does not exist' } },
    );
    const q = new VConQueries(supabase);
    const chain = supabase.from('analysis');
    calls.length = 0;
    const origUpdate = chain.update;
    chain.update = vi.fn((...args: any[]) => {
      origUpdate(...args);
      return { eq: () => Promise.resolve({ data: null, error: { message: 'update failed' } }) };
    });
    await expect(q.removeAnalysis(UUID, 0)).rejects.toMatchObject({ message: 'update failed' });
    expect(calls.filter(c => c.op === 'delete')).toHaveLength(1);
    expect(calls).toContainEqual({ op: 'eq', args: ['id', 'a0'] });
    expect(payloadsOf(calls, 'insert')).toHaveLength(0);
  });

  it('fallback throws ChildIndexError when the index is absent', async () => {
    const { supabase } = makeMock(
      { data: [{ id: 'a5', analysis_index: 5 }], error: null },
      { data: null, error: { code: 'PGRST202', message: 'missing' } },
    );
    const q = new VConQueries(supabase);
    await expect(q.removeAnalysis(UUID, 0)).rejects.toBeInstanceOf(ChildIndexError);
  });
});
