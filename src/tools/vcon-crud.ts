/**
 * MCP Tool Definitions for vCon Operations
 *
 * ⚠️ CRITICAL: All schemas use corrected field names
 * - analysis.schema (NOT schema_version)
 * - analysis.vendor (REQUIRED)
 * - analysis.body/dialog.body/attachment.body: string, or any JSON value when
 *   encoding is "json" (draft-ietf-vcon-vcon-core-05 Section 2.3)
 *
 * vCon core-05 (syntax "0.5.0"): Session and Event Objects, Dialog contributors only,
 * redacted_from / amended_from, Attachment party plus dialog or session.
 */

import { z } from 'zod';
import { LEGACY_DIALOG_PARAMS, validateEvent } from '../utils/vcon-validation.js';

// ============================================================================
// Zod Schemas with Corrections
// ============================================================================

/**
 * Inline body (draft-ietf-vcon-vcon-core-04 Section 2.3 "Inline Files", shared
 * by Dialog Section 4.3.10, Attachment Section 4.4.7 and Analysis Section
 * 4.5.9): body is a string, unless encoding is "json", in which case it is any
 * JSON value (object, array, number, string, boolean, or null).
 *
 * Encoding-absent decision: legacy callers routinely omit `encoding` on a
 * string body (see tests/handlers/vcon-crud.test.ts), so that keeps working
 * unchanged. A non-string body is only accepted when `encoding` is explicitly
 * "json" — with encoding absent, "base64url" or "none" there is no signal
 * that a non-string value is meant to be a raw JSON value rather than data
 * the caller forgot to stringify, so it is rejected.
 */
const BodySchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.unknown()),
]).optional().describe(
  'Inline content. A string, unless encoding is "json", in which case any JSON value ' +
  '(object, array, number, string, boolean, or null) is accepted as-is.'
);

/** Reject a non-string body unless encoding is explicitly "json" (see BodySchema doc). */
function refineJsonBody(val: { body?: unknown; encoding?: string }, ctx: z.RefinementCtx): void {
  if (val.body !== undefined && typeof val.body !== 'string' && val.encoding !== 'json') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['body'],
      message: 'body must be a string unless encoding is "json" (draft-ietf-vcon-vcon-core-04 Section 2.3.2)',
    });
  }
}

/**
 * Dialog session_id (draft-ietf-vcon-vcon-core-05 Section 4.5.10):
 * a SessionId object {local, remote}, or an array of them.
 *
 * Legacy decision (CON-1242): a plain string, the pre-0.4.0 form, is still
 * accepted. The corpus mixes 0.3.0 and 0.4.0 vCons and older writers emit
 * strings, so rejecting them would break re-imports and updates of existing
 * records. The string is stored and returned as-is; it is never rewritten
 * into an invented {local, remote} object. Unknown keys on the object are
 * kept (passthrough) rather than silently dropped.
 */
const SessionIdObjectSchema = z.object({
  local: z.string().describe('Local UUID (RFC 7989)'),
  remote: z.string().describe('Remote UUID (RFC 7989)'),
}).passthrough();

const SessionIdSchema = z.union([
  SessionIdObjectSchema,
  z.array(SessionIdObjectSchema),
  z.string(),
]).optional().describe(
  'SessionId object {local, remote} or an array of them. ' +
  'A plain string is accepted as the legacy pre-0.4.0 form and stored verbatim.'
);

/**
 * Analysis Schema
 * ✅ CRITICAL CORRECTIONS:
 * - Uses 'schema' field (NOT 'schema_version')
 * - 'vendor' is REQUIRED
 * - 'body' is a string, or any JSON value when encoding is "json"
 */
export const AnalysisSchema = z.object({
  type: z.string().describe('Analysis type (e.g., summary, transcript, sentiment)'),
  dialog: z.union([z.number(), z.array(z.number())]).optional()
    .describe('Dialog index or array of indexes this analysis applies to'),
  sessions: z.union([z.number(), z.array(z.number())]).optional()
    .describe('Session index or array of indexes this analysis applies to (0.5.0)'),
  attachment: z.union([z.number(), z.array(z.number())]).optional()
    .describe('Attachment index or array of indexes the analysis was derived from'),
  analysis: z.union([z.number(), z.array(z.number())]).optional()
    .describe('Analysis index or array of indexes the analysis was derived from (0.5.0); never itself'),
  mediatype: z.string().optional(),
  filename: z.string().optional(),
  vendor: z.string().describe('REQUIRED: Vendor who produced this analysis'),  // ✅ REQUIRED
  product: z.string().optional().describe('Product name or version'),
  schema: z.string().optional().describe('Schema identifier for this analysis'),  // ✅ CORRECT: 'schema'
  body: BodySchema,
  encoding: z.enum(['base64url', 'json', 'none']).optional(),
  url: z.string().optional(),
  content_hash: z.union([z.string(), z.array(z.string())]).optional(),
}).passthrough() // extension keys are stored in `extra` (CON-1047)
  .superRefine(refineJsonBody);

/**
 * Dialog Schema (core-05 Section 4.5)
 *
 * Written types are recording, text and incomplete. `parties` are the CONTRIBUTORS only
 * (receivers are the Session `parties`); a null slot is an unknown contributor. An empty
 * Dialog Object `{}` holds an index position, so `type` is required unless the Dialog is
 * empty. party_history, originator, the transfer parameters, recordings and recording_set
 * were removed in 0.5.0 and are rejected with a pointer to the Session/Event replacement.
 */
