/**
 * REST API Authentication Middleware for Koa
 * 
 * Provides API key authentication for REST endpoints
 */

import type { Context, Next } from 'koa';
import { logWithContext } from '../observability/instrumentation.js';

export interface AuthConfig {
  /** API keys that are allowed (comma-separated in env) */
  apiKeys: string[];
  /** Header name for API key (default: x-api-key) */
  headerName: string;
  /** Whether auth is required (default: true) */
  required: boolean;
}

/**
 * Get auth configuration from environment
 */
export function getAuthConfig(): AuthConfig {
  const apiKeysEnv = process.env.VCON_API_KEYS || process.env.API_KEYS || '';
  const apiKeys = apiKeysEnv
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);

  return {
    apiKeys,
    headerName: process.env.API_KEY_HEADER || 'x-api-key',
    required: process.env.API_AUTH_REQUIRED !== 'false',
  };
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
    if (authConfig.apiKeys.length === 0) {
      logWithContext('error', 'API auth required but no API keys configured - blocking request', {
        path: ctx.path,
        hint: 'Set VCON_API_KEYS or API_KEYS environment variable, or set API_AUTH_REQUIRED=false to disable auth',
      });

      ctx.status = 503;
      ctx.body = {
        error: 'Service Unavailable',
        message: 'API authentication is required but not configured. Please contact the administrator.',
        hint: process.env.NODE_ENV !== 'production' 
          ? 'Set VCON_API_KEYS or API_KEYS env var, or set API_AUTH_REQUIRED=false' 
          : undefined,
      };
      return;
    }

    // Get API key from header
    const apiKey = ctx.get(authConfig.headerName);

    if (!apiKey) {
      ctx.status = 401;
      ctx.set('WWW-Authenticate', 'ApiKey realm="vCon API"');
      ctx.body = {
        error: 'Unauthorized',
        message: `Missing ${authConfig.headerName} header`,
      };
      return;
    }

    // Check if API key is valid
    if (!authConfig.apiKeys.includes(apiKey)) {
      logWithContext('warn', 'Invalid API key attempted', {
        remote_address: ctx.ip,
        api_key_prefix: apiKey.substring(0, 8) + '...',
      });

      ctx.status = 401;
      ctx.set('WWW-Authenticate', 'ApiKey realm="vCon API"');
      ctx.body = {
        error: 'Unauthorized',
        message: 'Invalid API key',
      };
      return;
    }

    // Store API key in state for downstream use
    ctx.state.apiKey = apiKey;
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
