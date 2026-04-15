/**
 * Tier A: invalid inputs and edge limits (read-only, no data destruction).
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  checkStressEnvironment,
  createStressClient,
  closeStressClient,
  callTool,
  type StressTestContext,
} from './harness.js';

const runStress = checkStressEnvironment();

describe.skipIf(!runStress)('stress: abuse + error contracts', () => {
  let ctx: StressTestContext;

  beforeAll(async () => {
    const root = join(process.cwd(), 'dist', 'index.js');
    if (!existsSync(root)) {
      throw new Error('dist/index.js missing — run `npm run build` first');
    }
    ctx = await createStressClient();
  }, 120000);

  afterAll(async () => {
    if (ctx) {
      await closeStressClient(ctx);
    }
  }, 60000);

  it('rejects malformed UUID for get_vcon', async () => {
    try {
      await callTool(ctx.client, 'get_vcon', { uuid: 'not-a-uuid' });
      expect.fail('expected McpError');
    } catch (e) {
      expect(e).toBeInstanceOf(McpError);
      expect((e as McpError).code).toBe(ErrorCode.InvalidParams);
    }
  });

  it('fails for non-existent vCon UUID', async () => {
    const fake = randomUUID();
    await expect(callTool(ctx.client, 'get_vcon', { uuid: fake })).rejects.toThrow(McpError);
  });

  it('search_vcons with limit 0 still returns structured success', async () => {
    const parsed = await callTool<{
      success: boolean;
      count: number;
      results: unknown[];
    }>(ctx.client, 'search_vcons', { limit: 0, response_format: 'metadata' });
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.results)).toBe(true);
  });

  it('search_vcons_content rejects empty query', async () => {
    await expect(
      callTool(ctx.client, 'search_vcons_content', {
        query: '',
        response_format: 'metadata',
      })
    ).rejects.toThrow(McpError);
  });

  it('handles very long keyword query without crashing', async () => {
    const longQuery = 'x'.repeat(5000);
    const parsed = await callTool<{
      success: boolean;
      count: number;
      results: unknown[];
    }>(ctx.client, 'search_vcons_content', {
      query: longQuery,
      limit: 1,
      response_format: 'ids_only',
    });
    expect(parsed.success).toBe(true);
    expect(typeof parsed.count).toBe('number');
  });
});
