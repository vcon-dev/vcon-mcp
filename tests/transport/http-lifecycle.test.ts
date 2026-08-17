/**
 * Regression tests for MCP-over-HTTP transport lifecycle.
 *
 * Guards the bug where startHttpServer reused ONE StreamableHTTPServerTransport
 * for every request: the first `initialize` worked, every later request got an
 * empty-body HTTP 500 (the SDK throws "Stateless transport cannot be reused
 * across requests"). Stateful mode had the same shape of bug - a second client
 * hit "Server already initialized".
 */

import http from 'http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { startHttpServer, type HttpTransportConfig } from '../../src/transport/http.js';

/** Minimal MCP server - no DB, just enough to answer tools/list. */
function createTestMcpServer(): Server {
  const server = new Server(
    { name: 'test-server', version: '0.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object' } }],
  }));
  return server;
}

async function start(config: HttpTransportConfig): Promise<{ server: http.Server; url: URL }> {
  const server = await startHttpServer(createTestMcpServer, { host: '127.0.0.1', port: 0, ...config });
  const { port } = server.address() as { port: number };
  return { server, url: new URL(`http://127.0.0.1:${port}/`) };
}

async function connectClient(url: URL): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

// Auth and REST are configured from env; keep both out of the way.
beforeAll(() => {
  process.env.API_AUTH_REQUIRED = 'false';
  process.env.REST_API_ENABLED = 'false';
});

for (const stateless of [true, false]) {
  for (const jsonOnly of [true, false]) {
    describe(`HTTP transport lifecycle (stateless=${stateless}, jsonOnly=${jsonOnly})`, () => {
      let httpServer: http.Server;
      let url: URL;

      beforeAll(async () => {
        ({ server: httpServer, url } = await start({ port: 0, stateless, jsonOnly }));
      });

      afterAll(() => httpServer.close());

      it('accepts two full handshakes in sequence', async () => {
        const first = await connectClient(url);
        expect(first.getServerVersion()?.name).toBe('test-server');
        await first.close();

        // This is the regression: the second initialize used to 500.
        const second = await connectClient(url);
        expect(second.getServerVersion()?.name).toBe('test-server');
        await second.close();
      });

      it('serves tools/list as a separate request after initialize', async () => {
        const client = await connectClient(url);
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual(['ping']);
        await client.close();
      });

      it('serves two concurrent clients', async () => {
        const [a, b] = await Promise.all([connectClient(url), connectClient(url)]);
        const [ta, tb] = await Promise.all([a.listTools(), b.listTools()]);
        expect(ta.tools).toHaveLength(1);
        expect(tb.tools).toHaveLength(1);
        await Promise.all([a.close(), b.close()]);
      });
    });
  }
}
