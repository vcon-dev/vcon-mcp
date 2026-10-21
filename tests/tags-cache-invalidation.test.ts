/**
 * Issue #102: tag writes must invalidate the Redis vCon cache, and every reader of
 * vcon_tags_mv must follow one staleness policy (src/db/tags-mv.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VConQueries } from '../src/db/queries.js';
import {
  refreshTagsMvIfStale,
  markTagsMvDirty,
  TAGS_MV_MIN_REFRESH_INTERVAL_MS,
} from '../src/db/tags-mv.js';

const UUID = '11111111-1111-4111-8111-111111111111';

function makeSupabase(opts: { existingTags?: string[] } = {}) {
  const rpc = vi.fn(async () => ({ data: [], error: null }));
  const from = vi.fn((table: string) => {
    const b: any = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'update', 'insert', 'delete', 'in', 'neq', 'gt', 'gte', 'lt', 'lte', 'range']) {
      b[m] = vi.fn(() => b);
    }
    b.single = vi.fn(async () => ({ data: { id: 'vcon-id-1' }, error: null }));
    b.then = (resolve: any) => {
      let data: any = [];
      if (table === 'attachments' && opts.existingTags) {
        data = [{ id: 'att-1', encoding: 'json', attachment_index: 0, body: JSON.stringify(opts.existingTags) }];
      }
      return resolve({ data, error: null });
    };
    return b;
  });
  return { from, rpc } as any;
}

function makeRedis() {
  return { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) } as any;
}

describe('tag writes invalidate the vCon cache (#102)', () => {
  let redis: any;
  let supabase: any;
  let queries: VConQueries;

  beforeEach(() => {
    redis = makeRedis();
    supabase = makeSupabase({ existingTags: ['a:1', 'b:2'] });
    queries = new VConQueries(supabase, redis);
  });

  it('addTag (manage_tag set) deletes the cached vCon', async () => {
    await queries.addTag(UUID, 'c', '3');
    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(redis.del.mock.calls[0][0]).toContain(UUID);
  });

  it('removeTag (manage_tag remove) deletes the cached vCon', async () => {
    await queries.removeTag(UUID, 'a');
    expect(redis.del).toHaveBeenCalledTimes(1);
  });

  it('updateTags deletes the cached vCon', async () => {
    await queries.updateTags(UUID, { z: '9' });
    expect(redis.del).toHaveBeenCalledTimes(1);
  });

  it('removeAllTags deletes the cached vCon', async () => {
    await queries.removeAllTags(UUID);
    expect(redis.del).toHaveBeenCalledTimes(1);
  });

  it('addAttachment of a tags attachment deletes the cached vCon', async () => {
    await queries.addAttachment(UUID, { type: 'tags', encoding: 'json', body: '["a:1"]' } as any);
    expect(redis.del).toHaveBeenCalledTimes(1);
  });

  it('updateAttachment and removeAttachment delete the cached vCon', async () => {
    // update path needs a returned row from .select('id')
    const sb = makeSupabase();
    const orig = sb.from;
    sb.from = vi.fn((t: string) => {
      const b = orig(t);
      const origThen = b.then;
      b.then = (resolve: any) => origThen((r: any) => resolve({ ...r, data: r.data.length ? r.data : [{ id: 'x' }] }));
      return b;
    });
    const r = makeRedis();
    const q = new VConQueries(sb, r);
    await q.updateAttachment(UUID, 0, { type: 'tags', encoding: 'json', body: '[]' } as any);
    await q.removeAttachment(UUID, 0);
    expect(r.del).toHaveBeenCalledTimes(2);
  });
});

describe('vcon_tags_mv refresh policy (#102)', () => {
  beforeEach(() => vi.useRealTimers());

  it('throttles the staleness probe between reads', async () => {
    const sb = makeSupabase();
    await refreshTagsMvIfStale(sb); // first read always probes
    await refreshTagsMvIfStale(sb);
    await refreshTagsMvIfStale(sb);
    expect(sb.rpc).toHaveBeenCalledTimes(1);
    expect(sb.rpc).toHaveBeenCalledWith('refresh_vcon_tags_mv_if_stale');
  });

  it('re-probes after the interval elapses', async () => {
    vi.useFakeTimers();
    const sb = makeSupabase();
    await refreshTagsMvIfStale(sb);
    vi.advanceTimersByTime(TAGS_MV_MIN_REFRESH_INTERVAL_MS + 1);
    await refreshTagsMvIfStale(sb);
    expect(sb.rpc).toHaveBeenCalledTimes(2);
  });

  it('a tag write makes the next read refresh, and never refreshes during the write', async () => {
    const sb = makeSupabase({ existingTags: ['a:1'] });
    const q = new VConQueries(sb, makeRedis());
    await refreshTagsMvIfStale(sb);
    sb.rpc.mockClear();
    await q.addTag(UUID, 'k', 'v');
    expect(sb.rpc).not.toHaveBeenCalled();
    await refreshTagsMvIfStale(sb);
    expect(sb.rpc).toHaveBeenCalledWith('refresh_vcon_tags_mv_if_stale');
  });

  it('a failed probe is retried on the next read', async () => {
    const sb = makeSupabase();
    sb.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await refreshTagsMvIfStale(sb);
    await refreshTagsMvIfStale(sb);
    expect(sb.rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['searchByTags', (q: VConQueries) => q.searchByTags({ a: '1' })],
    ['searchByTagsAndDate', (q: VConQueries) => q.searchByTagsAndDate({ a: '1' }, undefined, undefined)],
    ['getUniqueTags', (q: VConQueries) => q.getUniqueTags()],
    ['getVconShapeGraph', (q: VConQueries) => q.getVconShapeGraph()],
  ])('%s probes the view before reading it', async (_n, call) => {
    const sb = makeSupabase();
    markTagsMvDirty(sb);
    await Promise.resolve(call(new VConQueries(sb))).catch(() => {});
    expect(sb.rpc).toHaveBeenCalledWith('refresh_vcon_tags_mv_if_stale');
  });
});
