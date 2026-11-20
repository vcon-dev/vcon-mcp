/**
 * The reference validation of vcon-lib 1.0.6 (Python), message for message:
 * validate_vcon_dict (core-05 document rules, content_hash and body-form
 * checks, JWS and JWE containers) and Vcon.is_valid() /
 * get_validation_warnings() (those rules plus the body of every lawful_basis
 * attachment).
 *
 * Ported from vcon-js (src/validation.ts, src/event.ts, src/session.ts, MIT),
 * which matches the reference byte for byte, with the JWS / JWE handling of
 * vcon-lib 1.0.6. The 0.4.0 -> 0.5.0 migration post-check uses
 * validateVconDict; the server's own accept path (src/utils/validation.ts)
 * stays more lenient and borrows the content and lawful basis rules from here.
 */
import { validateLawfulBasisAttachment } from './lawful-basis-validation.js';
import { asList, dateTimeProblem, decodeJsonPayload, isIndex, isPlainObject, parseDateTime, pyRepr } from './py-compat.js';

export interface Findings {
  errors: string[];
  warnings: string[];
}

export const SYNTAX_VERSION = '0.5.0';

export const CORE_DIALOG_TYPES = ['recording', 'text', 'incomplete'];
/**
 * Dialog types older versions of this library wrote although core-05 does not
 * define them. Accepted on read with a warning; the library never writes them.
 */
export const LIBRARY_DIALOG_TYPES = ['audio', 'video'];
export const CORE_ENCODINGS = ['base64url', 'json', 'none'];
export const CORE_DISPOSITIONS = [
  'no-answer',
  'congestion',
  'failed',
  'busy',
  'hung-up',
  'voicemail-no-message'
];

/** Extension names this library recognises, keyed by how they show up. */
const KNOWN_ATTACHMENT_PURPOSE_EXTENSIONS: Record<string, string> = {
  lawful_basis: 'lawful_basis',
  wtf_transcription: 'wtf_transcription'
};
const KNOWN_ANALYSIS_TYPE_EXTENSIONS: Record<string, string> = {
  wtf_transcription: 'wtf_transcription'
};

/** Removed in 0.5.0; their presence means the document is still 0.4.0 shaped. */
export const LEGACY_TOP_LEVEL: Record<string, string> = {
  redacted: 'redacted_from',
  amended: 'amended_from'
};
export const LEGACY_DIALOG_PARAMS = [
  'party_history',
  'originator',
  'transferee',
  'transferor',
  'transfer_target',
  'original',
  'consultation',
  'target_dialog',
  'recordings',
  'recording_set'
];
export const LEGACY_DIALOG_TYPES = ['transfer', 'recording-set'];

/** The reference's Dialog.MIME_TYPES (vcon-lib dialog.py), the list is_valid() checks against. */
export const REFERENCE_DIALOG_MIME_TYPES: readonly string[] = [
  'text/plain', 'audio/x-wav', 'audio/wav', 'audio/wave', 'audio/mpeg', 'audio/mp3', 'audio/x-mp3',
  'audio/x-mp4', 'audio/ogg', 'audio/webm', 'audio/x-m4a', 'audio/aac', 'video/x-mp4', 'video/ogg',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska', 'video/mpeg',
  'video/x-flv', 'video/3gpp', 'video/x-m4v', 'multipart/mixed', 'message/rfc822', 'image/jpeg',
  'image/tiff', 'application/pdf', 'application/json',
];

const REDACTED_REF_RE = /__REDACTED_REF_(\d{1,5})(?!\d)/g;

/** ContentHash token (section 2.2): "<algorithm>-<unpadded base64url digest>". */
const CONTENT_HASH_RE = /^([a-z0-9]+)-([A-Za-z0-9_-]+)$/;
/** Unpadded base64url length of the digests this library knows. */
const DIGEST_B64_LENGTHS: Record<string, number> = { sha512: 86, sha256: 43 };

/** Return why `value` is not a ContentHash or ContentHash[] (empty if it is). */
export function contentHashProblems(value: unknown): string[] {
  if (Array.isArray(value) && value.length === 0) return ['must not be an empty array'];
  const tokens = Array.isArray(value) ? value : [value];
  const problems: string[] = [];
  for (const token of tokens) {
    if (typeof token !== 'string') {
      problems.push(`${pyRepr(token)} is not a string`);
      continue;
    }
    const m = CONTENT_HASH_RE.exec(token);
    if (!m) {
      problems.push(`${pyRepr(token)} is not of the form '<algorithm>-<base64url digest>'`);
      continue;
    }
    const expected = Object.prototype.hasOwnProperty.call(DIGEST_B64_LENGTHS, m[1]) ? DIGEST_B64_LENGTHS[m[1]] : undefined;
    if (expected !== undefined && m[2].length !== expected) {
      problems.push(
        `${pyRepr(token)} has a ${m[1]} digest of ${m[2].length} base64url characters, expected ${expected}`
      );
    }
  }
  return problems;
}

