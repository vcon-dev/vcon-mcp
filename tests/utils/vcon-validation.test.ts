/**
 * Structural validation against draft-ietf-vcon-vcon-core-05: Sessions, Events
 * (table 4.3.1.5), references, Attachment scope, redacted_from / amended_from,
 * extensions, redacted_strings.
 */

import { describe, it, expect } from 'vitest';
import { validateEvent, validateSession, validateVConDocument, extensionsInUse } from '../../src/utils/vcon-validation.js';
import { validateVCon } from '../../src/utils/validation.js';

const T = '2026-01-01T00:00:00Z';
const base = (extra: Record<string, any> = {}): any => ({
  vcon: '0.5.0',
  uuid: '018f0000-0000-7000-8000-000000000001',
  created_at: T,
  parties: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
  ...extra,
});
const call = (extra: Record<string, any> = {}) => base({
  sessions: [{ start: T, parties: [0, 1], dialog: [0] }],
  dialog: [{ type: 'recording', start: T, parties: [0, 1], url: 'https://e.com/a.wav', content_hash: 'sha512-x', mediatype: 'audio/x-wav' }],
  ...extra,
});

describe('Event parameter table (4.3.1.5)', () => {
  it('party events need sessions and party, and must not carry key or transfer parameters', () => {
    expect(validateEvent({ type: 'join', time: T, sessions: 0, party: 0 }).errors).toEqual([]);
    expect(validateEvent({ type: 'join', time: T, party: 0 }).errors.join()).toContain('missing required field: sessions');
    expect(validateEvent({ type: 'join', time: T, sessions: 0 }).errors.join()).toContain('missing required field: party');
    expect(validateEvent({ type: 'join', time: T, sessions: 0, party: 0, button: '1' }).errors.join()).toContain('must not have field: button');
    expect(validateEvent({ type: 'join', time: T, sessions: 0, party: 0, transferee: 1 }).errors.join()).toContain('must not have field: transferee');
  });

  it('dialog on a party event only draws a warning (SHOULD NOT)', () => {
    const r = validateEvent({ type: 'hold', time: T, sessions: 0, party: 0, dialog: 0 });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toContain("should not have field: dialog");
  });

  it('key events need a button', () => {
    expect(validateEvent({ type: 'keydown', time: T, sessions: 0, party: 0 }).errors.join()).toContain('missing required field: button');
    expect(validateEvent({ type: 'keyup', time: T, sessions: 0, party: 0, button: '5' }).errors).toEqual([]);
  });

  it('transfer events follow the table', () => {
    const blind = { type: 'blind-transfer', time: T, sessions: 0, party: 0, transferee: 1, transfer_target: 2, target_session: 1 };
    expect(validateEvent(blind).errors).toEqual([]);
    expect(validateEvent({ ...blind, consultation: 1 }).errors.join()).toContain('must not have field: consultation');
    expect(validateEvent({ ...blind, target_session: undefined }).errors.join()).toContain('missing required field: target_session');
    const start = { type: 'consultation-start', time: T, sessions: 0, party: 0, transferee: 1, transfer_target: 2, consultation: 1 };
    expect(validateEvent(start).errors).toEqual([]);
    expect(validateEvent({ ...start, target_session: 3 }).errors.join()).toContain('must not have field: target_session');
    const abandoned = { type: 'transfer-abandoned', time: T, sessions: 0, party: 0, transferee: 1 };
    expect(validateEvent(abandoned).errors).toEqual([]); // transfer_target and consultation are optional
    expect(validateEvent({ ...abandoned, sessions: [0, 1] }).errors.join()).toContain('single session index');
  });

  it('channel-contributors needs dialog and channel, and must not have sessions or party', () => {
    const cc = { type: 'channel-contributors', time: T, dialog: 0, channel: 1, contributors: [0] };
    expect(validateEvent(cc).errors).toEqual([]);
    expect(validateEvent({ ...cc, contributors: null }).errors).toEqual([]);
    expect(validateEvent({ ...cc, sessions: 0 }).errors.join()).toContain('must not have field: sessions');
    expect(validateEvent({ ...cc, party: 0 }).errors.join()).toContain('must not have field: party');
    expect(validateEvent({ ...cc, channel: undefined }).errors.join()).toContain('missing required field: channel');
  });

  it('requires type and a parseable time; an extension type is only checked for those', () => {
    expect(validateEvent({ time: T }).errors.join()).toContain('missing required field: type');
    expect(validateEvent({ type: 'join', sessions: 0, party: 0 }).errors.join()).toContain('missing required field: time');
    expect(validateEvent({ type: 'join', time: 'yesterday', sessions: 0, party: 0 }).errors.join()).toContain("invalid 'time'");
    expect(validateEvent({ type: 'x-custom', time: T }).errors).toEqual([]);
  });

  it('range-checks indexes only when counts are given', () => {
    const e = { type: 'join', time: T, sessions: 5, party: 9 };
    expect(validateEvent(e).errors).toEqual([]);
    const errs = validateEvent(e, { partyCount: 2, sessionCount: 1 }).errors.join();
    expect(errs).toContain('invalid party index: 9');
    expect(errs).toContain('invalid session index: 5');
  });
});

