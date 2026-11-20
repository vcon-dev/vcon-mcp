/**
 * Structural validation of a vCon document against draft-ietf-vcon-vcon-core-05
 * (syntax "0.5.0"). Pure functions over plain objects, shared by VConValidator
 * and the 0.4.0 -> 0.5.0 migration post-check.
 *
 * Port of the validation in the Python reference (vcon-lib, validation.py,
 * event.py, session.py), relaxed where this server has always been lenient
 * (missing Attachment start/purpose/mediatype, Dialog mediatype, party
 * identifiers), strict on the 0.5.0 structure: Sessions, Events, references,
 * Attachment scope, redacted_from / amended_from. The content rules of
 * vcon-lib 1.0.6 (content_hash form, a url without content_hash allowed, a JSON
 * body serialized as a string, lawful_basis bodies, created_at / updated_at) apply
 * here too. The `reference` option runs the reference rules exactly
 * (src/utils/vcon-reference-validation.ts); the migration post-check uses it.
 */
import {
  checkContent,
  encryptedForm,
  lawfulBasisFindings,
  signedForm,
  validateVconDict,
} from './vcon-reference-validation.js';
import { dateTimeProblem, parseDateTime } from './py-compat.js';

export const SYNTAX_VERSION = '0.5.0';

export const CORE_DIALOG_TYPES = ['recording', 'text', 'incomplete'] as const;
/** Written by older versions of this server although core-05 does not define them. Read-only. */
export const LIBRARY_DIALOG_TYPES = ['audio', 'video'] as const;
export const CORE_ENCODINGS = ['base64url', 'json', 'none'] as const;
export const CORE_DISPOSITIONS = [
  'no-answer', 'congestion', 'failed', 'busy', 'hung-up', 'voicemail-no-message',
] as const;

export const PARTY_EVENT_TYPES = ['join', 'drop', 'hold', 'unhold', 'mute', 'unmute'] as const;
export const KEY_EVENT_TYPES = ['keydown', 'keyup'] as const;
export const TRANSFER_EVENT_TYPES = [
  'consultation-start', 'blind-transfer', 'consultative-transfer', 'transfer-abandoned',
] as const;
export const CHANNEL_CONTRIBUTORS_EVENT_TYPE = 'channel-contributors';
export const CORE_EVENT_TYPES: readonly string[] = [
  ...PARTY_EVENT_TYPES, ...KEY_EVENT_TYPES, ...TRANSFER_EVENT_TYPES, CHANNEL_CONTRIBUTORS_EVENT_TYPE,
];
export const SESSION_REFERENCE_TYPES = ['child', 'peer', 'precursor', 'breakout'] as const;

/** Event parameters in the order of section 4.3. */
export const EVENT_PARAMETERS = [
  'type', 'time', 'sessions', 'party', 'dialog', 'channel', 'contributors', 'button',
  'transferee', 'transfer_target', 'consultation', 'target_session',
] as const;

/** Top-level parameters that exist only in 0.5.0. */
export const V050_ONLY_KEYS = ['sessions', 'events', 'redacted_from', 'amended_from', 'redacted_strings'] as const;

/** Removed in 0.5.0; their presence means the document is still 0.4.0 shaped. */
export const LEGACY_TOP_LEVEL: Record<string, string> = { redacted: 'redacted_from', amended: 'amended_from' };
export const LEGACY_DIALOG_PARAMS = [
  'party_history', 'originator', 'transferee', 'transferor', 'transfer_target', 'original',
  'consultation', 'target_dialog', 'recordings', 'recording_set',
] as const;
export const LEGACY_DIALOG_TYPES = ['transfer', 'recording-set'] as const;

const KNOWN_ATTACHMENT_PURPOSE_EXTENSIONS: Record<string, string> = {
  lawful_basis: 'lawful_basis',
  wtf_transcription: 'wtf_transcription',
};
const KNOWN_ANALYSIS_TYPE_EXTENSIONS: Record<string, string> = {
  wtf_transcription: 'wtf_transcription',
};

type Obj = Record<string, any>;

export interface DocumentFindings {
  errors: string[];
  warnings: string[];
}

export interface DocumentOptions {
  /**
   * Apply the reference's validate_vcon_dict (vcon-lib 1.0.6) exactly, including the
   * rules this server relaxes when it accepts a vCon (Attachment start / purpose /
   * mediatype / content, Dialog mediatype, incomplete disposition, Analysis type /
   * vendor / encoding). The 0.4.0 -> 0.5.0 migration post-check uses it, so its report
   * says what the reference's says.
   */
  reference?: boolean;
}

