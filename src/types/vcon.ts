/**
 * IETF vCon Core Types - draft-ietf-vcon-vcon-core-05
 *
 * Spec version: 0.5.0 (syntax string "0.5.0"). Readers also accept 0.4.0 and
 * migrate it on read (see src/utils/vcon-migration.ts); writers emit 0.5.0.
 *
 * Changes vs 0.4.0 (draft-ietf-vcon-vcon-core-05, Appendix A.1):
 *   Session Object and top-level 'sessions'      - new
 *   Event Object and top-level 'events'          - replace Dialog party_history and
 *                                                  'transfer' Dialogs (transfer events)
 *   Dialog 'originator'                          - moved to the Session
 *   Dialog 'parties'                             - contributors only; receivers are the
 *                                                  Session 'parties'
 *   'recording-set' Dialog, 'recordings',
 *   'recording_set'                              - replaced by the Session
 *   removed Dialogs                              - empty Dialog Object {} holds the index
 *   'redacted' -> 'redacted_from'                - renamed
 *   'amended'  -> 'amended_from'                 - renamed
 *   Attachment                                   - 'party' plus 'dialog' or 'session'
 *   Analysis                                     - 'sessions', 'analysis' references added
 *   JWS alg "none"                               - forbidden
 *
 * Key spec requirements kept from earlier versions:
 *   1. Dialog content can be inline (body + encoding) or external (url, with content_hash recommended)
 *   2. body and url are mutually exclusive for content storage
 *   3. HTTPS MUST be used for external content retrieval
 *   4. encoding: 'base64url' | 'json' | 'none'
 *   5. Analysis: vendor is REQUIRED, schema (not schema_version); body is a string unless
 *      encoding is "json", in which case body is any JSON value
 *   6. Dialog types emitted: 'recording' | 'text' | 'incomplete'
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** @deprecated Version field is deprecated; any string or missing is accepted. Kept for compatibility. */
export type VConVersion = '0.5.0';
/** Version strings readers accept. Writers emit VCON_VERSION. */
export const VCON_VERSION = '0.5.0' as const;
export const LEGACY_VCON_VERSION = '0.4.0' as const;
export type Encoding = 'base64url' | 'json' | 'none';

/**
 * A JSON value as defined in [JSON]: object, array, number, string, boolean, or null.
 * Per draft-ietf-vcon-vcon-core-04 Section 2.3.2, when encoding is "json" the body
 * parameter holds a value of this type; otherwise body is a plain string.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
/** Dialog types writers emit. 'audio' and 'video' are read-only legacy values (warned about). */
export type DialogType = 'recording' | 'text' | 'incomplete';
export type LegacyDialogType = 'audio' | 'video';
export type DialogDisposition = 'no-answer' | 'congestion' | 'failed' | 'busy' | 'hung-up' | 'voicemail-no-message';
export type PartyEventType = 'join' | 'drop' | 'hold' | 'unhold' | 'mute' | 'unmute';
export type KeyEventType = 'keydown' | 'keyup';
export type TransferEventType = 'consultation-start' | 'blind-transfer' | 'consultative-transfer' | 'transfer-abandoned';
export type EventType = PartyEventType | KeyEventType | TransferEventType | 'channel-contributors';
export type SessionReferenceType = 'child' | 'peer' | 'precursor' | 'breakout';

// ============================================================================
// Section 4.2 - Party Object
// ============================================================================

export interface Civicaddress {
  country?: string;
  a1?: string;
  a2?: string;
  a3?: string;
  a4?: string;
  a5?: string;
  a6?: string;
  prd?: string;
  pod?: string;
  sts?: string;
  hno?: string;
  hns?: string;
  lmk?: string;
  loc?: string;
  flr?: string;
  nam?: string;
  pc?: string;
}

/**
 * Party Object - Section 4.2
 */
export interface Party {
  tel?: string;
  sip?: string;
  stir?: string;
  mailto?: string;
  name?: string;
  did?: string;             // Section 4.2.6 - Decentralized Identifier
  validation?: string;
  jcard?: object;
  gmlpos?: string;
  civicaddress?: Civicaddress;
  timezone?: string;
  uuid?: string;            // Section 4.2.10 - Party UUID
}

// ============================================================================
// Section 4.2 - Session Object (new in 0.5.0)
// ============================================================================

/**
 * Session Identifier Object - Section 4.2.5 / 4.5.10
 */
export interface SessionId {
  local: string;   // local-uuid
  remote: string;  // remote-uuid
}

