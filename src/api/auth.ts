/**
 * REST API and MCP HTTP Authentication
 *
 * Provides API key authentication for REST and MCP HTTP endpoints.
 * Default: Authorization: Bearer <token>. Override with API_KEY_HEADER (e.g. x-api-key) if needed.
 */

import type { IncomingMessage } from 'http';
import type { Context, Next } from 'koa';
import { logWithContext } from '../observability/instrumentation.js';

export interface AuthConfig {
  /** Full-access API keys (comma-separated in env API_KEYS) */
  apiKeys: string[];
  /** Read-only API keys (comma-separated in env API_KEYS_READONLY) */
  readonlyKeys: string[];
  /** Header name for API key (default: authorization, i.e. Authorization: Bearer <token>). */
  headerName: string;
  /** Whether auth is required (default: true) */
  required: boolean;
}

function splitKeys(env: string | undefined): string[] {
  return (env || '')
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);
}

/**
 * Get auth configuration from environment.
 *
 * API_KEYS keeps full read/write access (backward compatible). API_KEYS_READONLY
 * tokens authenticate but may only read. A token listed in both is treated as
 * read-only (deny wins).
 */
export function getAuthConfig(): AuthConfig {
  const readonlyKeys = splitKeys(process.env.API_KEYS_READONLY);
  const apiKeys = splitKeys(process.env.API_KEYS).filter(k => !readonlyKeys.includes(k));

  return {
    apiKeys,
    readonlyKeys,
    headerName: process.env.API_KEY_HEADER || 'authorization',
    required: process.env.API_AUTH_REQUIRED !== 'false',
  };
}

/** True if the token is a configured read-only key. */
export function isReadonlyToken(config: AuthConfig, token: string): boolean {
  return config.readonlyKeys.includes(token);
}

/** All tokens that authenticate, whatever their scope. */
function allKeys(config: AuthConfig): string[] {
  return [...config.apiKeys, ...config.readonlyKeys];
}

