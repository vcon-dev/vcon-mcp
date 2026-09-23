import { SupabaseClient } from '@supabase/supabase-js';
import { logWithContext } from '../observability/instrumentation.js';
import { extractErrorMessage } from '../utils/errors.js';

/**
 * Bring vcon_tags_mv up to date before reading it. Nothing else refreshes the view on a
 * deployment without pg_cron, so tag reads saw an empty view (CON-995). A no-op when the
 * view is current; a failure (older schema without the RPC) is logged and the read goes on.
 */
export async function refreshTagsMvIfStale(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc('refresh_vcon_tags_mv_if_stale');
  if (error) {
    logWithContext('warn', 'refresh_vcon_tags_mv_if_stale failed; tag reads may be stale', {
      error_message: extractErrorMessage(error),
    });
  }
}