/** Session_Reference Object - Section 4.2.8 */
export interface SessionReference {
  session: number;             // index into the top-level sessions array
  type: SessionReferenceType | string;
  description?: string;
}

/**
 * Session Object - Section 4.2
 *
 * Scope for dialog and events. `parties` are the receivers; contributors are in
 * each Dialog's `parties`. `originator` is only set when the originator is NOT
 * the first party of `parties`. A Session with no parameters is permitted.
 */
export interface Session {
  start?: string;
  duration?: number;
  parties?: number[];
  originator?: number;
  session_id?: SessionId;
  sessions?: SessionReference[];
  dialog?: number[];
}

// ============================================================================
// Section 4.3 - Event Object (new in 0.5.0)
// ============================================================================

/**
 * Event Object - Section 4.3. A point-in-time occurrence. Replaces Dialog
 * party_history and the 'transfer' Dialog. Which parameters apply depends on
 * `type` (table in 4.3.1.5); see validateEvent in src/utils/vcon-validation.ts.
 */
export interface Event {
  type: EventType | string;          // extension types are strings
  time: string;                      // ISO 8601 datetime, MUST be present
  sessions?: number | number[];      // not used by channel-contributors
  party?: number;                    // not used by channel-contributors
  dialog?: number | number[];        // channel-contributors only (SHOULD NOT elsewhere)
  channel?: number;                  // channel-contributors only
  contributors?: number | number[] | null; // channel-contributors only
  button?: string;                   // keydown / keyup only
  transferee?: number;               // transfer types
  transfer_target?: number;          // transfer types
  consultation?: number;             // Session index
  target_session?: number;           // Session index
  [extension: string]: unknown;
}

// ============================================================================
// Section 4.5 - Dialog Object
// ============================================================================

/**
 * Dialog Object - Section 4.5
 *
 * Content stored in two mutually exclusive ways:
 *   Inline:   body + encoding
 *   External: url (HTTPS required), content_hash recommended
 *
 * 'incomplete' MUST NOT have content parameters. An empty Dialog Object `{}`
 * holds a position in the dialog array so other indices do not change; `type`
 * is required unless the Dialog is empty. `parties` are the CONTRIBUTORS only.
 * party_history, originator, transfer parameters, recordings and recording_set
 * no longer exist on a 0.5.0 Dialog.
 */
export interface Dialog {
  type?: DialogType | LegacyDialogType | string;
  start?: string;           // ISO 8601 datetime string
  duration?: number;        // Duration in seconds (UnsignedInt | UnsignedFloat)
  /** Contributors. A null slot marks an unknown contributor. */
  parties?: number | (number | null)[] | (number | (number | null)[] | null)[];
  mediatype?: string;
  filename?: string;

  // Inline content (mutually exclusive with url).
  body?: string | JsonValue;
  encoding?: Encoding;

  // External content (mutually exclusive with body)
  url?: string;
  content_hash?: string | string[];

  disposition?: string;  // Any string accepted; spec suggests no-answer, congestion, failed, busy, hung-up, voicemail-no-message
  // SessionId object (or array of them). A plain string is the pre-0.4.0 form: still accepted,
  // stored/returned verbatim, never converted into an invented {local, remote} (CON-1242).
  session_id?: SessionId | SessionId[] | string;
  application?: string;
  message_id?: string;
  redacted_segments?: unknown;  // Section 4.8.2, redacted_segments Object
}

// ============================================================================
// Section 4.6 - Attachment Object
// ============================================================================

/**
 * Attachment Object - Section 4.6. `party` is required; at least one of
 * `dialog` or `session` MUST be present.
 */
export interface Attachment {
  purpose?: string;         // Section 4.6.1 - canonical spec field for attachment classification
  start?: string;           // Section 4.6.2 - ISO 8601 datetime
  party?: number;           // Section 4.6.3
  dialog?: number;          // Section 4.6.4 - single Dialog index
  session?: number | number[]; // Section 4.6.5 - one or more Session indices
  mediatype?: string;
  filename?: string;
  body?: string | JsonValue;
  encoding?: Encoding;
  url?: string;
  content_hash?: string | string[];
  // Legacy/non-spec compatibility field. Prefer purpose for new writes and reads.
  type?: string;
}

// ============================================================================
// Section 4.7 - Analysis Object
// ============================================================================

/**
 * Analysis Object - Section 4.7
 *
 * 'vendor' is REQUIRED. Field name is 'schema' NOT 'schema_version'.
 * New in 0.5.0: `sessions`, `analysis` (input analyses). At least one of
 * dialog, sessions, attachment or analysis SHOULD be present.
 */
