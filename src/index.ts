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
import { initializeObservability, shutdownObservability } from './observability/config.js';
import { logWithContext } from './observability/instrumentation.js';
import { logger } from './observability/logger.js';
import { registerHandlers } from './server/handlers.js';
import { setupServer, type ServerContext } from './server/setup.js';
import { createHttpTransport, getHttpTransportConfig, startHttpServer } from './transport/http.js';
import { startStdioTransport } from './transport/stdio.js';
import { getVersionInfo, getVersionString } from './version.js';

// Load environment variables
dotenv.config();

// Initialize observability
await initializeObservability();

// Log version information on startup
const versionInfo = getVersionInfo();
logger.info({
  version: versionInfo.version,
  git_commit: versionInfo.gitCommit,
  build_time: versionInfo.buildTime,
  is_dev: versionInfo.isDev,
}, `vCon MCP Server starting - version ${getVersionString()}`);

// Setup server (database, plugins, handlers)
let serverContext: ServerContext;
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

// ============================================================================
// Start Server
// ============================================================================

// Store HTTP server reference for graceful shutdown
let httpServerInstance: http.Server | null = null;

async function main() {
  try {
    const transportType = process.env.MCP_TRANSPORT || 'stdio';

    if (transportType === 'http') {
      // HTTP/Streamable HTTP transport with REST API
      const config = getHttpTransportConfig();
      
      // Add REST API context for vCon ingestion endpoints
      config.restApiContext = {
        queries: serverContext.queries,
        pluginManager: serverContext.pluginManager,
        supabase: serverContext.supabase,
        vconService: serverContext.vconService,
      };
      
      const transport = createHttpTransport(config);
      httpServerInstance = await startHttpServer(serverContext.server, transport, config);
      
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
  await serverContext.pluginManager.shutdown();

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
  await serverContext.pluginManager.shutdown();

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
