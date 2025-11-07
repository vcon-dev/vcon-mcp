/**
 * STDIO Transport Setup
 * 
 * Configures stdio transport for MCP server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logWithContext } from '../observability/instrumentation.js';

/**
 * Start STDIO transport
 */
export async function startStdioTransport(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logWithContext('info', 'STDIO MCP server started', {
    transport: 'stdio',
  });

  // Log stdin/stdout activity for debugging
  if (process.env.MCP_DEBUG === 'true') {
    process.stdin.on('data', (chunk) => {
      const preview = chunk.toString('utf-8').substring(0, 200);
      logWithContext('debug', 'STDIO input received', {
        size: chunk.length,
        preview: preview,
      });
    });
  }

  process.stdin.on('error', (error) => {
    logWithContext('error', 'STDIO input error', {
      error_message: error.message,
      error_stack: error.stack,
    });
  });

  process.stdout.on('error', (error) => {
    logWithContext('error', 'STDIO output error', {
      error_message: error.message,
      error_stack: error.stack,
    });
  });
}

