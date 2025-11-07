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
import { closeAllConnections } from './db/client.js';
import { setupServer, type ServerContext } from './server/setup.js';
import { registerHandlers } from './server/handlers.js';
import { startHttpServer, createHttpTransport, getHttpTransportConfig } from './transport/http.js';
import { startStdioTransport } from './transport/stdio.js';

// Load environment variables
dotenv.config();

// Initialize observability
await initializeObservability();

// Setup server (database, plugins, handlers)
let serverContext: ServerContext;
try {
  serverContext = await setupServer();
} catch (error) {
  console.error('❌ Failed to initialize server:', error);
  process.exit(1);
}

// Register all MCP request handlers
registerHandlers(serverContext.server, {
  queries: serverContext.queries,
  pluginManager: serverContext.pluginManager,
  dbInspector: serverContext.dbInspector,
  dbAnalytics: serverContext.dbAnalytics,
  dbSizeAnalyzer: serverContext.dbSizeAnalyzer,
  supabase: serverContext.supabase,
  handlerRegistry: serverContext.handlerRegistry,
});

// ============================================================================
// Start Server
// ============================================================================

// Store HTTP server reference for graceful shutdown
let httpServerInstance: http.Server | null = null;

async function main() {
  try {
    const transportType = process.env.MCP_TRANSPORT || 'stdio';

    if (transportType === 'http') {
      // HTTP/Streamable HTTP transport
      const config = getHttpTransportConfig();
      const transport = createHttpTransport(config);
      httpServerInstance = await startHttpServer(serverContext.server, transport, config);
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