const ContributorSchema = z.union([z.number(), z.null()]);
export const DialogSchema = z.object({
  type: z.enum(['recording', 'text', 'incomplete']).optional()
    .describe('Type of dialog; required unless the Dialog is empty ({})'),
  start: z.string().optional().describe('ISO 8601 datetime when dialog started'),
  duration: z.number().optional().describe('Duration in seconds'),
  parties: z.union([
    z.number(),
    z.array(z.union([ContributorSchema, z.array(ContributorSchema)])),
  ]).optional().describe('Contributor party indexes; a nested list per channel, null for an unknown contributor'),
  mediatype: z.string().optional(),
  filename: z.string().optional(),
  body: BodySchema,
  encoding: z.enum(['base64url', 'json', 'none']).optional(),
  url: z.string().optional(),
  content_hash: z.union([z.string(), z.array(z.string())]).optional(),
  disposition: z.string().optional().describe('Call disposition; any string accepted (spec suggests no-answer, congestion, failed, busy, hung-up, voicemail-no-message)'),
  session_id: SessionIdSchema,
  application: z.string().optional().describe('Application that created this dialog'),  // ✅ New field
  message_id: z.string().optional().describe('Message identifier'),  // ✅ New field
  redacted_segments: z.array(z.record(z.unknown())).optional().describe('Redacted segments of this dialog (Section 4.8.2)'),
}).passthrough() // extension keys are stored in `extra` (CON-1047)
  .superRefine((val, ctx) => {
    refineJsonBody(val, ctx);
    const keys = Object.keys(val);
    if (keys.length > 0 && val.type === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['type'], message: 'type is required unless the Dialog Object is empty ({})' });
    }
    for (const legacy of LEGACY_DIALOG_PARAMS) {
      if (legacy in val) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [legacy],
          message: `'${legacy}' was removed from the Dialog Object in vCon 0.5.0: ` +
            (legacy === 'party_history' ? 'use an Event (join, drop, hold, unhold, mute, unmute) in the vCon events array'
              : legacy === 'originator' ? 'use the Session originator'
              : ['recordings', 'recording_set'].includes(legacy) ? 'group recordings with a Session'
              : 'use a transfer Event (consultation-start, blind-transfer, consultative-transfer, transfer-abandoned)'),
        });
      }
    }
  });

/** Session_Reference Object (Section 4.2.8) */
export const SessionReferenceSchema = z.object({
  session: z.number().int().min(0).describe('Index into the sessions array'),
  type: z.string().describe('child, peer, precursor, breakout, or an extension value'),
  description: z.string().optional(),
}).passthrough();

/** Session Object (Section 4.2). An empty Session is permitted. */
export const SessionSchema = z.object({
  start: z.string().optional().describe('ISO 8601 datetime; SHOULD be present'),
  duration: z.number().min(0).optional().describe('Seconds; absent means no end'),
  parties: z.array(z.number().int().min(0)).optional()
    .describe('Receivers (party indexes). The first is the implied originator'),
  originator: z.number().int().min(0).optional()
    .describe('Only when the first party in parties is NOT the originator'),
  // A separate object (not the shared SessionIdObjectSchema) so the JSON Schema inlines it
  session_id: z.object({ local: z.string(), remote: z.string() }).passthrough().optional(),
  sessions: z.array(SessionReferenceSchema).optional().describe('Relationships to other Sessions'),
  dialog: z.array(z.number().int().min(0)).optional().describe('Indexes of the Dialogs in this Session'),
}).passthrough();

/**
 * Event Object (Section 4.3). Parameter applicability by type is enforced
 * (table 4.3.1.5): required, optional, should-not and must-not per event type.
 */
export const EventSchema = z.object({
  type: z.string().describe('join, drop, hold, unhold, mute, unmute, keydown, keyup, consultation-start, blind-transfer, consultative-transfer, transfer-abandoned, channel-contributors, or an extension value'),
  time: z.string().describe('ISO 8601 datetime (REQUIRED)'),
  sessions: z.union([z.number().int().min(0), z.array(z.number().int().min(0))]).optional(),
  party: z.number().int().min(0).optional(),
  dialog: z.union([z.number().int().min(0), z.array(z.number().int().min(0))]).optional(),
  channel: z.number().int().min(0).optional(),
  contributors: z.union([z.number().int().min(0), z.array(z.number().int().min(0)), z.null()]).optional(),
  button: z.string().optional(),
  transferee: z.number().int().min(0).optional(),
  transfer_target: z.number().int().min(0).optional(),
  consultation: z.number().int().min(0).optional(),
  target_session: z.number().int().min(0).optional(),
}).passthrough()
  .superRefine((val, ctx) => {
    const { errors } = validateEvent(val);
    for (const message of errors) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });

/** Redacted_from Object (Section 4.1.8) */
export const RedactedFromSchema = z.object({
  uuid: z.string().optional(),
  type: z.string().optional(),
  url: z.string().optional(),
  content_hash: z.union([z.string(), z.array(z.string())]).optional(),
}).passthrough();

/** Amended_from Object (Section 4.1.9) */
export const AmendedFromSchema = z.object({
  uuid: z.string().optional(),
  url: z.string().optional(),
  content_hash: z.union([z.string(), z.array(z.string())]).optional(),
}).passthrough();

/** Redacted_string Object (Section 4.8) */
export const RedactedStringSchema = z.object({
  ref: z.number().int().min(1).max(99999),
  type: z.string().optional(),
  orig: z.string().optional(),
}).passthrough();

/**
 * Party Schema
 * ✅ Includes uuid field
 */
export const PartySchema = z.object({
  tel: z.string().optional(),
  sip: z.string().optional(),
  stir: z.string().optional(),
  mailto: z.string().optional(),
  name: z.string().optional(),
  did: z.string().optional(),
  uuid: z.string().uuid().optional().describe('Unique identifier for this party'),  // ✅ Added
  validation: z.string().optional(),
  // Full Party object: these are persisted by the DB layer, so the schema
  // must include them or .parse() would strip them before they reach the query.
  jcard: z.record(z.unknown()).optional().describe('jCard object (RFC 7095)'),
  gmlpos: z.string().optional().describe('GML position'),
  civicaddress: z.record(z.unknown()).optional().describe('Civic address object'),
  timezone: z.string().optional(),
}).passthrough(); // extension keys are stored in `extra` (CON-1047)

