/**
 * MCP capability probe: tools, resources, prompts (single client).
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { allPrompts } from '../../src/prompts/index.js';
import { getCoreResources } from '../../src/resources/index.js';
import {
  checkStressEnvironment,
  createStressClient,
  closeStressClient,
  type StressTestContext,
  MINIMUM_CORE_TOOL_NAMES,
} from './harness.js';

const runStress = checkStressEnvironment();

describe.skipIf(!runStress)('stress: MCP capabilities', () => {
  let ctx: StressTestContext;

  beforeAll(async () => {
    const root = join(process.cwd(), 'dist', 'index.js');
    if (!existsSync(root)) {
      throw new Error(
        'dist/index.js missing — run `npm run build` before `npm run test:stress`'
      );
    }
    ctx = await createStressClient();
  }, 120000);

  afterAll(async () => {
    if (ctx) {
      await closeStressClient(ctx);
    }
  }, 60000);

  it('lists tools including minimum core set', async () => {
    const listed = await ctx.client.listTools();
    expect(listed.tools.length).toBeGreaterThan(0);
    const names = new Set(listed.tools.map((t) => t.name));
    for (const required of MINIMUM_CORE_TOOL_NAMES) {
      expect(names.has(required)).toBe(true);
    }
  });

  it('lists core resources', async () => {
    const { resources } = await ctx.client.listResources();
    const expectedUris = new Set(getCoreResources().map((r) => r.uri));
    const gotUris = new Set(resources.map((r) => r.uri));
    for (const uri of expectedUris) {
      expect(gotUris.has(uri)).toBe(true);
    }
  });

  it('reads a collection resource (recent vCons)', async () => {
    const res = await ctx.client.readResource({
      uri: 'vcon://v1/vcons/recent',
    });
    expect(res.contents.length).toBeGreaterThan(0);
    const text = res.contents[0];
    expect(text.mimeType).toBe('application/json');
    expect(text.text).toBeDefined();
    const parsed = JSON.parse(text.text as string);
    expect(parsed).toBeDefined();
  });

  it('lists prompts matching server definitions', async () => {
    const { prompts } = await ctx.client.listPrompts();
    expect(prompts.length).toBe(allPrompts.length);
    const names = new Set(prompts.map((p) => p.name));
    for (const def of allPrompts) {
      expect(names.has(def.name)).toBe(true);
    }
  });

  it('getPrompt returns text for find_by_exact_tags', async () => {
    const prompt = await ctx.client.getPrompt({
      name: 'find_by_exact_tags',
      arguments: { tag_criteria: 'priority:high' },
    });
    expect(prompt.messages.length).toBeGreaterThan(0);
    const first = prompt.messages[0];
    expect(first.role).toBe('user');
    if (first.content.type === 'text') {
      expect(first.content.text.length).toBeGreaterThan(20);
    }
  });
});