function isSerializedJson(body: string): boolean {
  const s = body.trim();
  if (s[0] !== '{' && s[0] !== '[') return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * Integrity and body-form checks shared by Dialog, Attachment, Analysis and the
 * redacted_from / amended_from references (section 2.4).
 *
 * A `url` without a `content_hash` is allowed on Dialog, Attachment and
 * Analysis: a producer cannot always obtain stable bytes for the URL (a
 * streaming-service page, audio behind a login). This follows the working
 * group's direction on draft-ietf-vcon-vcon-core issue #40 (vcon-lib 1.0.6);
 * core-05 still says MUST. `redacted_from` and `amended_from` keep the
 * requirement (checked by the callers).
 */
export function checkContent(
  obj: Record<string, any>,
  label: string,
  errors: string[],
  warnings: string[]
): void {
  if ('content_hash' in obj) {
    for (const problem of contentHashProblems(obj.content_hash)) {
      errors.push(`${label} has an invalid content_hash: ${problem}.`);
    }
  }
  if (obj.encoding === 'json' && typeof obj.body === 'string' && isSerializedJson(obj.body)) {
    warnings.push(
      `${label} has encoding 'json' and a body that is a serialized JSON string; ` +
        'the body should be the JSON value itself (section 2.3.2).'
    );
  }
}

/**
 * True if `mediatype` is acceptable for a Dialog. Media type parameters
 * (`; boundary=...`) are ignored. Any multipart/, message/ or text/ subtype is
 * accepted, since the draft's examples use multipart/alternative and the list
 * in the draft is open-ended.
 */
export function mediatypeOk(mediatype: unknown, known: readonly string[] = REFERENCE_DIALOG_MIME_TYPES): boolean {
  if (typeof mediatype !== 'string') return false;
  const base = mediatype.split(';', 1)[0].trim().toLowerCase();
  if (known.includes(base)) return true;
  return ['multipart/', 'message/', 'text/'].some(p => base.startsWith(p));
}

function flattenParties(value: unknown): unknown[] {
  const out: unknown[] = [];
  for (const v of asList(value)) {
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  }
  return out;
}

/**
 * Find the vCon extensions the document uses.
 *
 * `names` holds extension names this library recognises (lawful_basis,
 * wtf_transcription). `unnamed` describes each use of a value outside the core
 * vocabulary (an Event type, Dialog encoding, disposition or Session_Reference
 * type) whose defining extension cannot be identified from the document alone.
 */
export function extensionsInUse(vcon: Record<string, any>): { names: Set<string>; unnamed: string[] } {
  const names = new Set<string>();
  const unnamed: string[] = [];

  asList(vcon.attachments).forEach((att, i) => {
    if (!isPlainObject(att)) return;
    if (typeof att.purpose === 'string' && Object.prototype.hasOwnProperty.call(KNOWN_ATTACHMENT_PURPOSE_EXTENSIONS, att.purpose)) {
      names.add(KNOWN_ATTACHMENT_PURPOSE_EXTENSIONS[att.purpose]);
    }
    if (att.encoding !== undefined && att.encoding !== null && !CORE_ENCODINGS.includes(att.encoding)) {
      unnamed.push(`attachments[${i}] encoding '${att.encoding}'`);
    }
  });
  asList(vcon.analysis).forEach((an, i) => {
    if (!isPlainObject(an)) return;
    if (typeof an.type === 'string' && Object.prototype.hasOwnProperty.call(KNOWN_ANALYSIS_TYPE_EXTENSIONS, an.type)) {
      names.add(KNOWN_ANALYSIS_TYPE_EXTENSIONS[an.type]);
    }
    if (an.encoding !== undefined && an.encoding !== null && !CORE_ENCODINGS.includes(an.encoding)) {
      unnamed.push(`analysis[${i}] encoding '${an.encoding}'`);
    }
  });
  asList(vcon.dialog).forEach((d, i) => {
    if (!isPlainObject(d) || Object.keys(d).length === 0) return;
    if (d.encoding !== undefined && d.encoding !== null && !CORE_ENCODINGS.includes(d.encoding)) {
      unnamed.push(`dialog[${i}] encoding '${d.encoding}'`);
    }
    if (d.type === 'incomplete' && d.disposition !== undefined && d.disposition !== null && !CORE_DISPOSITIONS.includes(d.disposition)) {
      unnamed.push(`dialog[${i}] disposition '${d.disposition}'`);
    }
  });
  asList(vcon.events).forEach((e, i) => {
    if (!isPlainObject(e)) return;
    if (e.type !== undefined && e.type !== null && !CORE_EVENT_TYPES.includes(e.type)) {
      unnamed.push(`events[${i}] type '${e.type}'`);
    }
  });
  asList(vcon.sessions).forEach((s, i) => {
    if (!isPlainObject(s)) return;
    asList(s.sessions).forEach((ref, j) => {
      if (isPlainObject(ref) && ref.type !== undefined && ref.type !== null && !SESSION_REFERENCE_TYPES.includes(ref.type)) {
        unnamed.push(`sessions[${i}].sessions[${j}] type '${ref.type}'`);
      }
    });
  });
  return { names, unnamed };
}

function scanRedactedRefs(obj: unknown, found: Set<number>): void {
  if (typeof obj === 'string') {
    for (const m of obj.matchAll(REDACTED_REF_RE)) found.add(parseInt(m[1], 10));
  } else if (Array.isArray(obj)) {
    obj.forEach(v => scanRedactedRefs(v, found));
  } else if (isPlainObject(obj)) {
    Object.values(obj).forEach(v => scanRedactedRefs(v, found));
  }
}

export const SESSION_REFERENCE_TYPES = ['child', 'peer', 'precursor', 'breakout'];

export interface ValidateContext {
  partyCount?: number;
  dialogCount?: number;
  sessionCount?: number;
  label?: string;
}

/** Validate one Session Object. Returns `{ errors, warnings }`. */
export function validateSession(
  session: unknown,
  ctx: ValidateContext = {}
): { errors: string[]; warnings: string[] } {
  const { partyCount, dialogCount, sessionCount } = ctx;
  const label = ctx.label ?? 'Session';
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isPlainObject(session)) {
    return { errors: [`${label} must be a dictionary.`], warnings };
  }
  if (Object.keys(session).length === 0) {
    return { errors, warnings }; // an empty placeholder Session is permitted
  }

  if ('start' in session) {
    if (parseDateTime(session.start) === undefined) {
      errors.push(`${label} has an invalid 'start' format. Must be an ISO 8601 datetime string.`);
    }
  } else {
    warnings.push(`${label} should have a start parameter.`);
  }

  if ('duration' in session) {
    const d = session.duration;
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0) {
      errors.push(`${label} field 'duration' must be a non-negative number.`);
    }
  }

  if ('parties' in session) {
    const p = session.parties;
    if (!Array.isArray(p)) {
      errors.push(`${label} field 'parties' must be a list.`);
    } else {
      for (const idx of p) {
        if (!isIndex(idx) || (partyCount !== undefined && idx >= partyCount)) {
          errors.push(`${label} references invalid party index: ${idx}`);
        }
      }
    }
  } else {
    warnings.push(`${label} should have a parties parameter.`);
  }

  if ('originator' in session) {
    const o = session.originator;
    if (!isIndex(o) || (partyCount !== undefined && o >= partyCount)) {
      errors.push(`${label} references invalid party index: ${o}`);
    }
  }

  if ('session_id' in session && !isPlainObject(session.session_id)) {
    errors.push(`${label} field 'session_id' must be a SessionId Object.`);
  }

  if ('dialog' in session) {
    const dl = session.dialog;
    if (!Array.isArray(dl)) {
      errors.push(`${label} field 'dialog' must be a list.`);
    } else {
      for (const idx of dl) {
        if (!isIndex(idx) || (dialogCount !== undefined && idx >= dialogCount)) {
          errors.push(`${label} references invalid dialog index: ${idx}`);
        }
      }
    }
  }

  if ('sessions' in session) {
    const refs = session.sessions;
    if (!Array.isArray(refs)) {
      errors.push(`${label} field 'sessions' must be a list.`);
    } else {
      refs.forEach((ref, n) => {
        if (!isPlainObject(ref)) {
          errors.push(`${label} sessions[${n}] must be a dictionary.`);
          return;
        }
        for (const req of ['session', 'type']) {
          if (!(req in ref)) errors.push(`${label} sessions[${n}] is missing required field: ${req}`);
        }
        if ('session' in ref) {
          if (!isIndex(ref.session) || (sessionCount !== undefined && ref.session >= sessionCount)) {
            errors.push(`${label} references invalid session index: ${ref.session}`);
          }
        }
        if ('type' in ref && typeof ref.type !== 'string') {
          errors.push(`${label} sessions[${n}] field 'type' must be a string.`);
        }
      });
    }
  }
  return { errors, warnings };
}

