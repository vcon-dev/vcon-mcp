/**
 * HTTP Transport Setup
 * 
 * Configures and starts HTTP/Streamable HTTP transport for MCP server
 * Integrates Koa REST API for vCon ingestion when enabled
 */

import http from 'http';
import Koa from 'koa';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { createRestApi, getRestApiConfig, isRestApiPath, type RestApiContext } from '../api/index.js';
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
  /** REST API context (required to enable REST endpoints) */
  restApiContext?: RestApiContext;
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
 * Start HTTP server with MCP transport and Koa REST API
 */
export async function startHttpServer(
  server: Server,
  transport: StreamableHTTPServerTransport,
  config: HttpTransportConfig = {}
): Promise<http.Server> {
  const port = config.port || parseInt(process.env.MCP_HTTP_PORT || '3000');
  const host = config.host || process.env.MCP_HTTP_HOST || '127.0.0.1';

  await server.connect(transport);

  // Create Koa REST API if context provided
  let koaApp: Koa | null = null;
  let koaCallback: ReturnType<Koa['callback']> | null = null;
  const restConfig = getRestApiConfig();

  if (config.restApiContext && restConfig.enabled) {
    koaApp = createRestApi(config.restApiContext);
    koaCallback = koaApp.callback();
    
    logWithContext('info', 'REST API enabled (Koa)', {
      base_path: restConfig.basePath,
      auth_required: process.env.API_AUTH_REQUIRED !== 'false',
    });
  }

  // Create HTTP server that routes between REST API and MCP
  const httpServer = http.createServer((req, res) => {
    const path = req.url?.split('?')[0] || '';

    // Route to Koa REST API if path matches
    if (koaCallback && isRestApiPath(path, restConfig.basePath)) {
      koaCallback(req, res);
      return;
    }

    // Fall through to MCP transport
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
        rest_api: koaApp ? 'enabled' : 'disabled',
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
