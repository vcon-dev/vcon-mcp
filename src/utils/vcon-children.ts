/**
 * Pure, backend-agnostic mutation helpers for vCon child arrays
 * (parties, dialog, analysis, attachments).
 *
 * These functions implement the index-addressed CRUD rules in ONE place so the
 * behaviour is unit-tested once and shared by every storage backend:
 *
 *  - REPLACE (PUT): the supplied object fully replaces the child at `index`.
 *  - APPEND: add a party at the end, returning its new index.
 *  - REMOVE for parties/dialog: leave an index-preserving PLACEHOLDER so the
 *    positional references that point at them (dialog.parties, session.parties,
 *    session.dialog, event.party/sessions, analysis.dialog, attachment.party/dialog/session)
 *    do not silently shift.
 *    This follows IETF draft-ietf-vcon-vcon-core-02 §4.1.8: data removed from a
 *    JSON array "should leave an empty placeholder so that object array indices
 *    do not change for the remaining elements".
 *  - REMOVE for analysis/attachments: these are referential LEAVES (nothing
 *    inside a vCon references them by index), so they are hard-removed and the
 *    array is COMPACTED (remaining elements stay contiguous).
 *
 * Every function is pure: it returns a new VCon and never mutates its input.
 * References that pointed at an emptied party/dialog slot are LEFT INTACT
 * (scrubbing them is the redactor's responsibility, per the spec).
 */

import { Analysis, Attachment, Dialog, Party, Session, VCon } from '../types/vcon.js';

/** Thrown when an index does not address an existing element. */
export class ChildIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChildIndexError';
  }
}

/**
 * Throw a ChildIndexError unless `index` is a non-negative integer that
 * addresses an existing element of `arr`.
 */
export function assertIndexInRange(
  arr: unknown[] | undefined,
  index: number,
  kind: string
): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new ChildIndexError(`${kind} index must be a non-negative integer, got ${index}`);
  }
  const len = arr?.length ?? 0;
  if (index >= len) {
    throw new ChildIndexError(`${kind} index ${index} not found (vCon has ${len} ${kind} element(s))`);
  }
}

/** Return a new VCon with one child array replaced (shallow, input untouched). */
function withArray<K extends 'parties' | 'dialog' | 'analysis' | 'attachments'>(
  vcon: VCon,
  key: K,
  arr: NonNullable<VCon[K]>
): VCon {
  return { ...vcon, [key]: arr };
}

// ── REPLACE (PUT) ───────────────────────────────────────────────────────────

export function replacePartyAt(vcon: VCon, index: number, party: Party): VCon {
  assertIndexInRange(vcon.parties, index, 'party');
  const next = vcon.parties.slice();
  next[index] = party;
  return withArray(vcon, 'parties', next);
}

export function replaceDialogAt(vcon: VCon, index: number, dialog: Dialog): VCon {
  assertIndexInRange(vcon.dialog, index, 'dialog');
  const next = vcon.dialog!.slice();
  next[index] = dialog;
  return withArray(vcon, 'dialog', next);
}

export function replaceAnalysisAt(vcon: VCon, index: number, analysis: Analysis): VCon {
  assertIndexInRange(vcon.analysis, index, 'analysis');
  const next = vcon.analysis!.slice();
  next[index] = analysis;
  return withArray(vcon, 'analysis', next);
}

export function replaceAttachmentAt(vcon: VCon, index: number, attachment: Attachment): VCon {
  assertIndexInRange(vcon.attachments, index, 'attachment');
  const next = vcon.attachments!.slice();
  next[index] = attachment;
  return withArray(vcon, 'attachments', next);
}

// ── APPEND ──────────────────────────────────────────────────────────────────

export function appendParty(vcon: VCon, party: Party): { vcon: VCon; index: number } {
  const next = (vcon.parties ?? []).slice();
  const index = next.length;
  next.push(party);
  return { vcon: withArray(vcon, 'parties', next), index };
}

// ── REMOVE: index-preserving placeholders ────────────────────────────────────

/** Empty Party Object (or `{name:"anonymous"}`) that holds an index slot. */
export function emptyPartyPlaceholder(anonymize = false): Party {
  return anonymize ? { name: 'anonymous' } : {};
}

/**
 * Removed-dialog placeholder: the empty Dialog Object `{}` (core-05 Section 4.5.1), which
 * "may be used to hold a position in the dialog array, such that the indices of the other
 * Dialog Objects, and the references to them, do not change". `type` is required unless the
 * Dialog is empty. All content and positional parameters are dropped.
 */
export function strippedDialogPlaceholder(_existing?: Dialog): Dialog {
  return {};
}

// ── 0.5.0 scope rules ────────────────────────────────────────────────────────

/** Thrown when an attachment's scope (dialog or session) is missing and cannot be defaulted. */
export class AttachmentScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentScopeError';
  }
}

/**
 * Attachment scope (core-05 Sections 4.6.4, 4.6.5): at least one of `dialog` or `session`.
 * A caller-supplied scope is kept as is; a `dialog` index is never widened to a Session.
 * With neither given, the scope defaults only when the vCon has exactly one Session (the
 * whole conversation); otherwise the caller must pass it.
 */
