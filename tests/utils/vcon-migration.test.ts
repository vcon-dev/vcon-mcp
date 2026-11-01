/**
 * Migration of a 0.4.0 vCon to 0.5.0 (Appendix A.1, steps T1 to T15).
 *
 * Port of the reference tests (vcon-lib tests/test_migration_0_4_0.py and
 * test_migration_review.py). The expected shapes were cross-checked against the
 * Python implementation on the same inputs: the migrated documents are equal.
 */

import { describe, it, expect } from 'vitest';
import {
  MIGRATION_STEPS,
  MigrationError,
  getMigrationReport,
  migrate040To050,
  migrateOnRead,
  needsMigration,
  reportSummary,
} from '../../src/utils/vcon-migration.js';
import { validateVConDocument } from '../../src/utils/vcon-validation.js';

const T0 = '2022-06-21T17:53:26.000+00:00';
const T1 = '2022-06-21T17:54:00.000+00:00';
const T2 = '2022-06-21T17:55:00.000+00:00';

const v04 = (extra: Record<string, any> = {}): any => ({
  vcon: '0.4.0',
  uuid: '01a16b86-9a63-8346-b9a2-279e0d16bc46',
  created_at: '2022-06-21T13:53:00-04:00',
  parties: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }],
  dialog: [],
  analysis: [],
  attachments: [],
  ...extra,
});
const rec = (extra: Record<string, any> = {}): any => ({
  type: 'recording', start: T0, duration: 10, parties: [0, 1],
  mediatype: 'audio/x-wav', url: 'https://e.com/a.wav', content_hash: 'sha512-x', ...extra,
});
const text = (extra: Record<string, any> = {}): any => ({
  type: 'text', start: T1, parties: [0, 1], body: 'hi', encoding: 'none', mediatype: 'text/plain', ...extra,
});

/** Migrate, and require the result to satisfy the 0.5.0 document rules the report did not flag. */
function migrate(d: any, opts: { strict?: boolean } = {}) {
  const r = migrate040To050(d, opts);
  return r;
}
const kinds = (report: any, kind: string) => report.entries.filter((e: any) => e.kind === kind);
const sessionDialogs = (out: any) => out.sessions.flatMap((s: any) => s.dialog ?? []);

describe('table driven', () => {
  it('has one entry per transform step, in the documented order', () => {
    expect(MIGRATION_STEPS.map((s) => s.id)).toEqual(
      ['T13', 'T15', 'T1', 'T8', 'T9', 'T9b', 'T6', 'T2', 'T7', 'T4', 'T3', 'T10', 'T10b', 'T10c', 'T11', 'T12', 'T14']
    );
    expect(migrate(v04()).report.steps_run).toEqual(MIGRATION_STEPS.map((s) => s.id));
  });

  it('does not modify its input and accepts a JSON string', () => {
    const d = v04({ dialog: [rec()] });
    const copy = JSON.parse(JSON.stringify(d));
    migrate(d);
    expect(d).toEqual(copy);
    expect(migrate040To050(JSON.stringify(d)).vcon.vcon).toBe('0.5.0');
  });

  it('rejects other versions and garbage', () => {
    expect(() => migrate040To050({ vcon: '0.3.0' })).toThrow(MigrationError);
    expect(() => migrate040To050({ vcon: '0.5.0' })).toThrow(MigrationError);
    expect(() => migrate040To050('not json')).toThrow(MigrationError);
    expect(() => migrate040To050([1])).toThrow(MigrationError);
  });

  it('sets a missing vcon parameter and says so; refuses input that already has 0.5.0-only parameters', () => {
    const d = v04({ dialog: [rec()] });
    delete d.vcon;
    const { vcon, report } = migrate(d);
    expect(vcon.vcon).toBe('0.5.0');
    expect(report.entries.some((e) => e.code === 'AMB-12')).toBe(true);
    expect(() => migrate040To050({ uuid: 'x', sessions: [{}] })).toThrow(/already 0\.5\.0/);
  });
});