/**
 * Attachment Schema (core-05 Section 4.6)
 */
export const AttachmentSchema = z.object({
  purpose: z.string().optional().describe('Canonical spec field for attachment classification'),
  type: z.string().optional().describe('Legacy compatibility field; prefer purpose for new data'),
  start: z.string().optional(),
  party: z.number().optional().describe('Party index that contributed the attachment (REQUIRED in 0.5.0)'),
  dialog: z.number().optional().describe('Dialog index this attachment relates to'),
  session: z.union([z.number(), z.array(z.number())]).optional()
    .describe('Session index or indexes this attachment relates to (0.5.0). At least one of dialog or session is required'),
  mediatype: z.string().optional(),
  filename: z.string().optional(),
  body: BodySchema,
  encoding: z.enum(['base64url', 'json', 'none']).optional(),
  url: z.string().optional(),
  content_hash: z.union([z.string(), z.array(z.string())]).optional(),
}).passthrough() // extension keys are stored in `extra` (CON-1047)
  .superRefine(refineJsonBody);

// ============================================================================
// MCP Tool Definitions
// ============================================================================

import type { ToolCategory } from '../config/tools.js';

// ───────────────────────────────────────────────────────────────────────────
// Shared child property shapes, reused by create_vcon and the index-addressed
// update/add tools. (The legacy add_* tools keep their own inline copies.)
// ───────────────────────────────────────────────────────────────────────────

const UUID_PROP = {
  type: 'string' as const,
  description: 'UUID of the vCon',
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
};

const INDEX_PROP = {
  type: 'integer' as const,
  minimum: 0,
  description: 'Zero-based index of the child element to address',
};

// Reusable index-shaped fragments (positional array indexes are non-negative integers).
const PARTY_INDEX = { type: 'integer', minimum: 0 } as const;
const INDEX_OR_LIST = {
  oneOf: [{ type: 'integer', minimum: 0 }, { type: 'array', items: { type: 'integer', minimum: 0 } }],
} as const;
// Inline content: a string, or (when encoding is "json") any JSON value —
// draft-ietf-vcon-vcon-core-04 Section 2.3, shared by dialog/analysis/attachment.
const BODY_PROP = {
  oneOf: [
    { type: 'string' },
    { type: 'object' },
    { type: 'array' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'null' },
  ],
  description: 'Inline content. A string, unless encoding is "json", in which case any JSON value ' +
    '(object, array, number, string, boolean, or null) is accepted as-is.',
} as const;

// session_id: SessionId object or array, or a legacy string (see SessionIdSchema).
const SESSION_ID_OBJECT = {
  type: 'object',
  properties: {
    local: { type: 'string', description: 'Local UUID (RFC 7989)' },
    remote: { type: 'string', description: 'Remote UUID (RFC 7989)' },
  },
  required: ['local', 'remote'],
} as const;
const SESSION_ID_PROP = {
  oneOf: [
    SESSION_ID_OBJECT,
    { type: 'array', items: SESSION_ID_OBJECT },
    { type: 'string' },
  ],
  description: 'SessionId object {local, remote} or an array of them. ' +
    'A plain string is accepted as the legacy pre-0.4.0 form and stored verbatim.',
} as const;

const EVENT_TYPES = [
  'join', 'drop', 'hold', 'unhold', 'mute', 'unmute',
  'keydown', 'keyup',
  'consultation-start', 'blind-transfer', 'consultative-transfer', 'transfer-abandoned',
  'channel-contributors',
];

const sessionProperties = {
  start: { type: 'string', description: 'Session start (ISO 8601 datetime). SHOULD be present' },
  duration: { type: 'number', minimum: 0, description: 'Duration in seconds. Absent means the session has no end' },
  parties: {
    type: 'array',
    items: PARTY_INDEX,
    description: 'Receivers (party indexes). The first is the implied originator. Contributors are in each Dialog parties',
  },
  originator: { ...PARTY_INDEX, description: 'Originator party index; only when the first party in parties is NOT the originator' },
  session_id: SESSION_ID_OBJECT,
  sessions: {
    type: 'array',
    description: 'Relationships to other Sessions',
    items: {
      type: 'object',
      properties: {
        session: { type: 'integer', minimum: 0, description: 'Index into the sessions array' },
        type: { type: 'string', description: 'child, peer, precursor, breakout, or an extension value' },
        description: { type: 'string' },
      },
      required: ['session', 'type'],
    },
  },
  dialog: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Indexes of the Dialogs in this Session' },
} as const;

const eventProperties = {
  type: { type: 'string', enum: EVENT_TYPES, description: 'Event type; extension values are accepted when the extension is listed' },
  time: { type: 'string', description: 'ISO 8601 datetime (REQUIRED)' },
  sessions: { ...INDEX_OR_LIST, description: 'Session index(es) the event applies to. A single index for transfer types; not used by channel-contributors' },
  party: { ...PARTY_INDEX, description: 'Party the event is about; the Transferor for transfer types; not used by channel-contributors' },
  dialog: { ...INDEX_OR_LIST, description: 'channel-contributors only (SHOULD NOT be present on other core types)' },
  channel: { type: 'integer', minimum: 0, description: 'channel-contributors only' },
  contributors: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'array', items: { type: 'integer', minimum: 0 } }, { type: 'null' }], description: 'channel-contributors only; null means no contributor' },
  button: { type: 'string', description: 'keydown and keyup only' },
  transferee: { ...PARTY_INDEX, description: 'Transfer types only' },
  transfer_target: { ...PARTY_INDEX, description: 'Transfer types; optional on transfer-abandoned' },
  consultation: { type: 'integer', minimum: 0, description: 'Session index; consultation-start and consultative-transfer (optional on transfer-abandoned)' },
  target_session: { type: 'integer', minimum: 0, description: 'Session index; blind-transfer and consultative-transfer' },
} as const;