export function defaultAttachmentScope(attachment: Attachment, sessionCount: number): Attachment {
  if (attachment.dialog !== undefined || attachment.session !== undefined) return attachment;
  if (sessionCount === 1) return { ...attachment, session: 0 };
  throw new AttachmentScopeError(
    sessionCount === 0
      ? 'attachment needs a scope (dialog or session) and the vCon has no Session to default to: pass dialog or session'
      : `attachment needs a scope (dialog or session) and the vCon has ${sessionCount} Sessions: pass dialog or session`
  );
}

/**
 * Which Session lists a Dialog that is being added. `sessionCount` is the number of Sessions
 * the vCon has now. Returns the Session index and, when a Session has to be created, the
 * Session to create (without `dialog`; the writer sets it).
 *
 *  - an explicit `session` must exist;
 *  - exactly one Session: that one;
 *  - no Session: a new one, from `newSession`, else from the dialog's own start and duration
 *    (no parties are invented);
 *  - two or more Sessions and none named: the caller must choose.
 */
export function sessionForNewDialog(
  sessionCount: number,
  dialog: Dialog,
  options: { session?: number; newSession?: Omit<Session, 'dialog'> } = {}
): { session: number; create?: Omit<Session, 'dialog'> } {
  if (options.session !== undefined) {
    if (!Number.isInteger(options.session) || options.session < 0 || options.session >= sessionCount) {
      throw new ChildIndexError(`session index ${options.session} not found (vCon has ${sessionCount} session element(s))`);
    }
    return { session: options.session };
  }
  if (sessionCount === 1) return { session: 0 };
  if (sessionCount > 1) {
    throw new ChildIndexError(`vCon has ${sessionCount} Sessions: pass session to say which one lists the new dialog`);
  }
  const create: Omit<Session, 'dialog'> = options.newSession ? { ...options.newSession } : {};
  if (!options.newSession) {
    if (dialog.start !== undefined) create.start = dialog.start;
    if (dialog.duration !== undefined) create.duration = dialog.duration;
  }
  return { session: 0, create };
}

export function removePartyAt(
  vcon: VCon,
  index: number,
  opts: { anonymize?: boolean } = {}
): VCon {
  assertIndexInRange(vcon.parties, index, 'party');
  const next = vcon.parties.slice();
  next[index] = emptyPartyPlaceholder(opts.anonymize);
  return withArray(vcon, 'parties', next);
}

export function removeDialogAt(vcon: VCon, index: number): VCon {
  assertIndexInRange(vcon.dialog, index, 'dialog');
  const next = vcon.dialog!.slice();
  next[index] = strippedDialogPlaceholder(next[index]);
  return withArray(vcon, 'dialog', next);
}

// ── REMOVE: hard delete + compact (referential leaves) ───────────────────────

export function removeAnalysisAt(vcon: VCon, index: number): VCon {
  assertIndexInRange(vcon.analysis, index, 'analysis');
  const next = vcon.analysis!.slice();
  next.splice(index, 1);
  return withArray(vcon, 'analysis', next);
}

export function removeAttachmentAt(vcon: VCon, index: number): VCon {
  assertIndexInRange(vcon.attachments, index, 'attachment');
  const next = vcon.attachments!.slice();
  next.splice(index, 1);
  return withArray(vcon, 'attachments', next);
}

/**
 * Pure add of a Dialog with its Session membership (whole-document backends).
 * Same rules as sessionForNewDialog: the index is listed by a Session, one is created when
 * the vCon has none. Returns a new VCon; the input is untouched.
 */
export function appendDialogWithSession(
  vcon: VCon,
  dialog: Dialog,
  options: { session?: number; newSession?: Omit<Session, 'dialog'> } = {}
): { vcon: VCon; index: number; session: number; sessionCreated: boolean } {
  const sessions = (vcon.sessions ?? []).slice();
  const plan = sessionForNewDialog(sessions.length, dialog, options);
  const dialogs = (vcon.dialog ?? []).slice();
  const index = dialogs.length;
  dialogs.push(dialog);
  if (plan.create) {
    sessions.push({ ...plan.create, dialog: [index] });
  } else {
    const existing = sessions[plan.session];
    sessions[plan.session] = { ...existing, dialog: [...(existing.dialog ?? []), index] };
  }
  return { vcon: { ...vcon, dialog: dialogs, sessions }, index, session: plan.session, sessionCreated: !!plan.create };
}

/** Pure add of an Attachment with its default scope applied (see defaultAttachmentScope). */
export function appendAttachmentWithScope(
  vcon: VCon,
  attachment: Attachment
): { vcon: VCon; index: number; attachment: Attachment } {
  const scoped = defaultAttachmentScope(attachment, vcon.sessions?.length ?? 0);
  const attachments = (vcon.attachments ?? []).slice();
  const index = attachments.length;
  attachments.push(scoped);
  return { vcon: { ...vcon, attachments }, index, attachment: scoped };
}
