/**
 * Batched multi-tenant writer for vCon documents.
 *
 * Coalesces concurrent createVCon calls into a single multi-row upsert per
 * table to eliminate the ~12 sequential PostgREST round-trips that the
 * per-vcon writer was doing under load.
 *
 * Buffer is keyed by tenant_id (RLS scope). Each tenant has at most one
 * flush in-flight; any save received during a flush forms the next batch.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import Redis from 'ioredis';
import { Analysis, Attachment, Dialog, Party, VCon } from '../types/vcon.js';
import { deserializeBody, serializeBody } from '../utils/body-serialization.js';
import { logWithContext, recordCounter } from '../observability/instrumentation.js';
import { extractErrorMessage } from '../utils/errors.js';

export const BATCH_SIZE = 100;
export const BATCH_MAX_AGE_MS = 200;

type TenantKey = string;
const NULL_TENANT: TenantKey = '__null__';

interface Pending {
  vcon: VCon;
  tenantId: string | null;
  resolve: (v: { uuid: string; id: string }) => void;
  reject: (err: unknown) => void;
}

interface TenantState {
  buffer: Pending[];
  timer: NodeJS.Timeout | null;
  flushing: boolean;
}

const tenantStates = new Map<TenantKey, TenantState>();

let supabaseRef: SupabaseClient | null = null;
let redisRef: Redis | null = null;

/**
 * Wire the batch writer to the active Supabase + Redis clients.
 * Called once during server startup.
 */
export function configureBatchWriter(supabase: SupabaseClient, redis: Redis | null): void {
  supabaseRef = supabase;
  redisRef = redis;
}

function getState(key: TenantKey): TenantState {
  let s = tenantStates.get(key);
  if (!s) {
    s = { buffer: [], timer: null, flushing: false };
    tenantStates.set(key, s);
  }
  return s;
}

function tenantKey(tenantId: string | null): TenantKey {
  return tenantId === null ? NULL_TENANT : tenantId;
}

/**
 * Redis cache key for a vCon, namespaced by the instance's Postgres schema.
 * Instances pinned to different schemas (SUPABASE_DB_SCHEMA, see db/client.ts)
 * MUST NOT collide in a shared Redis, or a cached read from one schema leaks
 * into another. The schema is the tenant boundary, so it belongs in the key.
 *
 * Schema is the OUTERMOST namespace (`<schema>:vcon:<uuid>`), matching the
 * enterprise conserver's global key prefix so both can share one Redis. When
 * no schema is set the key is the bare `vcon:<uuid>` — byte-identical to the
 * pre-namespacing key and to the conserver's default, so an untenanted shared
 * store stays consistent across both services.
 */
export function vconCacheKey(uuid: string): string {
  const schema = process.env.SUPABASE_DB_SCHEMA;
  return schema ? `${schema}:vcon:${uuid}` : `vcon:${uuid}`;
}

/**
 * Enqueue a vCon for batched insertion. Resolves when the batch containing
 * this vCon has been fully committed; rejects if any insert in that batch
 * fails.
 *
 * The supabase/redis pair is captured the first time this is called; later
 * calls must pass the same instance (we don't support hot-swapping clients).
 */
export function batchSaveVCon(
  vcon: VCon,
  tenantId: string | null,
  supabase?: SupabaseClient,
  redis?: Redis | null
): Promise<{ uuid: string; id: string }> {
  if (supabase && !supabaseRef) {
    supabaseRef = supabase;
    redisRef = redis ?? null;
  }
  if (!supabaseRef) {
    return Promise.reject(new Error('batch-writer not configured; pass supabase on first call or use configureBatchWriter'));
  }

  const key = tenantKey(tenantId);
  const state = getState(key);

  return new Promise<{ uuid: string; id: string }>((resolve, reject) => {
    state.buffer.push({ vcon, tenantId, resolve, reject });

    if (state.buffer.length >= BATCH_SIZE && !state.flushing) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      void _flush(key);
      return;
    }

    if (!state.timer && !state.flushing) {
      state.timer = setTimeout(() => {
        state.timer = null;
        void _flush(key);
      }, BATCH_MAX_AGE_MS);
    }
  });
}

