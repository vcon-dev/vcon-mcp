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
 *    positional references that point at them (dialog.parties, analysis.dialog,
 *    attachment.party/dialog, transferee/transferor/...) do not silently shift.
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

import { Analysis, Attachment, Dialog, Party, VCon } from '../types/vcon.js';

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
 * Content-stripped dialog placeholder that keeps only `type` (required by the
 * spec and the DB NOT NULL + CHECK constraint). All content and positional
 * parameters are dropped.
 */
export function strippedDialogPlaceholder(existing: Dialog): Dialog {
  return { type: existing?.type ?? 'incomplete' };
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