describe('Session Object (4.2)', () => {
  it('permits an empty Session and warns about missing start and parties', () => {
    expect(validateSession({})).toEqual({ errors: [], warnings: [] });
    expect(validateSession({ dialog: [0] }).warnings.join()).toContain('should have a start');
  });

  it('checks the types of start, duration, parties, originator, session_id, dialog and sessions', () => {
    const r = validateSession(
      { start: 'x', duration: -1, parties: 'a', originator: 7, session_id: 'str', dialog: [4], sessions: [{ session: 9 }, { type: 'child' }] },
      { partyCount: 2, dialogCount: 1, sessionCount: 2 }
    );
    const e = r.errors.join('|');
    expect(e).toContain("invalid 'start'");
    expect(e).toContain('non-negative number');
    expect(e).toContain("'parties' must be a list");
    expect(e).toContain('invalid party index: 7');
    expect(e).toContain('SessionId Object');
    expect(e).toContain('invalid dialog index: 4');
    expect(e).toContain('invalid session index: 9');
    expect(e).toContain('missing required field: type');
    expect(e).toContain('missing required field: session');
  });
});

describe('document rules', () => {
  it('a conforming call is valid', () => {
    expect(validateVConDocument(call())).toEqual({ errors: [], warnings: [] });
  });

  it('requires a Session when dialog or events are present', () => {
    expect(validateVConDocument(call({ sessions: undefined })).errors.join()).toContain('At least one Session Object MUST exist');
    expect(validateVConDocument(base({ events: [{ type: 'join', time: T, sessions: 0, party: 0 }] })).errors.join())
      .toContain('At least one Session Object MUST exist');
  });

  it('warns about a Dialog no Session lists, and about a Session that lists an empty Dialog', () => {
    const d = call({ sessions: [{ start: T, parties: [0] }], dialog: [call().dialog[0], {}] });
    expect(validateVConDocument(d).warnings.join()).toContain('not referenced by any Session');
    const e = call({ sessions: [{ start: T, parties: [0], dialog: [0, 1] }], dialog: [call().dialog[0], {}] });
    expect(validateVConDocument(e).warnings.join()).toContain('empty placeholder Dialog');
  });

  it('accepts the empty Dialog Object and null contributors, and rejects 0.4.0 Dialog content', () => {
    const ok = call({ dialog: [{}, { type: 'text', parties: [0, null], body: 'x', encoding: 'none' }], sessions: [{ start: T, parties: [0], dialog: [1] }] });
    expect(validateVConDocument(ok).errors).toEqual([]);
    const bad = call({ dialog: [{ type: 'recording', parties: [0], originator: 0, party_history: [], url: 'https://e.com', content_hash: 'h' }] });
    const e = validateVConDocument(bad).errors.join();
    expect(e).toContain("parameter 'originator', which was removed in 0.5.0");
    expect(e).toContain("parameter 'party_history'");
    expect(validateVConDocument(call({ dialog: [{ type: 'transfer' }] })).errors.join()).toContain("type 'transfer', which was removed");
    expect(validateVConDocument(call({ dialog: [{ type: 'recording-set' }] })).errors.join()).toContain('recording-set');
    expect(validateVConDocument(call({ dialog: [{ parties: [0] }] })).errors.join()).toContain('missing required field: type');
  });

  it('audio and video Dialogs read with a warning', () => {
    const d = call({ dialog: [{ type: 'audio', parties: [0], url: 'https://e.com/a', content_hash: 'h' }] });
    const r = validateVConDocument(d);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toContain("type 'audio', which core-05 does not define");
  });

  it('an incomplete Dialog has no content', () => {
    const d = call({ dialog: [{ type: 'incomplete', disposition: 'busy', body: 'x', encoding: 'none' }] });
    expect(validateVConDocument(d).errors.join()).toContain("must not have field: body");
  });

  it('rejects the old top-level names', () => {
    const e = validateVConDocument(call({ redacted: { uuid: 'x' }, amended: { uuid: 'y' } })).errors.join();
    expect(e).toContain("'redacted' was renamed 'redacted_from'");
    expect(e).toContain("'amended' was renamed 'amended_from'");
  });

  it('redacted_from and amended_from are mutually exclusive; url needs content_hash', () => {
    expect(validateVConDocument(call({ redacted_from: { uuid: 'a', type: 't' }, amended_from: { uuid: 'b' } })).errors.join()).toContain('mutually exclusive');
    expect(validateVConDocument(call({ redacted_from: { url: 'https://e.com/x' } })).errors.join()).toContain('must include content_hash');
    expect(validateVConDocument(call({ amended_from: {} })).errors.join()).toContain('must include uuid, or an external reference');
    expect(validateVConDocument(call({ amended_from: { uuid: 'b' } })).errors).toEqual([]);
  });

  it('attachments need party plus dialog or session, with valid indexes', () => {
    const att = { purpose: 'note', body: 'x', encoding: 'none' };
    const e = (a: any) => validateVConDocument(call({ attachments: [a] })).errors.join('|');
    expect(e(att)).toContain('missing required field: party');
    expect(e({ ...att, party: 0 })).toContain('at least one of dialog or session');
    expect(e({ ...att, party: 0, dialog: 0 })).toBe('');
    expect(e({ ...att, party: 0, session: 0 })).toBe('');
    expect(e({ ...att, party: 0, session: [0, 0] })).toBe('');
    expect(e({ ...att, party: 0, session: 4 })).toContain('invalid session index: 4');
    expect(e({ ...att, party: 0, dialog: 4 })).toContain('invalid dialog index: 4');
    expect(e({ ...att, party: 9, dialog: 0 })).toContain('invalid party index: 9');
    expect(e({ ...att, party: 0, session: [] })).toContain("'session' must not be empty");
  });

  it('analysis references dialog, sessions, attachment and analysis, never itself', () => {
    const an = (a: any) => validateVConDocument(call({ attachments: [{ party: 0, session: 0, body: 'x', encoding: 'none' }], analysis: [a, { type: 'summary', vendor: 'v', dialog: 0 }] }));
    expect(an({ type: 'summary', vendor: 'v', sessions: 0 }).errors).toEqual([]);
    expect(an({ type: 'summary', vendor: 'v', sessions: 3 }).errors.join()).toContain('invalid session index: 3');
    expect(an({ type: 'summary', vendor: 'v', analysis: 0 }).errors.join()).toContain('must not reference itself');
    expect(an({ type: 'summary', vendor: 'v', analysis: 1, attachment: 0 }).errors).toEqual([]);
    expect(an({ type: 'summary', vendor: 'v', attachment: 5 }).errors.join()).toContain('invalid attachment index: 5');
    expect(an({ type: 'summary', vendor: 'v' }).warnings.join()).toContain('should have at least one of dialog, sessions');
  });

  it('extensions MUST list every extension used, and critical names', () => {
    const lb = { purpose: 'lawful_basis', party: 0, session: 0, body: '{}', encoding: 'json' };
    expect(validateVConDocument(call({ attachments: [lb] })).errors.join()).toContain("Extension 'lawful_basis' is in use but is not listed");
    expect(validateVConDocument(call({ attachments: [lb], extensions: ['lawful_basis'] })).errors).toEqual([]);
    expect(validateVConDocument(call({ critical: ['x'] })).errors.join()).toContain('listed in critical but not in extensions');
    const odd = call({ events: [{ type: 'x-custom', time: T }] });
    expect(validateVConDocument(odd).errors.join()).toContain('Values outside the core vocabulary');
    expect(validateVConDocument({ ...odd, extensions: ['x'] }).errors).toEqual([]);
    expect(extensionsInUse(call({ attachments: [lb] })).names.has('lawful_basis')).toBe(true);
  });

  it('redacted_strings: unique refs 1..99999, and every marker in the text has an entry', () => {
    const withMarker = call({ subject: 'call from __REDACTED_REF_7' });
    expect(validateVConDocument(withMarker).errors.join()).toContain('__REDACTED_REF_7 appears in the vCon but has no entry');
    expect(validateVConDocument({ ...withMarker, redacted_strings: [{ ref: 7, type: 'CONTACT_INFO' }] }).errors).toEqual([]);
    expect(validateVConDocument(call({ redacted_strings: [{ ref: 0 }, { ref: 5 }, { ref: 5 }] })).errors.join()).toContain('between 1 and 99999');
    expect(validateVConDocument(call({ redacted_strings: [{ ref: 5 }, { ref: 5 }] })).errors.join()).toContain('duplicates ref 5');
  });

  it('accepts any vcon string (deprecated parameter) but warns on a non-0.5.0 value', () => {
    const r = validateVConDocument(call({ vcon: '0.3.0' }));
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toContain("not '0.5.0'");
  });
});

describe('VConValidator wires the document rules in', () => {
  it('validateVCon reports a missing Session and a legacy Dialog parameter', () => {
    const v: any = call({ sessions: undefined, dialog: [{ type: 'text', body: 'x', encoding: 'none', originator: 0 }] });
    const r = validateVCon(v);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain('At least one Session');
    expect(r.errors.join()).toContain("'originator'");
  });

  it('accepts an empty Party Object (an unknown party)', () => {
    expect(validateVCon(call({ parties: [{}, { name: 'B' }] }) as any).valid).toBe(true);
  });
});
