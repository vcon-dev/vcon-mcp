/**
 * Tests for REST and MCP HTTP auth (getTokenFromRequest, validateHttpRequestAuth)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage } from 'http';
import {
  getAuthConfig,
  getTokenFromRequest,
  validateHttpRequestAuth,
} from '../../src/api/auth.js';

vi.mock('../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
}));

function mockReq(headers: Record<string, string>): IncomingMessage {
  return {
    headers: { ...headers },
    socket: { remoteAddress: '127.0.0.1' },
  } as IncomingMessage;
}

describe('getTokenFromRequest', () => {
  it('extracts Bearer token from Authorization header (default)', () => {
    const req = mockReq({ authorization: 'Bearer sk-secret-123' });
    expect(getTokenFromRequest(req, 'authorization')).toBe('sk-secret-123');
  });

  it('extracts token from custom header when API_KEY_HEADER is set', () => {
    const req = mockReq({ 'x-api-key': 'my-api-key' });
    expect(getTokenFromRequest(req, 'x-api-key')).toBe('my-api-key');
  });

  it('returns undefined when no auth header', () => {
    const req = mockReq({});
    expect(getTokenFromRequest(req, 'authorization')).toBeUndefined();
  });
});

describe('validateHttpRequestAuth', () => {
  beforeEach(() => {
    vi.stubEnv('API_AUTH_REQUIRED', 'true');
    vi.stubEnv('API_KEYS', 'key1,key2');
  });

  it('returns ok when auth not required', () => {
    const config = { ...getAuthConfig(), required: false };
    const req = mockReq({});
    expect(validateHttpRequestAuth(req, config)).toEqual({ ok: true });
  });

  it('returns ok when Authorization Bearer token is valid (default)', () => {
    const config = getAuthConfig();
    const req = mockReq({ authorization: 'Bearer key1' });
    expect(validateHttpRequestAuth(req, config)).toEqual({ ok: true });
  });

  it('returns ok when custom header is valid (API_KEY_HEADER override)', () => {
    const config = { ...getAuthConfig(), headerName: 'x-api-key' };
    const req = mockReq({ 'x-api-key': 'key2' });
    expect(validateHttpRequestAuth(req, config)).toEqual({ ok: true });
  });

  it('returns 401 when token missing and auth required', () => {
    const config = getAuthConfig();
    const req = mockReq({});
    const result = validateHttpRequestAuth(req, config);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.statusCode).toBe(401);
      expect(result.body).toMatchObject({ error: 'Unauthorized' });
      expect(result.wwwAuth).toContain('Bearer');
    }
  });

  it('returns 401 when token invalid', () => {
    const config = getAuthConfig();
    const req = mockReq({ authorization: 'Bearer wrong-key' });
    const result = validateHttpRequestAuth(req, config);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.statusCode).toBe(401);
      expect(result.body).toMatchObject({ error: 'Unauthorized', message: 'Invalid token' });
    }
  });
});
