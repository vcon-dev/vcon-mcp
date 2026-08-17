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
import {
  createRestApi,
  getAuthConfig,
  getRestApiConfig,
  isRestApiPath,
  validateHttpRequestAuth,
  type RestApiContext,
} from '../api/index.js';
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
 * Create and configure HTTP transport.
 *
 * One transport instance serves ONE session (stateful) or ONE request
 * (stateless) - the SDK throws if a stateless transport is reused, and
 * stateful sessions would collide between clients. Callers must create one
 * per session/request; see startHttpServer.
 */
export function createHttpTransport(
  config: HttpTransportConfig = {},
  onSessionInitialized?: (sessionId: string) => void
) {
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
      onSessionInitialized?.(sessionId);
    },
    onsessionclosed: (sessionId) => {
      logWithContext('info', `HTTP session closed: ${sessionId}`);
    },
  });
}

/**
 * Start HTTP server with MCP transport and Koa REST API
 *
 * @param createMcpServer - Factory returning a fresh MCP Server with handlers
 *   registered. A Server binds to exactly one transport, so we need one per
 *   session (stateful) / per request (stateless).
 */
export async function startHttpServer(
  createMcpServer: () => Server,
  config: HttpTransportConfig = {}
): Promise<http.Server> {
  // ?? not ||: port 0 is valid (bind any free port).
  const port = config.port ?? parseInt(process.env.MCP_HTTP_PORT || '3000');
  const host = config.host || process.env.MCP_HTTP_HOST || '127.0.0.1';

  // Stateful mode: live sessions keyed by Mcp-Session-Id. Empty in stateless
  // mode, where every request gets a throwaway transport.
  // ponytail: in-memory map, so stateful mode needs sticky routing across
  // replicas. Move to a shared store only if that becomes a real deployment.
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  async function handleMcpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    if (existing) {
      return setupHttpMiddleware(req, res, existing);
    }

    const transport = createHttpTransport(config, (id) => {
      sessions.set(id, transport);
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await createMcpServer().connect(transport);

    if (config.stateless) {
      // Single-use transport: tear it down once the response is done.
      res.on('close', () => void transport.close());
    }

    return setupHttpMiddleware(req, res, transport);
  }

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

  // MCP endpoint auth (same config as REST: API_KEYS, API_KEY_HEADER, API_AUTH_REQUIRED)
  const mcpAuthConfig = getAuthConfig();
  logWithContext('info', 'MCP HTTP endpoint auth', {
    auth_required: mcpAuthConfig.required,
    header: mcpAuthConfig.headerName,
    bearer_supported: true,
  });

  // Create HTTP server that routes between REST API and MCP
  const httpServer = http.createServer((req, res) => {
    const path = req.url?.split('?')[0] || '';

    // Route to Koa REST API if path matches
    if (koaCallback && isRestApiPath(path, restConfig.basePath)) {
      koaCallback(req, res);
      return;
    }

    // MCP path: validate auth (Authorization: Bearer <token> or configured header)
    const authResult = validateHttpRequestAuth(req, mcpAuthConfig);
    if (authResult.ok === false) {
      const { statusCode, body, wwwAuth } = authResult;
      res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        ...(wwwAuth ? { 'WWW-Authenticate': wwwAuth } : {}),
      });
      res.end(JSON.stringify(body));
      return;
    }

    // Fall through to MCP transport
    handleMcpRequest(req, res).catch((error) => {
      logWithContext('error', 'MCP request handling failed', {
        error_message: error instanceof Error ? error.message : String(error),
        error_stack: error instanceof Error ? error.stack : undefined,
      });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          })
        );
      } else {
        res.end();
      }
    });
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
