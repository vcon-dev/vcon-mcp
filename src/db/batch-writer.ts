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
import { serializeBody } from '../utils/body-serialization.js';
import { logWithContext, recordCounter } from '../observability/instrumentation.js';

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
      error_message: err instanceof Error ? err.message : String(err),
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
        redis.del(`vcon:${p.vcon.uuid}`).catch(e => {
          logWithContext('warn', 'cache invalidation failed', {
            vcon_uuid: p.vcon.uuid,
            error_message: e instanceof Error ? e.message : String(e),
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
    tenant_id: tenantId,
  };
}

// Single-row builders. These own the column-name mapping (start->start_time,
// duration->duration_seconds, dialog->dialog_indices, mediatype->mimetype) and
// body serialization, so per-child update/insert paths in the query layer reuse
// exactly the same shaping as batch creation. NOTE: dialog body is stored RAW
// (no serializeBody); analysis/attachment bodies use serializeBody.

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
    body: dialog.body,
    encoding: dialog.encoding,
    url: dialog.url,
    content_hash: dialog.content_hash,
    disposition: dialog.disposition,
    session_id: dialog.session_id,
    application: dialog.application,
    message_id: dialog.message_id,
  };
}

export function buildAnalysisRow(vconUuid: string, analysis: Analysis, index: number) {
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
    body: serializeBody(analysis.body, analysis.encoding),
    encoding: analysis.encoding,
    url: analysis.url,
    content_hash: analysis.content_hash,
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
    body: serializeBody(attachment.body, attachment.encoding),
    encoding: attachment.encoding,
    url: attachment.url,
    content_hash: attachment.content_hash,
  };
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
