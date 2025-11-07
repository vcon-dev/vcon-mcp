/**
 * HTTP Transport Setup
 * 
 * Configures and starts HTTP/Streamable HTTP transport for MCP server
 */

import http from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { logWithContext } from '../observability/instrumentation.js';
import { setupHttpMiddleware } from './middleware.js';

export interface HttpTransportConfig {
  port?: number;
  host?: string;
  stateless?: boolean;
  jsonOnly?: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  dnsProtection?: boolean;
}

/**
 * Create and configure HTTP transport
 */
export function createHttpTransport(config: HttpTransportConfig = {}) {
  const sessionIdGenerator = config.stateless
    ? undefined
    : () => randomUUID();

  return new StreamableHTTPServerTransport({
    sessionIdGenerator,
    enableJsonResponse: config.jsonOnly || false,
    allowedHosts: config.allowedHosts,
    allowedOrigins: config.allowedOrigins,
    enableDnsRebindingProtection: config.dnsProtection || false,
    onsessioninitialized: (sessionId) => {
      logWithContext('info', `HTTP session initialized: ${sessionId}`);
    },
    onsessionclosed: (sessionId) => {
      logWithContext('info', `HTTP session closed: ${sessionId}`);
    },
  });
}

/**
 * Start HTTP server with MCP transport
 */
export async function startHttpServer(
  server: Server,
  transport: StreamableHTTPServerTransport,
  config: HttpTransportConfig = {}
): Promise<http.Server> {
  const port = config.port || parseInt(process.env.MCP_HTTP_PORT || '3000');
  const host = config.host || process.env.MCP_HTTP_HOST || '127.0.0.1';

  await server.connect(transport);

  // Create HTTP server with middleware
  const httpServer = http.createServer((req, res) => {
    setupHttpMiddleware(req, res, transport);
  });

  // Setup server event handlers
  httpServer.on('error', (error) => {
    logWithContext('error', 'HTTP server error', {
      error_message: error.message,
      error_stack: error.stack,
    });
  });

  // Start listening
  return new Promise((resolve, reject) => {
    httpServer.listen(port, host, () => {
      logWithContext('info', 'HTTP MCP server started', {
        host,
        port,
        transport: 'http',
      });
      resolve(httpServer);
    });

    httpServer.on('error', reject);
  });
}

/**
 * Get HTTP transport configuration from environment
 */
export function getHttpTransportConfig(): HttpTransportConfig {
  return {
    port: parseInt(process.env.MCP_HTTP_PORT || '3000'),
    host: process.env.MCP_HTTP_HOST || '127.0.0.1',
    stateless: process.env.MCP_HTTP_STATELESS === 'true',
    jsonOnly: process.env.MCP_HTTP_JSON_ONLY === 'true',
    allowedHosts: process.env.MCP_HTTP_ALLOWED_HOSTS?.split(','),
    allowedOrigins: process.env.MCP_HTTP_ALLOWED_ORIGINS?.split(','),
    dnsProtection: process.env.MCP_HTTP_DNS_PROTECTION === 'true',
  };
}