/**
 * Drain one tenant's buffer into a single batched commit.
 * Singleton per tenant: re-entrancy while flushing is a no-op (the next
 * timer/threshold tick will pick up any newly-buffered items).
 */
async function _flush(key: TenantKey): Promise<void> {
  const state = getState(key);
  if (state.flushing) return;
  if (state.buffer.length === 0) return;

  state.flushing = true;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  const pending = state.buffer.splice(0, state.buffer.length);
  const tenantId = pending[0].tenantId;

  try {
    await commitBatch(pending, tenantId);
    for (const p of pending) {
      p.resolve({ uuid: p.vcon.uuid, id: p.vcon.uuid });
    }
  } catch (err) {
    recordCounter('db.query.errors', 1, {
      operation: 'batchSaveVCon',
      error_type: (err as { code?: string })?.code || 'unknown',
    }, 'Database query errors');
    logWithContext('error', 'batch-writer flush failed', {
      batch_size: pending.length,
      tenant_id: tenantId ?? '(null)',
      error_message: extractErrorMessage(err),
    });
    for (const p of pending) {
      p.reject(err);
    }
  } finally {
    state.flushing = false;
    if (state.buffer.length > 0) {
      void _flush(key);
    }
  }
}

async function commitBatch(pending: Pending[], tenantId: string | null): Promise<void> {
  const supabase = supabaseRef!;

  const vconRows: ReturnType<typeof buildVconRow>[] = [];
  const partyRows: ReturnType<typeof buildPartyRows> = [];
  const dialogRows: ReturnType<typeof buildDialogRows> = [];
  const analysisRows: ReturnType<typeof buildAnalysisRows> = [];
  const attachmentRows: ReturnType<typeof buildAttachmentRows> = [];

  for (const { vcon } of pending) {
    vconRows.push(buildVconRow(vcon, tenantId));
    partyRows.push(...buildPartyRows(vcon));
    dialogRows.push(...buildDialogRows(vcon));
    analysisRows.push(...buildAnalysisRows(vcon));
    attachmentRows.push(...buildAttachmentRows(vcon));
  }

  // Parent first — each PostgREST call is its own transaction, so children
  // referencing vcon_id must wait for the vcons upsert to commit or we race
  // into FK violations.
  const vconRes = (await supabase
    .from('vcons')
    .upsert(vconRows, { onConflict: 'id' })) as { error: unknown };
  if (vconRes.error) throw vconRes.error;

  const ops: Array<PromiseLike<{ error: unknown }>> = [];
  if (partyRows.length > 0) {
    ops.push(
      supabase.from('parties').upsert(partyRows, { onConflict: 'vcon_id,party_index' }) as PromiseLike<{ error: unknown }>
    );
  }
  if (dialogRows.length > 0) {
    ops.push(
      supabase.from('dialog').upsert(dialogRows, { onConflict: 'vcon_id,dialog_index' }) as PromiseLike<{ error: unknown }>
    );
  }
  if (analysisRows.length > 0) {
    ops.push(
      supabase.from('analysis').upsert(analysisRows, { onConflict: 'vcon_id,analysis_index' }) as PromiseLike<{ error: unknown }>
    );
  }
  if (attachmentRows.length > 0) {
    ops.push(
      supabase.from('attachments').upsert(attachmentRows, { onConflict: 'vcon_id,attachment_index' }) as PromiseLike<{ error: unknown }>
    );
  }

  const results = await Promise.all(ops.map(op => Promise.resolve(op)));
  for (const r of results) {
    if (r.error) throw r.error;
  }

  recordCounter('db.batch.commit', 1, {
    operation: 'batchSaveVCon',
    tenant_id: tenantId ?? '(null)',
  }, 'Batched vCon commits');
  recordCounter('db.batch.vcons', pending.length, {
    operation: 'batchSaveVCon',
  }, 'vCons per batched commit');

  if (redisRef) {
    const redis = redisRef;
    await Promise.all(
      pending.map(p =>
        redis.del(vconCacheKey(p.vcon.uuid)).catch(e => {
          logWithContext('warn', 'cache invalidation failed', {
            vcon_uuid: p.vcon.uuid,
            error_message: extractErrorMessage(e),
          });
        })
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Row builders. Child rows omit created_at so the column default (now()) is
// used on insert and the original created_at is preserved on conflict update
// (PostgREST builds DO UPDATE SET ... from the provided columns only).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Extension fields (CON-1047). Every key a builder does not map to a column is
// kept in the row's `extra` jsonb (null when nothing is left over) and merged
// back by assembleVCon, so a stored vCon reads back as it was written.
//
// `extra` may also carry one reserved key, SHAPE_KEY, with hints for values the
// columns cannot express faithfully. Hints are written only when the legacy
// reader would get the value wrong, so rows written before this change read
// exactly as they did:
//   body: 'string' -> a string body the legacy reader would JSON.parse (e.g. "false")
//   body: 'json'   -> a non-string body stored as JSON text the legacy reader returns as a string
//   dialog: 'array' -> analysis.dialog was a one-element array, not a bare int
// ponytail: a client-supplied key named SHAPE_KEY is shadowed; rename if that ever collides.
// ---------------------------------------------------------------------------

export const SHAPE_KEY = '_vcon_mcp_shape';

type Shape = { body?: 'string' | 'json'; dialog?: 'array' };
type Row = Record<string, any>;

const VCON_KEYS = new Set([
  'vcon', 'uuid', 'subject', 'created_at', 'updated_at', 'extensions', 'critical',
  'redacted', 'amended', 'group', 'parties', 'dialog', 'analysis', 'attachments',
]);
const PARTY_KEYS = new Set([
  'tel', 'sip', 'stir', 'mailto', 'name', 'did', 'uuid', 'validation', 'jcard',
  'gmlpos', 'civicaddress', 'timezone',
]);
// party_history and transfer fields are not dialog columns, so they ride in extra.
const DIALOG_KEYS = new Set([
  'type', 'start', 'duration', 'parties', 'originator', 'mediatype', 'filename', 'body',
  'encoding', 'url', 'content_hash', 'disposition', 'session_id', 'application', 'message_id',
]);
const ANALYSIS_KEYS = new Set([
  'type', 'dialog', 'mediatype', 'filename', 'vendor', 'product', 'schema', 'body',
  'encoding', 'url', 'content_hash',
]);
const ATTACHMENT_KEYS = new Set([
  'type', 'purpose', 'start', 'party', 'dialog', 'mediatype', 'filename', 'body',
  'encoding', 'url', 'content_hash',
]);

function extraOf(obj: object, known: Set<string>, shape: Shape = {}): Row | null {
  const extra: Row = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!known.has(k) && v !== undefined) extra[k] = v;
  }
  if (Object.keys(shape).length > 0) extra[SHAPE_KEY] = shape;
  return Object.keys(extra).length > 0 ? extra : null;
}

/** Column values win; extra keys fill in the rest. SHAPE_KEY never reaches clients. */
function withExtra<T extends object>(cols: T, extra: Row | null | undefined): T {
  if (!extra) return cols;
  const out: Row = { ...cols };
  for (const [k, v] of Object.entries(extra)) {
    if (k !== SHAPE_KEY && !(k in out)) out[k] = v;
  }
  return out as T;
}

/** Legacy analysis/attachment reads JSON.parse bodies with no/none encoding; dialog reads raw. */
function legacyParses(table: 'dialog' | 'other', encoding?: string | null): boolean {
  return table === 'other' && (!encoding || encoding === 'none');
}

/** Shape hint needed so readBody restores the original type (see SHAPE_KEY). */
function bodyShape(body: unknown, parses: boolean): Shape {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'string') return parses ? {} : { body: 'json' };
  if (!parses) return {};
  try {
    JSON.parse(body);
    return { body: 'string' };
  } catch {
    return {};
  }
}

function readBody(stored: unknown, parses: boolean, encoding: string | null | undefined, shape?: Shape): any {
  if (shape?.body === 'string') return stored;
  if (shape?.body === 'json') return typeof stored === 'string' ? JSON.parse(stored) : stored;
  return parses ? deserializeBody(stored as string, encoding ?? undefined) : stored;
}

/**
 * vcons.redacted / amended / group_data default to '{}' / '[]', so an empty
 * value means the parameter is absent. Drop it instead of round-tripping noise.
 */
function nonEmpty<T>(value: T | null | undefined): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.length ? value : undefined;
  if (typeof value === 'object' && Object.keys(value as object).length === 0) return undefined;
  return value;
}

