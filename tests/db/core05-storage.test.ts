/**
 * core-05 storage: Session and Event rows, the renamed columns, and reading rows
 * stored before 0.5.0 (migrated on read with the reference semantics).
 */

import { describe, it, expect } from 'vitest';
import {
  assembleVCon,
  buildAttachmentRow,
  buildDialogRow,
  buildEventRow,
  buildSessionRow,
  buildVconRow,
  SHAPE_KEY,
} from '../../src/db/batch-writer.js';
import { getMigrationReport } from '../../src/utils/vcon-migration.js';
import { validateVConDocument } from '../../src/utils/vcon-validation.js';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:01:00.000Z';
const viaDb = (row: object) => JSON.parse(JSON.stringify(row, (_k, v) => (v === undefined ? null : v)));
const UUID = '018f0000-0000-7000-8000-000000000009';

describe('row builders', () => {
  it('vcons row: redacted_from / amended_from / redacted_strings, version 0.5.0', () => {
    const row = buildVconRow({
      uuid: UUID, created_at: T0, parties: [], redacted_from: { uuid: 'u', type: 'x' }, redacted_strings: [{ ref: 1 }],
    } as any, null);
    expect(row).toMatchObject({ vcon_version: '0.5.0', redacted_from: { uuid: 'u', type: 'x' }, amended_from: {}, redacted_strings: [{ ref: 1 }] });
    expect(row).not.toHaveProperty('redacted');
    expect(row).not.toHaveProperty('amended');
    expect(row.extra).toBeNull();
  });

  it('session row maps start/duration/dialog and an empty Session is a row of nulls', () => {
    const row = buildSessionRow(UUID, { start: T0, duration: 5, parties: [0, 1], originator: 1, session_id: { local: 'l', remote: 'r' }, sessions: [{ session: 1, type: 'child' }], dialog: [0, 1] }, 2, 't');
    expect(row).toMatchObject({
      vcon_id: UUID, session_index: 2, tenant_id: 't', start_time: T0, duration_seconds: 5, parties: [0, 1], originator: 1,
      session_id: { local: 'l', remote: 'r' }, session_refs: [{ session: 1, type: 'child' }], dialog_indices: [0, 1], extra: null,
    });
    const empty = buildSessionRow(UUID, {}, 0, null);
    expect(empty.parties).toBeNull();
    expect(empty.dialog_indices).toBeNull();
    expect(empty.extra).toBeNull();
  });

  it('event row maps sessions to session_indices and keeps extension parameters in extra', () => {
    const row = buildEventRow(UUID, { type: 'join', time: T0, sessions: 3, party: 1, x_note: 'n' }, 4, null);
    expect(row).toMatchObject({ event_index: 4, type: 'join', time: T0, session_indices: [3], party: 1, extra: { x_note: 'n' } });
    const arr = buildEventRow(UUID, { type: 'drop', time: T0, sessions: [3], party: 1 }, 0, null);
    expect(arr.extra).toEqual({ [SHAPE_KEY]: { sessions: 'array' } });
  });

  it('dialog row has no originator column; the empty Dialog {} has a NULL type; non-flat parties ride in extra', () => {
    const row = buildDialogRow(UUID, { type: 'text', parties: [0], body: 'x', encoding: 'none' }, 0, null);
    expect(row).not.toHaveProperty('originator');
    expect(row.parties).toEqual([0]);
    const empty = buildDialogRow(UUID, {}, 1, null);
    expect(empty.type).toBeUndefined();
    expect(empty.extra).toBeNull();
    const channels = buildDialogRow(UUID, { type: 'recording', parties: [[0], [1, 2]] }, 2, null);
    expect(channels.parties).toBeNull();
    expect(channels.extra).toEqual({ parties: [[0], [1, 2]] });
    const unknown = buildDialogRow(UUID, { type: 'text', parties: [0, null] }, 3, null);
    expect(unknown.parties).toBeNull();
    expect(unknown.extra).toEqual({ parties: [0, null] });
  });

  it('attachment row writes session_indices and remembers a one-element array', () => {
    expect(buildAttachmentRow(UUID, { party: 0, session: 2 }, 0, null).session_indices).toEqual([2]);
    const arr = buildAttachmentRow(UUID, { party: 0, session: [2] }, 0, null);
    expect(arr.session_indices).toEqual([2]);
    expect((arr.extra as any)[SHAPE_KEY].session).toBe('array');
    expect(buildAttachmentRow(UUID, { party: 0, dialog: 1 }, 0, null).session_indices).toBeNull();
  });
});

describe('reading 0.5.0 rows', () => {
  it('reassembles Sessions, Events and the empty Dialog Object', () => {
    const vconRow = viaDb(buildVconRow({ uuid: UUID, created_at: T0, parties: [] } as any, null));
    const out = assembleVCon(
      vconRow,
      [{ name: 'A' }, { name: 'B' }],
      [
        viaDb(buildDialogRow(UUID, { type: 'text', parties: [0], body: 'x', encoding: 'none' }, 0, null)),
        viaDb(buildDialogRow(UUID, {}, 1, null)),
      ],
      [],
      [],
      [viaDb(buildSessionRow(UUID, { start: T0, parties: [0, 1], dialog: [0] }, 0, null)), viaDb(buildSessionRow(UUID, {}, 1, null))],
      [viaDb(buildEventRow(UUID, { type: 'join', time: T0, sessions: 0, party: 1 }, 0, null))]
    );
    expect(out.vcon).toBe('0.5.0');
    expect(out.sessions).toEqual([{ start: T0, parties: [0, 1], dialog: [0] }, {}]);
    expect(out.dialog![1]).toEqual({});
    expect(out.events).toEqual([{ type: 'join', time: T0, sessions: 0, party: 1 }]);
    expect(getMigrationReport(out)).toBeUndefined();
  });
});

