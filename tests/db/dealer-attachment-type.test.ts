/**
 * Every dealer RPC must receive the configured dealer attachment type, so search
 * filters and aggregates read the same attachments as vcon_fetch and vcon_taxonomy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VConQueries } from '../../src/db/queries.js';

vi.mock('../../src/observability/instrumentation.js', () => ({
  withSpan: vi.fn((_name: string, fn: any) => fn({ setAttributes: vi.fn(), setStatus: vi.fn() })),
  recordCounter: vi.fn(),
  recordHistogram: vi.fn(),
  logWithContext: vi.fn(),
  attachErrorToSpan: vi.fn(),
}));

function fakeSupabase() {
  const builder = (): any => {
    const b: any = {};
    for (const m of ['select', 'ilike', 'gte', 'lte', 'order', 'range', 'in', 'eq', 'not', 'limit']) {
      b[m] = () => b;
    }
    b.then = (resolve: any, reject: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject);
    return b;
  };
  return {
    from: vi.fn(() => builder()),
    rpc: vi.fn(async (name: string) => ({ data: name.startsWith('count_') ? 1 : [], error: null })),
  } as any;
}

const DEALER_RPCS = [
  'vcon_uuids_for_dealer_filter',
  'count_vcons_for_dealer_filter',
  'count_vcons_tags_and_dealer',
  'aggregate_vcons_by_dealer_stats',
];

async function exerciseDealerRpcs(queries: VConQueries) {
  await queries.searchVCons({ dealerId: '7', subject: 'x' }).catch(() => undefined);
  await queries.searchVConsCount({ dealerId: '7' });
  await queries.searchVConsCount({ dealerId: '7', tags: { a: 'b' } });
  await queries.aggregateVconsByDealerStats({ tagFilter: {}, minBaseline: 1, limit: 5 });
}

describe('dealer RPCs receive the configured attachment type', () => {
  let saved: string | undefined;
  let supabase: any;
  let queries: VConQueries;

  beforeEach(() => {
    saved = process.env.VCON_DEALER_ATTACHMENT_TYPE;
    supabase = fakeSupabase();
    queries = new VConQueries(supabase);
    vi.spyOn(queries, 'getVCon').mockImplementation(async (uuid: string) => ({ uuid } as any));
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.VCON_DEALER_ATTACHMENT_TYPE;
    else process.env.VCON_DEALER_ATTACHMENT_TYPE = saved;
  });

  it.each([
    ['default', undefined, 'dealer'],
    ['configured', 'example_dealer', 'example_dealer'],
  ])('%s type', async (_label, envValue, expected) => {
    if (envValue === undefined) delete process.env.VCON_DEALER_ATTACHMENT_TYPE;
    else process.env.VCON_DEALER_ATTACHMENT_TYPE = envValue;

    await exerciseDealerRpcs(queries);

    const called = supabase.rpc.mock.calls.filter((c: any[]) => DEALER_RPCS.includes(c[0]));
    expect(new Set(called.map((c: any[]) => c[0]))).toEqual(new Set(DEALER_RPCS));
    for (const [name, args] of called) {
      expect({ name, type: args.p_attachment_type }).toEqual({ name, type: expected });
    }
  });
});