const REDACTED_FROM_PROP = {
  type: 'object',
  description: 'Reference to the less redacted vCon this one was made from (was redacted). Mutually exclusive with amended_from',
  properties: {
    uuid: { type: 'string' },
    type: { type: 'string' },
    url: { type: 'string' },
    content_hash: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
  },
} as const;

const AMENDED_FROM_PROP = {
  type: 'object',
  description: 'Reference to the prior vCon version this one amends (was amended). Mutually exclusive with redacted_from',
  properties: {
    uuid: { type: 'string' },
    url: { type: 'string' },
    content_hash: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
  },
} as const;

const CONTRIBUTOR_ITEM = { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] } as const;

const partyProperties = {
  name: { type: 'string', description: 'Display name of the party' },
  tel: { type: 'string', description: 'Telephone number' },
  mailto: { type: 'string', description: 'Email address' },
  sip: { type: 'string', description: 'SIP URI' },
  stir: { type: 'string', description: 'STIR identity' },
  did: { type: 'string', description: 'Decentralized identifier' },
  uuid: { type: 'string', description: 'UUID for cross-vCon party tracking' },
  validation: { type: 'string' },
  jcard: { type: 'object', description: 'jCard object (RFC 7095)', additionalProperties: true },
  gmlpos: { type: 'string', description: 'GML position' },
  civicaddress: { type: 'object', description: 'Civic address object', additionalProperties: true },
  timezone: { type: 'string' },
} as const;

const dialogProperties = {
  type: { type: 'string', enum: ['recording', 'text', 'incomplete'], description: 'Type of dialog. Required unless the Dialog is empty ({})' },
  start: { type: 'string', description: 'Start time (ISO 8601 datetime)' },
  duration: { type: 'number', description: 'Duration in seconds' },
  parties: {
    oneOf: [
      { type: 'integer', minimum: 0 },
      { type: 'array', items: { oneOf: [CONTRIBUTOR_ITEM, { type: 'array', items: CONTRIBUTOR_ITEM }] } },
    ],
    description: 'Contributors only: party index, list of indexes, or one list per channel; null is an unknown contributor. Receivers are the Session parties',
  },
  body: BODY_PROP,
  encoding: { type: 'string', enum: ['base64url', 'json', 'none'] },
  mediatype: { type: 'string', description: 'MIME type of the content' },
  filename: { type: 'string' },
  url: { type: 'string', description: 'URL to external content' },
  content_hash: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
  disposition: { type: 'string' },
  session_id: SESSION_ID_PROP,
  application: { type: 'string' },
  message_id: { type: 'string' },
  redacted_segments: { type: 'array', items: { type: 'object' }, description: 'Redacted segments of this dialog' },
} as const;

const analysisProperties = {
  type: { type: 'string', description: 'Type of analysis (e.g., summary, transcript, sentiment)' },
  dialog: { ...INDEX_OR_LIST, description: 'Dialog index(es) this analysis applies to' },
  sessions: { ...INDEX_OR_LIST, description: 'Session index(es) this analysis applies to (0.5.0)' },
  attachment: { ...INDEX_OR_LIST, description: 'Attachment index(es) the analysis was derived from' },
  analysis: { ...INDEX_OR_LIST, description: 'Analysis index(es) the analysis was derived from (0.5.0); never itself' },
  vendor: { type: 'string', description: 'REQUIRED: Vendor who produced this analysis' },
  product: { type: 'string' },
  schema: { type: 'string', description: 'Schema identifier for this analysis format' },
  body: BODY_PROP,
  encoding: { type: 'string', enum: ['base64url', 'json', 'none'] },
  mediatype: { type: 'string' },
  filename: { type: 'string' },
  url: { type: 'string' },
  content_hash: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
} as const;

const attachmentProperties = {
  purpose: { type: 'string', description: 'Canonical spec field for attachment classification' },
  type: { type: 'string', description: 'Legacy compatibility field; prefer purpose' },
  party: { ...PARTY_INDEX, description: 'Party index that contributed the attachment (REQUIRED)' },
  dialog: { ...PARTY_INDEX, description: 'Dialog index this attachment relates to. At least one of dialog or session is required' },
  session: { ...INDEX_OR_LIST, description: 'Session index(es) this attachment relates to. Defaults to the only Session when the vCon has exactly one and neither dialog nor session is given' },
  start: { type: 'string' },
  mediatype: { type: 'string' },
  filename: { type: 'string' },
  body: BODY_PROP,
  encoding: { type: 'string', enum: ['base64url', 'json', 'none'] },
  url: { type: 'string' },
  content_hash: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
} as const;

/**
 * Tool: Create vCon
 */