export type RuleCode = 'M' | 'O' | 'SN' | 'X';

export const PARTY_EVENT_TYPES = ['join', 'drop', 'hold', 'unhold', 'mute', 'unmute'];
export const KEY_EVENT_TYPES = ['keydown', 'keyup'];
export const TRANSFER_EVENT_TYPES = [
  'consultation-start',
  'blind-transfer',
  'consultative-transfer',
  'transfer-abandoned'
];
export const CHANNEL_CONTRIBUTORS_EVENT_TYPE = 'channel-contributors';

/** Every Event type token defined by core-05 (section 4.3.1). */
export const CORE_EVENT_TYPES = [
  ...PARTY_EVENT_TYPES,
  ...KEY_EVENT_TYPES,
  ...TRANSFER_EVENT_TYPES,
  CHANNEL_CONTRIBUTORS_EVENT_TYPE
];

/** Event parameters in the order of section 4.3. */
export const EVENT_PARAMETERS = [
  'type',
  'time',
  'sessions',
  'party',
  'dialog',
  'channel',
  'contributors',
  'button',
  'transferee',
  'transfer_target',
  'consultation',
  'target_session'
] as const;

type Rules = Record<(typeof EVENT_PARAMETERS)[number], RuleCode>;

function rules(overrides: Partial<Rules> = {}): Rules {
  return {
    type: 'M',
    time: 'M',
    sessions: 'M',
    party: 'M',
    dialog: 'SN',
    channel: 'X',
    contributors: 'X',
    button: 'X',
    transferee: 'X',
    transfer_target: 'X',
    consultation: 'X',
    target_session: 'X',
    ...overrides
  };
}

/** Parameter applicability by Event type (section 4.3.1.5 tables). */
export const EVENT_PARAMETER_RULES: Record<string, Rules> = {};
for (const t of PARTY_EVENT_TYPES) EVENT_PARAMETER_RULES[t] = rules();
for (const t of KEY_EVENT_TYPES) EVENT_PARAMETER_RULES[t] = rules({ button: 'M' });
EVENT_PARAMETER_RULES['consultation-start'] = rules({
  transferee: 'M',
  transfer_target: 'M',
  consultation: 'M',
  target_session: 'X'
});
EVENT_PARAMETER_RULES['blind-transfer'] = rules({
  transferee: 'M',
  transfer_target: 'M',
  consultation: 'X',
  target_session: 'M'
});
EVENT_PARAMETER_RULES['consultative-transfer'] = rules({
  transferee: 'M',
  transfer_target: 'M',
  consultation: 'M',
  target_session: 'M'
});
EVENT_PARAMETER_RULES['transfer-abandoned'] = rules({
  transferee: 'M',
  transfer_target: 'O',
  consultation: 'O',
  target_session: 'X'
});
EVENT_PARAMETER_RULES[CHANNEL_CONTRIBUTORS_EVENT_TYPE] = {
  type: 'M',
  time: 'M',
  sessions: 'X',
  party: 'X',
  dialog: 'M',
  channel: 'M',
  contributors: 'O',
  button: 'X',
  transferee: 'X',
  transfer_target: 'X',
  consultation: 'X',
  target_session: 'X'
};