describe('T2 sessions', () => {
  it('one Session references all Dialogs, in the Appendix B shape for a call', () => {
    const { vcon } = migrate(v04({ dialog: [rec()] }));
    expect(vcon.sessions).toEqual([{ start: T0, duration: 10, parties: [0, 1], dialog: [0] }]);
    expect(validateVConDocument(vcon).errors).toEqual([]);
  });

  it('no dialog means no Session', () => {
    const { vcon } = migrate(v04());
    expect(vcon.sessions).toBeUndefined();
    expect(vcon.events).toBeUndefined();
  });

  it('derives start and duration from the Dialogs and reports it', () => {
    const { vcon, report } = migrate(v04({ dialog: [rec({ duration: 10 }), rec({ start: T1, duration: 5 })] }));
    expect(vcon.sessions[0].start).toBe(T0);
    expect(vcon.sessions[0].duration).toBe(39); // T0 to the end of the second Dialog (T0 + 34s + 5s)
    expect(kinds(report, 'inferred').some((e: any) => /derived from its Dialogs/.test(e.message))).toBe(true);
  });

  it('a text-only Session has no duration', () => {
    const { vcon } = migrate(v04({ dialog: [text()] }));
    expect(vcon.sessions[0].duration).toBeUndefined();
  });
});

describe('T3 party_history', () => {
  const withHistory = () => v04({
    dialog: [rec({
      party_history: [
        { party: 0, time: T0, event: 'join' },
        { party: 1, time: T1, event: 'drop', x_ext: 5 },
        { party: 0, time: T2, event: 'keydown', button: '5' },
      ],
    })],
  });

  it('entries become Events with event renamed type, and the Event does not reference the Dialog', () => {
    const { vcon } = migrate(withHistory());
    expect(vcon.events.map((e: any) => [e.type, e.party, e.sessions])).toEqual([
      ['join', 0, 0], ['drop', 1, 0], ['keydown', 0, 0],
    ]);
    expect(vcon.events.every((e: any) => !('dialog' in e))).toBe(true);
    expect(vcon.dialog[0]).not.toHaveProperty('party_history');
  });

  it('keeps button on key events', () => {
    expect(migrate(withHistory()).vcon.events[2].button).toBe('5');
  });

  it('carries extension keys onto the Event and reports them', () => {
    const { vcon, report } = migrate(withHistory());
    expect(vcon.events[1].x_ext).toBe(5);
    expect(kinds(report, 'unresolved').some((e: any) => /non-core parameter/.test(e.message))).toBe(true);
  });

  it('a Dialog in two Sessions lists both in sessions', () => {
    const d = v04({
      dialog: [rec({ recording_set: 1, party_history: [{ party: 0, time: T0, event: 'join' }] }), { type: 'recording-set', start: T0, recordings: [0] }],
    });
    const { vcon } = migrate(d);
    expect(vcon.events[0].sessions).toEqual([0, 1]);
  });

  it('a missing party uses an empty Party Object, or throws in strict mode', () => {
    const d = v04({ dialog: [rec({ party_history: [{ time: T0, event: 'join' }] })] });
    const { vcon, report } = migrate(d);
    expect(vcon.parties[vcon.events[0].party]).toEqual({});
    expect(kinds(report, 'fallback')).toHaveLength(1);
    expect(() => migrate(d, { strict: true })).toThrow(MigrationError);
  });

  it('a missing time falls back to the Dialog start, then created_at, and is reported', () => {
    const d = v04({ dialog: [rec({ party_history: [{ party: 0, event: 'join' }] })] });
    const { vcon, report } = migrate(d);
    expect(vcon.events[0].time).toBe(T0);
    expect(kinds(report, 'fallback')[0].details).toMatchObject({ source: 'Dialog start' });
    const noStart = v04({ dialog: [rec({ start: undefined, party_history: [{ party: 0, event: 'join' }] })] });
    expect(migrate(noStart).vcon.events[0].time).toBe('2022-06-21T13:53:00-04:00');
  });
});

