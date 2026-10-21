import { SupabaseClient } from '@supabase/supabase-js';
import { logWithContext } from '../observability/instrumentation.js';
import { extractErrorMessage } from '../utils/errors.js';

/**
 * Staleness policy for vcon_tags_mv, shared by every reader of the view.
 *
 * Writes never refresh the view (a full refresh per tag write does not scale). Instead:
 *  - every reader calls refreshTagsMvIfStale() before it touches the view;
 *  - the call is throttled to one RPC per TAGS_MV_MIN_REFRESH_INTERVAL_MS per client, so hot
 *    paths such as search_by_tags do not pay for a staleness probe on every request;
 *  - a tag write in this process calls markTagsMvDirty(), which lifts the throttle so the
 *    next read refreshes (lazily, outside the write).
 * Net staleness window: zero after a write made through this process, at most the interval
 * for writes made by another process or by SQL.
 */
export const TAGS_MV_MIN_REFRESH_INTERVAL_MS = 30_000;

interface RefreshState {
  lastCheck: number;
  dirty: boolean;
  inflight: Promise<void> | null;
}

const states = new WeakMap<object, RefreshState>();

function stateFor(supabase: SupabaseClient): RefreshState {
  let s = states.get(supabase);
  if (!s) {
    s = { lastCheck: 0, dirty: true, inflight: null };
    states.set(supabase, s);
  }
  return s;
}

/** Record that tags changed, so the next view read refreshes regardless of the throttle. */
export function markTagsMvDirty(supabase: SupabaseClient): void {
  stateFor(supabase).dirty = true;
}

/**
 * Bring vcon_tags_mv up to date before reading it. Nothing else refreshes the view on a
 * deployment without pg_cron, so tag reads saw an empty view (CON-995). A no-op when the
 * view is current; a failure (older schema without the RPC) is logged and the read goes on.
 */
export async function refreshTagsMvIfStale(supabase: SupabaseClient): Promise<void> {
  const s = stateFor(supabase);
  if (s.inflight) return s.inflight;
  if (!s.dirty && Date.now() - s.lastCheck < TAGS_MV_MIN_REFRESH_INTERVAL_MS) return;

  s.dirty = false;
  s.inflight = (async () => {
    try {
      const { error } = await supabase.rpc('refresh_vcon_tags_mv_if_stale');
      if (error) {
        s.dirty = true; // retry on the next read
        logWithContext('warn', 'refresh_vcon_tags_mv_if_stale failed; tag reads may be stale', {
          error_message: extractErrorMessage(error),
        });
      } else {
        s.lastCheck = Date.now();
      }
    } finally {
      s.inflight = null;
    }
  })();
  return s.inflight;
}
