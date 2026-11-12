import { describe, expect, it } from 'vitest';
import { assertLaneCanStart, LaneStartupError } from '../../src/lane/index.js';
import { laneIgnoredSettings, laneStartupProblems } from '../../src/lane/startup.js';

const GOOD: NodeJS.ProcessEnv = {
  TENANT_MODE: 'lane',
  MCP_TRANSPORT: 'http',
  MCP_HTTP_STATELESS: 'true',
  SUPABASE_URL: 'http://127.0.0.1:3010',
};

describe('laneStartupProblems', () => {
  it('allows a lane with stateless HTTP, a store URL and no key', () => {
    expect(laneStartupProblems(GOOD)).toEqual([]);
    expect(() => assertLaneCanStart(GOOD)).not.toThrow();
  });

  it('refuses a service key and never echoes it', () => {
    const problems = laneStartupProblems({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: 'canary-service-key-123' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/SUPABASE_SERVICE_ROLE_KEY is set/);
    expect(problems.join(' ')).not.toContain('canary-service-key-123');
    expect(() => assertLaneCanStart({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: 'x' })).toThrow(LaneStartupError);
  });

  it('refuses an anon key too: the lane holds no store key of any kind', () => {
    const problems = laneStartupProblems({ ...GOOD, SUPABASE_ANON_KEY: 'canary-anon-key' });
    expect(problems).toEqual(['SUPABASE_ANON_KEY is set. A lane holds no store key; unset it.']);
  });

  it('treats a blank key variable as unset', () => {
    expect(laneStartupProblems({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ANON_KEY: '  ' })).toEqual([]);
  });

  it('refuses stdio, the default transport', () => {
    const { MCP_TRANSPORT: _t, ...noTransport } = GOOD;
    expect(laneStartupProblems(noTransport)).toEqual([
      'MCP_TRANSPORT must be http. A lane serves Streamable HTTP only; stdio is off.',
    ]);
    expect(laneStartupProblems({ ...GOOD, MCP_TRANSPORT: 'stdio' })).toHaveLength(1);
  });

  it('refuses stateful HTTP', () => {
    const { MCP_HTTP_STATELESS: _s, ...stateful } = GOOD;
    expect(laneStartupProblems(stateful)[0]).toMatch(/MCP_HTTP_STATELESS must be true/);
    expect(laneStartupProblems({ ...GOOD, MCP_HTTP_STATELESS: 'false' })).toHaveLength(1);
  });

  it('needs a store URL and the Supabase backend', () => {
    expect(laneStartupProblems({ ...GOOD, SUPABASE_URL: '' })[0]).toMatch(/SUPABASE_URL is required/);
    expect(laneStartupProblems({ ...GOOD, SUPABASE_URL: 'lane-store:3010' })[0]).toMatch(/must be an http or https URL/);
    expect(laneStartupProblems({ ...GOOD, SUPABASE_URL: 'https://lane-store.invalid' })).toEqual([]);
    expect(laneStartupProblems({ ...GOOD, DB_TYPE: 'mongodb' })[0]).toMatch(/DB_TYPE must be supabase/);
  });

  it('lists every problem at once', () => {
    const problems = laneStartupProblems({ TENANT_MODE: 'lane', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    expect(problems).toHaveLength(4);
    expect(() => assertLaneCanStart({ TENANT_MODE: 'lane', SUPABASE_SERVICE_ROLE_KEY: 'k' }))
      .toThrow(/SUPABASE_SERVICE_ROLE_KEY.*MCP_TRANSPORT.*MCP_HTTP_STATELESS.*SUPABASE_URL/);
  });
});

describe('laneIgnoredSettings', () => {
  it('names the settings a lane does not use, so the start log can warn', () => {
    expect(laneIgnoredSettings(GOOD)).toEqual([]);
    expect(laneIgnoredSettings({
      ...GOOD,
      REDIS_URL: 'redis://127.0.0.1:6379',
      VCON_PLUGINS_PATH: './plugin.js',
      API_KEYS: 'k',
      OAUTH_ISSUER: 'https://issuer.invalid',
      CURRENT_TENANT_ID: 't-aaaaaaaaaaaaaaaa',
      TENANT_ATTACHMENT_TYPE: 'other',
      TAGS_MV_REFRESH_INTERVAL_MS: '5',
      MCP_DISABLED_TOOLS: 'get_vcon',
    })).toEqual([
      'REDIS_URL', 'VCON_PLUGINS_PATH', 'API_KEYS', 'OAUTH_ISSUER', 'CURRENT_TENANT_ID', 'TENANT_ATTACHMENT_TYPE',
      'TAGS_MV_REFRESH_INTERVAL_MS', 'MCP_DISABLED_TOOLS',
    ]);
  });
});