describe('T4 transfer Dialogs become transfer Events', () => {
  const withTransfer = (transfer: any) => v04({
    dialog: [rec(), rec({ start: T1, parties: [1, 2] }), rec({ start: T2, parties: [0, 2] }), transfer],
  });

  it('blind transfer', () => {
    const { vcon } = migrate(withTransfer({ type: 'transfer', start: T2, transferee: 0, transferor: 1, transfer_target: 2, original: 0, target_dialog: 2 }));
    expect(vcon.events.map((e: any) => e.type)).toEqual(['blind-transfer']);
    const e = vcon.events[0];
    expect(e).toMatchObject({ party: 1, transferee: 0, transfer_target: 2, time: T2 });
    expect(e).not.toHaveProperty('consultation');
    expect(vcon.sessions[e.sessions].dialog).toEqual([0]);
    expect(vcon.sessions[e.target_session].dialog).toEqual([2]);
    expect(vcon.dialog[3]).toEqual({});
    expect(sessionDialogs(vcon)).not.toContain(3);
    expect(validateVConDocument(vcon).errors).toEqual([]);
  });

  it('consultative transfer emits two Events sharing the consultation Session', () => {
    const { vcon } = migrate(withTransfer({ type: 'transfer', start: T2, transferee: 0, transferor: 1, transfer_target: 2, original: 0, consultation: 1, target_dialog: 2 }));
    expect(vcon.events.map((e: any) => e.type)).toEqual(['consultation-start', 'consultative-transfer']);
    const [cs, ct] = vcon.events;
    expect(cs.consultation).toBe(ct.consultation);
    expect(vcon.sessions[cs.consultation].dialog).toEqual([1]);
    expect(vcon.sessions[ct.target_session].dialog).toEqual([2]);
    expect(cs).not.toHaveProperty('target_session');
    expect(ct.party).toBe(1);
    expect(validateVConDocument(vcon).errors).toEqual([]);
  });

  it('a transfer to a recording-set reuses its Session', () => {
    const d = v04({
      dialog: [
        rec(), rec({ start: T2 }),
        { type: 'recording-set', start: T0, recordings: [0], parties: [0, 1] },
        { type: 'transfer', start: T2, transferee: 0, transferor: 1, transfer_target: 2, original: 2, target_dialog: 1 },
      ],
    });
    const { vcon } = migrate(d);
    expect(vcon.events[0].sessions).toBe(1);
  });

  it('takes the Event time from the target call when the transfer has no start, and reports it', () => {
    const { vcon, report } = migrate(withTransfer({ type: 'transfer', transferee: 0, transferor: 1, transfer_target: 2, original: 0, target_dialog: 2 }));
    expect(vcon.events[0].time).toBe(T2);
    expect(report.entries.some((e) => e.code === 'AMB-7' && /Event time taken from/.test(e.message))).toBe(true);
  });

  it('falls back to created_at, or throws in strict mode; no created_at always throws', () => {
    const d = v04({ dialog: [rec(), { type: 'transfer', transferee: 0, transferor: 1, transfer_target: 2, original: 0 }] });
    delete d.dialog[0].start;
    const { vcon, report } = migrate(d);
    expect(vcon.events[0].time).toBe('2022-06-21T13:53:00-04:00');
    expect(kinds(report, 'fallback')).toHaveLength(1);
    expect(() => migrate(d, { strict: true })).toThrow(MigrationError);
    delete d.created_at;
    expect(() => migrate(d)).toThrow(MigrationError);
  });

  it('abandoned transfer: no target dialog and no transfer_target', () => {
    const { vcon } = migrate(withTransfer({ type: 'transfer', start: T2, transferee: 0, transferor: 1, original: 0 }));
    expect(vcon.events.map((e: any) => e.type)).toEqual(['transfer-abandoned']);
    expect(vcon.events[0]).not.toHaveProperty('transfer_target');
    expect(vcon.events[0]).not.toHaveProperty('target_session');
  });

  it('missing transferor and original use an empty Party Object and a placeholder Session (strict raises)', () => {
    const t = { type: 'transfer', start: T2, transferee: 0, transfer_target: 2, target_dialog: 2 };
    const { vcon, report } = migrate(withTransfer(t));
    expect(vcon.parties[vcon.events[0].party]).toEqual({});
    expect(vcon.sessions[vcon.events[0].sessions]).toEqual({});
    expect(kinds(report, 'fallback').length).toBeGreaterThanOrEqual(2);
    expect(() => migrate(withTransfer(t), { strict: true })).toThrow(MigrationError);
  });

  it('keeps unmapped transfer content in the report', () => {
    const { report } = migrate(withTransfer({ type: 'transfer', start: T2, transferee: 0, transferor: 1, transfer_target: 2, original: 0, target_dialog: 2, parties: [0, 1], x_note: 'n' }));
    expect(report.removed_dialogs['3']).toMatchObject({ type: 'transfer', x_note: 'n' });
    expect(kinds(report, 'unresolved').some((e: any) => /no Event equivalent/.test(e.message))).toBe(true);
  });
});