export function buildVconRow(vcon: VCon, tenantId: string | null) {
  return {
    id: vcon.uuid,
    uuid: vcon.uuid,
    vcon_version: vcon.vcon ?? '0.4.0',
    subject: vcon.subject,
    created_at: vcon.created_at,
    updated_at: vcon.updated_at ?? new Date().toISOString(),
    extensions: vcon.extensions,
    critical: vcon.critical,
    redacted: vcon.redacted || {},
    amended: vcon.amended || {},
    group_data: vcon.group || [],
    tenant_id: tenantId,
    extra: extraOf(vcon, VCON_KEYS),
  };
}

// Single-row builders. These own the column-name mapping (start->start_time,
// duration->duration_seconds, dialog->dialog_indices, mediatype->mimetype) and
// body serialization, so per-child update/insert paths in the query layer reuse
// exactly the same shaping as batch creation.

export function buildPartyRow(vconUuid: string, party: Party, index: number) {
  return {
    vcon_id: vconUuid,
    party_index: index,
    tel: party.tel,
    sip: party.sip,
    stir: party.stir,
    mailto: party.mailto,
    name: party.name,
    did: party.did,
    uuid: party.uuid,
    validation: party.validation,
    jcard: party.jcard,
    gmlpos: party.gmlpos,
    civicaddress: party.civicaddress,
    timezone: party.timezone,
    extra: extraOf(party, PARTY_KEYS),
  };
}