describe('reading rows stored as 0.4.0', () => {
  /** What the old writer stored: originator column, party_history and transfer fields in extra. */
  function legacy() {
    const vconRow = { id: UUID, uuid: UUID, vcon_version: '0.4.0', created_at: T0, redacted: { uuid: 'prior', type: 'pii' }, amended: {}, group_data: [] };
    const parties = [{ name: 'Agent' }, { name: 'Caller' }, { name: 'Supervisor' }];
    const dialog = [
      { type: 'recording', start_time: T0, duration_seconds: 60, parties: [0, 1], originator: 1, mediatype: 'audio/x-wav', url: 'https://e.com/a.wav', content_hash: 'h',
        body: null, encoding: null, session_id: null, extra: { party_history: [{ party: 0, time: T0, event: 'join' }, { party: 1, time: T1, event: 'drop' }] } },
      { type: 'transfer', start_time: T1, parties: null, originator: null, body: null, extra: { transferee: 1, transferor: 0, transfer_target: 2, original: 0, target_dialog: null } },
    ];
    const attachments = [{ type: 'tags', purpose: 'tags', party: null, dialog: null, mimetype: null, encoding: 'json', body: '["a:b"]', extra: null }];
    return assembleVCon(vconRow, parties, dialog, [], attachments, null, null);
  }

  it('migrates on read: Sessions, Events, renamed redacted_from, scoped attachments', () => {
    const out = legacy();
    expect(out.vcon).toBe('0.5.0');
    expect(out.redacted_from).toEqual({ uuid: 'prior', type: 'pii' });
    expect(out).not.toHaveProperty('redacted');
    expect(out.sessions![0]).toMatchObject({ parties: [0, 1], originator: 1, dialog: [0] });
    // the transfer Dialog has a transfer_target party, so it is a blind transfer; T4 runs before T3
    expect(out.events!.map((e) => e.type)).toEqual(['blind-transfer', 'join', 'drop']);
    expect(out.dialog![0]).not.toHaveProperty('originator');
    expect(out.dialog![0]).not.toHaveProperty('party_history');
    expect(out.dialog![1]).toEqual({});
    // the tags attachment had no scope; the transfer made a second Session, so it is left unscoped and reported
    expect(out.attachments![0]).not.toHaveProperty('session');
  });

  it('attaches the migration report out of band', () => {
    const report = getMigrationReport(legacy());
    expect(report?.source_version).toBe('0.4.0');
    expect(report?.removed_dialogs['1']).toMatchObject({ type: 'transfer' });
    expect(report?.entries.some((e) => e.step === 'T4')).toBe(true);
  });

  it('drops the nulls the database filled in for absent parameters before migrating', () => {
    const out = legacy();
    expect(out.dialog![0]).not.toHaveProperty('body');
    expect(out.dialog![0]).not.toHaveProperty('session_id');
    expect(JSON.stringify(out)).not.toContain('null');
  });

  it('a 0.3.0 row is read as the 0.4.0 shape; no migration report noise beyond the version note', () => {
    const out = assembleVCon(
      { id: UUID, uuid: UUID, vcon_version: '0.3.0', created_at: T0 },
      [{ name: 'A' }],
      [{ type: 'text', start_time: T0, parties: [0], body: 'hi', encoding: 'none', extra: null }],
      [], [], null, null
    );
    expect(out.vcon).toBe('0.5.0');
    expect(out.sessions).toHaveLength(1);
    expect(getMigrationReport(out)?.source_version).toBe('0.3.0');
  });

  it('a row that cannot be migrated is returned as stored instead of failing the read', () => {
    const out = assembleVCon(
      { id: UUID, uuid: UUID, vcon_version: '0.4.0', created_at: null },
      [{ name: 'A' }],
      [{ type: 'transfer', parties: null, extra: { transferee: 0, transferor: 0, transfer_target: 0, original: null } }],
      [], [], null, null
    );
    expect(out.vcon).toBe('0.4.0');
    expect(out.dialog![0].type).toBe('transfer');
  });

  it('the migrated vCon passes the 0.5.0 document rules, except what the migration cannot invent', () => {
    // The old tags attachment has no party and, with two Sessions, no scope the migration may pick.
    // Both are reported as unresolved; neither is filled in.
    expect(validateVConDocument(legacy()).errors).toEqual([
      'Attachment at index 0 is missing required field: party',
      'Attachment at index 0 must have at least one of dialog or session.',
    ]);
    expect(getMigrationReport(legacy())?.entries.filter((e) => e.kind === 'unresolved' && e.step === 'T10c')).toHaveLength(1);
  });
});