export const createVConTool = {
  name: 'create_vcon',
  category: 'write' as ToolCategory,
  description: 'Create a new vCon compliant with IETF draft-ietf-vcon-vcon-core-05 (syntax "0.5.0"). ' +
    'A vCon (virtual conversation) captures conversation data including parties, sessions, dialog, events, analysis, and attachments. ' +
    'At least one Session is required when dialog or events are supplied; a Session lists the receivers (parties) and the Dialogs (dialog indexes) it covers, ' +
    'while each Dialog parties lists only the contributors. Attachments need party plus dialog or session. ' +
    'A 0.4.0 vCon (vcon "0.4.0", or dialog with no sessions and no vcon) is migrated to 0.5.0 and the migration report is returned. ' +
    'Dialog, analysis, and attachments may be supplied inline at creation, or added later with the add_* tools. ' +
    'An optional client-supplied uuid makes the create idempotent: re-posting the same uuid replaces the existing vCon instead of creating a duplicate.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      uuid: {
        type: 'string',
        format: 'uuid',
        description: 'Optional vCon UUID. When supplied it is used as the vCon identifier, so a re-post with the same uuid replaces the stored vCon (idempotent). When omitted the server generates one.'
      },
      subject: {
        type: 'string',
        description: 'Subject or title of the conversation'
      },
      parties: {
        type: 'array',
        description: 'Array of parties (participants) in the conversation. At least one party is required.',
        items: { type: 'object', properties: partyProperties },
        minItems: 1
      },
      sessions: {
        type: 'array',
        description: 'Sessions: the scope of dialog and events. Required when dialog or events are present.',
        items: { type: 'object', properties: sessionProperties }
      },
      dialog: {
        type: 'array',
        description: 'Optional conversation segments to create inline. An empty object {} holds an index position.',
        items: { type: 'object', properties: dialogProperties }
      },
      events: {
        type: 'array',
        description: 'Optional point-in-time events (party, key, transfer, channel-contributors); replace party_history and transfer dialogs.',
        items: { type: 'object', properties: eventProperties, required: ['type', 'time'] }
      },
      analysis: {
        type: 'array',
        description: 'Optional analysis records to create inline (vendor REQUIRED per spec).',
        items: { type: 'object', properties: analysisProperties, required: ['type', 'vendor'] }
      },
      attachments: {
        type: 'array',
        description: 'Optional attachments to create inline.',
        items: { type: 'object', properties: attachmentProperties }
      },
      extensions: {
        type: 'array',
        description: 'Extension names used in this vCon (core-05 requires every extension used to be listed; lawful_basis and wtf_transcription are added automatically)',
        items: { type: 'string' }
      },
      critical: {
        type: 'array',
        description: 'Extensions that MUST be supported to process this vCon (was must_support).',
        items: { type: 'string' }
      },
      redacted_from: REDACTED_FROM_PROP,
      amended_from: AMENDED_FROM_PROP,
      redacted_strings: {
        type: 'array',
        description: 'Substrings replaced by __REDACTED_REF_<ref> markers',
        items: { type: 'object', properties: { ref: { type: 'integer', minimum: 1, maximum: 99999 }, type: { type: 'string' }, orig: { type: 'string' } }, required: ['ref'] }
      },
      vcon: { type: 'string', enum: ['0.4.0', '0.5.0'], description: 'Syntax version of the input. Output is always 0.5.0. 0.4.0 input is migrated' },
      must_support: {
        type: 'array',
        description: 'Deprecated alias for critical (pre-0.4.0 name); mapped to critical if critical is absent.',
        items: { type: 'string' }
      }
    },
    required: ['parties']
  }
};

/**
 * Tool: Get vCon
 */
export const getVConTool = {
  name: 'get_vcon',
  category: 'read' as ToolCategory,
  description: 'Retrieve a vCon by its UUID. The result is always syntax 0.5.0: a vCon stored as 0.4.0 is migrated on read, and migration_report summarises what was inferred. Use response_format to control how much data is returned:\n' +
    '- "full" (default): complete vCon with all parties, sessions, dialog, events, analysis bodies, and attachments\n' +
    '- "summary": metadata + parties + sessions + only analysis records of type "summary" (compact, fast — use this for browsing or summarizing)\n' +
    '- "metadata": only vCon metadata and parties, no sessions/dialog/events/analysis/attachments\n' +
    'For vCons with large transcripts, "summary" is recommended — transcripts can be 80KB+.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      uuid: {
        type: 'string',
        description: 'UUID of the vCon to retrieve',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      response_format: {
        type: 'string',
        enum: ['full', 'summary', 'metadata'],
        description: 'How much data to return. "summary" returns only summary-type analysis (recommended for browsing). Default: "full".'
      }
    },
    required: ['uuid']
  }
};

/**
 * Tool: Search vCons
 */
export const searchVConsTool = {
  name: 'search_vcons',
  category: 'read' as ToolCategory,
  description: 'Search for vCons using various criteria including tags, date ranges, and party info. Returns matching vCons. ' +
    'For full-text or semantic search of conversation content, use search_vcons_content instead. ' +
    'For daily reports: use start_date/end_date with response_format="metadata" to get subjects and counts without loading bodies. ' +
    'Dates filter on created_at by default; pass date_field="conversation" to filter on when the conversation happened (imported history). ' +
    '⚠️ LARGE DATABASE WARNING: Use response_format="metadata" or "ids_only" for large result sets to avoid memory issues.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      subject: {
        type: 'string',
        description: 'Search by subject (case-insensitive partial match)'
      },
      party_name: {
        type: 'string',
        description: 'Search by party name (case-insensitive partial match)'
      },
      party_email: {
        type: 'string',
        description: 'Search by party email address'
      },
      party_tel: {
        type: 'string',
        description: 'Search by party telephone number'
      },
      start_date: {
        type: 'string',
        description: 'Filter by vCons dated on or after this date (ISO 8601 format). The date is created_at unless date_field="conversation".'
      },
      end_date: {
        type: 'string',
        description: 'Filter by vCons dated on or before this date (ISO 8601 format). The date is created_at unless date_field="conversation".'
      },
      date_field: {
        type: 'string',
        enum: ['created', 'conversation'],
        description: 'Which timestamp start_date/end_date apply to. "created" (default): vcon created_at, when the vCon object was created. ' +
          '"conversation": when the conversation happened: the earliest dialog start, else the earliest attachment start capped at created_at, else created_at. ' +
          'Use "conversation" for imported historical conversations, whose created_at is the import time.',
        default: 'created'
      },
      tags: {
        type: 'object',
        description: 'Filter by tags (key-value pairs). Example: {"department": "sales", "priority": "high"}',
        additionalProperties: { type: 'string' }
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 1000)',
        minimum: 1,
        maximum: 1000,
        default: 10
      },
      response_format: {
        type: 'string',
        enum: ['full', 'metadata', 'ids_only'],
        description: 'Response format: "full" (complete vCons), "metadata" (summary info), "ids_only" (just UUIDs)',
        default: 'metadata'
      },
      include_count: {
        type: 'boolean',
        description: 'Include total count of matching records (may be expensive for large datasets)',
        default: false
      }
    }
  }
};