export function buildDialogRow(vconUuid: string, dialog: Dialog, index: number) {
  let parties: unknown = null;
  if (dialog.parties !== undefined) {
    parties = Array.isArray(dialog.parties) ? dialog.parties : [dialog.parties];
  }
  return {
    vcon_id: vconUuid,
    dialog_index: index,
    type: dialog.type,
    start_time: dialog.start,
    duration_seconds: dialog.duration,
    parties,
    originator: dialog.originator,
    mediatype: dialog.mediatype,
    filename: dialog.filename,
    body: serializeBody(dialog.body),
    encoding: dialog.encoding,
    url: dialog.url,
    content_hash: dialog.content_hash,
    disposition: dialog.disposition,
    session_id: dialog.session_id,
    application: dialog.application,
    message_id: dialog.message_id,
    extra: extraOf(dialog, DIALOG_KEYS, bodyShape(dialog.body, legacyParses('dialog'))),
  };
}

export function buildAnalysisRow(vconUuid: string, analysis: Analysis, index: number) {
  // dialog_indices is always an array. A one-element array is recorded in the
  // shape hint so it does not read back as the bare int the legacy reader emits.
  const dialogShape: Shape = Array.isArray(analysis.dialog) && analysis.dialog.length === 1 ? { dialog: 'array' } : {};
  return {
    vcon_id: vconUuid,
    analysis_index: index,
    type: analysis.type,
    dialog_indices: Array.isArray(analysis.dialog)
      ? analysis.dialog
      : (analysis.dialog !== undefined ? [analysis.dialog] : null),
    mediatype: analysis.mediatype,
    filename: analysis.filename,
    vendor: analysis.vendor,
    product: analysis.product,
    schema: analysis.schema,
    body: serializeBody(analysis.body),
    encoding: analysis.encoding,
    url: analysis.url,
    content_hash: analysis.content_hash,
    extra: extraOf(analysis, ANALYSIS_KEYS, {
      ...bodyShape(analysis.body, legacyParses('other', analysis.encoding)),
      ...dialogShape,
    }),
  };
}

export function buildAttachmentRow(vconUuid: string, attachment: Attachment, index: number) {
  return {
    vcon_id: vconUuid,
    attachment_index: index,
    type: attachment.type,
    purpose: attachment.purpose,
    start_time: attachment.start,
    party: attachment.party,
    dialog: attachment.dialog,
    mimetype: attachment.mediatype,
    filename: attachment.filename,
    body: serializeBody(attachment.body),
    encoding: attachment.encoding,
    url: attachment.url,
    content_hash: attachment.content_hash,
    extra: extraOf(attachment, ATTACHMENT_KEYS, bodyShape(attachment.body, legacyParses('other', attachment.encoding))),
  };
}

