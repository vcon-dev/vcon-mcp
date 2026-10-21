/**
 * Batched multi-tenant writer for vCon documents.
 *
 * Coalesces concurrent createVCon calls into a single save_vcon_batch RPC
 * (one transaction for every table) to eliminate the ~12 sequential PostgREST
 * round-trips that the per-vcon writer was doing under load.
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
 * Enqueue a vCon for batched insertion. Resolves when this vCon and all its
 * children have committed; rejects, with nothing of this vCon written, if any
 * of its rows fails (see commitBatch).
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
  } catch (err) {
    // commitBatch settles every promise itself; this only guards against a
    // bug leaving callers hanging. Settling an already-settled promise is a no-op.
    for (const p of pending) p.reject(err);
  } finally {
    state.flushing = false;
    if (state.buffer.length > 0) {
      void _flush(key);
    }
  }
}

function flushFailed(batchSize: number, tenantId: string | null, err: unknown): void {
  recordCounter('db.query.errors', 1, {
    operation: 'batchSaveVCon',
    error_type: (err as { code?: string })?.code || 'unknown',
  }, 'Database query errors');
  logWithContext('error', 'batch-writer flush failed', {
    batch_size: batchSize,
    tenant_id: tenantId ?? '(null)',
    error_message: extractErrorMessage(err),
  });
}

// The non-atomic-fallback warning is about the deployment, not the vCon, so
// log it once per process instead of on every flush.
let atomicFallbackWarned = false;

/**
 * Commit a batch and settle every caller's promise. Never throws.
 *
 * CON-957: each vCon is all-or-nothing. The whole batch goes to the
 * save_vcon_batch RPC in one transaction. If that fails and the batch holds
 * more than one vCon, each vCon is retried alone (the RPC is an idempotent
 * upsert, so a retry after an ambiguous failure is safe): good vCons commit,
 * and only the vCon that fails again rejects its caller.
 */
async function commitBatch(pending: Pending[], tenantId: string | null): Promise<void> {
  let batchError: unknown;
  try {
    await saveVConsAtomic(pending, tenantId);
  } catch (err) {
    batchError = err;
  }

  if (batchError === undefined) {
    recordBatchCommit(pending.length, tenantId);
    await invalidateCache(pending);
    for (const p of pending) p.resolve({ uuid: p.vcon.uuid, id: p.vcon.uuid });
    return;
  }

  if (isSaveVConBatchMissing(batchError as { code?: string; message?: string })) {
    await commitBatchLegacy(pending, tenantId, batchError as { message?: string });
    return;
  }

  flushFailed(pending.length, tenantId, batchError);
  if (pending.length === 1) {
    pending[0].reject(batchError);
    return;
  }

  for (const p of pending) {
    try {
      await saveVConsAtomic([p], tenantId);
    } catch (err) {
      flushFailed(1, tenantId, err);
      p.reject(err);
      continue;
    }
    recordBatchCommit(1, tenantId);
    await invalidateCache([p]);
    p.resolve({ uuid: p.vcon.uuid, id: p.vcon.uuid });
  }
}

/**
 * True only when save_vcon_batch itself is absent. PGRST202 is PostgREST's
 * "function not found" for the RPC. A bare 42883 can also come from inside the
 * function body (a trigger calling a missing function), and treating that as
 * "RPC missing" would silently drop to the non-atomic path, so 42883 counts
 * only when the message names save_vcon_batch.
 */
export function isSaveVConBatchMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (error?.code === 'PGRST202') return true;
  return error?.code === '42883' && /save_vcon_batch/.test(error.message ?? '');
}

/** Write the vCons and all their children in one transaction (save_vcon_batch). */
async function saveVConsAtomic(pending: Pending[], tenantId: string | null): Promise<void> {
  const rows = buildBatchRows(pending, tenantId);
  const { error } = (await supabaseRef!.rpc('save_vcon_batch', {
    p_vcons: rows.vcons,
    p_parties: rows.parties,
    p_dialog: rows.dialog,
    p_analysis: rows.analysis,
    p_attachments: rows.attachments,
  })) as { error: unknown };
  if (error) throw error;
}

function buildBatchRows(pending: Pending[], tenantId: string | null) {
  const vcons: ReturnType<typeof buildVconRow>[] = [];
  const parties: ReturnType<typeof buildPartyRows> = [];
  const dialog: ReturnType<typeof buildDialogRows> = [];
  const analysis: ReturnType<typeof buildAnalysisRows> = [];
  const attachments: ReturnType<typeof buildAttachmentRows> = [];

  for (const { vcon } of pending) {
    vcons.push(buildVconRow(vcon, tenantId));
    parties.push(...buildPartyRows(vcon, tenantId));
    dialog.push(...buildDialogRows(vcon, tenantId));
    analysis.push(...buildAnalysisRows(vcon, tenantId));
    attachments.push(...buildAttachmentRows(vcon, tenantId));
  }
  return { vcons, parties, dialog, analysis, attachments };
}

/**
 * Fallback for databases without save_vcon_batch (migration
 * 20261020130000_save_vcon_batch.sql not applied). Not atomic: a failed child
 * write leaves the vcons row and the other children committed. The whole batch
 * settles together, as it did before CON-957.
 */
async function commitBatchLegacy(
  pending: Pending[],
  tenantId: string | null,
  reason: { message?: string }
): Promise<void> {
  if (!atomicFallbackWarned) {
    atomicFallbackWarned = true;
    logWithContext('warn', 'save_vcon_batch RPC missing; vCon create is not atomic. Apply migration 20261020130000_save_vcon_batch.sql (and create the function in each per-group schema)', {
      reason: reason?.message,
    });
  }

  try {
    await writeTablesLegacy(pending, tenantId);
  } catch (err) {
    flushFailed(pending.length, tenantId, err);
    for (const p of pending) p.reject(err);
    return;
  }
  recordBatchCommit(pending.length, tenantId);
  await invalidateCache(pending);
  for (const p of pending) p.resolve({ uuid: p.vcon.uuid, id: p.vcon.uuid });
}

