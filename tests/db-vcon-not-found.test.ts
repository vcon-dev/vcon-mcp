/**
 * CON-1239: a missing vCon must surface as VConNotFoundError (REST -> 404),
 * not the raw PostgREST `.single()` error (REST -> 500). Other DB errors stay errors.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VConQueries } from '../src/db/queries.js';
import { _resetBatchWriterForTests } from '../src/db/batch-writer.js';
import { VConNotFoundError } from '../src/utils/errors.js';

const UUID = '11111111-1111-1111-1111-111111111111';

function makeSupabase(error: { code: string; message: string }) {
  const chain: any = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn().mockResolvedValue({ data: null, error });
  return { from: vi.fn(() => chain) } as any;
}

const NO_ROWS = { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' };

describe('missing vCon lookup', () => {
  beforeEach(() => _resetBatchWriterForTests());

  const cases: Array<[string, (q: VConQueries) => Promise<unknown>]> = [
    ['addDialog', q => q.addDialog(UUID, { type: 'text', start: new Date().toISOString(), parties: [0] } as any)],
    ['addAnalysis', q => q.addAnalysis(UUID, { type: 't', vendor: 'v', body: '{}', encoding: 'json' } as any)],
    ['addAttachment', q => q.addAttachment(UUID, { type: 't', body: 'x', encoding: 'none' } as any)],
    ['getTags', q => q.getTags(UUID)],
    ['addTag', q => q.addTag(UUID, 'k', 'v')],
    ['removeDialog (resolveVConId)', q => q.removeDialog(UUID, 0)],
  ];

  it.each(cases)('%s throws VConNotFoundError on PGRST116', async (_name, call) => {
    const q = new VConQueries(makeSupabase(NO_ROWS));
    const err = await call(q).catch(e => e);
    expect(err).toBeInstanceOf(VConNotFoundError);
    expect(err.message).toContain('not found');
  });

  it('keeps other database errors as errors', async () => {
    const dbError = { code: '57014', message: 'canceling statement due to statement timeout' };
    const q = new VConQueries(makeSupabase(dbError));
    const err = await q.getTags(UUID).catch(e => e);
    expect(err).not.toBeInstanceOf(VConNotFoundError);
    expect(err).toBe(dbError);
  });
});
