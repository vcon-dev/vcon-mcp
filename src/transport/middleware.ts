/**
 * HTTP Transport Middleware
 * 
 * Provides request/response logging, error handling, and metrics recording
 */

import { IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { logWithContext, recordCounter, recordHistogram } from '../observability/instrumentation.js';

/**
 * Setup HTTP request/response middleware
 * Adds logging, error handling, and metrics to HTTP requests
 */
export function setupHttpMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  transport: any
): void {
  const requestId = randomUUID();
  const startTime = Date.now();
  const remoteAddress = req.socket.remoteAddress || 'unknown';
  const remotePort = req.socket.remotePort || 0;

  // Log incoming request
  logWithContext('info', 'HTTP request received', {
    request_id: requestId,
    method: req.method,
    url: req.url,
    path: req.url?.split('?')[0],
    query: req.url?.includes('?') ? req.url.split('?')[1] : undefined,
    remote_address: remoteAddress,
    remote_port: remotePort,
    user_agent: req.headers['user-agent'],
    content_type: req.headers['content-type'],
    content_length: req.headers['content-length'],
    mcp_session_id: req.headers['mcp-session-id'] || req.headers['x-session-id'] || 'none',
    accept: req.headers['accept'],
    referer: req.headers['referer'],
    origin: req.headers['origin'],
    all_headers: Object.keys(req.headers).join(', '),
  });

  // Track response end to log completion
  let responseSent = false;
  const originalEnd = res.end.bind(res);
  let statusCode = 200;
  const originalWriteHead = res.writeHead.bind(res);

  // Handle request errors
  req.on('error', (error) => {
    const duration = Date.now() - startTime;
    logWithContext('error', 'HTTP request error', {
      request_id: requestId,
      method: req.method,
      url: req.url,
      error_message: error.message,
      error_stack: error.stack,
      duration_ms: duration,
      remote_address: remoteAddress,
    });

    recordCounter('http.request.error', 1, {
      method: req.method || 'unknown',
      error_type: error.constructor.name,
    }, 'HTTP request errors');
  });

  // Handle response errors
  res.on('error', (error) => {
    const duration = Date.now() - startTime;
    logWithContext('error', 'HTTP response error', {
      request_id: requestId,
      method: req.method,
      url: req.url,
      status_code: statusCode,
      error_message: error.message,
      error_stack: error.stack,
      duration_ms: duration,
      remote_address: remoteAddress,
    });

    recordCounter('http.response.error', 1, {
      method: req.method || 'unknown',
      status_code: statusCode,
      error_type: error.constructor.name,
    }, 'HTTP response errors');
  });

  // Override writeHead to capture status code
  res.writeHead = function(...args: any[]) {
    if (args.length > 0 && typeof args[0] === 'number') {
      statusCode = args[0];
    }
    return (originalWriteHead as any).apply(this, args);
  };

  // Override end to log response completion
  res.end = function(chunk?: any, encoding?: any, cb?: any) {
    if (!responseSent) {
      responseSent = true;
      const duration = Date.now() - startTime;

      logWithContext('info', 'HTTP response sent', {
        request_id: requestId,
        method: req.method,
        url: req.url,
        status_code: statusCode,
        duration_ms: duration,
        remote_address: remoteAddress,
      });

      recordHistogram('http.request.duration', duration, {
        method: req.method || 'unknown',
        status_code: statusCode,
      }, 'HTTP request duration in milliseconds');

      recordCounter('http.request.count', 1, {
        method: req.method || 'unknown',
        status_code: statusCode,
      }, 'HTTP request count');
    }

    return originalEnd.call(this, chunk, encoding, cb);
  };

  // Delegate to transport
  transport.handleRequest(req, res);
}

