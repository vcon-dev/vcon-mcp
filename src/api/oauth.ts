/**
 * OAuth 2.1 resource-server support for the MCP HTTP endpoint.
 *
 * vcon-mcp does not issue tokens. An external authorization server (Supabase
 * OAuth Server, or any issuer that publishes a JWKS) runs sign-in, PKCE and
 * dynamic client registration. This module serves the protected-resource
 * metadata (RFC 9728) that points clients at it, and verifies the JWT access
 * tokens it issues on every request: signature, issuer, expiry, and audience
 * bound to this resource.
 *
 * Off unless OAUTH_ISSUER is set. Static API keys are checked first and keep
 * working unchanged.
 */

import type { IncomingMessage } from 'http';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { logWithContext } from '../observability/instrumentation.js';
import { CONSENT_PATH, serveConsentPage } from './oauth-consent.js';
import { getTokenFromRequest, type AuthConfig, type ValidateHttpAuthResult } from './auth.js';

export interface OAuthConfig {
  /** Authorization server issuer, e.g. https://<ref>.supabase.co/auth/v1 */
  issuer: string;
  /** This MCP endpoint's canonical URL, e.g. https://mcp.example.com/mcp. Also the required `aud`. */
  resource: string;
  /** OAuth sessions get read-only tools unless OAUTH_READONLY=false */
  readonly: boolean;
  /** Lower-cased email domains allowed in; empty means any user the issuer signs in */
  allowedEmailDomains: string[];
  /** Supabase publishable (anon) key; when set, the consent page is served at /oauth/consent */
  consentAnonKey?: string;
  /** Consent-page sign-in methods: "email" and/or GoTrue external providers ("google") */
  consentProviders: string[];
  /** Key source for signature checks (the issuer's JWKS) */
  jwks: JWTVerifyGetKey;
}

/** Read OAuth config from env. Returns null when OAuth is disabled. */
export function getOAuthConfig(): OAuthConfig | null {
  const issuer = process.env.OAUTH_ISSUER?.trim().replace(/\/+$/, '');
  if (!issuer) return null;
  const resource = process.env.OAUTH_RESOURCE?.trim();
  if (!resource) {
    // Fail loud: without a resource there is nothing to bind the audience to.
    throw new Error('OAUTH_ISSUER is set but OAUTH_RESOURCE is not (e.g. https://mcp.example.com/mcp)');
  }
  return {
    issuer,
    resource,
    readonly: process.env.OAUTH_READONLY !== 'false',
    allowedEmailDomains: (process.env.OAUTH_ALLOWED_EMAIL_DOMAINS || '')
      .split(',')
      .map(d => d.trim().toLowerCase())
      .filter(Boolean),
    consentAnonKey: process.env.OAUTH_CONSENT_ANON_KEY?.trim() || undefined,
    consentProviders: (process.env.OAUTH_CONSENT_PROVIDERS || 'email')
      .split(',')
      .map(p => p.trim().toLowerCase())
      .filter(p => /^[a-z0-9_-]+$/.test(p)),
    // ponytail: Supabase's JWKS path. Add OAUTH_JWKS_URL if an issuer puts it elsewhere.
    jwks: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
  };
}

/** RFC 9728 metadata URL for the resource: well-known inserted before the resource path. */
export function resourceMetadataUrl(config: OAuthConfig): string {
  const url = new URL(config.resource);
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

/** RFC 8414 metadata URL for the issuer, same insertion rule. */
function authorizationServerMetadataUrl(config: OAuthConfig): string {
  const url = new URL(config.issuer);
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.origin}/.well-known/oauth-authorization-server${path}`;
}

export function wwwAuthenticate(config: OAuthConfig, error?: 'invalid_token'): string {
  return `Bearer resource_metadata="${resourceMetadataUrl(config)}"${error ? `, error="${error}"` : ''}`;
}

/**
 * Answer the discovery paths without auth. Returns true when the request was handled.
 *
 * - /.well-known/oauth-protected-resource and the resource-path-suffixed variant: RFC 9728 metadata
 * - /.well-known/oauth-authorization-server (exact): redirect to the issuer's metadata, for clients that
 *   look for it on the resource origin (the 2025-03-26 MCP auth spec did this)
 * - /oauth/consent: the Supabase consent page, when OAUTH_CONSENT_ANON_KEY is set
 */
export function handleOAuthDiscovery(
  path: string,
  res: import('http').ServerResponse,
  config: OAuthConfig
): boolean {
  const suffixed = new URL(resourceMetadataUrl(config)).pathname;
  if (path === '/.well-known/oauth-protected-resource' || path === suffixed) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Cache-Control': 'max-age=3600',
    });
    res.end(
      JSON.stringify({
        resource: config.resource,
        authorization_servers: [config.issuer],
        bearer_methods_supported: ['header'],
        resource_name: 'vCon MCP',
      })
    );
    return true;
  }
  if (path === CONSENT_PATH && config.consentAnonKey) {
    serveConsentPage(res, config, config.consentAnonKey);
    return true;
  }
  // Exact path only: when the issuer shares this origin (self-hosted auth routed at /auth/v1),
  // the issuer's own path-suffixed metadata URL lands here too and must reach the issuer.
  if (path === '/.well-known/oauth-authorization-server') {
    res.writeHead(302, {
      Location: authorizationServerMetadataUrl(config),
      'Access-Control-Allow-Origin': '*',
    });
    res.end();
    return true;
  }
  return false;
}

/** Verify an OAuth access token. Returns the session scope, or null when the token is not valid here. */
export async function verifyOAuthToken(
  token: string,
  config: OAuthConfig
): Promise<{ readonly: boolean; subject?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, config.jwks, {
      issuer: config.issuer,
      audience: config.resource,
    });
    if (config.allowedEmailDomains.length > 0) {
      const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
      const domain = email.split('@')[1] || '';
      if (!config.allowedEmailDomains.includes(domain)) {
        logWithContext('warn', 'OAuth token rejected: email domain not allowed', { subject: payload.sub, domain });
        return null;
      }
    }
    return { readonly: config.readonly, subject: payload.sub };
  } catch (error) {
    // Expected for static-key typos and expired tokens; no token material logged.
    logWithContext('info', 'OAuth token rejected', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Second chance for a request the static-key check turned away. A valid OAuth
 * token lets it through; otherwise the 401 points the client at the metadata.
 * Only 401s and the "no API keys configured" 503 are retried, so an OAuth-only
 * deployment needs no API_KEYS.
 */
export async function applyOAuth(
  req: IncomingMessage,
  result: ValidateHttpAuthResult,
  authConfig: AuthConfig,
  config: OAuthConfig
): Promise<ValidateHttpAuthResult> {
  if (result.ok || (result.statusCode !== 401 && result.statusCode !== 503)) return result;
  const token = getTokenFromRequest(req, authConfig.headerName);
  if (token) {
    const verified = await verifyOAuthToken(token, config);
    if (verified) return { ok: true, readonly: verified.readonly };
  }
  if (!token && authConfig.anonymousReadonly) return { ok: true, readonly: true };
  return {
    ok: false,
    statusCode: 401,
    wwwAuth: wwwAuthenticate(config, token ? 'invalid_token' : undefined),
    body: {
      error: 'Unauthorized',
      message: token ? 'Invalid or expired token' : 'Missing Authorization: Bearer <token> header',
    },
  };
}
