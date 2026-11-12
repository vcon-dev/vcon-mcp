/**
 * The per-request store context of a TENANT_MODE=lane request.
 *
 * Every request gets its own supabase-js client, built from that request's bearer JWT and nothing else,
 * and its own queries, service and (empty) plugin manager. Nothing here is shared between requests, so
 * two tenants' requests never share a client. No env key is read on this path: the token is both the
 * `apikey` and the `Authorization` bearer PostgREST sees.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseVConQueries } from '../db/queries.js';
import { skipTagsMvRefresh } from '../db/tags-mv.js';
import type { IDatabaseAnalytics, IDatabaseInspector, IDatabaseSizeAnalyzer } from '../db/types.js';
import { PluginManager } from '../hooks/plugin-manager.js';
import { VConService } from '../services/vcon-service.js';
import type { ToolHandlerContext } from '../tools/handlers/base.js';
import type { VCon } from '../types/vcon.js';

export interface LaneStoreOptions {
  /** The lane PostgREST base URL. supabase-js appends /rest/v1; the proxy in front strips it. */
  url: string;
  /** Postgres schema. Default public. */
  schema?: string;
  /** The fetch the store client uses. Tests pass a stub. */
  fetch?: typeof fetch;
}

/** The store options from env: SUPABASE_URL and SUPABASE_DB_SCHEMA. */
export function laneStoreOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): LaneStoreOptions {
  return { url: (env.SUPABASE_URL ?? '').trim(), schema: env.SUPABASE_DB_SCHEMA || 'public' };
}

/**
 * A supabase-js client that sends `jwt` as both `apikey` and `Authorization: Bearer`. The accessToken
 * option keeps supabase-js from building an auth client, so no session is read or refreshed.
 */
export function createLaneStoreClient(jwt: string, options: LaneStoreOptions): SupabaseClient {
  return createClient(options.url, jwt, {
    db: { schema: options.schema || 'public' },
    accessToken: async () => jwt,
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
  }) as SupabaseClient;
}

/**
 * The query layer of one lane request. Reads are the shared Supabase implementation. The two changes:
 * createVCon (the batch writer) cannot run, and deleteVCon reports how many rows it removed, because under
 * row-level security another tenant's uuid matches nothing and PostgREST answers without an error.
 */
export class LaneVConQueries extends SupabaseVConQueries {
  constructor(private readonly store: SupabaseClient) {
    super(store, null);
    // The tag view is refreshed by the writer. A tenant token may not refresh it.
    skipTagsMvRefresh(store);
  }

  override async createVCon(_vcon: VCon): Promise<{ uuid: string; id: string }> {
    throw new Error('TENANT_MODE=lane does not write vCons');
  }

  /** Deletes the vCon and returns the number of vcons rows removed: 0 when no row was visible. */
  override async deleteVCon(uuid: string): Promise<number> {
    const { data, error } = await this.store.from('vcons').delete().eq('uuid', uuid).select('uuid');
    if (error) throw error;
    return Array.isArray(data) ? data.length : 0;
  }
}

/** Any use of an operator surface on the lane path fails loudly instead of reaching the store. */
function refused<T>(name: string): T {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return undefined;
        throw new Error(`${name}.${String(prop)} is not available in TENANT_MODE=lane`);
      },
    }
  ) as T;
}

/** The handler context for one lane request, built from its bearer JWT. */
export function createLaneContext(jwt: string, options: LaneStoreOptions): ToolHandlerContext {
  const supabase = createLaneStoreClient(jwt, options);
  const queries = new LaneVConQueries(supabase);
  const pluginManager = new PluginManager();
  return {
    queries,
    pluginManager,
    vconService: new VConService({ queries, pluginManager }),
    supabase,
    dbInspector: refused<IDatabaseInspector>('dbInspector'),
    dbAnalytics: refused<IDatabaseAnalytics>('dbAnalytics'),
    dbSizeAnalyzer: refused<IDatabaseSizeAnalyzer>('dbSizeAnalyzer'),
  };
}
