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

function makeMockSupabase() {
  const calls: Record<string, any[][]> = {};
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
  return { from: fromMock, _calls: calls } as any;
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
      const parties = buildPartyRows(v);
      const dialog = buildDialogRows(v);
      const analysis = buildAnalysisRows(v);
      const attachments = buildAttachmentRows(v);

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
    it('coalesces two parallel saves into a single batch (one upsert per table)', async () => {
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

      // One upsert per table per batch — vcons should be called exactly once.
      const vconUpserts = supabase._calls['vcons'] || [];
      expect(vconUpserts).toHaveLength(1);
      // ... and that single call should carry both vcon rows.
      expect(vconUpserts[0][0]).toHaveLength(2);
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

      const vconUpserts = supabase._calls['vcons'] || [];
      expect(vconUpserts).toHaveLength(1);
      expect(vconUpserts[0][0]).toHaveLength(BATCH_SIZE);
    });
  });

  describe('error propagation', () => {
    it('rejects every pending promise in a failed batch', async () => {
      const supabase: any = {
        from: vi.fn((table: string) => {
          if (table === 'vcons') {
            return {
              upsert: vi.fn(() => Promise.resolve({ data: null, error: new Error('boom') })),
              insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
            };
          }
          return {
            upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
            insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
          };
        }),
      };

      const v1 = batchSaveVCon(makeVcon(), null, supabase, null);
      const v2 = batchSaveVCon(makeVcon(), null, supabase, null);
      await _flushNowForTests(null);

      await expect(v1).rejects.toThrow('boom');
      await expect(v2).rejects.toThrow('boom');
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

      const vconCalls = supabase._calls['vcons'] || [];
      expect(vconCalls).toHaveLength(2);
      // Each tenant's batch should have exactly one row.
      expect(vconCalls[0][0]).toHaveLength(1);
      expect(vconCalls[1][0]).toHaveLength(1);
    });
  });
});
