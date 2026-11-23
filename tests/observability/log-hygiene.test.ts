/**
 * What the logs carry: no query strings, no token or key prefixes, no search text, and logWithContext
 * goes through pino without copying its attributes onto the active span.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { EventEmitter } from 'events';
import { trace } from '@opentelemetry/api';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/observability/logger.js';
import { initializeObservability } from '../../src/observability/config.js';
import { logWithContext } from '../../src/observability/instrumentation.js';
import { createAuthMiddleware, requestLogger, validateHttpRequestAuth, type AuthConfig } from '../../src/api/auth.js';
import { setupHttpMiddleware } from '../../src/transport/middleware.js';

let lines: string[];

// Observability must be live: with it off, logWithContext never touched the span, so the span test
// passed on the old code for the wrong reason.
beforeAll(async () => {
  process.env.OTEL_ENABLED = 'true';
  process.env.OTEL_EXPORTER_TYPE = 'console';
  process.env.OTEL_LOG_LEVEL = 'error';
  await initializeObservability();
});

beforeEach(() => {
  lines = [];
  for (const m of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
    vi.spyOn(logger, m).mockImplementation(((obj: unknown, msg?: string) => {
      lines.push(JSON.stringify([obj, msg]));
    }) as never);
  }
  for (const m of ['error', 'warn', 'info', 'log', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
  }
});

afterEach(() => vi.restoreAllMocks());

const all = () => lines.join('\n');

const authConfig: AuthConfig = {
  apiKeys: ['good-key-0000000000'],
  readonlyKeys: [],
  headerName: 'authorization',
  required: true,
} as unknown as AuthConfig;

describe('logWithContext', () => {
  it('goes through the pino logger', () => {
    logWithContext('info', 'hello', { a: 1 });
    expect(logger.info).toHaveBeenCalledWith({ a: 1 }, 'hello');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('does not copy attributes onto the active span', () => {
    const addEvent = vi.fn();
    vi.spyOn(trace, 'getSpan').mockReturnValue({
      addEvent,
      spanContext: () => ({ traceId: 't', spanId: 's', traceFlags: 1 }),
    } as any);
    logWithContext('info', 'secret handling', { token: 'hunter2hunter2' });
    expect(addEvent).not.toHaveBeenCalled();
  });
});

describe('request logs carry the path only', () => {
  it('MCP HTTP middleware logs no query string, in any field', () => {
    const req = Object.assign(new EventEmitter(), {
      method: 'POST',
      url: '/mcp?api_key=querysecret123&q=private+words',
      socket: { remoteAddress: '127.0.0.1', remotePort: 1 },
      headers: { referer: 'https://example.test/page?token=refsecret456' },
    }) as unknown as IncomingMessage;
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      writeHead: vi.fn(),
      end: vi.fn(),
    }) as unknown as ServerResponse;
    setupHttpMiddleware(req, res, { handleRequest: vi.fn().mockResolvedValue(undefined) });
    res.end();
    (req as any).emit('error', new Error('boom'));
    expect(all()).toContain('/mcp');
    expect(all()).not.toContain('querysecret123');
    expect(all()).not.toContain('private+words');
    expect(all()).not.toContain('refsecret456');
  });

  it('REST request logger logs no query string', async () => {
    const ctx: any = {
      method: 'GET',
      path: '/api/v1/vcons/search',
      querystring: 'q=private+words&api_key=querysecret123',
      ip: '127.0.0.1',
      status: 200,
      get: () => 'agent',
    };
    await requestLogger()(ctx, async () => undefined);
    expect(all()).toContain('/api/v1/vcons/search');
    expect(all()).not.toContain('querysecret123');
    expect(all()).not.toContain('private+words');
  });
});

describe('auth failure logs carry no part of the credential', () => {
  it('MCP token', () => {
    const req = { headers: { authorization: 'Bearer wrongtoken-ABCDEFGH-rest' }, socket: { remoteAddress: '1.2.3.4' } } as any;
    const result = validateHttpRequestAuth(req, authConfig);
    expect(result.ok).toBe(false);
    expect(all()).toContain('Invalid MCP auth token attempted');
    expect(all()).not.toContain('wrongtok');
  });

  it('REST API key', async () => {
    const ctx: any = {
      path: '/api/v1/vcons',
      method: 'GET',
      ip: '1.2.3.4',
      headers: { authorization: 'Bearer wrongapikey-ABCDEFGH-rest' },
      get: (name: string) => ctx.headers[name.toLowerCase()],
      set: vi.fn(),
      state: {},
    };
    await createAuthMiddleware(authConfig)(ctx, async () => undefined);
    expect(ctx.status).toBe(401);
    expect(all()).toContain('Invalid API key attempted');
    expect(all()).not.toContain('wrongapi');
  });
});
