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
import { _resetBatchWriterForTests } from '../src/db/batch-writer.js';

type Call = { op: string; args: any[] };

/**
 * `thenResult` is what any awaited chain (terminal `.select()`, `.delete()`,
 * `.insert()`, `.order()`) resolves to. `.single()` always resolves the vcons
 * id (resolveVConId); `.maybeSingle()` resolves an existing dialog row.
 */
function makeMock(thenResult: any = { data: [{ id: 'child-1' }], error: null }) {
  const calls: Call[] = [];
  const chain: any = {};
  const record = (op: string) => (...args: any[]) => { calls.push({ op, args }); return chain; };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'gte', 'lte', 'order', 'limit', 'in']) {
    chain[m] = vi.fn(record(m));
  }
  chain.single = vi.fn().mockResolvedValue({ data: { id: 'vid' }, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'did-1', type: 'recording' }, error: null });
  chain.then = (resolve: any) => resolve(thenResult);
  const supabase: any = { from: vi.fn((t: string) => { calls.push({ op: 'from', args: [t] }); return chain; }) };
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

  it('updateDialog updates the dialog row and rewrites party_history', async () => {
    const { supabase, calls } = makeMock();
    const q = new VConQueries(supabase);
    await q.updateDialog(UUID, 0, {
      type: 'text', body: 'hi', parties: [0, 1],
      party_history: [{ party: 0, time: '2026-01-01T00:00:00Z', event: 'join' }],
    });
    const tables = tablesTouched(calls);
    expect(tables).toContain('dialog');
    expect(tables).toContain('party_history');
    expect(payloadsOf(calls, 'delete').length).toBeGreaterThan(0);  // party_history cleared first
    const ph = payloadsOf(calls, 'insert').find((r: any) => Array.isArray(r) && r[0]?.event);
    expect(ph[0]).toMatchObject({ party_index: 0, event: 'join' });
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

  it('removeAnalysis hard-deletes and reinserts shifted rows (compaction)', async () => {
    const { supabase, calls } = makeMock({ data: [{ analysis_index: 0 }, { analysis_index: 1 }], error: null });
    const q = new VConQueries(supabase);
    await q.removeAnalysis(UUID, 0);
    expect(payloadsOf(calls, 'delete').length).toBeGreaterThan(0);
    const reinserted = payloadsOf(calls, 'insert').find((r: any) => Array.isArray(r));
    expect(reinserted).toEqual([{ analysis_index: 0 }]);   // old index 1 shifted to 0
  });

  it('removeAttachment hard-deletes (compaction path)', async () => {
    const { supabase, calls } = makeMock({ data: [{ attachment_index: 0 }], error: null });
    const q = new VConQueries(supabase);
    await q.removeAttachment(UUID, 0);
    expect(tablesTouched(calls)).toContain('attachments');
    expect(payloadsOf(calls, 'delete').length).toBeGreaterThan(0);
  });

  it('removeAnalysis throws when the index is absent', async () => {
    const { supabase } = makeMock({ data: [{ analysis_index: 5 }], error: null });
    const q = new VConQueries(supabase);
    await expect(q.removeAnalysis(UUID, 0)).rejects.toThrow();
  });
});
