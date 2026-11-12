#!/usr/bin/env node

/**
 * vCon MCP Server
 *
 * Model Context Protocol server for IETF vCon operations
 * ✅ Fully compliant with draft-ietf-vcon-vcon-core-00
 * ✅ All 7 critical corrections implemented
 */

import dotenv from 'dotenv';
import http from 'http';
import { getTenantMode, type TenantMode } from './config/tenant-mode.js';
import { initializeObservability, shutdownObservability } from './observability/config.js';
import { logWithContext } from './observability/instrumentation.js';
import { logger } from './observability/logger.js';
import { registerHandlers } from './server/handlers.js';
import { createServer, setupServer, type ServerContext } from './server/setup.js';
import { getHttpTransportConfig, startHttpServer } from './transport/http.js';
import { startStdioTransport } from './transport/stdio.js';
import { getVersionInfo, getVersionString } from './version.js';

// Load environment variables. ENV_FILE lets each instance load its own
// per-group file (e.g. .env.sales) so multiple instances can point at
// different Supabase projects/schemas. Defaults to .env.
dotenv.config({ path: process.env.ENV_FILE || '.env' });

// Initialize observability
await initializeObservability();

// Log version information on startup
const versionInfo = getVersionInfo();
logger.info({
  version: versionInfo.version,
  git_commit: versionInfo.gitCommit,
  build_time: versionInfo.buildTime,
  is_dev: versionInfo.isDev,
  instance: process.env.VCON_INSTANCE_LABEL || undefined,
  schema: process.env.SUPABASE_DB_SCHEMA || 'public',
}, `vCon MCP Server starting - version ${getVersionString()}`);

// TENANT_MODE: off (default) is the server as it has always been. lane holds no store key and builds
// its store client per request (src/lane), so it skips the shared setup below: no shared client, no
// plugins, no Redis, no tenant session variable.
let tenantMode: TenantMode;
try {
  tenantMode = getTenantMode();
  if (tenantMode === 'lane') (await import('./lane/index.js')).assertLaneCanStart();
} catch (error) {
  logger.fatal({
    error_message: error instanceof Error ? error.message : String(error)
  }, 'Refusing to start');
  process.exit(1);
}

// Setup server (database, plugins, handlers)
let serverContext: ServerContext | undefined;
if (tenantMode !== 'lane') {
  try {
    serverContext = await setupServer();
  } catch (error) {
    logger.fatal({
      err: error,
      error_message: error instanceof Error ? error.message : String(error)
    }, 'Failed to initialize server');
    process.exit(1);
  }

  // Register all MCP request handlers
  registerHandlers(serverContext);
}

// ============================================================================
// Start Server
// ============================================================================

// Store HTTP server reference for graceful shutdown
let httpServerInstance: http.Server | null = null;

async function main() {
  try {
    // TENANT_MODE=lane has no shared context: it builds one per request.
    if (!serverContext) {
      const { startTenantLane } = await import('./lane/index.js');
      httpServerInstance = await startTenantLane();
      return;
    }

    const transportType = process.env.MCP_TRANSPORT || 'stdio';

    if (transportType === 'http') {
      // HTTP/Streamable HTTP transport with REST API
      const config = getHttpTransportConfig();
      
      // Add REST API context for all REST endpoints
      config.restApiContext = {
        queries: serverContext.queries,
        pluginManager: serverContext.pluginManager,
        supabase: serverContext.supabase,
        vconService: serverContext.vconService,
        dbInspector: serverContext.dbInspector,
        dbAnalytics: serverContext.dbAnalytics,
        dbSizeAnalyzer: serverContext.dbSizeAnalyzer,
      };
      
      // A Server binds to one transport, so HTTP needs a fresh one per
      // session (stateful) / per request (stateless).
      const context = serverContext;
      httpServerInstance = await startHttpServer(({ readonly }) => {
        const server = createServer();
        registerHandlers({ ...context, server }, { readonly });
        return server;
      }, config);
      
      // Log REST API availability
      const restBasePath = process.env.REST_API_BASE_PATH || '/api/v1';
      const httpHost = process.env.MCP_HTTP_HOST || '127.0.0.1';
      const httpPort = process.env.MCP_HTTP_PORT || '3000';
      logWithContext('info', 'REST API endpoints available', {
        create_vcon: `POST http://${httpHost}:${httpPort}${restBasePath}/vcons`,
        batch_create: `POST http://${httpHost}:${httpPort}${restBasePath}/vcons/batch`,
        get_vcon: `GET http://${httpHost}:${httpPort}${restBasePath}/vcons/{uuid}`,
        list_vcons: `GET http://${httpHost}:${httpPort}${restBasePath}/vcons`,
        health: `GET http://${httpHost}:${httpPort}${restBasePath}/health`,
      });
    } else {
      // STDIO transport
      await startStdioTransport(serverContext.server);
    }
  } catch (error) {
    logWithContext('error', 'Failed to start MCP server', {
      error_message: error instanceof Error ? error.message : String(error),
      error_stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logWithContext('info', 'Received SIGINT, shutting down gracefully...');

  if (httpServerInstance) {
    httpServerInstance.close(() => {
      logWithContext('info', 'HTTP server closed');
    });
  }

  await shutdownObservability();
  await serverContext?.pluginManager.shutdown();

  process.exit(0);
});

process.on('SIGTERM', async () => {
  logWithContext('info', 'Received SIGTERM, shutting down gracefully...');

  if (httpServerInstance) {
    httpServerInstance.close(() => {
      logWithContext('info', 'HTTP server closed');
    });
  }

  await shutdownObservability();
  await serverContext?.pluginManager.shutdown();

  process.exit(0);
});

// Start the server
main().catch((error) => {
  logWithContext('error', 'Fatal error in main', {
    error_message: error instanceof Error ? error.message : String(error),
    error_stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