function isIndexOrList(value: unknown): boolean {
  return isIndex(value) || (Array.isArray(value) && value.every(isIndex));
}

/**
 * Validate one Event Object against core-05 section 4.3.
 *
 * SN violations are warnings, M and X violations are errors. An Event whose
 * type is not a core token is only checked for `type` and `time` (section 2.5:
 * it belongs to an extension). Index values are range-checked only when the
 * matching count is supplied.
 */
export function validateEvent(
  event: unknown,
  ctx: ValidateContext = {}
): { errors: string[]; warnings: string[] } {
  const { partyCount, dialogCount, sessionCount } = ctx;
  const label = ctx.label ?? 'Event';
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isPlainObject(event)) {
    return { errors: [`${label} must be a dictionary.`], warnings };
  }

  const etype = event.type;
  if (typeof etype !== 'string' || !etype) {
    errors.push(`${label} is missing required field: type`);
  }
  if (!('time' in event)) {
    errors.push(`${label} is missing required field: time`);
  } else if (parseDateTime(event.time) === undefined) {
    errors.push(`${label} has an invalid 'time' format. Must be an ISO 8601 datetime string.`);
  }

  const table = typeof etype === 'string' && Object.prototype.hasOwnProperty.call(EVENT_PARAMETER_RULES, etype)
    ? EVENT_PARAMETER_RULES[etype]
    : undefined;
  if (table) {
    for (const [param, code] of Object.entries(table)) {
      const present = param in event;
      if (code === 'M' && !present) {
        errors.push(`${label} of type '${etype}' is missing required field: ${param}`);
      } else if (code === 'X' && present) {
        errors.push(`${label} of type '${etype}' must not have field: ${param}`);
      } else if (code === 'SN' && present) {
        warnings.push(`${label} of type '${etype}' should not have field: ${param}`);
      }
    }
  }

  const checkIndex = (param: string, count: number | undefined, noun: string): void => {
    if (!(param in event)) return;
    const val = event[param];
    if (!isIndex(val)) {
      errors.push(`${label} field '${param}' must be a non-negative integer.`);
    } else if (count !== undefined && val >= count) {
      errors.push(`${label} references invalid ${noun} index: ${val}`);
    }
  };
  checkIndex('party', partyCount, 'party');
  checkIndex('transferee', partyCount, 'party');
  checkIndex('transfer_target', partyCount, 'party');
  checkIndex('consultation', sessionCount, 'session');
  checkIndex('target_session', sessionCount, 'session');

  if ('dialog' in event) {
    const val = event.dialog;
    let idxs: number[] = [];
    if (isIndex(val)) {
      idxs = [val];
    } else if (
      Array.isArray(val) &&
      typeof etype === 'string' &&
      !CORE_EVENT_TYPES.includes(etype) &&
      val.every(isIndex)
    ) {
      idxs = val as number[]; // extension event types may use an array (4.3.5)
    } else {
      errors.push(`${label} field 'dialog' must be a non-negative integer.`);
    }
    for (const v of idxs) {
      if (dialogCount !== undefined && v >= dialogCount) {
        errors.push(`${label} references invalid dialog index: ${v}`);
      }
    }
  }

  if ('channel' in event && !isIndex(event.channel)) {
    errors.push(`${label} field 'channel' must be a non-negative integer.`);
  }

  if ('sessions' in event) {
    const val = event.sessions;
    if (!isIndexOrList(val)) {
      errors.push(`${label} field 'sessions' must be an index or a list of indices.`);
    } else {
      const idxs: number[] = Array.isArray(val) ? val : [val as number];
      if (typeof etype === 'string' && TRANSFER_EVENT_TYPES.includes(etype) && Array.isArray(val)) {
        errors.push(`${label} of type '${etype}' must reference a single session index in 'sessions'.`);
      }
      for (const v of idxs) {
        if (sessionCount !== undefined && v >= sessionCount) {
          errors.push(`${label} references invalid session index: ${v}`);
        }
      }
    }
  }

  if ('contributors' in event) {
    const val = event.contributors;
    if (val !== null && !isIndexOrList(val)) {
      errors.push(`${label} field 'contributors' must be an index, a list of indices or null.`);
    } else if (val !== null) {
      for (const v of Array.isArray(val) ? val : [val]) {
        if (partyCount !== undefined && v >= partyCount) {
          errors.push(`${label} references invalid party index: ${v}`);
        }
      }
    }
  }

  if ('button' in event && typeof event.button !== 'string') {
    errors.push(`${label} field 'button' must be a string.`);
  }

  return { errors, warnings };
}

/**
 * The reference's validate_vcon_dict (vcon-lib 1.0.6): core-05 document rules.
 * A signed (JWS) vCon is checked as a JWS and its payload as a vCon; an
 * encrypted (JWE) vCon is checked as a JWE only.
 */
