/**
 * Tests for the batched vCon writer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import {
  batchSaveVCon,
  buildVconRow,
  buildPartyRows,
  buildDialogRows,
  buildAnalysisRows,
  buildAttachmentRows,
  BATCH_SIZE,
  BATCH_MAX_AGE_MS,
  _resetBatchWriterForTests,
  _flushNowForTests,
  vconCacheKey,
} from '../../src/db/batch-writer.js';
import { VCon } from '../../src/types/vcon.js';

function makeVcon(overrides: Partial<VCon> = {}): VCon {
  return {
    vcon: '0.4.0',
    uuid: randomUUID(),
    created_at: new Date('2025-01-01T00:00:00Z').toISOString(),
    parties: [{ name: 'A' }, { name: 'B' }],
    dialog: [{
      type: 'text',
      body: 'hi',
      encoding: 'none',
    }],
    analysis: [{
      type: 'summary',
      vendor: 'X',
      body: 'ok',
      encoding: 'none',
    }],
    attachments: [{
      type: 'doc',
      body: 'd',
      encoding: 'none',
    }],
    ...overrides,
  };
}

type RpcArgs = {
  p_vcons: any[];
  p_parties: any[];
  p_dialog: any[];
  p_analysis: any[];
  p_attachments: any[];
};

/**
 * Supabase mock. `rpcError(args)` decides the save_vcon_batch result per call,
 * so a test can fail any batch that contains a given vCon. Table writes are
 * recorded too, so a test can assert none happened.
 */
function makeMockSupabase(rpcError: (args: RpcArgs) => unknown = () => null) {
  const calls: Record<string, any[][]> = {};
  const rpcCalls: Array<[string, RpcArgs]> = [];
  const fromMock = vi.fn((table: string) => {
    calls[table] = calls[table] || [];
    const ok = Promise.resolve({ data: null, error: null });
    return {
      upsert: vi.fn((rows: any[], opts?: any) => {
        calls[table].push([rows, opts, 'upsert']);
        return ok;
      }),
      insert: vi.fn((rows: any[]) => {
        calls[table].push([rows, undefined, 'insert']);
        return ok;
      }),
    };
  });
  const rpcMock = vi.fn((fn: string, args: RpcArgs) => {
    rpcCalls.push([fn, args]);
    return Promise.resolve({ data: null, error: rpcError(args) });
  });
  return { from: fromMock, rpc: rpcMock, _calls: calls, _rpcCalls: rpcCalls } as any;
}

