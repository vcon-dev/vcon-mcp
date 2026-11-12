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
import { extractErrorMessage } from '../utils/errors.js';

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

  if (env.CURRENT_TENANT_ID) {
    logWithContext('warn', 'TENANT_MODE=writer serves every tenant, but CURRENT_TENANT_ID is set', {
      hint: 'CURRENT_TENANT_ID pins one tenant on a pooled database connection; unset it on the writer',
    });
  }

  logWithContext('info', 'TENANT_MODE=writer', {
    tenant_extraction: 'on',
    bad_stamp_tenant: '_quarantine',
    tags_mv_refresh_interval_ms: intervalMs,
  });
  return mode;
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
