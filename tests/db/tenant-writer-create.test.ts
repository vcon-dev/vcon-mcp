/**
 * createVCon under TENANT_MODE. writer: extraction always runs and a bad
 * stamp stores under _quarantine. off: exactly the old behaviour.
 *
 * What the database does with the tenant on a re-post (w3, w4) is in
 * tests/db/tenant-writer-migration.test.ts and scripts/test-tenant-writer.sh.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { VConQueries } from '../../src/db/queries.js';
import { _resetBatchWriterForTests } from '../../src/db/batch-writer.js';
import { VCon } from '../../src/types/vcon.js';

const TA = 't-aaaaaaaaaaaaaaaa';
const TB = 't-bbbbbbbbbbbbbbbb';
const CHILD_KEYS = ['p_parties', 'p_dialog', 'p_analysis', 'p_attachments'];
const ENV_KEYS = ['TENANT_MODE', 'RLS_ENABLED', 'TENANT_ATTACHMENT_TYPE', 'TENANT_JSON_PATH'];

const stamp = (id: string) => ({
  purpose: 'tenant',
  start: '2026-11-01T00:00:00Z',
  party: 0,
  dialog: 0,
  mediatype: 'application/json',
  encoding: 'json' as const,
  body: { id },
});

// Synthetic vCons with no lawful_basis attachment, on purpose: no basis is
// invented for a fake call.
const makeVCon = (attachments: any[]): VCon => ({
  vcon: '0.4.0',
  uuid: randomUUID(),
  created_at: '2026-11-01T00:00:00Z',
  parties: [{ name: 'Caller' }, { name: 'Agent' }],
  dialog: [{ type: 'text', body: 'hello', encoding: 'none' }],
  analysis: [{ type: 'summary', vendor: 'test', body: 'ok', encoding: 'none' }],
  attachments,
});

describe('createVCon tenant under TENANT_MODE', () => {
  let saved: Record<string, string | undefined>;
  let supabase: any;
  let queries: VConQueries;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    _resetBatchWriterForTests();
    supabase = { rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) };
    queries = new VConQueries(supabase);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    _resetBatchWriterForTests();
  });

  async function storedTenant(v: VCon): Promise<{ parent: unknown; children: unknown[] }> {
    await queries.createVCon(v);
    const call = supabase.rpc.mock.calls.filter((c: any[]) => c[0] === 'save_vcon_batch').at(-1);
    expect(call).toBeDefined();
    const args = call[1];
    const children = CHILD_KEYS.flatMap((k) => args[k].map((r: any) => r.tenant_id));
    return { parent: args.p_vcons[0].tenant_id, children };
  }

  describe('writer', () => {
    beforeEach(() => {
      process.env.TENANT_MODE = 'writer';
    });

    it('stores a good stamp on the vCon and every child row, with RLS_ENABLED unset', async () => {
      const { parent, children } = await storedTenant(makeVCon([stamp(TA)]));
      expect(parent).toBe(TA);
      expect(children.length).toBeGreaterThan(0);
      for (const c of children) expect(c).toBe(TA);
    });

    it('extracts with RLS_ENABLED=false too', async () => {
      process.env.RLS_ENABLED = 'false';
      expect((await storedTenant(makeVCon([stamp(TA)]))).parent).toBe(TA);
    });

    it('reads a JSON-string body and the legacy type field', async () => {
      const legacy = { type: 'tenant', encoding: 'json' as const, body: JSON.stringify({ id: TB }) };
      expect((await storedTenant(makeVCon([legacy]))).parent).toBe(TB);
    });

    it('stores a vCon with no stamp under _quarantine, children included', async () => {
      const { parent, children } = await storedTenant(makeVCon([]));
      expect(parent).toBe('_quarantine');
      for (const c of children) expect(c).toBe('_quarantine');
    });

    it('stores a malformed stamp under _quarantine', async () => {
      expect((await storedTenant(makeVCon([stamp('T-1')]))).parent).toBe('_quarantine');
      expect((await storedTenant(makeVCon([{ purpose: 'tenant', encoding: 'json', body: 'not json' }]))).parent)
        .toBe('_quarantine');
    });

    it('stores two different tenant ids under _quarantine instead of keeping the first', async () => {
      expect((await storedTenant(makeVCon([stamp(TA), stamp(TB)]))).parent).toBe('_quarantine');
    });

    it('still writes the vCon: no path drops it because of tenancy', async () => {
      const v = makeVCon([stamp('bad')]);
      await expect(queries.createVCon(v)).resolves.toMatchObject({ uuid: v.uuid });
    });
  });

  describe('off (TENANT_MODE unset): unchanged', () => {
    it('writes NULL with RLS_ENABLED unset, even with a stamp', async () => {
      const { parent, children } = await storedTenant(makeVCon([stamp(TA)]));
      expect(parent).toBeNull();
      for (const c of children) expect(c).toBeNull();
    });

    it('writes NULL, not _quarantine, for a vCon with no stamp and RLS_ENABLED=true', async () => {
      process.env.RLS_ENABLED = 'true';
      expect((await storedTenant(makeVCon([]))).parent).toBeNull();
    });

    it('keeps the first of two ids with RLS_ENABLED=true, as before', async () => {
      process.env.RLS_ENABLED = 'true';
      expect((await storedTenant(makeVCon([stamp(TA), stamp(TB)]))).parent).toBe(TA);
    });

    it('accepts any id string with RLS_ENABLED=true, as before', async () => {
      process.env.RLS_ENABLED = 'true';
      expect((await storedTenant(makeVCon([stamp('T-1')]))).parent).toBe('T-1');
    });
  });
});