/**
 * Tool: Search vCon Content (Keyword Search)
 * Searches through subject, dialog, analysis, and party information using full-text search
 */
export const searchVConsContentTool = {
  name: 'search_vcons_content',
  category: 'read' as ToolCategory,
  description: 'Full-text keyword search across vCon content including subject, dialog, analysis, and party info. ' +
    'Searches through conversation text, analysis bodies (transcripts, summaries), and participant details. Returns ranked results with snippets. ' +
    'After getting vcon_ids from snippets, use get_vcon(uuid, response_format="summary") to read the full summary without loading large transcript bodies (transcripts can be 80KB+ each). ' +
    '⚠️ LARGE DATABASE WARNING: Use response_format="snippets" (default) to avoid memory issues.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query text (supports partial matches and typos)'
      },
      start_date: {
        type: 'string',
        description: 'Filter by vCons dated on or after this date (ISO 8601 format). The date is created_at unless date_field="conversation".'
      },
      end_date: {
        type: 'string',
        description: 'Filter by vCons dated on or before this date (ISO 8601 format). The date is created_at unless date_field="conversation".'
      },
      date_field: {
        type: 'string',
        enum: ['created', 'conversation'],
        description: 'Which timestamp start_date/end_date apply to. "created" (default): vcon created_at, when the vCon object was created. ' +
          '"conversation": when the conversation happened: the earliest dialog start, else the earliest attachment start capped at created_at, else created_at. ' +
          'Use "conversation" for imported historical conversations, whose created_at is the import time.',
        default: 'created'
      },
      tags: {
        type: 'object',
        description: 'Filter by tags (key-value pairs). Example: {"department": "sales", "priority": "high"}',
        additionalProperties: { type: 'string' }
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 50, max: 1000)',
        minimum: 1,
        maximum: 1000,
        default: 50
      },
      response_format: {
        type: 'string',
        enum: ['full', 'snippets', 'metadata', 'ids_only'],
        description: 'Response format: "full" (complete vCons), "snippets" (with search highlights), "metadata" (summary), "ids_only" (just UUIDs)',
        default: 'snippets'
      },
      include_count: {
        type: 'boolean',
        description: 'Include total count of matching records (may be expensive for large datasets)',
        default: false
      }
    },
    required: ['query']
  }
};

/**
 * Tool: Semantic Search vCons
 * Searches using AI embeddings for meaning-based similarity
 */
export const searchVConsSemanticTool = {
  name: 'search_vcons_semantic',
  category: 'read' as ToolCategory,
  description: 'Semantic search using AI embeddings to find conversations by meaning, not just keywords. ' +
    'Searches through subject, dialog, and analysis content. Returns similar conversations based on semantic similarity. ' +
    'Note: Requires embeddings to be generated for vCons (see embedding documentation). ' +
    '⚠️ LARGE DATABASE WARNING: Use response_format="metadata" for large result sets to avoid memory issues.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query describing what you are looking for'
      },
      embedding: {
        type: 'array',
        description: 'Pre-computed embedding vector (384 dimensions). If not provided, will be generated from query.',
        items: { type: 'number' }
      },
      tags: {
        type: 'object',
        description: 'Filter by tags (key-value pairs)',
        additionalProperties: { type: 'string' }
      },
      threshold: {
        type: 'number',
        description: 'Minimum similarity threshold (0-1, default: 0.7)',
        minimum: 0,
        maximum: 1,
        default: 0.7
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 50, max: 1000)',
        minimum: 1,
        maximum: 1000,
        default: 50
      },
      response_format: {
        type: 'string',
        enum: ['full', 'metadata', 'ids_only'],
        description: 'Response format: "metadata" (default; one row per matching hit with scores), "ids_only" (unique vCon UUIDs in rank order), "full" (complete vCons for the unique matches, first 20 only)',
        default: 'metadata'
      }
    }
  }
};

/**
 * Tool: Hybrid Search vCons
 * Combines keyword and semantic search for best results
 */
export const searchVConsHybridTool = {
  name: 'search_vcons_hybrid',
  category: 'read' as ToolCategory,
  description: 'Hybrid search combining keyword and semantic search for comprehensive results. ' +
    'Returns vcon_ids with combined_score, semantic_score, and keyword_score. ' +
    'NOTE: keyword_score=0 just means the vCon was found semantically (not that billing terms are absent from the DB — semantic results often outnumber keyword results). ' +
    'After finding IDs, use get_vcon(uuid, response_format="summary") to efficiently read just the summary analysis for each result (saves ~80KB of transcript JSON per vCon). ' +
    'Ideal for complex queries where you want both exact matches and conceptually similar content.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query text'
      },
      embedding: {
        type: 'array',
        description: 'Pre-computed embedding vector (384 dimensions). If not provided, will be generated from query.',
        items: { type: 'number' }
      },
      tags: {
        type: 'object',
        description: 'Filter by tags (key-value pairs)',
        additionalProperties: { type: 'string' }
      },
      semantic_weight: {
        type: 'number',
        description: 'Weight for semantic vs keyword (0-1, default: 0.6). Higher values favor semantic matching.',
        minimum: 0,
        maximum: 1,
        default: 0.6
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 50, max: 1000)',
        minimum: 1,
        maximum: 1000,
        default: 50
      },
      response_format: {
        type: 'string',
        enum: ['full', 'metadata', 'ids_only'],
        description: 'Response format: "metadata" (default; one row per matching hit with scores), "ids_only" (unique vCon UUIDs in rank order), "full" (complete vCons for the unique matches, first 20 only)',
        default: 'metadata'
      }
    },
    required: ['query']
  }
};

