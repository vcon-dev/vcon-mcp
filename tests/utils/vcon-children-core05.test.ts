/**
 * core-05 scope rules shared by every storage backend: which Session lists a new Dialog,
 * and an Attachment's default scope.
 */

import { describe, it, expect } from 'vitest';
import {
  AttachmentScopeError,
  ChildIndexError,
  appendAttachmentWithScope,
  appendDialogWithSession,
  defaultAttachmentScope,
  removeDialogAt,
  sessionForNewDialog,
} from '../../src/utils/vcon-children.js';
import type { VCon } from '../../src/types/vcon.js';

const base = (extra: Partial<VCon> = {}): VCon => ({
  vcon: '0.5.0', uuid: 'u', created_at: '2026-01-01T00:00:00Z', parties: [{ name: 'A' }, { name: 'B' }], ...extra,
});

describe('defaultAttachmentScope', () => {
  it('keeps a given dialog or session as it is (a dialog index is never widened to a Session)', () => {
    const a = { purpose: 'x', party: 0, dialog: 1 };
    expect(defaultAttachmentScope(a, 1)).toBe(a);
    const b = { purpose: 'x', party: 0, session: [0, 1] };
    expect(defaultAttachmentScope(b, 3)).toBe(b);
  });

  it('uses the only Session when exactly one exists', () => {
    expect(defaultAttachmentScope({ party: 0 }, 1)).toEqual({ party: 0, session: 0 });
  });

  it('asks the caller when there are none or several', () => {
    expect(() => defaultAttachmentScope({ party: 0 }, 0)).toThrow(AttachmentScopeError);
    expect(() => defaultAttachmentScope({ party: 0 }, 0)).toThrow(/no Session/);
    expect(() => defaultAttachmentScope({ party: 0 }, 2)).toThrow(/2 Sessions/);
  });
});

describe('sessionForNewDialog', () => {
  it('uses an explicit Session when it exists, and rejects one that does not', () => {
    expect(sessionForNewDialog(3, { type: 'text' }, { session: 2 })).toEqual({ session: 2 });
    expect(() => sessionForNewDialog(3, { type: 'text' }, { session: 3 })).toThrow(ChildIndexError);
    expect(() => sessionForNewDialog(0, { type: 'text' }, { session: 0 })).toThrow(ChildIndexError);
  });

  it('uses the only Session, and refuses to guess among several', () => {
    expect(sessionForNewDialog(1, { type: 'text' })).toEqual({ session: 0 });
    expect(() => sessionForNewDialog(2, { type: 'text' })).toThrow(/pass session/);
  });

  it('with no Session, creates one from new_session, else from the dialog start and duration, inventing no parties', () => {
    expect(sessionForNewDialog(0, { type: 'text' }, { newSession: { parties: [0, 1] } })).toEqual({ session: 0, create: { parties: [0, 1] } });
    expect(sessionForNewDialog(0, { type: 'recording', start: '2026-01-01T00:00:00Z', duration: 9, parties: [0, 1] }))
      .toEqual({ session: 0, create: { start: '2026-01-01T00:00:00Z', duration: 9 } });
    expect(sessionForNewDialog(0, { type: 'text' })).toEqual({ session: 0, create: {} });
  });
});

describe('appendDialogWithSession / appendAttachmentWithScope (whole-document backends)', () => {
  it('creates a Session for the first Dialog and lists later Dialogs in it', () => {
    const first = appendDialogWithSession(base(), { type: 'text', start: '2026-01-01T00:00:00Z', body: 'a', encoding: 'none' });
    expect(first).toMatchObject({ index: 0, session: 0, sessionCreated: true });
    expect(first.vcon.sessions).toEqual([{ start: '2026-01-01T00:00:00Z', dialog: [0] }]);
    const second = appendDialogWithSession(first.vcon, { type: 'text', body: 'b', encoding: 'none' });
    expect(second).toMatchObject({ index: 1, session: 0, sessionCreated: false });
    expect(second.vcon.sessions![0].dialog).toEqual([0, 1]);
    expect(first.vcon.sessions![0].dialog).toEqual([0]); // input untouched
  });

  it('adds to a named Session among several', () => {
    const v = base({ sessions: [{ dialog: [] }, { dialog: [0] }], dialog: [{ type: 'text' }] });
    const out = appendDialogWithSession(v, { type: 'text' }, { session: 0 });
    expect(out.vcon.sessions![0].dialog).toEqual([1]);
    expect(out.vcon.sessions![1].dialog).toEqual([0]);
    expect(() => appendDialogWithSession(v, { type: 'text' })).toThrow(ChildIndexError);
  });

  it('scopes an attachment to the only Session', () => {
    const v = base({ sessions: [{}] });
    const out = appendAttachmentWithScope(v, { party: 0, purpose: 'n' });
    expect(out).toMatchObject({ index: 0, attachment: { party: 0, purpose: 'n', session: 0 } });
    expect(() => appendAttachmentWithScope(base(), { party: 0 })).toThrow(AttachmentScopeError);
  });
});

describe('removeDialogAt (0.5.0)', () => {
  it('leaves the empty Dialog Object so Session and Event references stay valid', () => {
    const v = base({
      sessions: [{ dialog: [0, 1] }],
      dialog: [{ type: 'text', body: 'x', encoding: 'none' }, { type: 'text', body: 'y', encoding: 'none' }],
    });
    const out = removeDialogAt(v, 0);
    expect(out.dialog).toEqual([{}, { type: 'text', body: 'y', encoding: 'none' }]);
    expect(out.sessions).toBe(v.sessions);
  });
});
