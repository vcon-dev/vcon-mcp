/**
 * TENANT_MODE=lane: one narrow server for many tenants on a row-level store.
 *
 * Holds no store key. Builds its store client per request from the caller's bearer JWT and forwards it to
 * its own PostgREST, which verifies it. Serves five tools over stateless Streamable HTTP. No REST routes
 * but health, no resources, prompts or plugins, no Redis cache, no stdio. See docs/guide/tenant-lane.md.
 */

import type http from 'http';
import { logWithContext } from '../observability/instrumentation.js';
import { getHttpTransportConfig } from '../transport/http.js';
import { resolveProvider } from '../utils/embeddings.js';
import { laneStoreOptionsFromEnv } from './context.js';
import { startLaneHttpServer } from './http.js';
import { laneIgnoredSettings, laneStartupProblems } from './startup.js';

export { readLaneBearer } from './bearer.js';
export { createLaneContext, createLaneStoreClient, LaneVConQueries } from './context.js';
export { startLaneHttpServer } from './http.js';
export { createLaneMcpServer, LANE_TOOL_NAMES } from './mcp-server.js';
export { laneIgnoredSettings, laneStartupProblems } from './startup.js';

/** Thrown when the env does not allow a lane to start. The message lists every reason. */
export class LaneStartupError extends Error {
  constructor(public readonly problems: string[]) {
    super(`TENANT_MODE=lane cannot start: ${problems.join(' ')}`);
    this.name = 'LaneStartupError';
  }
}

/** Throws LaneStartupError unless `env` allows a lane to start. */
export function assertLaneCanStart(env: NodeJS.ProcessEnv = process.env): void {
  const problems = laneStartupProblems(env);
  if (problems.length) throw new LaneStartupError(problems);
}

/** Checks the env and starts the lane's HTTP server. */
export async function startTenantLane(env: NodeJS.ProcessEnv = process.env): Promise<http.Server> {
  assertLaneCanStart(env);

  const ignored = laneIgnoredSettings(env);
  if (ignored.length) {
    logWithContext('warn', 'TENANT_MODE=lane ignores these settings', { settings: ignored.join(', ') });
  }
  if (resolveProvider().provider === 'supabase') {
    // The embed-query edge function is called with the service key, which a lane does not hold.
    logWithContext('warn', 'search_vcons_semantic with query text needs EMBEDDING_PROVIDER=openai in TENANT_MODE=lane', {
      hint: 'Callers can still pass a precomputed embedding. Query and corpus vectors must come from one model.',
    });
  }

  const transport = getHttpTransportConfig();
  return startLaneHttpServer(
    {
      port: transport.port,
      host: transport.host,
      jsonOnly: transport.jsonOnly,
      allowedHosts: transport.allowedHosts,
      allowedOrigins: transport.allowedOrigins,
      dnsProtection: transport.dnsProtection,
    },
    laneStoreOptionsFromEnv(env)
  );
}
