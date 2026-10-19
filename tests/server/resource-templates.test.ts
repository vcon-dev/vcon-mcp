/**
 * resources/list vs resources/templates/list (CON-1241)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerHandlers } from '../../src/server/handlers.js';
import type { ServerContext } from '../../src/server/setup.js';

vi.mock('../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
}));

describe('resource templates', () => {
  let client: Client;
  let server: Server;
  let queries: any;

  beforeEach(async () => {
    server = new Server(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } },
    );
    queries = { getVCon: vi.fn(), searchVCons: vi.fn() };
    const context = {
      server,
      queries,
      pluginManager: {
        getAdditionalTools: vi.fn().mockResolvedValue([]),
        getAdditionalResources: vi.fn().mockResolvedValue([]),
      },
      handlerRegistry: { get: vi.fn() },
    } as unknown as ServerContext;
    registerHandlers(context);

    client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('resources/list returns only concrete URIs', async () => {
    const { resources } = await client.listResources();
    expect(resources.length).toBeGreaterThan(0);
    for (const r of resources) {
      expect(r.uri).not.toMatch(/[{}]/);
    }
    const uris = resources.map(r => r.uri);
    expect(uris).toContain('vcon://v1/vcons/recent');
    expect(uris).toContain('vcon://v1/vcons/ids');
    expect(uris).not.toContain('vcon://v1/vcons/{uuid}');
  });

  it('resources/templates/list returns the parameterised URIs', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    const templates = resourceTemplates.map(t => t.uriTemplate);
    expect(templates).toContain('vcon://v1/vcons/{uuid}');
    expect(templates).toContain('vcon://v1/vcons/{uuid}/attachments/purpose/{purpose}');
    expect(templates).toContain('vcon://v1/vcons/ids/{limit}/after/{cursor}');
    for (const t of resourceTemplates) {
      expect(t.uriTemplate).toMatch(/\{[^}]+\}/);
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.mimeType).toBe('application/json');
    }
  });

  it('still reads a concrete URI that matches a template', async () => {
    const uuid = '123e4567-e89b-42d3-a456-426614174000';
    queries.getVCon.mockResolvedValue({ uuid, vcon: '0.4.0', parties: [] });
    const res = await client.readResource({ uri: `vcon://v1/vcons/${uuid}` });
    expect(JSON.parse(res.contents[0].text as string).uuid).toBe(uuid);
    expect(queries.getVCon).toHaveBeenCalledWith(uuid);
  });
});
