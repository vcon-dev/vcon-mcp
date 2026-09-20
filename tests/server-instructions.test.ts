import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer } from '../src/server/setup.js';

// The SDK keeps instructions private and returns them from `initialize`; the
// handler is registered on construction, so drive it through the request path.
async function initialize(server: any) {
  const handler = server._requestHandlers.get('initialize');
  return handler(
    { method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    {}
  );
}

describe('MCP_SERVER_INSTRUCTIONS', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is returned on initialize when set', async () => {
    vi.stubEnv('MCP_SERVER_INSTRUCTIONS', '  This corpus is 8,503 oral arguments.  ');
    const result = await initialize(createServer());
    expect(result.instructions).toBe('This corpus is 8,503 oral arguments.');
  });

  it('is absent when unset or blank', async () => {
    vi.stubEnv('MCP_SERVER_INSTRUCTIONS', '   ');
    const result = await initialize(createServer());
    expect(result.instructions).toBeUndefined();
  });
});