export function validateVconDict(
  vcon: Record<string, any>,
  dialogMimeTypes: readonly string[] = REFERENCE_DIALOG_MIME_TYPES
): Findings {
  if (signedForm(vcon)) return validateJws(vcon, dialogMimeTypes);
  if (encryptedForm(vcon)) return validateJwe(vcon);
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- required fields and version ----------------------------------------
  for (const field of ['uuid', 'created_at']) {
    if (!(field in vcon)) errors.push(`Missing required field: ${field}`);
  }
  for (const ts of ['created_at', 'updated_at']) {
    if (ts in vcon && parseDateTime(vcon[ts]) === undefined) {
      errors.push(`Invalid ${ts} format. Must be an ISO 8601 datetime string: ${dateTimeProblem(vcon[ts])}`);
    }
  }
  if ('vcon' in vcon && vcon.vcon !== SYNTAX_VERSION) {
    errors.push(
      `Unsupported vcon syntax version '${vcon.vcon}': this library writes '${SYNTAX_VERSION}'. ` +
        'Migrate a 0.4.0 vCon with migrate_0_4_0_to_0_5_0().'
    );
  }
  for (const [old, neu] of Object.entries(LEGACY_TOP_LEVEL)) {
    if (old in vcon) errors.push(`Legacy 0.4.0 parameter '${old}' was renamed '${neu}' in 0.5.0.`);
  }

  // --- parties --------------------------------------------------------------
  let parties: any[] = [];
  if ('parties' in vcon) {
    if (!Array.isArray(vcon.parties)) {
      errors.push("Field 'parties' must be a list.");
    } else {
      parties = vcon.parties;
      parties.forEach((party, i) => {
        if (!isPlainObject(party)) errors.push(`Party at index ${i} must be a dictionary.`);
      });
    }
  }
  const partyCount = parties.length;

  let dialogs: any[] = [];
  if ('dialog' in vcon) {
    if (!Array.isArray(vcon.dialog)) errors.push("Field 'dialog' must be a list.");
    else dialogs = vcon.dialog;
  }
  const dialogCount = dialogs.length;
  let sessions: any[] = [];
  if ('sessions' in vcon) {
    if (!Array.isArray(vcon.sessions)) errors.push("Field 'sessions' must be a list.");
    else sessions = vcon.sessions;
  }
  const sessionCount = sessions.length;
  let events: any[] = [];
  if ('events' in vcon) {
    if (!Array.isArray(vcon.events)) errors.push("Field 'events' must be a list.");
    else events = vcon.events;
  }
  let attachments: any[] = [];
  if ('attachments' in vcon) {
    if (!Array.isArray(vcon.attachments)) errors.push("Field 'attachments' must be a list.");
    else attachments = vcon.attachments;
  }
  let analyses: any[] = [];
  if ('analysis' in vcon) {
    if (!Array.isArray(vcon.analysis)) errors.push("Field 'analysis' must be a list.");
    else analyses = vcon.analysis;
  }
  const redacted = isPlainObject(vcon.redacted_from);

  // --- redacted_from / amended_from ----------------------------------------
  if ('redacted_from' in vcon && 'amended_from' in vcon) {
    errors.push('redacted_from and amended_from are mutually exclusive.');
  }
  if ('redacted_from' in vcon) {
    const rf = vcon.redacted_from;
    if (!isPlainObject(rf)) {
      errors.push("Field 'redacted_from' must be an object.");
    } else {
      if (!('type' in rf)) errors.push('redacted_from is missing required field: type');
      if ('url' in rf && !('content_hash' in rf)) errors.push('redacted_from with url must include content_hash.');
      checkContent(rf, 'redacted_from', errors, warnings);
    }
  }
  if ('amended_from' in vcon) {
    const af = vcon.amended_from;
    if (!isPlainObject(af)) {
      errors.push("Field 'amended_from' must be an object.");
    } else {
      if (!('uuid' in af) && !('url' in af)) {
        errors.push('amended_from must include uuid, or an external reference (url).');
      }
      if ('url' in af && !('content_hash' in af)) errors.push('amended_from with url must include content_hash.');
      checkContent(af, 'amended_from', errors, warnings);
    }
  }

  // --- extensions / critical -----------------------------------------------
  let extListed: any[] = [];
  if ('extensions' in vcon) {
    if (!Array.isArray(vcon.extensions) || !vcon.extensions.every((x: unknown) => typeof x === 'string')) {
      errors.push("Field 'extensions' must be a list of strings.");
    } else {
      extListed = vcon.extensions;
    }
  }
  let crit: any[] = [];
  if ('critical' in vcon) {
    if (!Array.isArray(vcon.critical) || !vcon.critical.every((x: unknown) => typeof x === 'string')) {
      errors.push("Field 'critical' must be a list of strings.");
    } else {
      crit = vcon.critical;
    }
  }
  for (const name of crit) {
    if (!extListed.includes(name)) {
      errors.push(`Extension '${name}' is listed in critical but not in extensions.`);
    }
  }
  const { names: used, unnamed } = extensionsInUse(vcon);
  for (const name of [...used].sort()) {
    if (!extListed.includes(name)) {
      errors.push(`Extension '${name}' is in use but is not listed in the extensions parameter.`);
    }
  }
  if (unnamed.length && extListed.length === 0) {
    errors.push(
      'Values outside the core vocabulary are in use but the extensions parameter lists no extension: ' +
        unnamed.join('; ') +
        '.'
    );
  }

  // --- dialog -----------------------------------------------------------------
  dialogs.forEach((dialog, i) => {
    if (!isPlainObject(dialog)) {
      errors.push(`Dialog at index ${i} must be a dictionary.`);
      return;
    }
    if (Object.keys(dialog).length === 0) return; // empty placeholder Dialog Object (4.5.1)
    const dialogType = dialog.type;
    if (!('type' in dialog)) {
      errors.push(`Dialog at index ${i} is missing required field: type`);
    } else if (LEGACY_DIALOG_TYPES.includes(dialogType)) {
      errors.push(
        `Dialog at index ${i} has type '${dialogType}', which was removed in 0.5.0 ` +
          '(use Events and Sessions; migrate with migrate_0_4_0_to_0_5_0()).'
      );
    } else if (LIBRARY_DIALOG_TYPES.includes(dialogType) && extListed.length === 0) {
      warnings.push(
        `Dialog at index ${i} has type '${dialogType}', which core-05 does not define; ` +
          "it is read as 'recording' (written by older library versions)."
      );
    } else if (
      !CORE_DIALOG_TYPES.includes(dialogType) &&
      !LIBRARY_DIALOG_TYPES.includes(dialogType) &&
      extListed.length === 0
    ) {
      // A Dialog type outside the core vocabulary must come from a vCon
      // extension, which has to be listed in extensions (4.1.3).
      errors.push(`Dialog at index ${i} has an invalid type: ${dialogType}`);
    }
    for (const legacy of LEGACY_DIALOG_PARAMS) {
      if (legacy in dialog) errors.push(`Dialog at index ${i} has parameter '${legacy}', which was removed in 0.5.0.`);
    }
    if (dialogType === 'incomplete') {
      if (!('disposition' in dialog)) errors.push(`Dialog at index ${i} of type 'incomplete' must have a disposition.`);
      for (const forbidden of [
        'mediatype', 'filename', 'body', 'encoding', 'url', 'content_hash', 'message_id', 'redacted_segments'
      ]) {
        if (forbidden in dialog) {
          errors.push(`Dialog at index ${i} of type 'incomplete' must not have field: ${forbidden}`);
        }
      }
    }

    if ('parties' in dialog) {
      const dp = dialog.parties;
      if (!(Array.isArray(dp) || (typeof dp === 'number' && Number.isInteger(dp)))) {
        errors.push(`Dialog at index ${i} field 'parties' must be a list.`);
      } else {
        for (const partyIdx of flattenParties(dp)) {
          if (partyIdx === null) continue; // null placeholder for a channel with no contributor
          if (!isIndex(partyIdx) || partyIdx >= partyCount) {
            errors.push(`Dialog at index ${i} references invalid party index: ${partyIdx}`);
          }
        }
      }
    }
    if ('start' in dialog && parseDateTime(dialog.start) === undefined) {
      errors.push(`Dialog at index ${i} has an invalid 'start' format. Must be an ISO 8601 datetime string.`);
    }
    if (dialogType !== 'incomplete') {
      const hasContent = 'body' in dialog;
      if ('mediatype' in dialog) {
        if (!mediatypeOk(dialog.mediatype, dialogMimeTypes)) {
          errors.push(`Dialog at index ${i} has an invalid or missing mediatype: ${dialog.mediatype}`);
        }
      } else if (hasContent) {
        errors.push(`Dialog at index ${i} has an invalid or missing mediatype: missing`);
      }
    }
    if ('redacted_segments' in dialog) {
      const segs = dialog.redacted_segments;
      if (!Array.isArray(segs)) {
        errors.push(`Dialog at index ${i} field 'redacted_segments' must be a list.`);
      } else {
        segs.forEach((seg, n) => {
          if (!isPlainObject(seg) || !('start' in seg) || !('end' in seg)) {
            errors.push(`Dialog at index ${i} redacted_segments[${n}] requires start and end.`);
          }
        });
      }
    }
  });

  dialogs.forEach((dialog, i) => {
    if (isPlainObject(dialog) && dialog.type !== 'incomplete') {
      checkContent(dialog, `Dialog at index ${i}`, errors, warnings);
    }
  });

  // --- sessions -----------------------------------------------------------------
  if ((dialogCount || events.length) && sessions.length === 0) {
    errors.push('At least one Session Object MUST exist if the events array or the dialog array contains Objects.');
  }
  sessions.forEach((s, i) => {
    const r = validateSession(s, { partyCount, dialogCount, sessionCount, label: `Session at index ${i}` });
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  });
  const referencedDialogs = new Set<number>();
  for (const s of sessions) {
    if (isPlainObject(s) && Array.isArray(s.dialog)) {
      for (const x of s.dialog) if (isIndex(x)) referencedDialogs.add(x);
    }
  }
  dialogs.forEach((d, i) => {
    if (isPlainObject(d) && Object.keys(d).length > 0 && !referencedDialogs.has(i)) {
      warnings.push(`Dialog at index ${i} is not referenced by any Session Object.`);
    }
  });
  const emptyDialogs = new Set<number>();
  dialogs.forEach((d, i) => {
    if (isPlainObject(d) && Object.keys(d).length === 0) emptyDialogs.add(i);
  });
  sessions.forEach((s, n) => {
    if (!isPlainObject(s)) return;
    if (Array.isArray(s.parties) && s.parties.length > 0 && s.originator === s.parties[0]) {
      warnings.push(
        `Session at index ${n} has originator equal to its first party; originator is ` +
          'only provided when the first party is not the originator (4.2.4).'
      );
    }
    const listed = asList(s.dialog).filter(isIndex).sort((a, b) => a - b);
    for (const x of [...new Set(listed)]) {
      if (emptyDialogs.has(x)) warnings.push(`Session at index ${n} lists dialog ${x}, which is an empty placeholder Dialog.`);
    }
  });

  // --- events ---------------------------------------------------------------------
  events.forEach((ev, i) => {
    const r = validateEvent(ev, { partyCount, dialogCount, sessionCount, label: `Event at index ${i}` });
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    if (isPlainObject(ev) && ev.type === 'channel-contributors' && isIndex(ev.dialog)) {
      const di = ev.dialog;
      if (di < dialogCount && isPlainObject(dialogs[di]) && dialogs[di].type !== 'recording') {
        errors.push(`Event at index ${i} of type 'channel-contributors' must reference a 'recording' Dialog.`);
      }
    }
  });

  // --- attachments --------------------------------------------------------------
  attachments.forEach((attachment, i) => {
    if (!isPlainObject(attachment)) {
      errors.push(`Attachment at index ${i} must be a dictionary.`);
      return;
    }
    if (!('purpose' in attachment)) errors.push(`Attachment at index ${i} is missing required field: purpose`);
    const hasInline = 'body' in attachment && 'encoding' in attachment;
    const hasExternal = 'url' in attachment;
    if (!(hasInline || hasExternal || redacted)) {
      errors.push(`Attachment at index ${i} must include body+encoding or url.`);
    }
    checkContent(attachment, `Attachment at index ${i}`, errors, warnings);
    if ('encoding' in attachment && !CORE_ENCODINGS.includes(attachment.encoding) && extListed.length === 0) {
      errors.push(`Attachment at index ${i} has invalid encoding: ${attachment.encoding}`);
    }
    if ('body' in attachment && attachment.body !== '' && !('mediatype' in attachment)) {
      errors.push(`Attachment at index ${i} is missing required field: mediatype (needed for inline content)`);
    }
    if (!('start' in attachment)) errors.push(`Attachment at index ${i} is missing required field: start`);
    if (!('party' in attachment)) {
      errors.push(`Attachment at index ${i} is missing required field: party`);
    } else if (!isIndex(attachment.party) || attachment.party >= partyCount) {
      errors.push(`Attachment at index ${i} references invalid party index: ${attachment.party}`);
    }
    if (!('dialog' in attachment) && !('session' in attachment)) {
      errors.push(`Attachment at index ${i} must have at least one of dialog or session.`);
    }
    if ('dialog' in attachment) {
      const dv = attachment.dialog;
      if (!isIndex(dv) || dv >= dialogCount) {
        errors.push(`Attachment at index ${i} references invalid dialog index: ${dv}`);
      } else if (emptyDialogs.has(dv)) {
        warnings.push(`Attachment at index ${i} references dialog ${dv}, an empty placeholder Dialog.`);
      }
    }
    if ('session' in attachment) {
      const sv = attachment.session;
      const vals = Array.isArray(sv) ? sv : [sv];
      if (Array.isArray(sv) && sv.length === 0) {
        errors.push(`Attachment at index ${i} field 'session' must not be empty.`);
      }
      for (const v of vals) {
        if (!isIndex(v) || v >= sessionCount) {
          errors.push(`Attachment at index ${i} references invalid session index: ${v}`);
        }
      }
    }
  });

  // --- analysis ---------------------------------------------------------------------
  analyses.forEach((analysis, i) => {
    if (!isPlainObject(analysis)) {
      errors.push(`Analysis at index ${i} must be a dictionary.`);
      return;
    }
    for (const field of ['type', 'vendor']) {
      if (!(field in analysis)) errors.push(`Analysis at index ${i} is missing required field: ${field}`);
    }
    if ('body' in analysis && analysis.body !== '' && !('encoding' in analysis)) {
      errors.push(`Analysis at index ${i} is missing required field: encoding`);
    }
    if ('encoding' in analysis && !CORE_ENCODINGS.includes(analysis.encoding) && extListed.length === 0) {
      errors.push(`Analysis at index ${i} has invalid encoding: ${analysis.encoding}`);
    }
    checkContent(analysis, `Analysis at index ${i}`, errors, warnings);
    const refs: Array<[string, number, string]> = [
      ['dialog', dialogCount, 'dialog'],
      ['sessions', sessionCount, 'session'],
      ['attachment', attachments.length, 'attachment'],
      ['analysis', analyses.length, 'analysis']
    ];
    for (const [key, count, noun] of refs) {
      if (!(key in analysis)) continue;
      const val = analysis[key];
      if (!(typeof val === 'number' || Array.isArray(val))) {
        errors.push(`Analysis at index ${i} has an invalid '${key}' reference type.`);
        continue;
      }
      for (const v of Array.isArray(val) ? val : [val]) {
        if (!isIndex(v) || v >= count) {
          errors.push(`Analysis at index ${i} references invalid ${noun} index: ${v}`);
        } else if (key === 'analysis' && v === i) {
          errors.push(`Analysis at index ${i} must not reference itself in analysis.`);
        }
      }
    }
    if (!['dialog', 'sessions', 'attachment', 'analysis'].some(k => k in analysis)) {
      warnings.push(`Analysis at index ${i} should have at least one of dialog, sessions, attachment or analysis.`);
    }
  });

  // --- redacted_strings -----------------------------------------------------------
  const refsDeclared = new Set<number>();
  if ('redacted_strings' in vcon) {
    const rs = vcon.redacted_strings;
    if (!Array.isArray(rs)) {
      errors.push("Field 'redacted_strings' must be a list.");
    } else {
      if (rs.length > 99999) errors.push('A vCon MUST NOT have more than 99999 redacted substrings.');
      rs.forEach((item, n) => {
        if (!isPlainObject(item) || !Number.isInteger(item.ref)) {
          errors.push(`redacted_strings[${n}] requires an integer ref.`);
          return;
        }
        if (item.ref < 1 || item.ref > 99999) errors.push(`redacted_strings[${n}] ref must be between 1 and 99999.`);
        if (refsDeclared.has(item.ref)) errors.push(`redacted_strings[${n}] duplicates ref ${item.ref}.`);
        refsDeclared.add(item.ref);
      });
    }
  }
  const found = new Set<number>();
  const rest: Record<string, any> = {};
  for (const [k, v] of Object.entries(vcon)) if (k !== 'redacted_strings') rest[k] = v;
  scanRedactedRefs(rest, found);
  for (const ref of [...found].sort((a, b) => a - b)) {
    if (!refsDeclared.has(ref)) {
      errors.push(`__REDACTED_REF_${ref} appears in the vCon but has no entry in redacted_strings.`);
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Signed (JWS) and encrypted (JWE) vCons (core-05 sections 6.2, 6.3)
// ---------------------------------------------------------------------------

/** True for a JWS General JSON Serialization container. */
export function signedForm(vcon: unknown): boolean {
  return isPlainObject(vcon) && !('uuid' in vcon) && 'payload' in vcon && 'signatures' in vcon;
}

/** True for a JWE General JSON Serialization container. */
export function encryptedForm(vcon: unknown): boolean {
  return isPlainObject(vcon) && !('uuid' in vcon) && 'ciphertext' in vcon;
}

/** The decoded JWS payload of a signed vCon, or undefined if it is not base64url JSON. */
export function signedPayload(vcon: Record<string, any>): unknown {
  return decodeJsonPayload(vcon.payload);
}

function validateJws(vcon: Record<string, any>, dialogMimeTypes: readonly string[]): Findings {
  const errors: string[] = [];
  const sigs = vcon.signatures;
  if (!Array.isArray(sigs) || sigs.length === 0) {
    errors.push("Signed vCon: 'signatures' must be a non-empty array.");
  } else {
    sigs.forEach((sig, n) => {
      if (!isPlainObject(sig)) {
        errors.push(`Signed vCon: signatures[${n}] must be an object.`);
        return;
      }
      if (typeof sig.signature !== 'string') errors.push(`Signed vCon: signatures[${n}] is missing 'signature'.`);
      if (typeof sig.protected !== 'string' && !isPlainObject(sig.header)) {
        errors.push(`Signed vCon: signatures[${n}] needs 'protected' or 'header'.`);
      }
    });
  }
  const payload = signedPayload(vcon);
  if (!isPlainObject(payload)) {
    errors.push("Signed vCon: 'payload' is not a base64url-encoded JSON object.");
    return { errors, warnings: [] };
  }
  const inner = validateVconDict(payload, dialogMimeTypes);
  return { errors: [...errors, ...inner.errors], warnings: inner.warnings };
}

function validateJwe(vcon: Record<string, any>): Findings {
  const errors: string[] = [];
  for (const member of ['ciphertext', 'iv', 'tag']) {
    if (member in vcon && typeof vcon[member] !== 'string') {
      errors.push(`Encrypted vCon: '${member}' must be a base64url string.`);
    }
  }
  if ('recipients' in vcon && (!Array.isArray(vcon.recipients) || vcon.recipients.length === 0)) {
    errors.push("Encrypted vCon: 'recipients' must be a non-empty array.");
  }
  if ('protected' in vcon && typeof vcon.protected !== 'string') {
    errors.push("Encrypted vCon: 'protected' must be a base64url string.");
  }
  return { errors, warnings: ['Encrypted vCon: the content cannot be validated without decrypting it.'] };
}

// ---------------------------------------------------------------------------
// is_valid() / get_validation_warnings()
// ---------------------------------------------------------------------------

/**
 * Lawful basis body findings for every `purpose: "lawful_basis"` attachment of a
 * vCon (the payload of a signed one; none for an encrypted one), prefixed
 * `Attachment at index {i} (lawful_basis): `. Scope warnings are left to the
 * document rules.
 */
export function lawfulBasisFindings(vcon: Record<string, any>): Findings {
  const errors: string[] = [];
  const warnings: string[] = [];
  let content: unknown = signedForm(vcon) ? signedPayload(vcon) : vcon;
  if (encryptedForm(vcon) || !isPlainObject(content)) content = {};
  const doc = content as Record<string, any>;
  const attachments = Array.isArray(doc.attachments) ? doc.attachments : [];
  attachments.forEach((attachment: unknown, i: number) => {
    if (!isPlainObject(attachment) || attachment.purpose !== 'lawful_basis') return;
    if (isPlainObject(doc.redacted_from) && !('body' in attachment)) return;
    const result = validateLawfulBasisAttachment(attachment);
    errors.push(...result.errors.map((e) => `Attachment at index ${i} (lawful_basis): ${e}`));
    warnings.push(
      ...result.warnings
        .filter((w) => !w.includes('no party') && !w.includes('no session'))
        .map((w) => `Attachment at index ${i} (lawful_basis): ${w}`)
    );
  });
  return { errors, warnings };
}

/** Vcon.is_valid() errors and get_validation_warnings() warnings of the reference. */
export function validateReference(vcon: Record<string, any>): Findings {
  const core = validateVconDict(vcon);
  const lb = lawfulBasisFindings(vcon);
  return { errors: [...core.errors, ...lb.errors], warnings: [...core.warnings, ...lb.warnings] };
}
