/**
 * Tests for HTTP transport middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { setupHttpMiddleware } from '../../src/transport/middleware.js';
import { EventEmitter } from 'events';
import { logWithContext, recordCounter, recordHistogram } from '../../src/observability/instrumentation.js';

// Mock observability
vi.mock('../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
  recordCounter: vi.fn(),
  recordHistogram: vi.fn(),
}));

describe('HTTP Middleware', () => {
  let mockReq: Partial<IncomingMessage>;
  let mockRes: Partial<ServerResponse>;
  let mockTransport: any;

  beforeEach(() => {
    // Create mock request
    mockReq = {
      method: 'POST',
      url: '/mcp',
      socket: {
        remoteAddress: '127.0.0.1',
        remotePort: 12345,
      } as any,
      headers: {
        'user-agent': 'test-agent',
        'content-type': 'application/json',
        'content-length': '100',
      },
      on: vi.fn(),
    } as any;

    // Create mock response
    mockRes = {
      writeHead: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
      on: vi.fn(),
    } as any;

    // Create mock transport
    mockTransport = {
      handleRequest: vi.fn(),
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('setupHttpMiddleware', () => {
    it('should setup middleware and call transport', () => {
      setupHttpMiddleware(mockReq as IncomingMessage, mockRes as ServerResponse, mockTransport);

      expect(mockTransport.handleRequest).toHaveBeenCalledWith(mockReq, mockRes);
    });

    it('should log incoming request', () => {
      setupHttpMiddleware(mockReq as IncomingMessage, mockRes as ServerResponse, mockTransport);

      expect(logWithContext).toHaveBeenCalledWith(
        'info',
        'HTTP request received',
        expect.objectContaining({
          method: 'POST',
          url: '/mcp',
        })
      );
    });

    it('should handle request errors', () => {
      const error = new Error('Request error');
      
      setupHttpMiddleware(mockReq as IncomingMessage, mockRes as ServerResponse, mockTransport);

      // Simulate request error
      const errorHandler = (mockReq.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1];
      
      if (errorHandler) {
        errorHandler(error);
      }

      expect(logWithContext).toHaveBeenCalledWith(
        'error',
        'HTTP request error',
        expect.objectContaining({
          error_message: 'Request error',
        })
      );
      expect(recordCounter).toHaveBeenCalled();
    });

    it('should handle response errors', () => {
      const error = new Error('Response error');
      
      setupHttpMiddleware(mockReq as IncomingMessage, mockRes as ServerResponse, mockTransport);

      // Simulate response error
      const errorHandler = (mockRes.on as any).mock.calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1];
      
      if (errorHandler) {
        errorHandler(error);
      }

      expect(logWithContext).toHaveBeenCalledWith(
        'error',
        'HTTP response error',
        expect.objectContaining({
          error_message: 'Response error',
        })
      );
      expect(recordCounter).toHaveBeenCalled();
    });

    it('should capture status code from writeHead', () => {
      
      setupHttpMiddleware(mockReq as IncomingMessage, mockRes as ServerResponse, mockTransport);

      // Call writeHead with status code
      (mockRes.writeHead as any)(404);

      // Call end to trigger logging
      (mockRes.end as any)();

      expect(logWithContext).toHaveBeenCalledWith(
        'info',
        'HTTP response sent',
        expect.objectContaining({
          status_code: 404,
        })
      );
      expect(recordHistogram).toHaveBeenCalled();
      expect(recordCounter).toHaveBeenCalled();
    });

    it('should log response completion with duration', () => {
      
      setupHttpMiddleware(mockReq as IncomingMessage, mockRes as ServerResponse, mockTransport);

      // Call end to trigger logging
      (mockRes.end as any)();

      expect(logWithContext).toHaveBeenCalledWith(
        'info',
        'HTTP response sent',
        expect.objectContaining({
          status_code: expect.any(Number),
          duration_ms: expect.any(Number),
        })
      );
      expect(recordHistogram).toHaveBeenCalledWith(
        'http.request.duration',
        expect.any(Number),
        expect.any(Object),
        expect.any(String)
      );
    });

    it('should only log response once', () => {
      
      setupHttpMiddleware(mockReq as IncomingMessage, mockRes as ServerResponse, mockTransport);

      // Call end multiple times
      (mockRes.end as any)();
      (mockRes.end as any)();
      (mockRes.end as any)();

      // Should only log once
      const logCalls = (logWithContext as any).mock.calls.filter(
        (call: any[]) => call[1] === 'HTTP response sent'
      );
      expect(logCalls.length).toBe(1);
    });

    it('should handle missing request properties gracefully', () => {
      const incompleteReq = {
        method: undefined,
        url: undefined,
        socket: {
          remoteAddress: undefined,
          remotePort: undefined,
        },
        headers: {},
        on: vi.fn(),
      } as any;

      expect(() => {
        setupHttpMiddleware(incompleteReq, mockRes as ServerResponse, mockTransport);
      }).not.toThrow();
    });
  });
});