describe('T6 originator, T7 recording sets', () => {
  it('originator moves to the Session when it is not the first party, and is dropped when it is', () => {
    expect(migrate(v04({ dialog: [rec({ originator: 1 })] })).vcon.sessions[0].originator).toBe(1);
    expect(migrate(v04({ dialog: [rec({ originator: 0 })] })).vcon.sessions[0]).not.toHaveProperty('originator');
    expect(migrate(v04({ dialog: [rec({ originator: 1 })] })).vcon.dialog[0]).not.toHaveProperty('originator');
  });

  it('reports conflicting originators instead of choosing silently', () => {
    const { report } = migrate(v04({ dialog: [text({ originator: 1 }), text({ originator: 0 })] }));
    expect(kinds(report, 'unresolved').some((e: any) => /different originators/.test(e.message))).toBe(true);
  });

  const recordingSet = () => v04({
    dialog: [
      rec({ recording_set: 2, start: T0, duration: 4, parties: [0, 1] }),
      rec({ recording_set: 2, start: T0, duration: 6, parties: [1, 0] }),
      { type: 'recording-set', start: T0, duration: 7, parties: [0, 1], originator: 1, session_id: { local: 'l', remote: 'r' }, recordings: [0, 1] },
    ],
  });

  it('a recording-set becomes a Session with its start, duration, parties, originator and session_id', () => {
    const { vcon, report } = migrate(recordingSet());
    expect(vcon.sessions[1]).toEqual({
      start: T0, duration: 7, parties: [0, 1], originator: 1, session_id: { local: 'l', remote: 'r' }, dialog: [0, 1],
    });
    expect(report.entries.some((e) => e.code === 'AMB-4')).toBe(true);
    expect(report.entries.some((e) => e.code === 'AMB-1' && e.kind === 'unresolved')).toBe(true);
  });

  it('removes recording_set from recordings, blanks the set and does not list it', () => {
    const { vcon, report } = migrate(recordingSet());
    expect(vcon.dialog.slice(0, 2).every((d: any) => !('recording_set' in d))).toBe(true);
    expect(vcon.dialog[2]).toEqual({});
    expect(report.removed_dialogs['2'].type).toBe('recording-set');
    expect(sessionDialogs(vcon)).not.toContain(2);
  });

  it('membership is the union of recordings and the recordings that point at the set', () => {
    const d = v04({ dialog: [rec({ recording_set: 1 }), { type: 'recording-set', start: T0, recordings: [] }] });
    const { vcon, report } = migrate(d);
    expect(vcon.sessions[1].dialog).toEqual([0]);
    expect(kinds(report, 'inferred').some((e: any) => /name recording-set/.test(e.message))).toBe(true);
  });

  it('a recording-set inside a recording-set becomes a child Session_Reference', () => {
    const d = v04({
      dialog: [
        rec(), rec({ start: T1 }),
        { type: 'recording-set', recordings: [0], start: T0 },
        { type: 'recording-set', recordings: [2, 1], start: T0 },
      ],
    });
    const { vcon } = migrate(d);
    const outer = vcon.sessions[2];
    expect(outer.sessions).toEqual([{ session: 1, type: 'child' }]);
    expect(outer.dialog).toEqual([1]);
    expect(validateVConDocument(vcon).errors).toEqual([]);
  });
});

