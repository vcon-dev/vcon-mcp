import { describe, it, expect } from 'vitest';
import { collectTextUnits, LookupError } from '../supabase/functions/embed-vcons/lookup.js';

const ok = (data: unknown[]) => ({ data, error: null });
const fail = (message: string) => ({ data: null, error: { message } });

describe('embed-vcons lookup aggregation (CON-1072)', () => {
  it('throws when any lookup query errors instead of returning an empty list', () => {
    expect(() => collectTextUnits([ok([]), fail('connection refused'), ok([])], 10)).toThrow(LookupError);
  });

  it('reports every error message', () => {
    try {
      collectTextUnits([fail('a down'), ok([]), fail('c down')], 10);
      expect.unreachable();
    } catch (e) {
      expect((e as LookupError).messages).toEqual(['a down', 'c down']);
    }
  });

  it('does not return partial units when one query errors', () => {
    expect(() => collectTextUnits([ok([{ id: 1 }]), fail('boom'), ok([])], 10)).toThrow();
  });

  it('returns an empty list only when all queries succeed empty', () => {
    expect(collectTextUnits([ok([]), ok([]), ok([])], 10)).toEqual([]);
  });

  it('merges and caps at limit', () => {
    expect(collectTextUnits([ok([1, 2]), ok([3]), ok([4])], 3)).toEqual([1, 2, 3]);
  });
});
