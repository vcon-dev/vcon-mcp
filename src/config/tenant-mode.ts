/**
 * TENANT_MODE selects how this server treats tenants.
 *   off     default: today's behaviour
 *   writer  service key; tenant extraction always on; a bad stamp stores under _quarantine
 *   lane    no service key; a bearer JWT per request; five read tools only
 */
export type TenantMode = 'off' | 'writer' | 'lane';

export const TENANT_MODES: readonly TenantMode[] = ['off', 'writer', 'lane'];

export function getTenantMode(env: NodeJS.ProcessEnv = process.env): TenantMode {
  const raw = (env.TENANT_MODE ?? '').trim().toLowerCase();
  if (raw === '') return 'off';
  if ((TENANT_MODES as readonly string[]).includes(raw)) return raw as TenantMode;
  throw new Error(`TENANT_MODE must be one of ${TENANT_MODES.join(', ')}`);
}