describe('batch-writer', () => {
  beforeEach(() => {
    _resetBatchWriterForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetBatchWriterForTests();
  });

  describe('row builders', () => {
    it('omits created_at from every child row payload', () => {
      const v = makeVcon();
      const parties = buildPartyRows(v, null);
      const dialog = buildDialogRows(v, null);
      const analysis = buildAnalysisRows(v, null);
      const attachments = buildAttachmentRows(v, null);

      for (const r of [...parties, ...dialog, ...analysis, ...attachments]) {
        expect(r).not.toHaveProperty('created_at');
      }
    });

    it('preserves vcon.created_at on the parent vcons row', () => {
      const v = makeVcon();
      const row = buildVconRow(v, 'tenant-1');
      expect(row.created_at).toBe(v.created_at);
      expect(row.id).toBe(v.uuid);
      expect(row.tenant_id).toBe('tenant-1');
    });
  });

  describe('coalescing', () => {
    it('coalesces two parallel saves into a single batch (one RPC)', async () => {
      vi.useFakeTimers();
      const supabase = makeMockSupabase();

      const v1 = makeVcon();
      const v2 = makeVcon();

      const p1 = batchSaveVCon(v1, null, supabase, null);
      const p2 = batchSaveVCon(v2, null, supabase, null);

      // Trigger the timer-based flush.
      await vi.advanceTimersByTimeAsync(BATCH_MAX_AGE_MS + 1);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.uuid).toBe(v1.uuid);
      expect(r2.uuid).toBe(v2.uuid);

      // One RPC per batch, carrying both vCons and all their children.
      expect(supabase._rpcCalls).toHaveLength(1);
      const [, args] = supabase._rpcCalls[0];
      expect(args.p_vcons.map((r: any) => r.id)).toEqual([v1.uuid, v2.uuid]);
      expect(args.p_parties).toHaveLength(4);
      expect(args.p_dialog).toHaveLength(2);
      expect(args.p_analysis).toHaveLength(2);
      expect(args.p_attachments).toHaveLength(2);
    });
  });

  describe('size-based flush', () => {
    it('flushes immediately when buffer reaches BATCH_SIZE', async () => {
      const supabase = makeMockSupabase();

      const promises: Promise<any>[] = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        promises.push(batchSaveVCon(makeVcon(), null, supabase, null));
      }
      // No timer advance — should flush on size.
      await Promise.all(promises);

      expect(supabase._rpcCalls).toHaveLength(1);
      expect(supabase._rpcCalls[0][1].p_vcons).toHaveLength(BATCH_SIZE);
    });
  });

  describe('error propagation', () => {
    it('rejects every pending promise when every vCon fails', async () => {
      const supabase = makeMockSupabase(() => new Error('boom'));

      const v1 = batchSaveVCon(makeVcon(), null, supabase, null);
      const v2 = batchSaveVCon(makeVcon(), null, supabase, null);
      await _flushNowForTests(null);

      await expect(v1).rejects.toThrow('boom');
      await expect(v2).rejects.toThrow('boom');
    });
  });

  // CON-957: a vCon create was split across one PostgREST call per table, so a
  // failed dialog insert left the vcons row, parties and attachments committed
  // while the caller got a 500. A flush must write each vCon in one transaction.
  describe('atomic create (CON-957)', () => {
    it('writes vCon and children through save_vcon_batch, with no direct table writes', async () => {
      const supabase = makeMockSupabase();
      const v = makeVcon();

      const p = batchSaveVCon(v, 'tenant-1', supabase, null);
      await _flushNowForTests('tenant-1');
      await expect(p).resolves.toEqual({ uuid: v.uuid, id: v.uuid });

      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      const [fn, args] = supabase._rpcCalls[0];
      expect(fn).toBe('save_vcon_batch');
      // Same rows the builders produce, so column mapping is unchanged.
      expect(args).toEqual({
        p_vcons: [buildVconRow(v, 'tenant-1')].map(r => ({ ...r, updated_at: expect.any(String) })),
        p_parties: buildPartyRows(v, 'tenant-1'),
        p_dialog: buildDialogRows(v, 'tenant-1'),
        p_analysis: buildAnalysisRows(v, 'tenant-1'),
        p_attachments: buildAttachmentRows(v, 'tenant-1'),
      });
    });

    it('rejects the caller when the child write fails, without falling back to table writes', async () => {
      const dialogError = { code: '54000', message: 'string is too long for tsvector' };
      const supabase = makeMockSupabase(() => dialogError);

      const p = batchSaveVCon(makeVcon(), null, supabase, null);
      await _flushNowForTests(null);

      await expect(p).rejects.toBe(dialogError);
      // Nothing written outside the (rolled back) transaction.
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('commits the good vCon and rejects only the bad one when a batch fails', async () => {
      const bad = makeVcon({ dialog: [{ type: 'text', body: 'POISON', encoding: 'none' }] });
      const good = makeVcon();
      const dialogError = { code: '54000', message: 'string is too long for tsvector' };
      const supabase = makeMockSupabase(args =>
        args.p_dialog.some((d: any) => d.body === 'POISON') ? dialogError : null
      );
      const redis = { del: vi.fn(() => Promise.resolve(1)) };

      const pBad = batchSaveVCon(bad, null, supabase, redis as any);
      const pGood = batchSaveVCon(good, null, supabase, redis as any);
      await _flushNowForTests(null);

      await expect(pGood).resolves.toEqual({ uuid: good.uuid, id: good.uuid });
      await expect(pBad).rejects.toBe(dialogError);

      // Batch attempt, then one retry per vCon.
      const vconIdsPerCall = supabase._rpcCalls.map(([, a]: [string, RpcArgs]) => a.p_vcons.map(r => r.id));
      expect(vconIdsPerCall).toEqual([[bad.uuid, good.uuid], [bad.uuid], [good.uuid]]);
      expect(supabase.from).not.toHaveBeenCalled();
      // Only the committed vCon's cache entry is invalidated.
      expect(redis.del).toHaveBeenCalledTimes(1);
      expect(redis.del).toHaveBeenCalledWith(vconCacheKey(good.uuid));
    });

    it('falls back to per-table writes when the RPC is not deployed', async () => {
      const supabase = makeMockSupabase(() => ({ code: 'PGRST202', message: 'Could not find the function' }));
      const v = makeVcon();

      const p = batchSaveVCon(v, null, supabase, null);
      await _flushNowForTests(null);
      await expect(p).resolves.toEqual({ uuid: v.uuid, id: v.uuid });

      expect(supabase._calls['vcons'][0][0]).toHaveLength(1);
      expect(supabase._calls['dialog'][0][1]).toEqual({ onConflict: 'vcon_id,dialog_index' });
    });
  });

  // The RPC is "missing" only when save_vcon_batch itself is absent. A 42883
  // raised inside the function body (a trigger calling a missing function)
  // must reject, not silently drop to the non-atomic path.
  describe('missing-RPC detection', () => {
    it('rejects on a 42883 that does not name save_vcon_batch (no fallback)', async () => {
      const err = { code: '42883', message: 'function public.some_trigger_helper(text) does not exist' };
      const supabase = makeMockSupabase(() => err);

      const p = batchSaveVCon(makeVcon(), null, supabase, null);
      await _flushNowForTests(null);

      await expect(p).rejects.toBe(err);
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('falls back on a 42883 that names save_vcon_batch', async () => {
      const supabase = makeMockSupabase(() => ({
        code: '42883',
        message: 'function save_vcon_batch(jsonb, jsonb, jsonb, jsonb, jsonb) does not exist',
      }));

      const p = batchSaveVCon(makeVcon(), null, supabase, null);
      await _flushNowForTests(null);

      await expect(p).resolves.toBeDefined();
      expect(supabase._calls['vcons']).toHaveLength(1);
    });

    it('legacy fallback writes and resolves both vCons of a 2-vCon batch', async () => {
      const supabase = makeMockSupabase(() => ({ code: 'PGRST202', message: 'Could not find the function' }));
      const v1 = makeVcon();
      const v2 = makeVcon();

      const p1 = batchSaveVCon(v1, 'tenant-L', supabase, null);
      const p2 = batchSaveVCon(v2, 'tenant-L', supabase, null);
      await _flushNowForTests('tenant-L');

      await expect(p1).resolves.toEqual({ uuid: v1.uuid, id: v1.uuid });
      await expect(p2).resolves.toEqual({ uuid: v2.uuid, id: v2.uuid });
      // One RPC attempt, no per-vCon RPC retries, then one upsert per table for both.
      expect(supabase._rpcCalls).toHaveLength(1);
      expect(supabase._calls['vcons'][0][0].map((r: any) => r.id)).toEqual([v1.uuid, v2.uuid]);
      expect(supabase._calls['parties'][0][0]).toHaveLength(4);
      for (const t of ['parties', 'dialog', 'analysis', 'attachments']) {
        expect(supabase._calls[t]).toHaveLength(1);
        expect(supabase._calls[t][0][0].every((r: any) => r.tenant_id === 'tenant-L')).toBe(true);
      }
    });
  });

  // CON-1177: ~35% of parties rows had NULL tenant_id under a tenanted vCon.
  // The rows relied on a BEFORE INSERT trigger that copied whatever
  // vcons.tenant_id it could see, and re-posts never touched tenant_id because
  // it was not a column in the upsert (so not in ON CONFLICT ... SET).
  describe('child tenant_id (CON-1177)', () => {
    const CHILD_KEYS = ['p_parties', 'p_dialog', 'p_analysis', 'p_attachments'] as const;

    function childRows(args: RpcArgs) {
      return CHILD_KEYS.flatMap(k => args[k]);
    }

    it('stamps every child row with the parent tenant_id on create', async () => {
      const supabase = makeMockSupabase();
      const v = makeVcon();

      const p = batchSaveVCon(v, 'tenant-T', supabase, null);
      await _flushNowForTests('tenant-T');
      await p;

      const [, args] = supabase._rpcCalls[0];
      expect(args.p_vcons[0].tenant_id).toBe('tenant-T');
      for (const k of CHILD_KEYS) expect(args[k].length).toBeGreaterThan(0);
      for (const r of childRows(args)) {
        expect(r).toHaveProperty('tenant_id', 'tenant-T');
      }
    });

    it('re-posting the same uuid sends tenant_id on every child row, so ON CONFLICT SET repairs it', async () => {
      const supabase = makeMockSupabase();
      const v = makeVcon();

      const first = batchSaveVCon(v, 'tenant-T', supabase, null);
      await _flushNowForTests('tenant-T');
      await first;
      const again = batchSaveVCon({ ...v, subject: 'edited' }, 'tenant-T', supabase, null);
      await _flushNowForTests('tenant-T');
      await again;

      expect(supabase._rpcCalls).toHaveLength(2);
      // save_vcon_batch builds its SET list from the row keys, so tenant_id
      // being a key on every row is what puts it in ON CONFLICT DO UPDATE SET.
      for (const r of childRows(supabase._rpcCalls[1][1])) {
        expect(Object.keys(r)).toContain('tenant_id');
        expect(r.tenant_id).toBe('tenant-T');
      }
    });

    it('stamps the legacy per-table fallback upserts too', async () => {
      const supabase = makeMockSupabase(() => ({ code: 'PGRST202', message: 'Could not find the function' }));
      const p = batchSaveVCon(makeVcon(), 'tenant-T', supabase, null);
      await _flushNowForTests('tenant-T');
      await p;

      for (const t of ['parties', 'dialog', 'analysis', 'attachments']) {
        const [rows, opts] = supabase._calls[t][0];
        expect(opts.onConflict).toMatch(/^vcon_id,/);
        for (const r of rows) expect(r).toHaveProperty('tenant_id', 'tenant-T');
      }
    });

    it('with RLS disabled (null tenant) writes tenant_id null on parent and children, no crash', async () => {
      const supabase = makeMockSupabase();
      const v = makeVcon();

      const p = batchSaveVCon(v, null, supabase, null);
      await _flushNowForTests(null);
      await expect(p).resolves.toEqual({ uuid: v.uuid, id: v.uuid });

      const [, args] = supabase._rpcCalls[0];
      expect(args.p_vcons[0].tenant_id).toBeNull();
      for (const r of childRows(args)) expect(r).toHaveProperty('tenant_id', null);
    });
  });

  describe('tenant scoping', () => {
    it('keeps separate buffers per tenant', async () => {
      const supabase = makeMockSupabase();

      const a = batchSaveVCon(makeVcon(), 'tenant-A', supabase, null);
      const b = batchSaveVCon(makeVcon(), 'tenant-B', supabase, null);
      await _flushNowForTests('tenant-A');
      await _flushNowForTests('tenant-B');
      await Promise.all([a, b]);

      expect(supabase._rpcCalls).toHaveLength(2);
      // Each tenant's batch should have exactly one vCon, stamped with its tenant.
      expect(supabase._rpcCalls[0][1].p_vcons.map((r: any) => r.tenant_id)).toEqual(['tenant-A']);
      expect(supabase._rpcCalls[1][1].p_vcons.map((r: any) => r.tenant_id)).toEqual(['tenant-B']);
    });
  });

  describe('vconCacheKey', () => {
    const prev = process.env.SUPABASE_DB_SCHEMA;
    afterEach(() => {
      if (prev === undefined) delete process.env.SUPABASE_DB_SCHEMA;
      else process.env.SUPABASE_DB_SCHEMA = prev;
    });

    it('namespaces the cache key with schema outermost so two schemas never collide', () => {
      process.env.SUPABASE_DB_SCHEMA = 'acme';
      const acme = vconCacheKey('u1');
      process.env.SUPABASE_DB_SCHEMA = 'beta';
      const beta = vconCacheKey('u1');
      expect(acme).toBe('acme:vcon:u1');
      expect(beta).toBe('beta:vcon:u1');
      expect(acme).not.toBe(beta); // same uuid, different schema -> different key (no cross-tenant leak)
    });

    it('falls back to a bare vcon: key when no schema is set', () => {
      delete process.env.SUPABASE_DB_SCHEMA;
      // Bare key matches the pre-namespacing behavior and the conserver default,
      // so an untenanted shared Redis stays consistent across both services.
      expect(vconCacheKey('u1')).toBe('vcon:u1');
    });
  });
});