/**
 * Tool: Add Analysis
 * ✅ CRITICAL: Uses correct field names (schema, not schema_version)
 * ✅ CRITICAL: vendor is required
 */
export const addAnalysisTool = {
  name: 'add_analysis',
  category: 'write' as ToolCategory,
  description: 'Add analysis to an existing vCon. Analysis represents AI/ML processing results like transcripts, summaries, or sentiment. ' +
    'IMPORTANT: vendor field is REQUIRED per IETF spec.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to add analysis to',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      analysis: {
        type: 'object',
        description: 'Analysis object to add',
        properties: {
          type: {
            type: 'string',
            description: 'Type of analysis (e.g., summary, transcript, sentiment, translation)'
          },
          dialog: {
            oneOf: [
              { type: 'number' },
              { type: 'array', items: { type: 'number' } }
            ],
            description: 'Dialog index(es) this analysis applies to'
          },
          sessions: {
            oneOf: [
              { type: 'number' },
              { type: 'array', items: { type: 'number' } }
            ],
            description: 'Session index(es) this analysis applies to (0.5.0)'
          },
          attachment: {
            oneOf: [
              { type: 'number' },
              { type: 'array', items: { type: 'number' } }
            ],
            description: 'Attachment index(es) the analysis was derived from'
          },
          analysis: {
            oneOf: [
              { type: 'number' },
              { type: 'array', items: { type: 'number' } }
            ],
            description: 'Analysis index(es) the analysis was derived from (0.5.0)'
          },
          vendor: {
            type: 'string',
            description: 'REQUIRED: Vendor who produced this analysis (e.g., OpenAI, Google, IBM)'
          },
          product: {
            type: 'string',
            description: 'Product name or version (e.g., GPT-4, Whisper)'
          },
          schema: {  // ✅ CORRECT field name
            type: 'string',
            description: 'Schema identifier for this analysis format'
          },
          body: {
            ...BODY_PROP,
            description: 'Analysis content. A string, unless encoding is "json", in which case any JSON value.'
          },
          encoding: {
            type: 'string',
            enum: ['base64url', 'json', 'none'],
            description: 'Encoding of the body field'
          },
          url: {
            type: 'string',
            description: 'URL to external analysis content'
          }
        },
        required: ['type', 'vendor']  // ✅ vendor is required
      }
    },
    required: ['vcon_uuid', 'analysis']
  }
};

/**
 * Tool: Add Dialog
 * ✅ Includes new fields
 */
export const addDialogTool = {
  name: 'add_dialog',
  category: 'write' as ToolCategory,
  description: 'Add a dialog (conversation segment) to an existing vCon. Dialog type is recording, text or incomplete; parties are the contributors only. ' +
    'The new dialog is listed by a Session: pass session (an existing Session index), or omit it when the vCon has exactly one Session. ' +
    'When the vCon has no Session one is created (from new_session, else from the dialog start and duration). With two or more Sessions, session is required. ' +
    'A vCon stored as 0.4.0 is upgraded to 0.5.0 first. Returns the dialog index and the Session that lists it.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to add dialog to',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      dialog: {
        type: 'object',
        properties: dialogProperties,
        required: ['type']
      },
      session: {
        type: 'integer',
        minimum: 0,
        description: 'Index of the existing Session that lists this dialog. Optional when the vCon has zero or one Session'
      },
      new_session: {
        type: 'object',
        description: 'Session to create for this dialog when the vCon has none (dialog is set for you). Ignored when session is given or a Session exists',
        properties: {
          start: sessionProperties.start,
          duration: sessionProperties.duration,
          parties: sessionProperties.parties,
          originator: sessionProperties.originator,
          session_id: sessionProperties.session_id,
        }
      }
    },
    required: ['vcon_uuid', 'dialog']
  }
};

/**
 * Tool: Add Attachment
 */
export const addAttachmentTool = {
  name: 'add_attachment',
  category: 'write' as ToolCategory,
  description: 'Add an attachment to an existing vCon. Attachments need party (who contributed it) plus dialog or session. ' +
    'With neither dialog nor session given, the only Session is used when the vCon has exactly one; otherwise pass the scope. A dialog index is never widened to a Session.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to add attachment to',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      attachment: {
        type: 'object',
        properties: {
          purpose: {
            type: 'string',
            description: 'Canonical spec field for attachment classification'
          },
          type: {
            type: 'string',
            description: 'Legacy compatibility field; prefer purpose for new data'
          },
          party: {
            type: 'number',
            description: 'Party index that contributed the attachment (REQUIRED)'
          },
          dialog: {
            type: 'number',
            description: 'Dialog index this attachment relates to'
          },
          session: {
            ...INDEX_OR_LIST,
            description: 'Session index(es) this attachment relates to'
          },
          start: { type: 'string' },
          mediatype: { type: 'string' },
          filename: { type: 'string' },
          body: {
            ...BODY_PROP,
            description: 'Attachment content. A string, unless encoding is "json", in which case any JSON value.'
          },
          encoding: {
            type: 'string',
            enum: ['base64url', 'json', 'none']
          },
          url: { type: 'string' },
          content_hash: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }
        },
        required: ['party']
      }
    },
    required: ['vcon_uuid', 'attachment']
  }
};

/**
 * Tool: Delete vCon
 */
export const deleteVConTool = {
  name: 'delete_vcon',
  category: 'write' as ToolCategory,
  description: 'Delete a vCon and all its related data (parties, dialog, analysis, attachments). This operation cannot be undone.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      uuid: {
        type: 'string',
        description: 'UUID of the vCon to delete',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      }
    },
    required: ['uuid']
  }
};

