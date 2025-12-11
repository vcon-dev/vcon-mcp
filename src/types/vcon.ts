/**
 * IETF vCon Core Types - Compliant with draft-ietf-vcon-vcon-core-01
 *
 * Updated from vcon-core-00 to vcon-core-01 (2025-10-15)
 *
 * Key spec requirements:
 * 1. Dialog content can be inline (body + encoding) or external (url + content_hash)
 * 2. body and url are mutually exclusive for content storage
 * 3. HTTPS MUST be used for external content retrieval
 * 4. encoding: 'base64url' | 'json' | 'none'
 * 5. Analysis: vendor is REQUIRED, schema (not schema_version), body is string
 * 6. Dialog types: 'recording' | 'text' | 'transfer' | 'incomplete'
 * 7. transfer and incomplete types MUST NOT have Dialog Content parameters
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type VConVersion = '0.3.0';
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
 * ✅ CORRECTED: Added uuid field per spec Section 4.2.12
 * ✅ CORRECTED: Added did field per spec Section 4.2.6
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
  uuid?: string;            // ✅ Section 4.2.12 - Party UUID
}

// ============================================================================
// Section 4.3 - Dialog Object
// ============================================================================

/**
 * Party History - Section 4.3.11
 */
export interface PartyHistory {
  party: number;
  time: string;  // ISO 8601 datetime string
  event: PartyEventType;
}

/**
 * Dialog Object - Section 4.3 (vcon-core-01)
 *
 * Content can be stored in two mutually exclusive ways:
 * 1. Inline: body + encoding fields
 * 2. External: url + content_hash fields (HTTPS MUST be used)
 *
 * Note: 'transfer' and 'incomplete' types MUST NOT have content parameters
 */
export interface Dialog {
  type: DialogType;
  start?: string;           // ISO 8601 datetime string
  duration?: number;        // Duration in seconds
  parties?: number | number[] | (number | number[])[];
  originator?: number;
  mediatype?: string;       // MIME type (e.g., 'audio/x-wav', 'video/x-mp4')
  filename?: string;

  // Inline content (mutually exclusive with url)
  body?: string;            // Content data (base64url encoded for binary)
  encoding?: Encoding;      // How body is encoded: 'base64url' | 'json' | 'none'

  // External content (mutually exclusive with body)
  url?: string;             // HTTPS URL to external content
  content_hash?: string | string[];  // SHA-256 hash for integrity verification

  disposition?: DialogDisposition;
  session_id?: string;      // Section 4.3.10 - Session identifier
  party_history?: PartyHistory[];  // Section 4.3.11
  application?: string;     // Section 4.3.13 - Application identifier
  message_id?: string;      // Section 4.3.14 - Message identifier

  // Transfer-specific fields (only for type='transfer')
  transferee?: number;
  transferor?: number;
  transfer_target?: number;
  original?: number;
  consultation?: number;
  target_dialog?: number;
}

// ============================================================================
// Section 4.4 - Attachment Object
// ============================================================================

/**
 * Attachment Object - Section 4.4
 * ✅ CORRECTED: Added dialog field per spec Section 4.4.4
 */
export interface Attachment {
  type?: string;
  start?: string;           // ISO 8601 datetime string
  party?: number;
  dialog?: number;          // ✅ Section 4.4.4 - Dialog reference
  mediatype?: string;
  filename?: string;
  body?: string;
  encoding?: Encoding;
  url?: string;
  content_hash?: string | string[];
}

// ============================================================================
// Section 4.5 - Analysis Object
// ============================================================================

/**
 * Analysis Object - Section 4.5
 * 
 * ⚠️ CRITICAL CORRECTIONS:
 * ✅ Field name is 'schema' NOT 'schema_version' (Section 4.5.7)
 * ✅ 'vendor' is REQUIRED (Section 4.5.5)
 * ✅ 'body' is string type (Section 4.5.8)
 */
export interface Analysis {
  type: string;             // e.g., 'summary', 'transcript', 'translation', 'sentiment'
  dialog?: number | number[];  // Section 4.5.2 - Dialog reference(s)
  mediatype?: string;
  filename?: string;
  vendor: string;           // ✅ REQUIRED per spec Section 4.5.5 (no ?)
  product?: string;
  schema?: string;          // ✅ CORRECT: 'schema' NOT 'schema_version' (Section 4.5.7)
  body?: string;            // ✅ CORRECT: string type, supports all formats (Section 4.5.8)
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
// Section 4.1.9 - Appended Object
// ============================================================================

export interface Appended {
  uuid?: string;
  url?: string;
  content_hash?: string | string[];
}

// ============================================================================
// Section 4.6 - Group Object
// ============================================================================

export interface Group {
  uuid?: string;
  body?: string;            // Inline vCon content
  encoding?: 'json';        // Must be 'json' per spec
  url?: string;
  content_hash?: string | string[];
}

// ============================================================================
// Section 4.1 - Main vCon Object
// ============================================================================

/**
 * Main vCon Object - Section 4.1
 * ✅ CORRECTED: Added extensions per spec Section 4.1.3
 * ✅ CORRECTED: Added must_support per spec Section 4.1.4
 * ✅ CORRECTED: Added appended per spec Section 4.1.9
 */
export interface VCon {
  vcon: VConVersion;
  uuid: string;
  extensions?: string[];    // ✅ Section 4.1.3 - Extension identifiers
  must_support?: string[];  // ✅ Section 4.1.4 - Required extension support
  created_at: string;       // ISO 8601 datetime string
  updated_at?: string;      // ISO 8601 datetime string
  subject?: string;
  redacted?: Redacted;
  appended?: Appended;      // ✅ Section 4.1.9
  group?: Group[];
  parties: Party[];
  dialog?: Dialog[];
  analysis?: Analysis[];
  attachments?: Attachment[];
}

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Type guard to check if a string is a valid DialogType
 */
export function isValidDialogType(type: string): type is DialogType {
  return ['recording', 'text', 'transfer', 'incomplete'].includes(type);
}

/**
 * Type guard to check if a string is a valid Encoding
 */
export function isValidEncoding(encoding: string): encoding is Encoding {
  return ['base64url', 'json', 'none'].includes(encoding);
}

/**
 * Type guard to check if a string is a valid DialogDisposition
 */
export function isValidDisposition(disposition: string): disposition is DialogDisposition {
  return ['no-answer', 'congestion', 'failed', 'busy', 'hung-up', 'voicemail-no-message'].includes(disposition);
}

/**
 * Type guard to check if a string is a valid PartyEventType
 */
export function isValidPartyEvent(event: string): event is PartyEventType {
  return ['join', 'drop', 'hold', 'unhold', 'mute', 'unmute'].includes(event);
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Partial vCon for updates (all fields optional except uuid)
 */
export type VConUpdate = Partial<Omit<VCon, 'uuid' | 'vcon'>> & {
  uuid: string;
  vcon?: VConVersion;
};

/**
 * vCon creation input (before UUID generation)
 */
export type VConCreate = Omit<VCon, 'uuid' | 'created_at'> & {
  uuid?: string;
  created_at?: string;
};

