/**
 * CON-1047: a vCon stored through the row builders and read back through
 * assembleVCon must equal the input, extension fields and body types included.
 */

import { describe, it, expect } from 'vitest';
import {
  assembleVCon,
  buildAnalysisRows,
  buildAttachmentRows,
  buildDialogRows,
  buildPartyRows,
  buildVconRow,
  SHAPE_KEY,
} from '../../src/db/batch-writer.js';
import type { VCon } from '../../src/types/vcon.js';

/** Mimic a PostgREST write+read: JSON on the wire, unset columns come back null. */
const viaDb = (row: object) =>
  JSON.parse(JSON.stringify(row, (_k, v) => (v === undefined ? null : v)));

/** The reader emits null for empty columns (pre-existing); ignore those. */
function dropNulls(v: any): any {
  if (Array.isArray(v)) return v.map(dropNulls);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => [k, dropNulls(x)])
    );
  }
  return v;
}

function roundTrip(input: VCon): VCon {
  return assembleVCon(
    viaDb(buildVconRow(input, null)),
    buildPartyRows(input, null).map(viaDb),
    buildDialogRows(input, null).map(viaDb),
    buildAnalysisRows(input, null).map(viaDb),
    buildAttachmentRows(input, null).map(viaDb)
  );
}

const fixture = {
  vcon: '0.4.0',
  uuid: '018f0000-0000-7000-8000-000000000001',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:05:00.000Z',
  subject: 'round trip',
  meta: { source: 'test', labels: ['a', 'b'] },
  parties: [
    { tel: '+15550000001', name: 'Agent', id: 'party-1', role: 'agent', meta: { team: 'blue' } },
    { mailto: 'customer@example.com' },
  ],
  dialog: [
    {
      type: 'recording',
      start: '2026-01-01T00:00:00.000Z',
      duration: 30,
      parties: [0, 1],
      mediatype: 'audio/x-wav',
      url: 'https://example.com/a.wav',
      content_hash: 'sha512-abc',
      meta: { leg: 1 },
      alg: 'SHA-512',
      signature: 'sig-value',
    },
    { type: 'text', parties: [0], body: { text: 'hi' }, encoding: 'none' },
    { type: 'text', parties: [1], body: 'plain words', encoding: 'none' },
  ],
  analysis: [
    { type: 'summary', vendor: 'v', dialog: [0], body: 'false', encoding: 'none', vendor_schema: 'schema-1' },
    { type: 'sentiment', vendor: 'v', dialog: 1, body: { score: 0.9 }, encoding: 'json' },
    { type: 'transcript', vendor: 'v', dialog: [0, 1], body: '{"a":1}', encoding: 'json' },
    { type: 'keywords', vendor: 'v', body: ['x', 'y'] },
  ],
  attachments: [
    { id: 'att-1', purpose: 'tags', body: ['k:v'], encoding: 'json' },
    { purpose: 'note', start: '2026-01-01T00:01:00.000Z', party: 0, dialog: 0, body: '42', encoding: 'none' },
  ],
} as unknown as VCon;

describe('store/read round trip (CON-1047)', () => {
  it('returns the stored vCon unchanged, extension fields included', () => {
    expect(dropNulls(roundTrip(fixture))).toEqual(fixture);
  });

  it('keeps analysis.dialog as an array or an int, as written', () => {
    const out = roundTrip(fixture);
    expect(out.analysis![0].dialog).toEqual([0]);
    expect(out.analysis![1].dialog).toBe(1);
  });

  it('keeps string bodies as strings and object bodies as objects', () => {
    const out = roundTrip(fixture);
    expect(out.analysis![0].body).toBe('false');
    expect(out.analysis![1].body).toEqual({ score: 0.9 });
    expect(out.analysis![2].body).toBe('{"a":1}');
    expect(out.dialog![1].body).toEqual({ text: 'hi' });
    expect(out.attachments![1].body).toBe('42');
  });

  it('never emits extra or the shape hint to clients', () => {
    const json = JSON.stringify(roundTrip(fixture));
    expect(json).not.toContain('"extra"');
    expect(json).not.toContain(SHAPE_KEY);
  });

  it('leaves extra null when every key maps to a column', () => {
    const row = buildPartyRows({ ...fixture, parties: [{ name: 'x' }] } as VCon, null)[0];
    expect(row.extra).toBeNull();
  });

  // CON-1242: session_id (JSONB column) round-trips in each accepted shape.
  it('round-trips session_id as object, array, or legacy string', () => {
    const sid = { local: 'aaaa1111', remote: 'bbbb2222' };
    const input = {
      ...fixture,
      dialog: [
        { type: 'recording', parties: [0, 1], session_id: sid },
        { type: 'recording', parties: [0, 1], session_id: [sid, { local: 'cccc3333', remote: 'dddd4444' }] },
        { type: 'text', parties: [0], body: 'x', encoding: 'none', session_id: 'legacy-session' },
      ],
    } as unknown as VCon;
    const rows = buildDialogRows(input, null);
    expect(rows[0].session_id).toEqual(sid);
    expect(rows[0].extra).toBeNull();
    const out = roundTrip(input);
    expect(out.dialog![0].session_id).toEqual(sid);
    expect(out.dialog![1].session_id).toEqual(input.dialog![1].session_id);
    expect(out.dialog![2].session_id).toBe('legacy-session');
  });

  it('reads an existing string session_id row back as a string', () => {
    const out = assembleVCon(
      { uuid: fixture.uuid, created_at: fixture.created_at },
      [],
      [{ type: 'text', body: 'x', encoding: 'none', session_id: 'sess-0.3.0' }],
      [],
      []
    );
    expect(out.dialog![0].session_id).toBe('sess-0.3.0');
  });

  it('reads rows written before the extra column as it always did', () => {
    const out = assembleVCon(
      { uuid: fixture.uuid, created_at: fixture.created_at },
      [],
      [{ type: 'text', body: '{"s":1}', encoding: 'none' }],
      [{ type: 'summary', vendor: 'v', dialog_indices: [2], body: 'false', encoding: 'none' }],
      []
    );
    expect(out.dialog![0].body).toBe('{"s":1}');
    expect(out.analysis![0].dialog).toBe(2);
    expect(out.analysis![0].body).toBe(false);
  });
});
