/**
 * Regression test for CON-793.
 *
 * Every child table FKs to vcons(uuid), not the surrogate vcons.id:
 *
 *   parties_vcon_id_fkey FOREIGN KEY (vcon_id) REFERENCES vcons(uuid)
 *
 * The importer used to read `.select('id')` off the vcons insert and pass that
 * surrogate value as vcon_id, so every child insert failed the FK and the
 * import left childless vCon shells behind while still reporting a growing
 * vcons count. The test asserts on the vcon_id the children are given, because
 * "the vcons table grew" is exactly the check that let this ship.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const VCON_UUID = '11111111-1111-4111-8111-111111111111';
const SURROGATE_ID = '99999999-9999-4999-8999-999999999999';

/** Captures what each table was asked to insert. */
function makeDbSpy() {
  const inserts: Record<string, any[]> = {};

  const db = {
    from(table: string) {
      return {
        insert(rows: any) {
          inserts[table] ??= [];
          inserts[table].push(...(Array.isArray(rows) ? rows : [rows]));
          return {
            // vcons insert chains .select(...).single(); children just await.
            select(cols: string) {
              return {
                single: async () => ({
                  // Return BOTH columns with different values, so a test can
                  // only pass by selecting the right one.
                  data: { id: SURROGATE_ID, uuid: VCON_UUID }[cols as 'id' | 'uuid']
                    ? { [cols]: { id: SURROGATE_ID, uuid: VCON_UUID }[cols as 'id' | 'uuid'] }
                    : { id: SURROGATE_ID, uuid: VCON_UUID },
                  error: null,
                }),
              };
            },
            then: (resolve: any) => resolve({ error: null }),
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { db, inserts };
}

const RAW_VCON = {
  vcon: '0.4.0',
  uuid: VCON_UUID,
  created_at: '2026-08-31T00:00:00Z',
  subject: 'child FK regression',
  parties: [{ name: 'Caller', tel: '+15550000001' }],
  dialog: [
    {
      type: 'text',
      start: '2026-08-31T00:00:00Z',
      parties: [0],
      body: 'hello',
      encoding: 'none',
    },
  ],
  analysis: [{ type: 'summary', vendor: 'acme', body: '{}', encoding: 'json' }],
  attachments: [{ purpose: 'tags', encoding: 'json', body: '["a:b"]' }],
};

let insertVCon: (db: SupabaseClient, raw: any) => Promise<void>;

beforeAll(async () => {
  // The module builds a client and exits at load time without a key.
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
  ({ insertVCon } = await import('../scripts/import-vcon-files.js'));
});

describe('insertVCon child foreign keys (CON-793)', () => {
  it('gives every child the vCon uuid, not the surrogate vcons.id', async () => {
    const { db, inserts } = makeDbSpy();

    await insertVCon(db, RAW_VCON);

    // The parent row must carry the uuid from the file.
    expect(inserts.vcons?.[0]?.uuid).toBe(VCON_UUID);

    // Each child must reference vcons(uuid) — the FK target.
    for (const table of ['parties', 'dialog', 'analysis', 'attachments']) {
      expect(inserts[table], `${table} rows were inserted`).toBeDefined();
      for (const row of inserts[table]) {
        expect(row.vcon_id, `${table}.vcon_id targets vcons(uuid)`).toBe(VCON_UUID);
        expect(row.vcon_id, `${table}.vcon_id is not vcons.id`).not.toBe(SURROGATE_ID);
      }
    }
  });
});
