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
  attachments: [
    { purpose: 'tags', encoding: 'json', body: '["a:b"]' },
    { type: 'lawful_basis', encoding: 'json', body: '{"lawful_basis":"legitimate_interests"}' },
  ],
};

let insertVCon: (db: SupabaseClient, raw: any) => Promise<void>;

beforeAll(async () => {
  // The module builds a client and exits at load time without a key.
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
  ({ insertVCon } = await import('../scripts/import-vcon-files.js'));
});

describe('insertVCon tags body (CON-794)', () => {
  it('unwraps a serialised tags body instead of double-encoding it', async () => {
    const { db, inserts } = makeDbSpy();

    // core-02: an attachment body is a STRING with encoding "json", so a
    // spec-correct tags attachment arrives already serialised.
    await insertVCon(db, {
      ...RAW_VCON,
      attachments: [
        {
          purpose: 'tags',
          encoding: 'json',
          body: '["source:cxm_email", "direction:out"]',
        },
      ],
    });

    const tags = inserts.attachments[0];
    // Must be the array itself, not an array wrapping the serialised array —
    // the latter makes every tag key read as `["source`.
    expect(JSON.parse(tags.body)).toEqual(['source:cxm_email', 'direction:out']);
  });

  it('still accepts a tags body that arrives already parsed', async () => {
    const { db, inserts } = makeDbSpy();
    await insertVCon(db, {
      ...RAW_VCON,
      attachments: [{ purpose: 'tags', encoding: 'json', body: ['a:1', 'b:2'] }],
    });
    expect(JSON.parse(inserts.attachments[0].body)).toEqual(['a:1', 'b:2']);
  });
});

describe('insertVCon vcons row (CON-793)', () => {
  it('sets id = uuid and preserves the spec version from the file', async () => {
    const { db, inserts } = makeDbSpy();

    await insertVCon(db, RAW_VCON);

    const row = inserts.vcons[0];
    // Reads resolve a child's vcon_id via vcons.id, so a defaulted random id
    // makes the whole vCon come back childless.
    expect(row.id).toBe(VCON_UUID);
    expect(row.uuid).toBe(VCON_UUID);
    // Without this the column default ("0.3.0") misreports a 0.4.0 corpus.
    expect(row.vcon_version).toBe('0.4.0');
  });
});

describe('insertVCon attachment classification (CON-793)', () => {
  it('keeps purpose, so a 0.4.0 corpus does not land unclassified', async () => {
    const { db, inserts } = makeDbSpy();

    await insertVCon(db, RAW_VCON);

    const [tags, basis] = inserts.attachments;
    // 0.4.0 spells it `purpose`; dropping it strands the tag tools and any
    // lawful-basis audit, since both look the attachment up by classification.
    expect(tags.purpose).toBe('tags');
    expect(tags.encoding).toBe('json');
    // `type` remains the documented exception for lawful_basis.
    expect(basis.type).toBe('lawful_basis');
  });
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
