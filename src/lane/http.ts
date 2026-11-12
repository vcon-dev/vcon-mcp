/**
 * The HTTP server of a TENANT_MODE=lane process.
 *
 * Stateless Streamable HTTP only. Each POST must carry `Authorization: Bearer <jwt>`; a request without
 * one, or with one that cannot be a tenant token, gets 401 before anything else runs. Each accepted POST
 * gets its own store client, built from its own bearer, and its own MCP server, both dropped when the
 * response closes. GET and DELETE get 405: a stateless lane has no stream or session to offer. Under the
 * REST base path only the health route answers, and it makes no store call. Nothing logs the bearer.
 */

import http from 'http';
import { isRestApiPath } from '../api/rest-router.js';
import { logWithContext } from '../observability/instrumentation.js';
import { createHttpTransport, type HttpTransportConfig } from '../transport/http.js';
import { setupHttpMiddleware } from '../transport/middleware.js';
import { getVersionInfo } from '../version.js';
import { readLaneBearer } from './bearer.js';
import { createLaneContext, type LaneStoreOptions } from './context.js';
import { createLaneMcpServer } from './mcp-server.js';

export interface LaneHttpConfig extends Pick<
  HttpTransportConfig,
  'port' | 'host' | 'jsonOnly' | 'allowedHosts' | 'allowedOrigins' | 'dnsProtection'
> {
  /** REST base path. Only `<base>/health` answers under it. Default REST_API_BASE_PATH, then /api/v1. */
  restBasePath?: string;
}

function sendJson(res: http.ServerResponse, status: number, body: object, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function isHealthPath(path: string, basePath: string): boolean {
  return path === `${basePath}/health` || path === `${basePath}/health/`;
}

export async function startLaneHttpServer(config: LaneHttpConfig, store: LaneStoreOptions): Promise<http.Server> {
  const port = config.port ?? parseInt(process.env.MCP_HTTP_PORT || '3000');
  const host = config.host || process.env.MCP_HTTP_HOST || '127.0.0.1';
  const basePath = config.restBasePath || process.env.REST_API_BASE_PATH || '/api/v1';

  async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const bearer = readLaneBearer(req.headers.authorization);
    if (!bearer.ok) {
      logWithContext('warn', 'Lane request refused', {
        reason: `bearer_${bearer.problem}`,
        method: req.method,
        remote_address: req.socket?.remoteAddress,
      });
      sendJson(res, 401, {
        error: 'Unauthorized',
        message: bearer.problem === 'missing'
          ? 'Missing Authorization: Bearer <token> header'
          : 'Bearer token is not a tenant token',
      }, { 'WWW-Authenticate': 'Bearer realm="vCon MCP lane"' });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed: a stateless lane serves POST only' },
        id: null,
      }, { Allow: 'POST' });
      return;
    }

    // tenant_id here is decoded without verifying the token, for this log line only. PostgREST verifies
    // the token, and the store policies read the verified claim.
    logWithContext('info', 'Lane request', { tenant_id: bearer.tenantIdForLog });

    const server = createLaneMcpServer(createLaneContext(bearer.jwt, store));
    const transport = createHttpTransport({
      stateless: true,
      jsonOnly: config.jsonOnly,
      allowedHosts: config.allowedHosts,
      allowedOrigins: config.allowedOrigins,
      dnsProtection: config.dnsProtection,
    });
    await server.connect(transport);
    // Single use: the transport, its server and with them the store client go when the response does.
    res.on('close', () => void transport.close());
    await setupHttpMiddleware(req, res, transport);
  }

  const httpServer = http.createServer((req, res) => {
    const path = req.url?.split('?')[0] || '';

    if (isRestApiPath(path, basePath)) {
      if ((req.method === 'GET' || req.method === 'HEAD') && isHealthPath(path, basePath)) {
        const version = getVersionInfo();
        sendJson(res, 200, {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          tenant_mode: 'lane',
          database: 'not_checked',
          version: version.version,
          gitCommit: version.gitCommit,
          buildTime: version.buildTime,
        });
        return;
      }
      sendJson(res, 404, { error: 'Not Found', message: 'REST API routes are not served in TENANT_MODE=lane' });
      return;
    }

    handleMcp(req, res).catch((error) => {
      logWithContext('error', 'Lane request handling failed', {
        error_message: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      } else {
        res.end();
      }
    });
  });

  httpServer.on('error', (error) => {
    logWithContext('error', 'HTTP server error', { error_message: error.message });
  });

  return new Promise((resolve, reject) => {
    httpServer.listen(port, host, () => {
      logWithContext('info', 'Tenant lane started', { host, port, transport: 'http', stateless: true });
      resolve(httpServer);
    });
    httpServer.on('error', reject);
  });
}
