/**
 * Tier A: read-heavy stress and oracle accuracy vs VConQueries.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getSupabaseClient } from '../../src/db/client.js';
import {
  checkStressEnvironment,
  createStressClient,
  closeStressClient,
  callTool,
  runWithConcurrentClients,
  getStressConcurrency,
  type StressTestContext,
} from './harness.js';
import {
  createOracleQueries,
  assertSearchVconsMatchesOracle,
  assertSearchVconsContentMatchesOracle,
  assertGetVconCoreMatchesOracle,
  assertVconIdsExist,
} from './oracle.js';

const runStress = checkStressEnvironment();

describe.skipIf(!runStress)('stress: read load + oracle', () => {
  let ctx: StressTestContext;
  let sampleUuids: string[] = [];

  beforeAll(async () => {
    const root = join(process.cwd(), 'dist', 'index.js');
    if (!existsSync(root)) {
      throw new Error('dist/index.js missing — run `npm run build` first');
    }
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('vcons')
      .select('uuid')
      .order('created_at', { ascending: false })
      .limit(8);
    if (error) {
      throw error;
    }
    sampleUuids = (data ?? []).map((r: { uuid: string }) => r.uuid);
    ctx = await createStressClient();
  }, 120000);

  afterAll(async () => {
    if (ctx) {
      await closeStressClient(ctx);
    }
  }, 60000);

  it('bursts listTools without failure', async () => {
    const n = 40;
    for (let i = 0; i < n; i++) {
      const r = await ctx.client.listTools();
      expect(r.tools.length).toBeGreaterThan(0);
    }
  });

  it('get_vcon matches oracle for sampled UUIDs', async () => {
    if (sampleUuids.length === 0) {
      console.warn('No vCons in DB — skipping get_vcon oracle');
      return;
    }
    const queries = createOracleQueries();
    for (const uuid of sampleUuids.slice(0, 3)) {
      const parsed = await callTool<{ success: boolean; vcon: import('../../src/types/vcon.js').VCon }>(
        ctx.client,
        'get_vcon',
        { uuid, response_format: 'full' }
      );
      expect(parsed.success).toBe(true);
      await assertGetVconCoreMatchesOracle(queries, uuid, parsed.vcon);
    }
  });

  it('search_vcons metadata matches oracle', async () => {
    const queries = createOracleQueries();
    const args = {
      limit: 5,
      response_format: 'metadata' as const,
    };
    const parsed = await callTool<{
      success: boolean;
      response_format: string;
      results: unknown;
      count: number;
    }>(ctx.client, 'search_vcons', args);
    await assertSearchVconsMatchesOracle(queries, parsed, args);
  });

  it('search_vcons_content metadata matches oracle', async () => {
    const queries = createOracleQueries();
    const args = {
      query: 'a',
      limit: 10,
      response_format: 'metadata' as const,
    };
    const parsed = await callTool<{
      success: boolean;
      response_format: string;
      results: unknown;
      count: number;
    }>(ctx.client, 'search_vcons_content', args);
    await assertSearchVconsContentMatchesOracle(queries, parsed, args);
  });

  it('parallel get_vcon across concurrent clients', async () => {
    if (sampleUuids.length === 0) {
      return;
    }
    const uuid = sampleUuids[0];
    const n = getStressConcurrency();
    const queries = createOracleQueries();
    await runWithConcurrentClients(n, async (c) => {
      const parsed = await callTool<{ success: boolean; vcon: import('../../src/types/vcon.js').VCon }>(
        c.client,
        'get_vcon',
        { uuid, response_format: 'full' }
      );
      expect(parsed.success).toBe(true);
      await assertGetVconCoreMatchesOracle(queries, uuid, parsed.vcon);
    });
  });

  it('semantic search returns only existing vcon ids when OPENAI_API_KEY is set', async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY unset — skipping semantic smoke');
      return;
    }
    const parsed = await callTool<{
      success: boolean;
      results: Array<{ vcon_id: string }>;
    }>(ctx.client, 'search_vcons_semantic', {
      query: 'conversation',
      limit: 5,
    });
    expect(parsed.success).toBe(true);
    const ids = (parsed.results ?? []).map((r) => r.vcon_id);
    await assertVconIdsExist(getSupabaseClient(), ids);
  });

  it('hybrid search returns only existing vcon ids when OPENAI_API_KEY is set', async () => {
    if (!process.env.OPENAI_API_KEY) {
      return;
    }
    const parsed = await callTool<{
      success: boolean;
      results: Array<{ vcon_id: string }>;
    }>(ctx.client, 'search_vcons_hybrid', {
      query: 'test',
      limit: 5,
    });
    expect(parsed.success).toBe(true);
    const ids = (parsed.results ?? []).map((r) => r.vcon_id);
    await assertVconIdsExist(getSupabaseClient(), ids);
  });
});