describe('T8 T9 T9b parties', () => {
  it('a text Dialog keeps only the sender; every party goes to the Session', () => {
    const { vcon } = migrate(v04({ dialog: [text({ parties: [0, 1, 2] })] }));
    expect(vcon.dialog[0].parties).toEqual([0]);
    expect(vcon.sessions[0].parties).toEqual([0, 1, 2]);
  });

  it('the sender is the originator when one is set', () => {
    const { vcon } = migrate(v04({ dialog: [text({ parties: [0, 1, 2], originator: 2 })] }));
    expect(vcon.dialog[0].parties).toEqual([2]);
    expect(vcon.sessions[0].parties).toEqual([0, 1, 2]);
    expect(vcon.sessions[0].originator).toBe(2);
  });

  it('a thread with different receiver sets is reported, not split', () => {
    const { vcon, report } = migrate(v04({ dialog: [text({ parties: [0, 1] }), text({ parties: [1, 0, 2] })] }));
    expect(vcon.sessions).toHaveLength(1);
    expect(vcon.dialog.map((d: any) => d.parties)).toEqual([[0], [1]]);
    expect(vcon.sessions[0].parties).toEqual([0, 1, 2]);
    expect(report.entries.filter((e) => e.code === 'AMB-5').length).toBeGreaterThanOrEqual(1);
  });

  it('an incomplete Dialog keeps the originator, or the first party', () => {
    const inc = { type: 'incomplete', start: T0, parties: [2, 0], disposition: 'no-answer' };
    const a = migrate(v04({ dialog: [inc] })).vcon;
    expect(a.dialog[0].parties).toEqual([2]);
    expect(a.sessions[0].parties).toEqual([2, 0]);
    const b = migrate(v04({ dialog: [{ ...inc, originator: 0 }] })).vcon;
    expect(b.dialog[0].parties).toEqual([0]);
    expect(b.sessions[0].originator).toBe(0);
  });

  it('recording parties are kept and unioned into the Session', () => {
    const { vcon, report } = migrate(v04({ dialog: [rec({ parties: [0, 1] }), rec({ parties: [1, 2] })] }));
    expect(vcon.dialog.map((d: any) => d.parties)).toEqual([[0, 1], [1, 2]]);
    expect(vcon.sessions[0].parties).toEqual([0, 1, 2]);
    expect(report.entries.some((e) => e.code === 'AMB-6')).toBe(true);
  });

  it('a null first party becomes an empty Party Object that leads the Session parties; no receiver is promoted', () => {
    const { vcon, report } = migrate(v04({ dialog: [text({ parties: [null, 1, 2] })] }));
    const empty = vcon.parties.length - 1;
    expect(vcon.parties[empty]).toEqual({});
    expect(vcon.dialog[0].parties).toEqual([empty]);
    // it is the first Session party, so it is the implied originator and `originator` is omitted (4.2.4)
    expect(vcon.sessions[0].parties).toEqual([empty, 1, 2]);
    expect(vcon.sessions[0]).not.toHaveProperty('originator');
    expect(kinds(report, 'unresolved').some((e: any) => /unknown/.test(e.message))).toBe(true);
  });

  it('text without parties is reported', () => {
    const t = text();
    delete t.parties;
    expect(kinds(migrate(v04({ dialog: [t] })).report, 'unresolved').some((e: any) => /has no parties/.test(e.message))).toBe(true);
  });
});