async function writeTablesLegacy(pending: Pending[], tenantId: string | null): Promise<void> {
  const supabase = supabaseRef!;
  const rows = buildBatchRows(pending, tenantId);

  // Parent first — each PostgREST call is its own transaction, so children
  // referencing vcon_id must wait for the vcons upsert to commit or we race
  // into FK violations.
  const vconRes = (await supabase
    .from('vcons')
    .upsert(rows.vcons, { onConflict: 'id' })) as { error: unknown };
  if (vconRes.error) throw vconRes.error;

  const children: Array<[string, Row[], string]> = [
    ['parties', rows.parties, 'vcon_id,party_index'],
    ['dialog', rows.dialog, 'vcon_id,dialog_index'],
    ['analysis', rows.analysis, 'vcon_id,analysis_index'],
    ['attachments', rows.attachments, 'vcon_id,attachment_index'],
  ];
  const ops = children
    .filter(([, r]) => r.length > 0)
    .map(([table, r, onConflict]) =>
      Promise.resolve(supabase.from(table).upsert(r, { onConflict }) as PromiseLike<{ error: unknown }>)
    );

  const results = await Promise.all(ops);
  for (const r of results) {
    if (r.error) throw r.error;
  }
}

function recordBatchCommit(count: number, tenantId: string | null): void {
  recordCounter('db.batch.commit', 1, {
    operation: 'batchSaveVCon',
    tenant_id: tenantId ?? '(null)',
  }, 'Batched vCon commits');
  recordCounter('db.batch.vcons', count, {
    operation: 'batchSaveVCon',
  }, 'vCons per batched commit');
}

async function invalidateCache(committed: Pending[]): Promise<void> {
  if (!redisRef) return;
  const redis = redisRef;
  await Promise.all(
    committed.map(p =>
      redis.del(vconCacheKey(p.vcon.uuid)).catch(e => {
        logWithContext('warn', 'cache invalidation failed', {
          vcon_uuid: p.vcon.uuid,
          error_message: extractErrorMessage(e),
        });
      })
    )
  );
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
//
// CON-1177: every child row carries its parent's tenant_id explicitly (the
// value written to vcons.tenant_id, or the stored parent's on single-child
// writes). The BEFORE INSERT trigger alone left ~35% of parties NULL: it copies
// whatever vcons.tenant_id it can see at insert time, which was NULL when the
// parent's tenant was set later in another transaction, or invisible under RLS.
// Because the column is in every row, the upsert's ON CONFLICT DO UPDATE SET
// list includes tenant_id too, so a re-post repairs a stale NULL.

export function buildPartyRow(vconUuid: string, party: Party, index: number, tenantId: string | null) {
  return {
    vcon_id: vconUuid,
    party_index: index,
    tenant_id: tenantId,
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

export function buildDialogRow(vconUuid: string, dialog: Dialog, index: number, tenantId: string | null) {
  let parties: unknown = null;
  if (dialog.parties !== undefined) {
    parties = Array.isArray(dialog.parties) ? dialog.parties : [dialog.parties];
  }
  return {
    vcon_id: vconUuid,
    dialog_index: index,
    tenant_id: tenantId,
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

export function buildAnalysisRow(vconUuid: string, analysis: Analysis, index: number, tenantId: string | null) {
  // dialog_indices is always an array. A one-element array is recorded in the
  // shape hint so it does not read back as the bare int the legacy reader emits.
  const dialogShape: Shape = Array.isArray(analysis.dialog) && analysis.dialog.length === 1 ? { dialog: 'array' } : {};
  return {
    vcon_id: vconUuid,
    analysis_index: index,
    tenant_id: tenantId,
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

export function buildAttachmentRow(vconUuid: string, attachment: Attachment, index: number, tenantId: string | null) {
  return {
    vcon_id: vconUuid,
    attachment_index: index,
    tenant_id: tenantId,
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

export function buildPartyRows(vcon: VCon, tenantId: string | null) {
  return (vcon.parties ?? []).map((party, index) => buildPartyRow(vcon.uuid, party, index, tenantId));
}

export function buildDialogRows(vcon: VCon, tenantId: string | null) {
  return (vcon.dialog ?? []).map((dialog, index) => buildDialogRow(vcon.uuid, dialog, index, tenantId));
}

export function buildAnalysisRows(vcon: VCon, tenantId: string | null) {
  return (vcon.analysis ?? []).map((analysis, index) => buildAnalysisRow(vcon.uuid, analysis, index, tenantId));
}

export function buildAttachmentRows(vcon: VCon, tenantId: string | null) {
  return (vcon.attachments ?? []).map((attachment, index) => buildAttachmentRow(vcon.uuid, attachment, index, tenantId));
}

/**
 * Test-only: drop all internal state. Do not call from production code.
 */
export function _resetBatchWriterForTests(): void {
  for (const s of tenantStates.values()) {
    if (s.timer) clearTimeout(s.timer);
  }
  tenantStates.clear();
  atomicFallbackWarned = false;
  supabaseRef = null;
  redisRef = null;
}

/**
 * Test-only: synchronously flush a tenant's buffer.
 */
export async function _flushNowForTests(tenantId: string | null): Promise<void> {
  await _flush(tenantKey(tenantId));
}