export interface Analysis {
  type: string;             // e.g., 'summary', 'transcript', 'translation', 'sentiment'
  dialog?: number | number[];
  sessions?: number | number[];   // new in 0.5.0
  attachment?: number | number[];
  analysis?: number | number[];   // new in 0.5.0; MUST NOT reference itself
  mediatype?: string;
  filename?: string;
  vendor: string;           // REQUIRED
  product?: string;
  schema?: string;
  body?: string | JsonValue;
  encoding?: Encoding;
  url?: string;
  content_hash?: string | string[];
}

// ============================================================================
// Section 4.1.8 / 4.1.9 - Redacted_from and Amended_from Objects
// ============================================================================

export interface RedactedFrom {
  uuid?: string;
  type?: string;
  url?: string;
  content_hash?: string | string[];
}

export interface AmendedFrom {
  uuid?: string;
  url?: string;
  content_hash?: string | string[];
}

/** @deprecated 0.4.0 name; use RedactedFrom. */
export type Redacted = RedactedFrom;
/** @deprecated 0.4.0 name; use AmendedFrom. */
export type Amended = AmendedFrom;
/** @deprecated pre-0.4.0 name; use AmendedFrom. */
export type Appended = AmendedFrom;

/** Section 4.1.16 / 4.8 - Redacted_string Object */
export interface RedactedString {
  ref: number;          // 1..99999
  type?: string;
  orig?: string;
}

// ============================================================================
// Section 4.6 - Group Object
// ============================================================================

export interface Group {
  uuid?: string;
  body?: string;
  encoding?: 'json';
  url?: string;
  content_hash?: string | string[];
}

// ============================================================================
// Section 4.1 - Main vCon Object
// ============================================================================

/**
 * Main vCon Object - Section 4.1 (spec v0.5.0)
 *
 * Renames vs 0.4.0: redacted -> redacted_from, amended -> amended_from.
 * Older names remain as deprecated read aliases (see migrateLegacyKeys).
 */
export interface VCon {
  /** Version string; '0.5.0' per spec. Readers also accept '0.4.0' (migrated on read) or missing. */
  vcon?: string;
  uuid: string;
  extensions?: string[];    // Section 4.1.3 - MUST list every extension used
  critical?: string[];      // Section 4.1.4
  created_at: string;       // ISO 8601 datetime - MUST be present
  updated_at?: string;      // ISO 8601 datetime
  subject?: string;
  redacted_from?: RedactedFrom;   // Section 4.1.8 (mutually exclusive with amended_from)
  amended_from?: AmendedFrom;     // Section 4.1.9
  redacted_strings?: RedactedString[]; // Section 4.1.16
  group?: Group[];
  parties: Party[];
  sessions?: Session[];     // Section 4.1.10
  dialog?: Dialog[];
  events?: Event[];         // Section 4.1.12
  analysis?: Analysis[];
  attachments?: Attachment[];
}

// ============================================================================
// Validation Helper Functions
// ============================================================================

/** Dialog types a 0.5.0 writer may emit. */
export function isValidDialogType(type: string): type is DialogType {
  return ['recording', 'text', 'incomplete'].includes(type);
}

/** Legacy read-only values: accepted with a warning, never written. */
export function isLegacyDialogType(type: string): type is LegacyDialogType {
  return type === 'audio' || type === 'video';
}

export function isValidEncoding(encoding: string): encoding is Encoding {
  return ['base64url', 'json', 'none'].includes(encoding);
}

/**
 * Accept any non-empty string as disposition (forgiving of values outside spec).
 * Spec suggests: no-answer, congestion, failed, busy, hung-up, voicemail-no-message.
 */
export function isValidDisposition(disposition: string): boolean {
  return typeof disposition === 'string';
}

export function isValidPartyEvent(event: string): event is PartyEventType {
  return ['join', 'drop', 'hold', 'unhold', 'mute', 'unmute'].includes(event);
}

/** True for an empty Dialog Object `{}` (an index placeholder, Section 4.5.1). */
export function isEmptyDialog(dialog: unknown): boolean {
  return !!dialog && typeof dialog === 'object' && !Array.isArray(dialog) && Object.keys(dialog as object).length === 0;
}

// ============================================================================
// Utility Types
// ============================================================================

export type VConUpdate = Partial<Omit<VCon, 'uuid' | 'vcon'>> & {
  uuid: string;
  vcon?: VConVersion;
};

export type VConCreate = Omit<VCon, 'uuid' | 'created_at'> & {
  uuid?: string;
  created_at?: string;
};