describe('T10 empty Dialogs keep every index', () => {
  const withRemoved = () => v04({
    dialog: [
      rec(),
      { type: 'transfer', start: T1, transferee: 0, transferor: 1, transfer_target: 2, original: 0, target_dialog: 3 },
      { type: 'recording-set', start: T0, recordings: [0] },
      rec({ start: T2, parties: [0, 2] }),
    ],
    analysis: [{ type: 'summary', vendor: 'v', dialog: 3, body: 's', encoding: 'none' }],
  });

  it('removed Dialogs become {} in place and the array length does not change', () => {
    const { vcon } = migrate(withRemoved());
    expect(vcon.dialog).toHaveLength(4);
    expect(vcon.dialog[1]).toEqual({});
    expect(vcon.dialog[2]).toEqual({});
    expect(vcon.dialog[3].start).toBe(T2);
    expect(vcon.analysis[0].dialog).toBe(3); // untouched: it points at a kept Dialog
  });

  it('analysis on a recording-set is re-pointed to the recordings and the set Session', () => {
    const d = v04({
      dialog: [rec({ recording_set: 2 }), rec({ recording_set: 2 }), { type: 'recording-set', start: T0, recordings: [0, 1] }],
      analysis: [{ type: 'summary', vendor: 'v', dialog: 2, body: 'x', encoding: 'none' }, { type: 't', vendor: 'v', dialog: [2, 0] }],
      attachments: [{ purpose: 'note', party: 0, dialog: 2, body: 'x', encoding: 'none' }],
    });
    const { vcon } = migrate(d);
    expect(vcon.analysis[0]).toMatchObject({ dialog: [0, 1], sessions: 1 });
    expect(vcon.analysis[1]).toMatchObject({ dialog: [0, 1], sessions: 1 });
    expect(vcon.attachments[0]).toEqual({ purpose: 'note', party: 0, body: 'x', encoding: 'none', session: 1 });
    expect(validateVConDocument(vcon).errors).toEqual([]);
  });

  it('analysis on a transfer Dialog goes to the Session of the original call', () => {
    const d = v04({
      dialog: [rec(), { type: 'transfer', start: T1, transferee: 0, transferor: 1, transfer_target: 2, original: 0, target_dialog: 0 }],
      analysis: [{ type: 'summary', vendor: 'v', dialog: 1, body: 'x', encoding: 'none' }],
    });
    const { vcon } = migrate(d);
    expect(vcon.analysis[0]).not.toHaveProperty('dialog');
    expect(vcon.sessions[vcon.analysis[0].sessions].dialog).toContain(0);
  });
});

describe('T10c attachment scope', () => {
  it('scopes an unscoped attachment to the only Session, and keeps a lawful_basis dialog scope (noted)', () => {
    const d = v04({
      dialog: [rec()],
      attachments: [
        { purpose: 'note', party: 0, body: 'x', encoding: 'none' },
        { purpose: 'lawful_basis', party: 0, dialog: 0, body: '{}', encoding: 'json' },
      ],
    });
    const { vcon, report } = migrate(d);
    expect(vcon.attachments[0].session).toBe(0);
    expect(vcon.attachments[1]).not.toHaveProperty('session'); // never widened
    expect(vcon.attachments[1].dialog).toBe(0);
    expect(report.entries.some((e) => e.step === 'post' && /lawful_basis attachment scoped by dialog only/.test(e.message))).toBe(true);
  });

  it('does not choose a scope when there are several Sessions', () => {
    const d = v04({
      dialog: [rec(), { type: 'recording-set', start: T0, recordings: [0] }],
      attachments: [{ purpose: 'note', party: 0, body: 'x', encoding: 'none' }],
    });
    const { vcon, report } = migrate(d);
    expect(vcon.attachments[0]).not.toHaveProperty('session');
    expect(vcon.attachments[0]).not.toHaveProperty('dialog');
    expect(kinds(report, 'unresolved').some((e: any) => e.step === 'T10c')).toBe(true);
  });
});

