/**
 * Tests for OAuth resource-server support on the MCP endpoint (src/api/oauth.ts)
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { getAuthConfig, validateHttpRequestAuth } from '../../src/api/auth.js';
import { logWithContext } from '../../src/observability/instrumentation.js';
import {
  applyOAuth,
  getOAuthConfig,
  handleOAuthDiscovery,
  resourceMetadataUrl,
  verifyOAuthToken,
  type OAuthConfig,
} from '../../src/api/oauth.js';

vi.mock('../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
}));

const ISSUER = 'https://example-ref.supabase.co/auth/v1';
const RESOURCE = 'https://mcp.example.com/mcp';

let privateKey: CryptoKey;
let config: OAuthConfig;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' };
  config = {
    issuer: ISSUER,
    resource: RESOURCE,
    readonly: true,
    allowedEmailDomains: [],
    consentProviders: ['email'],
    jwks: createLocalJWKSet({ keys: [jwk] }),
  };
});

function sign(claims: Record<string, unknown> = {}, opts: { aud?: string; iss?: string; exp?: string } = {}) {
  return new SignJWT({ email: 'user@example.com', client_id: 'c1', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject('user-1')
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? RESOURCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(privateKey);
}

function mockReq(headers: Record<string, string>): IncomingMessage {
  return { headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

function mockRes() {
  const res = { status: 0, headers: {} as Record<string, string>, body: '' };
  const obj = {
    writeHead: (s: number, h: Record<string, string>) => { res.status = s; res.headers = h; },
    end: (b?: string) => { res.body = b ?? ''; },
  } as unknown as ServerResponse;
  return { res, obj };
}

describe('getOAuthConfig', () => {
  it('is disabled without OAUTH_ISSUER', () => {
    vi.stubEnv('OAUTH_ISSUER', '');
    expect(getOAuthConfig()).toBeNull();
  });

  it('refuses an issuer with no resource to bind the audience to', () => {
    vi.stubEnv('OAUTH_ISSUER', ISSUER);
    vi.stubEnv('OAUTH_RESOURCE', '');
    expect(() => getOAuthConfig()).toThrow(/OAUTH_RESOURCE/);
  });

  it('defaults OAuth sessions to read-only', () => {
    vi.stubEnv('OAUTH_ISSUER', `${ISSUER}/`);
    vi.stubEnv('OAUTH_RESOURCE', RESOURCE);
    vi.stubEnv('OAUTH_READONLY', '');
    const c = getOAuthConfig()!;
    expect(c.issuer).toBe(ISSUER);
    expect(c.readonly).toBe(true);
  });
});

describe('discovery', () => {
  it('builds the path-suffixed metadata URL', () => {
    expect(resourceMetadataUrl(config)).toBe('https://mcp.example.com/.well-known/oauth-protected-resource/mcp');
  });

  it.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])(
    'serves protected-resource metadata at %s',
    (path) => {
      const { res, obj } = mockRes();
      expect(handleOAuthDiscovery(path, obj, config)).toBe(true);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ resource: RESOURCE, authorization_servers: [ISSUER] });
    }
  );

  it('redirects authorization-server metadata to the issuer', () => {
    const { res, obj } = mockRes();
    expect(handleOAuthDiscovery('/.well-known/oauth-authorization-server', obj, config)).toBe(true);
    expect(res.status).toBe(302);
    expect(res.headers.Location).toBe('https://example-ref.supabase.co/.well-known/oauth-authorization-server/auth/v1');
  });

  it('serves the consent page only when an anon key is configured', () => {
    const off = mockRes();
    expect(handleOAuthDiscovery('/oauth/consent', off.obj, config)).toBe(false);
    const on = mockRes();
    expect(handleOAuthDiscovery('/oauth/consent', on.obj, { ...config, consentAnonKey: 'anon</script>' })).toBe(true);
    expect(on.res.status).toBe(200);
    expect(on.res.headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    // A config value can never close the script tag.
    expect(on.res.body).not.toContain('anon</script>');
    expect(on.res.body).toContain('anon\\u003c/script>');
  });

  it('does not loop when the issuer shares the resource origin', () => {
    const sameOrigin = { ...config, issuer: 'https://mcp.example.com/auth/v1' };
    const bare = mockRes();
    expect(handleOAuthDiscovery('/.well-known/oauth-authorization-server', bare.obj, sameOrigin)).toBe(true);
    expect(bare.res.headers.Location).toBe('https://mcp.example.com/.well-known/oauth-authorization-server/auth/v1');
    // The redirect target itself belongs to the issuer, not to this handler.
    const target = mockRes();
    expect(handleOAuthDiscovery('/.well-known/oauth-authorization-server/auth/v1', target.obj, sameOrigin)).toBe(false);
  });

  it('passes the configured sign-in providers to the consent page', () => {
    vi.stubEnv('OAUTH_ISSUER', ISSUER);
    vi.stubEnv('OAUTH_RESOURCE', RESOURCE);
    vi.stubEnv('OAUTH_CONSENT_PROVIDERS', 'Google, bad"name');
    const c = { ...getOAuthConfig()!, consentAnonKey: 'anon' };
    expect(c.consentProviders).toEqual(['google']);
    const page = mockRes();
    handleOAuthDiscovery('/oauth/consent', page.obj, c);
    expect(page.res.body).toContain('"providers":["google"]');
  });

  it('renders a consent script that parses', () => {
    // The page lives in a template literal, which silently eats regex backslashes.
    const page = mockRes();
    handleOAuthDiscovery('/oauth/consent', page.obj, { ...config, consentAnonKey: 'anon', consentProviders: ['google', 'email'] });
    const js = page.res.body.split('<script>')[1].split('</script>')[0];
    expect(() => new Function(js)).not.toThrow();
  });

  it('leaves other paths alone', () => {
    const { obj } = mockRes();
    expect(handleOAuthDiscovery('/mcp', obj, config)).toBe(false);
  });
});

describe('verifyOAuthToken', () => {
  it('accepts a token for this resource', async () => {
    expect(await verifyOAuthToken(await sign(), config)).toEqual({ readonly: true, subject: 'user-1' });
  });

  it('rejects the Supabase default audience', async () => {
    expect(await verifyOAuthToken(await sign({}, { aud: 'authenticated' }), config)).toBeNull();
  });

  it('rejects another issuer', async () => {
    expect(await verifyOAuthToken(await sign({}, { iss: 'https://evil.example/auth/v1' }), config)).toBeNull();
  });

  it('rejects an expired token', async () => {
    expect(await verifyOAuthToken(await sign({}, { exp: '-1m' }), config)).toBeNull();
  });

  it('enforces the email domain allowlist', async () => {
    const c = { ...config, allowedEmailDomains: ['example.com'] };
    expect(await verifyOAuthToken(await sign(), c)).not.toBeNull();
    expect(await verifyOAuthToken(await sign({ email: 'x@other.org' }), c)).toBeNull();
  });
});

describe('applyOAuth after the static-key check', () => {
  beforeEach(() => {
    vi.stubEnv('API_AUTH_REQUIRED', 'true');
    vi.stubEnv('API_KEYS', 'static-key');
    vi.stubEnv('API_KEYS_READONLY', '');
    vi.stubEnv('API_ANONYMOUS_READONLY', 'false');
  });

  // Mirrors src/transport/http.ts: the static check stays quiet while OAuth gets a turn.
  async function run(headers: Record<string, string>) {
    const auth = getAuthConfig();
    const req = mockReq(headers);
    return applyOAuth(req, validateHttpRequestAuth(req, auth, { logInvalid: false }), auth, config);
  }
  const invalidWarnings = () =>
    vi.mocked(logWithContext).mock.calls.filter(([level, msg]) => level === 'warn' && msg === 'Invalid MCP auth token attempted').length;

  it('keeps static bearer tokens working with full access', async () => {
    expect(await run({ authorization: 'Bearer static-key' })).toEqual({ ok: true, readonly: false });
  });

  it('accepts an OAuth token', async () => {
    expect(await run({ authorization: `Bearer ${await sign()}` })).toEqual({ ok: true, readonly: true });
  });

  it('logs no invalid-token warning for a valid OAuth token, one for a bad token', async () => {
    vi.mocked(logWithContext).mockClear();
    await run({ authorization: `Bearer ${await sign()}` });
    expect(invalidWarnings()).toBe(0);
    await run({ authorization: 'Bearer nope' });
    expect(invalidWarnings()).toBe(1);
  });

  it('points a tokenless client at the resource metadata', async () => {
    const r = await run({});
    expect(r).toMatchObject({ ok: false, statusCode: 401 });
    expect(r.ok === false && r.wwwAuth).toBe(
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"'
    );
  });

  it('flags a bad token as invalid_token', async () => {
    const r = await run({ authorization: 'Bearer nope' });
    expect(r.ok === false && r.wwwAuth).toContain('error="invalid_token"');
  });

  it('works with no API_KEYS configured (OAuth-only deployment)', async () => {
    vi.stubEnv('API_KEYS', '');
    expect(await run({ authorization: `Bearer ${await sign()}` })).toEqual({ ok: true, readonly: true });
    expect(await run({})).toMatchObject({ ok: false, statusCode: 401 });
  });
});
