/**
 * Stress test MCP client harness (stdio transport, same pattern as e2e).
 *
 * Environment:
 * - STRESS_CONCURRENCY: parallel subprocess clients (default 4)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  checkE2EEnvironment,
  callTool as e2eCallTool,
  closeTestClient,
  createTestClient,
  type TestContext,
} from '../e2e/setup.js';

export { checkE2EEnvironment as checkStressEnvironment };

export type StressTestContext = TestContext;

/** Minimum tools expected when full profile is enabled (read + write + schema). */
export const MINIMUM_CORE_TOOL_NAMES = [
  'create_vcon',
  'get_vcon',
  'search_vcons',
  'search_vcons_content',
  'delete_vcon',
  'add_dialog',
  'add_analysis',
  'manage_tag',
] as const;

export function getStressConcurrency(): number {
  const raw = process.env.STRESS_CONCURRENCY;
  const n = raw ? parseInt(raw, 10) : 4;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 32) : 4;
}

export async function createStressClient(): Promise<StressTestContext> {
  return createTestClient();
}

export async function closeStressClient(ctx: StressTestContext): Promise<void> {
  return closeTestClient(ctx);
}

export async function callTool<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  return e2eCallTool<T>(client, name, args);
}

/**
 * Spawn N independent stdio MCP clients and run `fn` on each in parallel.
 */
export async function runWithConcurrentClients<T>(
  n: number,
  fn: (ctx: StressTestContext, index: number) => Promise<T>
): Promise<T[]> {
  const contexts: StressTestContext[] = [];
  try {
    for (let i = 0; i < n; i++) {
      contexts.push(await createStressClient());
    }
    return await Promise.all(contexts.map((ctx, i) => fn(ctx, i)));
  } finally {
    await Promise.all(
      contexts.map((c) =>
        closeStressClient(c).catch(() => {
          /* ignore */
        })
      )
    );
  }
}

/**
 * Single client with explicit transport (for advanced cases).
 */
export async function createStressClientRaw(): Promise<{
  client: Client;
  transport: StdioClientTransport;
}> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  const client = new Client(
    { name: 'stress-test-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  return { client, transport };
}

export async function closeRawClient(client: Client): Promise<void> {
  await client.close();
}