export function isIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asList(v: unknown): any[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function isIndexOrList(v: unknown): boolean {
  return isIndex(v) || (Array.isArray(v) && v.every(isIndex));
}

function validDate(v: unknown): boolean {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

/** Flat list of the items of a Dialog `parties` value (nulls kept). */
function flattenParties(v: unknown): unknown[] {
  const out: unknown[] = [];
  for (const item of asList(v)) {
    if (Array.isArray(item)) out.push(...item);
    else out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Event table (4.3.1.5): M must, O optional, SN should not, X must not
// ---------------------------------------------------------------------------

const X_TRANSFER = { transferee: 'X', transfer_target: 'X', consultation: 'X', target_session: 'X' };

function rules(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    type: 'M', time: 'M', sessions: 'M', party: 'M', dialog: 'SN',
    channel: 'X', contributors: 'X', button: 'X',
    ...X_TRANSFER,
    ...overrides,
  };
}

export const EVENT_PARAMETER_RULES: Record<string, Record<string, string>> = {};
for (const t of PARTY_EVENT_TYPES) EVENT_PARAMETER_RULES[t] = rules();
for (const t of KEY_EVENT_TYPES) EVENT_PARAMETER_RULES[t] = rules({ button: 'M' });
EVENT_PARAMETER_RULES['consultation-start'] = rules({
  transferee: 'M', transfer_target: 'M', consultation: 'M', target_session: 'X',
});
EVENT_PARAMETER_RULES['blind-transfer'] = rules({
  transferee: 'M', transfer_target: 'M', consultation: 'X', target_session: 'M',
});
EVENT_PARAMETER_RULES['consultative-transfer'] = rules({
  transferee: 'M', transfer_target: 'M', consultation: 'M', target_session: 'M',
});
EVENT_PARAMETER_RULES['transfer-abandoned'] = rules({
  transferee: 'M', transfer_target: 'O', consultation: 'O', target_session: 'X',
});
EVENT_PARAMETER_RULES[CHANNEL_CONTRIBUTORS_EVENT_TYPE] = {
  type: 'M', time: 'M', sessions: 'X', party: 'X', dialog: 'M', channel: 'M', contributors: 'O', button: 'X',
  ...X_TRANSFER,
};

export interface Counts {
  partyCount?: number;
  dialogCount?: number;
  sessionCount?: number;
}

/** Validate one Event Object (4.3). SN violations are warnings; M and X are errors. */
export function validateEvent(event: unknown, counts: Counts = {}, label = 'Event'): DocumentFindings {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(event)) return { errors: [`${label} must be an object.`], warnings };

  const etype = event.type;
  if (typeof etype !== 'string' || !etype) errors.push(`${label} is missing required field: type`);
  if (!('time' in event)) errors.push(`${label} is missing required field: time`);
  else if (!validDate(event.time)) errors.push(`${label} has an invalid 'time' format. Must be an ISO 8601 datetime string.`);

  const r = typeof etype === 'string' ? EVENT_PARAMETER_RULES[etype] : undefined;
  if (r) {
    for (const [param, code] of Object.entries(r)) {
      const present = param in event && event[param] !== undefined;
      if (code === 'M' && !present) errors.push(`${label} of type '${etype}' is missing required field: ${param}`);
      else if (code === 'X' && present) errors.push(`${label} of type '${etype}' must not have field: ${param}`);
      else if (code === 'SN' && present) warnings.push(`${label} of type '${etype}' should not have field: ${param}`);
    }
  }

  const checkIndex = (param: string, count: number | undefined, noun: string) => {
    if (!(param in event) || event[param] === undefined) return;
    const val = event[param];
    if (!isIndex(val)) errors.push(`${label} field '${param}' must be a non-negative integer.`);
    else if (count !== undefined && val >= count) errors.push(`${label} references invalid ${noun} index: ${val}`);
  };
  checkIndex('party', counts.partyCount, 'party');
  checkIndex('transferee', counts.partyCount, 'party');
  checkIndex('transfer_target', counts.partyCount, 'party');
  checkIndex('consultation', counts.sessionCount, 'session');
  checkIndex('target_session', counts.sessionCount, 'session');

  if ('dialog' in event && event.dialog !== undefined) {
    const val = event.dialog;
    let idxs: number[] = [];
    if (isIndex(val)) idxs = [val];
    else if (Array.isArray(val) && !CORE_EVENT_TYPES.includes(etype) && val.every(isIndex)) idxs = val;
    else errors.push(`${label} field 'dialog' must be a non-negative integer.`);
    for (const v of idxs) {
      if (counts.dialogCount !== undefined && v >= counts.dialogCount) errors.push(`${label} references invalid dialog index: ${v}`);
    }
  }
  if ('channel' in event && event.channel !== undefined && !isIndex(event.channel)) {
    errors.push(`${label} field 'channel' must be a non-negative integer.`);
  }
  if ('sessions' in event && event.sessions !== undefined) {
    const val = event.sessions;
    if (!isIndexOrList(val)) {
      errors.push(`${label} field 'sessions' must be an index or a list of indices.`);
    } else {
      if (TRANSFER_EVENT_TYPES.includes(etype) && Array.isArray(val)) {
        errors.push(`${label} of type '${etype}' must reference a single session index in 'sessions'.`);
      }
      for (const v of asList(val)) {
        if (counts.sessionCount !== undefined && v >= counts.sessionCount) errors.push(`${label} references invalid session index: ${v}`);
      }
    }
  }
  if ('contributors' in event && event.contributors !== undefined) {
    const val = event.contributors;
    if (val !== null && !isIndexOrList(val)) {
      errors.push(`${label} field 'contributors' must be an index, a list of indices or null.`);
    } else {
      for (const v of asList(val)) {
        if (counts.partyCount !== undefined && v >= counts.partyCount) errors.push(`${label} references invalid party index: ${v}`);
      }
    }
  }
  if ('button' in event && event.button !== undefined && typeof event.button !== 'string') {
    errors.push(`${label} field 'button' must be a string.`);
  }
  return { errors, warnings };
}

/** Validate one Session Object (4.2). An empty Session is permitted. */
export function validateSession(session: unknown, counts: Counts = {}, label = 'Session'): DocumentFindings {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(session)) return { errors: [`${label} must be an object.`], warnings };
  if (Object.keys(session).length === 0) return { errors, warnings };

  if ('start' in session) {
    if (!validDate(session.start)) errors.push(`${label} has an invalid 'start' format. Must be an ISO 8601 datetime string.`);
  } else {
    warnings.push(`${label} should have a start parameter.`);
  }
  if ('duration' in session) {
    const d = session.duration;
    if (typeof d !== 'number' || Number.isNaN(d) || d < 0) errors.push(`${label} field 'duration' must be a non-negative number.`);
  }
  if ('parties' in session) {
    if (!Array.isArray(session.parties)) errors.push(`${label} field 'parties' must be a list.`);
    else {
      for (const idx of session.parties) {
        if (!isIndex(idx) || (counts.partyCount !== undefined && idx >= counts.partyCount)) {
          errors.push(`${label} references invalid party index: ${idx}`);
        }
      }
    }
  } else {
    warnings.push(`${label} should have a parties parameter.`);
  }
  if ('originator' in session) {
    const o = session.originator;
    if (!isIndex(o) || (counts.partyCount !== undefined && o >= counts.partyCount)) {
      errors.push(`${label} references invalid party index: ${o}`);
    }
  }
  if ('session_id' in session && !isObj(session.session_id)) {
    errors.push(`${label} field 'session_id' must be a SessionId Object.`);
  }
  if ('dialog' in session) {
    if (!Array.isArray(session.dialog)) errors.push(`${label} field 'dialog' must be a list.`);
    else {
      for (const idx of session.dialog) {
        if (!isIndex(idx) || (counts.dialogCount !== undefined && idx >= counts.dialogCount)) {
          errors.push(`${label} references invalid dialog index: ${idx}`);
        }
      }
    }
  }
  if ('sessions' in session) {
    if (!Array.isArray(session.sessions)) errors.push(`${label} field 'sessions' must be a list.`);
    else {
      session.sessions.forEach((ref: unknown, n: number) => {
        if (!isObj(ref)) {
          errors.push(`${label} sessions[${n}] must be an object.`);
          return;
        }
        for (const req of ['session', 'type']) {
          if (!(req in ref)) errors.push(`${label} sessions[${n}] is missing required field: ${req}`);
        }
        if ('session' in ref && (!isIndex(ref.session) || (counts.sessionCount !== undefined && ref.session >= counts.sessionCount))) {
          errors.push(`${label} references invalid session index: ${ref.session}`);
        }
        if ('type' in ref && typeof ref.type !== 'string') errors.push(`${label} sessions[${n}] field 'type' must be a string.`);
      });
    }
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Extensions in use
// ---------------------------------------------------------------------------

/**
 * Extensions the document uses. `names` are extensions this server recognises
 * (lawful_basis, wtf_transcription); `unnamed` describes each use of a value
 * outside the core vocabulary whose defining extension cannot be identified.
 */
export function extensionsInUse(vcon: Obj): { names: Set<string>; unnamed: string[] } {
  const names = new Set<string>();
  const unnamed: string[] = [];
  asList(vcon.attachments).forEach((att, i) => {
    if (!isObj(att)) return;
    const ext = KNOWN_ATTACHMENT_PURPOSE_EXTENSIONS[att.purpose as string];
    if (ext) names.add(ext);
    if (att.encoding !== undefined && !(CORE_ENCODINGS as readonly string[]).includes(att.encoding)) {
      unnamed.push(`attachments[${i}] encoding '${att.encoding}'`);
    }
  });
  asList(vcon.analysis).forEach((an, i) => {
    if (!isObj(an)) return;
    const ext = KNOWN_ANALYSIS_TYPE_EXTENSIONS[an.type as string];
    if (ext) names.add(ext);
    if (an.encoding !== undefined && !(CORE_ENCODINGS as readonly string[]).includes(an.encoding)) {
      unnamed.push(`analysis[${i}] encoding '${an.encoding}'`);
    }
  });
  asList(vcon.dialog).forEach((d, i) => {
    if (!isObj(d) || Object.keys(d).length === 0) return;
    if (d.encoding !== undefined && !(CORE_ENCODINGS as readonly string[]).includes(d.encoding)) {
      unnamed.push(`dialog[${i}] encoding '${d.encoding}'`);
    }
    if (d.type === 'incomplete' && d.disposition !== undefined && !(CORE_DISPOSITIONS as readonly string[]).includes(d.disposition)) {
      unnamed.push(`dialog[${i}] disposition '${d.disposition}'`);
    }
  });
  asList(vcon.events).forEach((e, i) => {
    if (isObj(e) && e.type !== undefined && !CORE_EVENT_TYPES.includes(e.type)) {
      unnamed.push(`events[${i}] type '${e.type}'`);
    }
  });
  asList(vcon.sessions).forEach((s, i) => {
    if (!isObj(s)) return;
    asList(s.sessions).forEach((ref, j) => {
      if (isObj(ref) && ref.type !== undefined && !(SESSION_REFERENCE_TYPES as readonly string[]).includes(ref.type)) {
        unnamed.push(`sessions[${i}].sessions[${j}] type '${ref.type}'`);
      }
    });
  });
  return { names, unnamed };
}

// ---------------------------------------------------------------------------
// Whole-document validation
// ---------------------------------------------------------------------------

const REDACTED_REF_RE = /__REDACTED_REF_(\d{1,5})(?!\d)/g;

function scanRedactedRefs(obj: unknown, found: Set<number>): void {
  if (typeof obj === 'string') {
    for (const m of obj.matchAll(REDACTED_REF_RE)) found.add(Number(m[1]));
  } else if (Array.isArray(obj)) {
    for (const v of obj) scanRedactedRefs(v, found);
  } else if (isObj(obj)) {
    for (const v of Object.values(obj)) scanRedactedRefs(v, found);
  }
}

/**
 * Validate a 0.5.0 vCon document. Structural only: the content rules the server
 * has always applied (identifiers, body/encoding pairs) stay in VConValidator.
 * A signed (JWS) or encrypted (JWE) container is checked as the reference checks it.
 */
export function validateVConDocument(vcon: Obj, opts: DocumentOptions = {}): DocumentFindings {
  if (opts.reference) return validateVconDict(vcon);
  if (signedForm(vcon) || encryptedForm(vcon)) {
    const container = validateVconDict(vcon);
    const lb = lawfulBasisFindings(vcon);
    return { errors: container.errors, warnings: [...container.warnings, ...lb.errors, ...lb.warnings] };
  }
  const errors: string[] = [];
  const warnings: string[] = [];

  // created_at / updated_at: the reference's date-time rules (an offset of 24 hours or
  // more is invalid). The value is not rewritten here.
  for (const ts of ['created_at', 'updated_at']) {
    if (vcon[ts] !== undefined && parseDateTime(vcon[ts]) === undefined) {
      errors.push(`Invalid ${ts} format. Must be an ISO 8601 datetime string: ${dateTimeProblem(vcon[ts])}`);
    }
  }

  // The vcon parameter is deprecated: any value or none is accepted. A value other than
  // 0.5.0 only draws a warning, because the service migrates 0.4.0 input before it validates.
  if (vcon.vcon !== undefined && vcon.vcon !== SYNTAX_VERSION) {
    warnings.push(
      `vcon syntax version is '${vcon.vcon}', not '${SYNTAX_VERSION}': a 0.4.0 vCon is migrated on read and on create.`
    );
  }
  for (const [oldName, newName] of Object.entries(LEGACY_TOP_LEVEL)) {
    if (oldName in vcon) errors.push(`Legacy 0.4.0 parameter '${oldName}' was renamed '${newName}' in 0.5.0.`);
  }

  const parties: any[] = Array.isArray(vcon.parties) ? vcon.parties : [];
  const dialogs: any[] = Array.isArray(vcon.dialog) ? vcon.dialog : [];
  const sessions: any[] = Array.isArray(vcon.sessions) ? vcon.sessions : [];
  const events: any[] = Array.isArray(vcon.events) ? vcon.events : [];
  const attachments: any[] = Array.isArray(vcon.attachments) ? vcon.attachments : [];
  const analyses: any[] = Array.isArray(vcon.analysis) ? vcon.analysis : [];
  for (const key of ['dialog', 'sessions', 'events', 'attachments', 'analysis'] as const) {
    if (key in vcon && vcon[key] !== undefined && !Array.isArray(vcon[key])) errors.push(`Field '${key}' must be a list.`);
  }
  const counts: Counts = { partyCount: parties.length, dialogCount: dialogs.length, sessionCount: sessions.length };

  // redacted_from / amended_from
  const hasRf = vcon.redacted_from !== undefined;
  const hasAf = vcon.amended_from !== undefined;
  if (hasRf && hasAf) errors.push('redacted_from and amended_from are mutually exclusive.');
  if (hasRf) {
    const rf = vcon.redacted_from;
    if (!isObj(rf)) errors.push("Field 'redacted_from' must be an object.");
    else {
      if (rf.url !== undefined && rf.content_hash === undefined) errors.push('redacted_from with url must include content_hash.');
      checkContent(rf, 'redacted_from', errors, warnings);
    }
  }
  if (hasAf) {
    const af = vcon.amended_from;
    if (!isObj(af)) errors.push("Field 'amended_from' must be an object.");
    else {
      if (af.uuid === undefined && af.url === undefined) errors.push('amended_from must include uuid, or an external reference (url).');
      if (af.url !== undefined && af.content_hash === undefined) errors.push('amended_from with url must include content_hash.');
      checkContent(af, 'amended_from', errors, warnings);
    }
  }
  const redacted = isObj(vcon.redacted_from);

  // extensions / critical
  const extListed: string[] = Array.isArray(vcon.extensions) ? vcon.extensions : [];
  const crit: string[] = Array.isArray(vcon.critical) ? vcon.critical : [];
  for (const name of crit) {
    if (!extListed.includes(name)) errors.push(`Extension '${name}' is listed in critical but not in extensions.`);
  }
  const { names: used, unnamed } = extensionsInUse(vcon);
  for (const name of [...used].sort()) {
    if (!extListed.includes(name)) errors.push(`Extension '${name}' is in use but is not listed in the extensions parameter.`);
  }
  if (unnamed.length > 0 && extListed.length === 0) {
    errors.push(
      'Values outside the core vocabulary are in use but the extensions parameter lists no extension: ' +
      unnamed.join('; ') + '.'
    );
  }

  // dialog
  dialogs.forEach((dialog, i) => {
    if (!isObj(dialog)) {
      errors.push(`Dialog at index ${i} must be an object.`);
      return;
    }
    if (Object.keys(dialog).length === 0) return; // empty placeholder (4.5.1)
    const dtype = dialog.type;
    if (!('type' in dialog)) {
      errors.push(`Dialog at index ${i} is missing required field: type`);
    } else if ((LEGACY_DIALOG_TYPES as readonly string[]).includes(dtype)) {
      errors.push(`Dialog at index ${i} has type '${dtype}', which was removed in 0.5.0 (use Events and Sessions).`);
    } else if ((LIBRARY_DIALOG_TYPES as readonly string[]).includes(dtype)) {
      if (extListed.length === 0) {
        warnings.push(`Dialog at index ${i} has type '${dtype}', which core-05 does not define; it is read as 'recording'.`);
      }
    } else if (!(CORE_DIALOG_TYPES as readonly string[]).includes(dtype) && extListed.length === 0) {
      errors.push(`Dialog at index ${i} has an invalid type: ${dtype}`);
    }
    for (const legacy of LEGACY_DIALOG_PARAMS) {
      if (legacy in dialog) errors.push(`Dialog at index ${i} has parameter '${legacy}', which was removed in 0.5.0.`);
    }
    if (dtype === 'incomplete') {
      for (const forbidden of ['mediatype', 'filename', 'body', 'encoding', 'url', 'content_hash', 'message_id', 'redacted_segments']) {
        if (forbidden in dialog) errors.push(`Dialog at index ${i} of type 'incomplete' must not have field: ${forbidden}`);
      }
    }
    if ('parties' in dialog) {
      const dp = dialog.parties;
      if (!Array.isArray(dp) && typeof dp !== 'number') {
        errors.push(`Dialog at index ${i} field 'parties' must be a list.`);
      } else {
        for (const idx of flattenParties(dp)) {
          if (idx === null) continue; // null placeholder: unknown contributor
          if (!isIndex(idx) || idx >= parties.length) errors.push(`Dialog at index ${i} references invalid party index: ${idx}`);
        }
      }
    }
    if ('start' in dialog && !validDate(dialog.start)) {
      errors.push(`Dialog at index ${i} has an invalid 'start' format. Must be an ISO 8601 datetime string.`);
    }
    if ('redacted_segments' in dialog && !Array.isArray(dialog.redacted_segments)) {
      errors.push(`Dialog at index ${i} field 'redacted_segments' must be a list.`);
    }
    if (dtype !== 'incomplete') checkContent(dialog, `Dialog at index ${i}`, errors, warnings);
  });

  // sessions
  if ((dialogs.length > 0 || events.length > 0) && sessions.length === 0) {
    errors.push('At least one Session Object MUST exist if the events array or the dialog array contains Objects.');
  }
  sessions.forEach((s, i) => {
    const f = validateSession(s, counts, `Session at index ${i}`);
    errors.push(...f.errors);
    warnings.push(...f.warnings);
  });
  const referenced = new Set<number>();
  for (const s of sessions) {
    if (isObj(s) && Array.isArray(s.dialog)) for (const x of s.dialog) if (isIndex(x)) referenced.add(x);
  }
  const emptyDialogs = new Set<number>();
  dialogs.forEach((d, i) => {
    if (isObj(d) && Object.keys(d).length === 0) emptyDialogs.add(i);
  });
  dialogs.forEach((d, i) => {
    if (isObj(d) && Object.keys(d).length > 0 && !referenced.has(i)) {
      warnings.push(`Dialog at index ${i} is not referenced by any Session Object.`);
    }
  });
  sessions.forEach((s, n) => {
    if (!isObj(s)) return;
    if (Array.isArray(s.parties) && s.parties.length > 0 && s.originator === s.parties[0]) {
      warnings.push(`Session at index ${n} has originator equal to its first party; originator is only provided when the first party is not the originator (4.2.4).`);
    }
    if (Array.isArray(s.dialog)) {
      for (const x of s.dialog) {
        if (emptyDialogs.has(x)) warnings.push(`Session at index ${n} lists dialog ${x}, which is an empty placeholder Dialog.`);
      }
    }
  });

  // events
  events.forEach((ev, i) => {
    const f = validateEvent(ev, counts, `Event at index ${i}`);
    errors.push(...f.errors);
    warnings.push(...f.warnings);
    if (isObj(ev) && ev.type === CHANNEL_CONTRIBUTORS_EVENT_TYPE && isIndex(ev.dialog)) {
      const d = dialogs[ev.dialog];
      if (isObj(d) && d.type !== 'recording') {
        errors.push(`Event at index ${i} of type 'channel-contributors' must reference a 'recording' Dialog.`);
      }
    }
  });

  // attachments
  attachments.forEach((att, i) => {
    if (!isObj(att)) {
      errors.push(`Attachment at index ${i} must be an object.`);
      return;
    }
    if (!('party' in att) || att.party === undefined) {
      errors.push(`Attachment at index ${i} is missing required field: party`);
    } else if (!isIndex(att.party) || att.party >= parties.length) {
      errors.push(`Attachment at index ${i} references invalid party index: ${att.party}`);
    }
    const hasDialog = att.dialog !== undefined;
    const hasSession = att.session !== undefined;
    if (!hasDialog && !hasSession) errors.push(`Attachment at index ${i} must have at least one of dialog or session.`);
    if (hasDialog) {
      if (!isIndex(att.dialog) || att.dialog >= dialogs.length) {
        errors.push(`Attachment at index ${i} references invalid dialog index: ${att.dialog}`);
      } else if (emptyDialogs.has(att.dialog)) {
        warnings.push(`Attachment at index ${i} references dialog ${att.dialog}, an empty placeholder Dialog.`);
      }
    }
    if (hasSession) {
      const sv = att.session;
      const vals = Array.isArray(sv) ? sv : [sv];
      if (vals.length === 0) errors.push(`Attachment at index ${i} field 'session' must not be empty.`);
      for (const v of vals) {
        if (!isIndex(v) || v >= sessions.length) errors.push(`Attachment at index ${i} references invalid session index: ${v}`);
      }
    }
    if (att.encoding !== undefined && !(CORE_ENCODINGS as readonly string[]).includes(att.encoding) && extListed.length === 0) {
      errors.push(`Attachment at index ${i} has invalid encoding: ${att.encoding}`);
    }
    checkContent(att, `Attachment at index ${i}`, errors, warnings);
  });

  // analysis
  analyses.forEach((analysis, i) => {
    if (!isObj(analysis)) {
      errors.push(`Analysis at index ${i} must be an object.`);
      return;
    }
    checkContent(analysis, `Analysis at index ${i}`, errors, warnings);
    const refs: Array<[string, number, string]> = [
      ['dialog', dialogs.length, 'dialog'],
      ['sessions', sessions.length, 'session'],
      ['attachment', attachments.length, 'attachment'],
      ['analysis', analyses.length, 'analysis'],
    ];
    for (const [key, count, noun] of refs) {
      if (analysis[key] === undefined) continue;
      const val = analysis[key];
      if (!isIndexOrList(val)) {
        errors.push(`Analysis at index ${i} has an invalid '${key}' reference type.`);
        continue;
      }
      for (const v of asList(val)) {
        if (v >= count) errors.push(`Analysis at index ${i} references invalid ${noun} index: ${v}`);
        else if (key === 'analysis' && v === i) errors.push(`Analysis at index ${i} must not reference itself in analysis.`);
      }
    }
    if (!['dialog', 'sessions', 'attachment', 'analysis'].some((k) => analysis[k] !== undefined)) {
      warnings.push(`Analysis at index ${i} should have at least one of dialog, sessions, attachment or analysis.`);
    }
  });

  // redacted_strings
  const rs = vcon.redacted_strings;
  const declared = new Set<number>();
  if (rs !== undefined) {
    if (!Array.isArray(rs)) errors.push("Field 'redacted_strings' must be a list.");
    else {
      if (rs.length > 99999) errors.push('A vCon MUST NOT have more than 99999 redacted substrings.');
      rs.forEach((item: any, n: number) => {
        if (!isObj(item) || !Number.isInteger(item.ref)) {
          errors.push(`redacted_strings[${n}] requires an integer ref.`);
          return;
        }
        if (item.ref < 1 || item.ref > 99999) errors.push(`redacted_strings[${n}] ref must be between 1 and 99999.`);
        if (declared.has(item.ref)) errors.push(`redacted_strings[${n}] duplicates ref ${item.ref}.`);
        declared.add(item.ref);
      });
    }
  }
  const found = new Set<number>();
  const { redacted_strings: _rs, ...rest } = vcon;
  scanRedactedRefs(rest, found);
  for (const ref of [...found].sort((a, b) => a - b)) {
    if (!declared.has(ref)) errors.push(`__REDACTED_REF_${ref} appears in the vCon but has no entry in redacted_strings.`);
  }

  // lawful_basis attachment bodies, checked with the reference's LawfulBasisValidator.
  // The reference reports body problems as errors; here they are warnings, as every
  // lawful basis finding of this server has been: a vCon is not refused over its basis.
  const lb = lawfulBasisFindings(vcon);
  warnings.push(...lb.errors, ...lb.warnings);

  return { errors, warnings };
}
