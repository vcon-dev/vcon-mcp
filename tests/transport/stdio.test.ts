/**
 * Tests for STDIO transport
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { startStdioTransport } from '../../src/transport/stdio.js';
import { logWithContext } from '../../src/observability/instrumentation.js';

// Mock observability
vi.mock('../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
}));

// Note: We create fresh EventEmitters in beforeEach for each test

describe('STDIO Transport', () => {
  let server: Server;
  let originalStdin: any;
  let originalStdout: any;
  let originalEnv: string | undefined;

  beforeEach(() => {
    server = new Server(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    );

    // Save original process properties
    originalStdin = process.stdin;
    originalStdout = process.stdout;
    originalEnv = process.env.MCP_DEBUG;

    // Create fresh mock event emitters for each test
    const freshStdin = new EventEmitter();
    const freshStdout = new EventEmitter();

    // Mock process.stdin and process.stdout
    Object.defineProperty(process, 'stdin', {
      value: freshStdin,
      writable: true,
    });
    Object.defineProperty(process, 'stdout', {
      value: freshStdout,
      writable: true,
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original process properties
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      writable: true,
    });
    Object.defineProperty(process, 'stdout', {
      value: originalStdout,
      writable: true,
    });

    if (originalEnv !== undefined) {
      process.env.MCP_DEBUG = originalEnv;
    } else {
      delete process.env.MCP_DEBUG;
    }

    vi.clearAllMocks();
  });

  describe('startStdioTransport', () => {
    it('should start STDIO transport', async () => {
      await expect(startStdioTransport(server)).resolves.not.toThrow();
    });

    it('should log STDIO server start', async () => {
      await startStdioTransport(server);

      expect(logWithContext).toHaveBeenCalledWith(
        'info',
        'STDIO MCP server started',
        expect.objectContaining({
          transport: 'stdio',
        })
      );
    });

    it('should setup stdin error handler', async () => {
      await startStdioTransport(server);

      // Simulate stdin error
      const error = new Error('Stdin error');
      process.stdin.emit('error', error);

      expect(logWithContext).toHaveBeenCalledWith(
        'error',
        'STDIO input error',
        expect.objectContaining({
          error_message: 'Stdin error',
        })
      );
    });

    it('should setup stdout error handler', async () => {
      await startStdioTransport(server);

      // Simulate stdout error
      const error = new Error('Stdout error');
      process.stdout.emit('error', error);

      expect(logWithContext).toHaveBeenCalledWith(
        'error',
        'STDIO output error',
        expect.objectContaining({
          error_message: 'Stdout error',
        })
      );
    });

    it('should enable debug logging when MCP_DEBUG is true', async () => {
      process.env.MCP_DEBUG = 'true';
      vi.clearAllMocks(); // Clear any previous calls

      await startStdioTransport(server);

      // Simulate stdin data
      const chunk = Buffer.from('test data');
      process.stdin.emit('data', chunk);

      expect(logWithContext).toHaveBeenCalledWith(
        'debug',
        'STDIO input received',
        expect.objectContaining({
          size: chunk.length,
          preview: expect.any(String),
        })
      );
    });

    it('should not enable debug logging when MCP_DEBUG is false', async () => {
      process.env.MCP_DEBUG = 'false';
      vi.clearAllMocks(); // Clear any previous calls

      await startStdioTransport(server);

      // Simulate stdin data
      const chunk = Buffer.from('test data');
      process.stdin.emit('data', chunk);

      // Should not log debug messages
      const debugCalls = (logWithContext as any).mock.calls.filter(
        (call: any[]) => call[1] === 'STDIO input received'
      );
      expect(debugCalls.length).toBe(0);
    });

    it('should not enable debug logging when MCP_DEBUG is not set', async () => {
      delete process.env.MCP_DEBUG;
      vi.clearAllMocks(); // Clear any previous calls

      await startStdioTransport(server);

      // Simulate stdin data
      const chunk = Buffer.from('test data');
      process.stdin.emit('data', chunk);

      // Should not log debug messages
      const debugCalls = (logWithContext as any).mock.calls.filter(
        (call: any[]) => call[1] === 'STDIO input received'
      );
      expect(debugCalls.length).toBe(0);
    });
  });
});

