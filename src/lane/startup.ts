/**
 * TENANT_MODE=lane start checks.
 *
 * A lane holds no store key. It forwards each request's bearer JWT to its own PostgREST, which verifies
 * it, and row-level policies keyed on the token's tenant_id claim decide what it reads. So the process
 * refuses to start with a key in its env, and refuses any setup that would serve more than the five
 * read tools per stateless HTTP request. See docs/guide/tenant-lane.md.
 */

/** True when an env variable holds a value. An empty or blank variable holds no key. */
function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Why this process may not start as a lane. Empty when it may. Messages name variables, never their
 * values.
 */
export function laneStartupProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  if (isSet(env.SUPABASE_SERVICE_ROLE_KEY)) {
    problems.push('SUPABASE_SERVICE_ROLE_KEY is set. A lane holds no store key; unset it.');
  }
  if (isSet(env.SUPABASE_ANON_KEY)) {
    problems.push('SUPABASE_ANON_KEY is set. A lane holds no store key; unset it.');
  }
  if ((env.MCP_TRANSPORT || 'stdio') !== 'http') {
    problems.push('MCP_TRANSPORT must be http. A lane serves Streamable HTTP only; stdio is off.');
  }
  if (env.MCP_HTTP_STATELESS !== 'true') {
    problems.push('MCP_HTTP_STATELESS must be true. A lane builds its store client from each request.');
  }
  if (!isSet(env.SUPABASE_URL)) {
    problems.push('SUPABASE_URL is required: the lane PostgREST, never the one that accepts the service key.');
  } else if (!isHttpUrl(env.SUPABASE_URL!.trim())) {
    problems.push('SUPABASE_URL must be an http or https URL.');
  }
  if ((env.DB_TYPE || 'supabase') !== 'supabase') {
    problems.push('DB_TYPE must be supabase. A lane reads through PostgREST only.');
  }
  return problems;
}

/** Settings a lane does not use. Logged at start so nobody relies on them. */
const IGNORED_IN_LANE = [
  'REDIS_URL',
  'VCON_PLUGINS_PATH',
  'API_KEYS',
  'API_KEYS_READONLY',
  'API_ANONYMOUS_READONLY',
  'API_AUTH_REQUIRED',
  'API_KEY_HEADER',
  'OAUTH_ISSUER',
  'RLS_ENABLED',
  'CURRENT_TENANT_ID',
  'MCP_TOOLS_PROFILE',
  'MCP_ENABLED_CATEGORIES',
  'MCP_DISABLED_CATEGORIES',
  'MCP_DISABLED_TOOLS',
  'REST_API_ENABLED',
] as const;

/** The names of the settings in `env` that a lane ignores. */
export function laneIgnoredSettings(env: NodeJS.ProcessEnv = process.env): string[] {
  return IGNORED_IN_LANE.filter((name) => isSet(env[name]));
}