/**
 * Tool: Update vCon (metadata-only)
 * Updates limited top-level fields. Use specific tools for arrays/components.
 */
export const updateVConTool = {
  name: 'update_vcon',
  category: 'write' as ToolCategory,
  description: 'Update top-level vCon metadata (subject, extensions, critical; legacy must_support is accepted as an alias for critical). For dialog, analysis, attachments use their specific tools.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      uuid: {
        type: 'string',
        description: 'UUID of the vCon to update',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      updates: {
        type: 'object',
        description: 'Allowed fields to update',
        properties: {
          subject: { type: 'string' },
          extensions: { type: 'array', items: { type: 'string' } },
          critical: { type: 'array', items: { type: 'string' }, description: 'Extensions that MUST be supported' },
          must_support: { type: 'array', items: { type: 'string' }, description: 'Deprecated alias for critical (pre-0.4.0 name). Ignored when critical is also given.' }
        }
      },
      return_updated: {
        type: 'boolean',
        description: 'Return the updated vCon',
        default: true
      }
    },
    required: ['uuid', 'updates']
  }
};

// ── Index-addressed update / remove tools (category 'write') ─────────────────

export const updateDialogTool = {
  name: 'update_dialog',
  category: 'write' as ToolCategory,
  description: 'Replace the dialog at the given index (PUT semantics: omitted fields are cleared). Index is the dialog\'s position in the vCon\'s dialog array. Session membership is unchanged. Send {} to blank the position.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: UUID_PROP,
      index: INDEX_PROP,
      dialog: { type: 'object', properties: dialogProperties },
    },
    required: ['vcon_uuid', 'index', 'dialog'],
  },
};

export const removeDialogTool = {
  name: 'remove_dialog',
  category: 'write' as ToolCategory,
  description: 'Remove the dialog at the given index. Per IETF core-05 Section 4.5.1 the slot becomes the empty Dialog Object {} so the indexes in Sessions, Events, analysis and attachments do not shift.',
  inputSchema: {
    type: 'object' as const,
    properties: { vcon_uuid: UUID_PROP, index: INDEX_PROP },
    required: ['vcon_uuid', 'index'],
  },
};

export const updateAnalysisTool = {
  name: 'update_analysis',
  category: 'write' as ToolCategory,
  description: 'Replace the analysis at the given index (PUT semantics: omitted fields are cleared). vendor is REQUIRED per IETF spec.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: UUID_PROP,
      index: INDEX_PROP,
      analysis: { type: 'object', properties: analysisProperties, required: ['type', 'vendor'] },
    },
    required: ['vcon_uuid', 'index', 'analysis'],
  },
};

export const removeAnalysisTool = {
  name: 'remove_analysis',
  category: 'write' as ToolCategory,
  description: 'Remove the analysis at the given index. Analysis is a referential leaf, so the element is hard-deleted and the remaining analyses are renumbered to stay contiguous.',
  inputSchema: {
    type: 'object' as const,
    properties: { vcon_uuid: UUID_PROP, index: INDEX_PROP },
    required: ['vcon_uuid', 'index'],
  },
};

export const updateAttachmentTool = {
  name: 'update_attachment',
  category: 'write' as ToolCategory,
  description: 'Replace the attachment at the given index (PUT semantics: omitted fields are cleared).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: UUID_PROP,
      index: INDEX_PROP,
      attachment: { type: 'object', properties: attachmentProperties },
    },
    required: ['vcon_uuid', 'index', 'attachment'],
  },
};

export const removeAttachmentTool = {
  name: 'remove_attachment',
  category: 'write' as ToolCategory,
  description: 'Remove the attachment at the given index. Attachments are referential leaves, so the element is hard-deleted and the rest renumbered to stay contiguous. Note: removing a "tags" attachment clears the vCon\'s tags.',
  inputSchema: {
    type: 'object' as const,
    properties: { vcon_uuid: UUID_PROP, index: INDEX_PROP },
    required: ['vcon_uuid', 'index'],
  },
};

export const addPartyTool = {
  name: 'add_party',
  category: 'write' as ToolCategory,
  description: 'Append a party to an existing vCon. Returns the new party index.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: UUID_PROP,
      party: { type: 'object', properties: partyProperties },
    },
    required: ['vcon_uuid', 'party'],
  },
};

export const updatePartyTool = {
  name: 'update_party',
  category: 'write' as ToolCategory,
  description: 'Replace the party at the given index (PUT semantics: omitted fields are cleared).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: UUID_PROP,
      index: INDEX_PROP,
      party: { type: 'object', properties: partyProperties },
    },
    required: ['vcon_uuid', 'index', 'party'],
  },
};

export const removePartyTool = {
  name: 'remove_party',
  category: 'write' as ToolCategory,
  description: 'Remove the party at the given index. Per IETF core-05 the slot is preserved as an empty placeholder Party Object so positional references (dialog.parties, session.parties, event.party, attachment.party, etc.) do not shift. Set anonymize=true to write {name:"anonymous"} instead of an empty object.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: UUID_PROP,
      index: INDEX_PROP,
      anonymize: { type: 'boolean', description: 'Write {name:"anonymous"} instead of an empty placeholder', default: false },
    },
    required: ['vcon_uuid', 'index'],
  },
};

// Export all tools as an array
export const allTools = [
  createVConTool,
  getVConTool,
  searchVConsTool,
  searchVConsContentTool,
  searchVConsSemanticTool,
  searchVConsHybridTool,
  addAnalysisTool,
  addDialogTool,
  addAttachmentTool,
  deleteVConTool,
  updateVConTool,
  // Index-addressed child CRUD
  updateDialogTool,
  removeDialogTool,
  updateAnalysisTool,
  removeAnalysisTool,
  updateAttachmentTool,
  removeAttachmentTool,
  addPartyTool,
  updatePartyTool,
  removePartyTool,
];