describe('T11 T12 renames, T14 extensions, T13 signed input', () => {
  it('redacted and amended are renamed in place', () => {
    const { vcon } = migrate(v04({ redacted: { type: 'x', uuid: 'u' }, amended: { uuid: 'a' }, subject: 's' }));
    expect(vcon.redacted_from).toEqual({ type: 'x', uuid: 'u' });
    expect(vcon.amended_from).toEqual({ uuid: 'a' });
    expect(vcon).not.toHaveProperty('redacted');
    expect(Object.keys(vcon).indexOf('redacted_from')).toBe(Object.keys(v04({ redacted: 1 })).indexOf('redacted'));
  });

  it('adds the extensions in use, and critical names, without inventing unidentifiable ones', () => {
    const d = v04({
      dialog: [rec()],
      attachments: [{ purpose: 'lawful_basis', party: 0, dialog: 0 }],
      analysis: [{ type: 'wtf_transcription', vendor: 'v' }],
      critical: ['zzz'],
    });
    const { vcon } = migrate(d);
    expect(vcon.extensions).toEqual(['lawful_basis', 'wtf_transcription', 'zzz']);
    const odd = migrate(v04({ dialog: [rec({ encoding: 'weird' })] }));
    expect(odd.vcon.extensions).toBeUndefined();
    expect(kinds(odd.report, 'unresolved').some((e: any) => e.step === 'T14')).toBe(true);
    expect(migrate(v04({ dialog: [rec()] })).vcon.extensions).toBeUndefined();
  });

  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signed = (payload: any, alg = 'RS256') => ({
    payload: b64(payload),
    signatures: [{ protected: b64({ alg }), signature: 'sig' }],
  });

  it('a signed vCon is migrated as its unsigned payload and flagged for re-signing', () => {
    const { vcon, report } = migrate040To050(signed(v04({ dialog: [rec()] })));
    expect(vcon.vcon).toBe('0.5.0');
    expect(vcon).not.toHaveProperty('signatures');
    expect(report.resign_required).toBe(true);
    expect(reportSummary(report)).toContain('re-signing required');
  });

  it('alg none is called out; a bad payload, an encrypted vCon and a non-0.4.0 payload are refused', () => {
    expect(migrate040To050(signed(v04(), 'none')).report.entries.some((e) => /alg 'none'/.test(e.message))).toBe(true);
    expect(() => migrate040To050({ payload: '###', signatures: [] })).toThrow(MigrationError);
    expect(() => migrate040To050({ ciphertext: 'x', recipients: [] })).toThrow(/encrypted/);
    expect(() => migrate040To050(signed({ ...v04(), vcon: '0.5.0' }))).toThrow(MigrationError);
  });
});

describe('report', () => {
  it('has a known kind on every entry and serialises', () => {
    const { report } = migrate(v04({ dialog: [rec({ party_history: [{ party: 0, time: T0, event: 'join' }] }), text()] }));
    expect(report.entries.every((e) => ['inferred', 'fallback', 'unresolved', 'info'].includes(e.kind))).toBe(true);
    expect(JSON.parse(JSON.stringify(report)).source_version).toBe('0.4.0');
    expect(report.target_version).toBe('0.5.0');
  });

  it('reports problems left in the result', () => {
    const { report } = migrate(v04({ dialog: [rec({ parties: [9] })] }));
    expect(report.entries.some((e) => e.step === 'post' && e.kind === 'unresolved' && /invalid party index/.test(e.message))).toBe(true);
  });
});