/**
 * Rebuild a vCon from its vcons row and child rows (inverse of the builders).
 * Pure, so the store/read round trip is unit-testable without a database.
 */
export function assembleVCon(
  vconData: Row,
  parties: Row[] | null | undefined,
  dialogs: Row[] | null | undefined,
  analysis: Row[] | null | undefined,
  attachments: Row[] | null | undefined
): VCon {
  return withExtra({
    vcon: vconData.vcon_version || '0.4.0',
    uuid: vconData.uuid,
    extensions: vconData.extensions,
    critical: vconData.critical,
    created_at: vconData.created_at,
    updated_at: vconData.updated_at,
    subject: vconData.subject,
    // Stored as '{}'/'[]' defaults, so empty means absent.
    redacted: nonEmpty(vconData.redacted),
    amended: nonEmpty(vconData.amended) ?? nonEmpty(vconData.appended),
    group: nonEmpty(vconData.group_data),
    parties: parties?.map(p => withExtra({
      tel: p.tel,
      sip: p.sip,
      stir: p.stir,
      mailto: p.mailto,
      name: p.name,
      did: p.did,
      uuid: p.uuid,
      validation: p.validation,
      jcard: p.jcard,
      gmlpos: p.gmlpos,
      civicaddress: p.civicaddress,
      timezone: p.timezone,
    }, p.extra)) || [],
    dialog: dialogs?.map(d => withExtra({
      type: d.type,
      start: d.start_time,
      duration: d.duration_seconds,
      parties: d.parties,
      originator: d.originator,
      mediatype: d.mediatype,
      filename: d.filename,
      body: readBody(d.body, legacyParses('dialog'), d.encoding, d.extra?.[SHAPE_KEY]),
      encoding: d.encoding,
      url: d.url,
      content_hash: d.content_hash,
      disposition: d.disposition,
      session_id: d.session_id,
      application: d.application,
      message_id: d.message_id,
    }, d.extra)),
    analysis: analysis?.map(a => withExtra({
      type: a.type,
      dialog: a.extra?.[SHAPE_KEY]?.dialog === 'array' || a.dialog_indices?.length !== 1
        ? a.dialog_indices
        : a.dialog_indices[0],
      mediatype: a.mediatype,
      filename: a.filename,
      vendor: a.vendor,
      product: a.product,
      schema: a.schema,
      body: readBody(a.body, legacyParses('other', a.encoding), a.encoding, a.extra?.[SHAPE_KEY]),
      encoding: a.encoding,
      url: a.url,
      content_hash: a.content_hash,
    }, a.extra)),
    attachments: attachments?.map(att => withExtra({
      type: att.type,
      purpose: att.purpose,
      start: att.start_time,
      party: att.party,
      dialog: att.dialog,
      mediatype: att.mimetype,
      filename: att.filename,
      body: readBody(att.body, legacyParses('other', att.encoding), att.encoding, att.extra?.[SHAPE_KEY]),
      encoding: att.encoding,
      url: att.url,
      content_hash: att.content_hash,
    }, att.extra)),
  }, vconData.extra);
}

export function buildPartyRows(vcon: VCon) {
  return (vcon.parties ?? []).map((party, index) => buildPartyRow(vcon.uuid, party, index));
}

export function buildDialogRows(vcon: VCon) {
  return (vcon.dialog ?? []).map((dialog, index) => buildDialogRow(vcon.uuid, dialog, index));
}

export function buildAnalysisRows(vcon: VCon) {
  return (vcon.analysis ?? []).map((analysis, index) => buildAnalysisRow(vcon.uuid, analysis, index));
}

export function buildAttachmentRows(vcon: VCon) {
  return (vcon.attachments ?? []).map((attachment, index) => buildAttachmentRow(vcon.uuid, attachment, index));
}

/**
 * Test-only: drop all internal state. Do not call from production code.
 */
export function _resetBatchWriterForTests(): void {
  for (const s of tenantStates.values()) {
    if (s.timer) clearTimeout(s.timer);
  }
  tenantStates.clear();
  supabaseRef = null;
  redisRef = null;
}

/**
 * Test-only: synchronously flush a tenant's buffer.
 */
export async function _flushNowForTests(tenantId: string | null): Promise<void> {
  await _flush(tenantKey(tenantId));
}