/** HTTP methods a read-only token may use on the REST API. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Lower-case header name for lookup (Node headers are lower-cased) */
function getHeader(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Extract token from request headers.
 * With default header "authorization", reads Authorization: Bearer <token>. Else reads configured header.
 */
export function getTokenFromRequest(req: IncomingMessage, headerName: string): string | undefined {
  const authHeader = getHeader(req, 'authorization');
  const trimmedAuthHeader = authHeader?.trim();
  if (trimmedAuthHeader?.toLowerCase().startsWith('bearer ')) {
    return trimmedAuthHeader.slice(7).trim() || undefined;
  }
  const value = getHeader(req, headerName);
  return value?.trim() || undefined;
}

export type ValidateHttpAuthResult =
  | { ok: true; readonly: boolean }
  | { ok: false; statusCode: number; body: object; wwwAuth?: string };

/**
 * Validate auth for a raw HTTP request (e.g. MCP endpoint).
 * Reuses same config as REST API (API_KEYS, API_KEY_HEADER, API_AUTH_REQUIRED).
 */
export function validateHttpRequestAuth(
  req: IncomingMessage,
  config: AuthConfig
): ValidateHttpAuthResult {
  if (!config.required) {
    return { ok: true, readonly: false };
  }
  if (allKeys(config).length === 0) {
    logWithContext('error', 'MCP auth required but no API keys configured - blocking request', {
      hint: 'Set API_KEYS, or set API_AUTH_REQUIRED=false',
    });
    return {
      ok: false,
      statusCode: 503,
      body: {
        error: 'Service Unavailable',
        message: 'MCP authentication is required but not configured.',
        hint:
          process.env.NODE_ENV !== 'production'
            ? 'Set API_KEYS env var, or set API_AUTH_REQUIRED=false'
            : undefined,
      },
    };
  }

  const token = getTokenFromRequest(req, config.headerName);
  if (!token) {
    return {
      ok: false,
      statusCode: 401,
      wwwAuth: 'Bearer realm="vCon MCP"',
      body: {
        error: 'Unauthorized',
        message:
          config.headerName === 'authorization'
            ? 'Missing Authorization: Bearer <token> header'
            : `Missing ${config.headerName} or Authorization: Bearer <token> header`,
      },
    };
  }
  if (!allKeys(config).includes(token)) {
    logWithContext('warn', 'Invalid MCP auth token attempted', {
      remote_address: req.socket?.remoteAddress,
      token_prefix: token.substring(0, 8) + '...',
    });
    return {
      ok: false,
      statusCode: 401,
      wwwAuth: 'Bearer realm="vCon MCP"',
      body: { error: 'Unauthorized', message: 'Invalid token' },
    };
  }
  return { ok: true, readonly: isReadonlyToken(config, token) };
}

/**
 * Koa authentication middleware factory
 */
export function createAuthMiddleware(config?: Partial<AuthConfig>) {
  const authConfig: AuthConfig = { ...getAuthConfig(), ...config };

  return async (ctx: Context, next: Next) => {
    // If auth not required, skip validation entirely
    if (!authConfig.required) {
      await next();
      return;
    }

    // Auth is required but no API keys are configured - this is a misconfiguration
    // Block requests with a clear error rather than silently allowing access
    if (allKeys(authConfig).length === 0) {
      logWithContext('error', 'API auth required but no API keys configured - blocking request', {
        path: ctx.path,
        hint: 'Set API_KEYS environment variable, or set API_AUTH_REQUIRED=false to disable auth',
      });

      ctx.status = 503;
      ctx.body = {
        error: 'Service Unavailable',
        message: 'API authentication is required but not configured. Please contact the administrator.',
        hint: process.env.NODE_ENV !== 'production' 
          ? 'Set API_KEYS env var, or set API_AUTH_REQUIRED=false' 
          : undefined,
      };
      return;
    }

    // Get API key: support Authorization: Bearer <token> (MockMCP-style) and configured header
    const authHeader = ctx.get('authorization');
    const trimmedAuthHeader = authHeader?.trim();
    const apiKey = trimmedAuthHeader?.toLowerCase().startsWith('bearer ')
      ? trimmedAuthHeader.slice(7).trim()
      : (ctx.get(authConfig.headerName) || '').trim();

    if (!apiKey) {
      ctx.status = 401;
      ctx.set('WWW-Authenticate', 'Bearer realm="vCon API"');
      ctx.body = {
        error: 'Unauthorized',
        message:
          authConfig.headerName === 'authorization'
            ? 'Missing Authorization: Bearer <token> header'
            : `Missing ${authConfig.headerName} header`,
      };
      return;
    }

    // Check if API key is valid (full-access or read-only)
    if (!allKeys(authConfig).includes(apiKey)) {
      logWithContext('warn', 'Invalid API key attempted', {
        remote_address: ctx.ip,
        api_key_prefix: apiKey.substring(0, 8) + '...',
      });

      ctx.status = 401;
      ctx.set('WWW-Authenticate', 'Bearer realm="vCon API"');
      ctx.body = {
        error: 'Unauthorized',
        message: 'Invalid API key',
      };
      return;
    }

    // Store API key + scope in state for downstream use
    ctx.state.apiKey = apiKey;
    ctx.state.readonly = isReadonlyToken(authConfig, apiKey);

    // Read-only tokens may only read. Method-based, so every current and future
    // mutating route is covered without a per-route allowlist.
    if (ctx.state.readonly && !READ_METHODS.has(ctx.method.toUpperCase())) {
      logWithContext('warn', 'Read-only API key attempted a write', {
        remote_address: ctx.ip,
        method: ctx.method,
        path: ctx.path,
        api_key_prefix: apiKey.substring(0, 8) + '...',
      });
      ctx.status = 403;
      ctx.body = {
        error: 'Forbidden',
        message: `Read-only API key cannot ${ctx.method} ${ctx.path}. Read-only keys are limited to GET requests.`,
      };
      return;
    }

    await next();
  };
}

/**
 * Error handling middleware for Koa
 */
export function errorHandler() {
  return async (ctx: Context, next: Next) => {
    try {
      await next();
    } catch (err: any) {
      const status = err.status || err.statusCode || 500;
      const message = err.message || 'Internal Server Error';

      logWithContext('error', 'REST API error', {
        status,
        message,
        path: ctx.path,
        method: ctx.method,
        error_stack: err.stack,
      });

      ctx.status = status;
      ctx.body = {
        error: status >= 500 ? 'Internal Server Error' : 'Error',
        message: status >= 500 && process.env.NODE_ENV === 'production' 
          ? 'An unexpected error occurred' 
          : message,
        timestamp: new Date().toISOString(),
      };
    }
  };
}

/**
 * Request logging middleware for Koa
 */
export function requestLogger() {
  return async (ctx: Context, next: Next) => {
    const startTime = Date.now();

    logWithContext('info', 'REST API request', {
      method: ctx.method,
      path: ctx.path,
      query: ctx.querystring || undefined,
      remote_address: ctx.ip,
      user_agent: ctx.get('user-agent'),
    });

    await next();

    const duration = Date.now() - startTime;

    logWithContext('info', 'REST API response', {
      method: ctx.method,
      path: ctx.path,
      status: ctx.status,
      duration_ms: duration,
    });
  };
}