describe('migrateOnRead', () => {
  it('migrates a stored 0.4.0 vCon and attaches the report out of band', () => {
    const stored = v04({ dialog: [rec()] });
    const out = migrateOnRead(stored);
    expect(out).not.toBe(stored);
    expect(out.vcon).toBe('0.5.0');
    expect(getMigrationReport(out)?.steps_run).toContain('T2');
    expect(stored.vcon).toBe('0.4.0');
  });

  it('leaves a 0.5.0 vCon, a signed vCon and a 0.5.0-shaped vCon with no version untouched', () => {
    const v5 = { vcon: '0.5.0', uuid: 'u', parties: [], sessions: [{}] };
    expect(migrateOnRead(v5)).toBe(v5);
    const signed = { payload: 'x', signatures: [] };
    expect(migrateOnRead(signed)).toBe(signed);
    const noVersion = { uuid: 'u', parties: [], sessions: [{}], dialog: [{}] };
    expect(migrateOnRead(noVersion)).toBe(noVersion);
    expect(needsMigration(signed)).toBe(false);
  });

  it('reads an older version string or an undeclared legacy shape as the 0.4.0 shape', () => {
    const old = migrateOnRead({ ...v04({ dialog: [rec()] }), vcon: '0.3.0' });
    expect(old.vcon).toBe('0.5.0');
    expect(getMigrationReport(old)?.source_version).toBe('0.3.0');
    const undeclared = v04({ dialog: [rec()] });
    delete undeclared.vcon;
    expect(migrateOnRead(undeclared).vcon).toBe('0.5.0');
  });

  it('returns the stored vCon as it was when the migration throws, and says so', () => {
    const bad = v04({ dialog: [rec(), { type: 'transfer', transferee: 0, transferor: 1, transfer_target: 2, original: 0 }] });
    delete bad.created_at;
    delete bad.dialog[0].start;
    let seen: unknown;
    expect(migrateOnRead(bad, (e) => { seen = e; })).toBe(bad);
    expect(seen).toBeInstanceOf(MigrationError);
  });
});

/**
 * Regressions found by diffing this port against the Python reference on the
 * reference test inputs plus adversarial ones.
 */
describe('parity with the reference implementation', () => {
  it('derives Session duration with microsecond precision', () => {
    const { vcon } = migrate040To050(v04({
      dialog: [rec({ start: '2022-01-01T00:00:00.123456Z', duration: 10 }), rec({ start: '2022-01-01T00:00:00.5Z', duration: 10 })],
    }));
    expect(vcon.sessions[0].duration).toBe(10.376544);
  });

  it('picks the earliest start when two starts differ by less than a millisecond', () => {
    const { vcon } = migrate040To050(v04({
      dialog: [rec({ start: '2022-01-01T00:00:00.0009Z', duration: 1 }), rec({ start: '2022-01-01T00:00:00.0001Z', duration: undefined })],
    }));
    expect(vcon.sessions[0].start).toBe('2022-01-01T00:00:00.0001Z');
    expect(vcon.sessions[0].duration).toBe(1.0008);
  });

  it('rounds durations half to even, as round(x, 6) does', () => {
    const { vcon } = migrate040To050(v04({ dialog: [rec({ start: '2022-01-01T00:00:00Z', duration: 0.0078125 })] }));
    expect(vcon.sessions[0].duration).toBe(0.007812);
  });

  it('formats a derived consultation-end Event time like the reference', () => {
    const transfer = { type: 'transfer', transferee: 0, transferor: 1, transfer_target: 2, original: 0, consultation: 1 };
    const time = (start: string, duration: number) => migrate040To050(v04({
      dialog: [rec(), rec({ start, duration, parties: [1, 2] }), transfer],
    })).vcon.events.find((e: any) => e.type === 'consultative-transfer').time;
    expect(time('2022-01-01T00:01:00Z', 30.5)).toBe('2022-01-01T00:01:30.500000+00:00');
    expect(time('2022-01-01T00:01:00Z', 60)).toBe('2022-01-01T00:02:00+00:00');
    expect(time('2022-01-01T00:01:00.123456+00:00', 0.0000015)).toBe('2022-01-01T00:01:00.123457+00:00');
  });

  it.each(['2022-02-30T00:00:00Z', '2022-01-01T24:00:00Z', '2022-01-01T00:00:00+24:00', 'Jan 1 2022 10:00'])(
    'does not treat %s as a start (no roll-over, no local-zone parse)',
    (start) => {
      const { vcon } = migrate040To050(v04({ dialog: [rec({ start })] }));
      expect(vcon.sessions[0].start).toBeUndefined();
    },
  );

  it('treats vcon: null as an absent version, as the reference does', () => {
    const { vcon } = migrate040To050(v04({ vcon: null, dialog: [rec()] }));
    expect(vcon.vcon).toBe('0.5.0');
    expect(() => migrate040To050(v04({ vcon: null, sessions: [] }))).toThrow(MigrationError);
  });
});
