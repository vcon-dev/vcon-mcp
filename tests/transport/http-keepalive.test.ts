/**
 * CON-1487: the server must keep idle keep-alive sockets open well past Node's
 * 5 s default, or the conserver's pooled webhook writes race the close and are
 * dead-lettered with ConnectionResetError.
 */

import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { applyKeepAliveTimeouts, DEFAULT_KEEPALIVE_TIMEOUT_MS } from '../../src/transport/http.js';

describe('applyKeepAliveTimeouts', () => {
  const saved = process.env.MCP_HTTP_KEEPALIVE_TIMEOUT_MS;
  afterEach(() => {
    if (saved === undefined) delete process.env.MCP_HTTP_KEEPALIVE_TIMEOUT_MS;
    else process.env.MCP_HTTP_KEEPALIVE_TIMEOUT_MS = saved;
  });

  it('defaults to 65 s with headersTimeout above it', () => {
    delete process.env.MCP_HTTP_KEEPALIVE_TIMEOUT_MS;
    const server = http.createServer();
    applyKeepAliveTimeouts(server);
    expect(server.keepAliveTimeout).toBe(DEFAULT_KEEPALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });

  it('honours MCP_HTTP_KEEPALIVE_TIMEOUT_MS', () => {
    process.env.MCP_HTTP_KEEPALIVE_TIMEOUT_MS = '120000';
    const server = http.createServer();
    applyKeepAliveTimeouts(server);
    expect(server.keepAliveTimeout).toBe(120_000);
    expect(server.headersTimeout).toBe(121_000);
  });

  it('ignores an invalid value', () => {
    process.env.MCP_HTTP_KEEPALIVE_TIMEOUT_MS = 'soon';
    const server = http.createServer();
    applyKeepAliveTimeouts(server);
    expect(server.keepAliveTimeout).toBe(DEFAULT_KEEPALIVE_TIMEOUT_MS);
  });
});
