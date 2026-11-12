/**
 * Startup for TENANT_MODE=writer.
 *
 * The writer is the one process that holds the service key. It serves the
 * conserver's writes and the operator tools, stamps every vCon it stores with a
 * tenant (src/config/tenant-stamp.ts), and refreshes vcon_tags_mv on a timer:
 * tenant tokens cannot run refresh_vcon_tags_mv_if_stale, and without pg_cron
 * nothing else refreshes the view (CON-995).
 *
 * TENANT_MODE=off (the default) does none of this.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getTenantMode, TenantMode } from '../config/tenant-mode.js';
import { refreshTagsMvNow } from '../db/tags-mv.js';
import { logWithContext } from '../observability/instrumentation.js';
import { extractErrorMessage, isMissingFunctionError } from '../utils/errors.js';
import { isSaveVConBatchMissing } from '../db/batch-writer.js';

export const WRITER_ATTACHMENT_TYPE = 'tenant';
export const WRITER_JSON_PATH = 'id';
export const DEFAULT_TAGS_MV_REFRESH_INTERVAL_MS = 60_000;
export const MIN_TAGS_MV_REFRESH_INTERVAL_MS = 1_000;

/** TAGS_MV_REFRESH_INTERVAL_MS, in milliseconds. Throws on a value that is not a whole number of at least 1000. */
export function getTagsMvRefreshIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.TAGS_MV_REFRESH_INTERVAL_MS ?? '').trim();
  if (raw === '') return DEFAULT_TAGS_MV_REFRESH_INTERVAL_MS;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < MIN_TAGS_MV_REFRESH_INTERVAL_MS) {
    throw new Error(`TAGS_MV_REFRESH_INTERVAL_MS must be a whole number of milliseconds, at least ${MIN_TAGS_MV_REFRESH_INTERVAL_MS}`);
  }
  return ms;
}

/**
 * Read TENANT_MODE and check what the chosen mode needs before anything
 * connects. Throws with a message naming the setting; the server exits.
 */
export function checkTenantModeAtStartup(env: NodeJS.ProcessEnv = process.env): TenantMode {
  const mode = getTenantMode(env);
  if (mode !== 'writer') return mode;

  const dbType = env.DB_TYPE || 'supabase';
  if (dbType !== 'supabase') {
    throw new Error(`TENANT_MODE=writer needs the Supabase backend; DB_TYPE is ${dbType}`);
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('TENANT_MODE=writer needs SUPABASE_SERVICE_ROLE_KEY');
  }
  const intervalMs = getTagsMvRefreshIntervalMs(env);

  // The writer serves every tenant. CURRENT_TENANT_ID sets a session tenant
  // that outlives the request on a pooled connection and reaches other callers.
  if ((env.CURRENT_TENANT_ID ?? '').trim() !== '') {
    throw new Error('TENANT_MODE=writer serves every tenant; unset CURRENT_TENANT_ID');
  }

  // The SQL backfill (vcon_tenant_stamp) knows only the defaults, so the
  // writer refuses anything else rather than let the two rules differ.
  if (env.TENANT_ATTACHMENT_TYPE && env.TENANT_ATTACHMENT_TYPE !== WRITER_ATTACHMENT_TYPE) {
    throw new Error(`TENANT_MODE=writer needs TENANT_ATTACHMENT_TYPE unset or '${WRITER_ATTACHMENT_TYPE}'`);
  }
  if (env.TENANT_JSON_PATH && env.TENANT_JSON_PATH !== WRITER_JSON_PATH) {
    throw new Error(`TENANT_MODE=writer needs TENANT_JSON_PATH unset or '${WRITER_JSON_PATH}'`);
  }

  logWithContext('info', 'TENANT_MODE=writer', {
    tenant_extraction: 'on',
    bad_stamp_tenant: '_quarantine',
    tags_mv_refresh_interval_ms: intervalMs,
  });
  return mode;
}

/**
 * Check the store before the writer takes traffic. Throws, and the server
 * exits, unless:
 *   - save_vcon_batch exists: without it the batch writer would fall back to
 *     per-table writes that overwrite a stored tenant (it refuses that too);
 *   - release_vcon_from_quarantine exists, i.e. 20261112120000_keep_stored_tenant.sql
 *     is applied, so save_vcon_batch is the version that keeps a stored tenant.
 * Neither probe writes: save_vcon_batch gets empty arrays, and
 * release_vcon_from_quarantine gets NULLs, which it refuses (22023) before
 * reading anything.
 */
export async function verifyWriterStore(supabase: SupabaseClient): Promise<void> {
  const batch = await supabase.rpc('save_vcon_batch', {
    p_vcons: [], p_parties: [], p_dialog: [], p_analysis: [], p_attachments: [],
  });
  if (batch.error) {
    if (isSaveVConBatchMissing(batch.error)) {
      throw new Error('TENANT_MODE=writer needs save_vcon_batch; apply 20261020130000_save_vcon_batch.sql and 20261112120000_keep_stored_tenant.sql');
    }
    throw new Error(`TENANT_MODE=writer could not confirm save_vcon_batch: ${extractErrorMessage(batch.error)}`);
  }

  const release = await supabase.rpc('release_vcon_from_quarantine', {
    p_vcon_uuid: null, p_tenant_id: null, p_reason: null, p_evidence: null, p_released_by: null,
  });
  if (release.error && release.error.code !== '22023') {
    if (isMissingFunctionError(release.error)) {
      throw new Error('TENANT_MODE=writer needs 20261112120000_keep_stored_tenant.sql, so a re-post keeps a stored tenant');
    }
    throw new Error(`TENANT_MODE=writer could not confirm 20261112120000_keep_stored_tenant.sql: ${extractErrorMessage(release.error)}`);
  }
}

export interface TagsMvRefreshTimer {
  stop(): void;
}

/**
 * Refresh vcon_tags_mv now and every intervalMs. The RPC refreshes only when
 * a tags attachment is newer than the view, so a quiet tick is one cheap query.
 * The timer does not keep the process alive.
 */
export function startTagsMvRefreshTimer(supabase: SupabaseClient, intervalMs: number): TagsMvRefreshTimer {
  const tick = () => {
    refreshTagsMvNow(supabase).catch((error: unknown) => {
      logWithContext('warn', 'vcon_tags_mv refresh timer: refresh failed', {
        error_message: extractErrorMessage(error),
      });
    });
  };
  tick();
  const handle = setInterval(tick, intervalMs);
  handle.unref?.();
  return { stop: () => clearInterval(handle) };
}

let writerTimer: TagsMvRefreshTimer | null = null;

/** Start the writer's background work. Idempotent. */
export function startTenantWriter(supabase: SupabaseClient, env: NodeJS.ProcessEnv = process.env): void {
  if (writerTimer) return;
  writerTimer = startTagsMvRefreshTimer(supabase, getTagsMvRefreshIntervalMs(env));
}

/** Stop the writer's background work (tests and shutdown). */
export function stopTenantWriter(): void {
  writerTimer?.stop();
  writerTimer = null;
}
