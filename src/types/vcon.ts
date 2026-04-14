/**
 * IETF vCon Core Types - Compliant with draft-ietf-vcon-vcon-core-02
 *
 * Spec version: 0.4.0  (January 2026)
 * Reference: https://ietf-wg-vcon.github.io/draft-ietf-vcon-vcon-core/
 *
 * Breaking changes vs -01:
 *   'mimetype'     → 'mediatype'    (dialog, analysis, attachments) — since 0.0.2
 *   'appended'     → 'amended'      (vCon top-level)                — since 0.4.0
 *   'must_support' → 'critical'     (vCon top-level)                — since 0.4.0
 *   session_id     now SessionId object {local, remote}             — since 0.4.0
 *
 * Key spec requirements:
 *   1. Dialog content can be inline (body + encoding) or external (url + content_hash)
 *   2. body and url are mutually exclusive for content storage
 *   3. HTTPS MUST be used for external content retrieval
 *   4. encoding: 'base64url' | 'json' | 'none'
 *   5. Analysis: vendor is REQUIRED, schema (not schema_version), body is string
 *   6. Dialog types: 'recording' | 'text' | 'transfer' | 'incomplete'
 *   7. 'transfer' and 'incomplete' MUST NOT have Dialog Content parameters
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type VConVersion = '0.4.0';
export type Encoding = 'base64url' | 'json' | 'none';
export type DialogType = 'recording' | 'text' | 'transfer' | 'incomplete';
export type DialogDisposition = 'no-answer' | 'congestion' | 'failed' | 'busy' | 'hung-up' | 'voicemail-no-message';
export type PartyEventType = 'join' | 'drop' | 'hold' | 'unhold' | 'mute' | 'unmute';

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
// Section 4.3 - Dialog Object
// ============================================================================

/**
 * Session Identifier Object - Section 2.2 / 4.3.10
 * Changed from String to Object in spec v0.4.0
 */
export interface SessionId {
  local: string;   // local-uuid
  remote: string;  // remote-uuid
}

/**
 * Party History - Section 4.3.11
 */
export interface PartyHistory {
  party: number;
  time: string;  // ISO 8601 datetime string
  event: PartyEventType;
}

/**
 * Dialog Object - Section 4.3
 *
 * Content stored in two mutually exclusive ways:
 *   Inline:   body + encoding
 *   External: url + content_hash (HTTPS required)
 *
 * 'transfer' and 'incomplete' types MUST NOT have content parameters.
 */
export interface Dialog {
  type: DialogType;
  start?: string;           // ISO 8601 datetime string
  duration?: number;        // Duration in seconds (UnsignedInt | UnsignedFloat)
  parties?: number | number[] | (number | number[])[];
  originator?: number;
  mediatype?: string;       // ✅ 'mediatype' (was 'mimetype' pre-0.0.2)
  filename?: string;

  // Inline content (mutually exclusive with url)
  body?: string;
  encoding?: Encoding;

  // External content (mutually exclusive with body)
  url?: string;
  content_hash?: string | string[];

  disposition?: DialogDisposition;
  session_id?: SessionId;   // ✅ SessionId object (was String pre-0.4.0)
  party_history?: PartyHistory[];
  application?: string;     // Section 4.3.13
  message_id?: string;      // Section 4.3.14

  // Transfer-specific (type='transfer' only)
  transferee?: number;
  transferor?: number;
  transfer_target?: number | number[];
  original?: number | number[];
  consultation?: number | number[];
  target_dialog?: number | number[];
}

// ============================================================================
// Section 4.4 - Attachment Object
// ============================================================================

/**
 * Attachment Object - Section 4.4
 */
export interface Attachment {
  purpose?: string;         // Section 4.4.1
  start?: string;           // Section 4.4.2 - ISO 8601 datetime
  party?: number;           // Section 4.4.3
  dialog?: number;          // Section 4.4.4
  mediatype?: string;       // ✅ 'mediatype' (was 'mimetype' pre-0.0.2)
  filename?: string;
  body?: string;
  encoding?: Encoding;
  url?: string;
  content_hash?: string | string[];
  // Non-spec fields used by Strolid for custom attachment types (stored in metadata)
  type?: string;
}

// ============================================================================
// Section 4.5 - Analysis Object
// ============================================================================

/**
 * Analysis Object - Section 4.5
 *
 * ⚠️  CRITICAL: 'vendor' is REQUIRED (no ?)
 * ⚠️  CORRECT field name is 'schema' NOT 'schema_version'
 * ⚠️  'body' MUST be a string (JSON.stringify objects before storing)
 */
export interface Analysis {
  type: string;             // e.g., 'summary', 'transcript', 'translation', 'sentiment'
  dialog?: number | number[];  // Section 4.5.2
  mediatype?: string;       // ✅ 'mediatype' (was 'mimetype' pre-0.0.2)
  filename?: string;
  vendor: string;           // ✅ REQUIRED — no optional marker
  product?: string;
  schema?: string;          // ✅ 'schema' NOT 'schema_version'
  body?: string;            // ✅ Must be string; JSON.stringify objects
  encoding?: Encoding;
  url?: string;
  content_hash?: string | string[];
}

// ============================================================================
// Section 4.1.8 - Redacted Object
// ============================================================================

export interface Redacted {
  uuid?: string;
  type?: string;
  url?: string;
  content_hash?: string | string[];
}

// ============================================================================
// Section 4.1.9 - Amended Object (was 'Appended' pre-0.4.0)
// ============================================================================

export interface Amended {
  uuid?: string;
  url?: string;
  content_hash?: string | string[];
}

/** @deprecated Use Amended — renamed in spec v0.4.0 */
export type Appended = Amended;

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
 * Main vCon Object - Section 4.1 (spec v0.4.0)
 *
 * Field renames from earlier versions:
 *   appended    → amended     (v0.4.0)
 *   must_support → critical   (v0.4.0)
 */
export interface VCon {
  vcon: VConVersion;        // Must be "0.4.0" per spec
  uuid: string;
  extensions?: string[];    // Section 4.1.3 - compatible extension names
  critical?: string[];      // ✅ Section 4.1.4 (was 'must_support' pre-0.4.0)
  created_at: string;       // ISO 8601 datetime — MUST be present
  updated_at?: string;      // ISO 8601 datetime
  subject?: string;
  redacted?: Redacted;      // Section 4.1.8
  amended?: Amended;        // ✅ Section 4.1.9 (was 'appended' pre-0.4.0)
  group?: Group[];
  parties: Party[];
  dialog?: Dialog[];
  analysis?: Analysis[];
  attachments?: Attachment[];
}

// ============================================================================
// Validation Helper Functions
// ============================================================================

export function isValidDialogType(type: string): type is DialogType {
  return ['recording', 'text', 'transfer', 'incomplete'].includes(type);
}

export function isValidEncoding(encoding: string): encoding is Encoding {
  return ['base64url', 'json', 'none'].includes(encoding);
}

export function isValidDisposition(disposition: string): disposition is DialogDisposition {
  return ['no-answer', 'congestion', 'failed', 'busy', 'hung-up', 'voicemail-no-message'].includes(disposition);
}

export function isValidPartyEvent(event: string): event is PartyEventType {
  return ['join', 'drop', 'hold', 'unhold', 'mute', 'unmute'].includes(event);
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
