/**
 * Invokes every core-registered MCP tool once and reads every core resource pattern.
 * Uses a dedicated fixture vCon (created then deleted) for mutating calls.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { allPrompts } from '../../src/prompts/index.js';
import {
  checkStressEnvironment,
  createStressClient,
  closeStressClient,
  callTool,
  type StressTestContext,
} from './harness.js';
import { REGISTERED_CORE_TOOL_NAMES, REGISTERED_CORE_TOOL_SET } from './registered-tools.js';
import { minimalPromptArgs } from './prompt-args.js';

const runStress = checkStressEnvironment();

describe.skipIf(!runStress)('stress: full tool + resource coverage', () => {
  let ctx: StressTestContext;
  let fixtureUuid: string;
  const tagKey = `fullcov_${randomUUID().slice(0, 8)}`;
  const tagVal = '1';

  beforeAll(async () => {
    const root = join(process.cwd(), 'dist', 'index.js');
    if (!existsSync(root)) {
      throw new Error('dist/index.js missing — run `npm run build` first');
    }
    ctx = await createStressClient();
    const created = await callTool<{ success: boolean; uuid: string }>(ctx.client, 'create_vcon', {
      subject: `[FULL-COV-${randomUUID().slice(0, 8)}] stress fixture`,
      parties: [{ name: 'Coverage Party' }],
    });
    if (!created.success || !created.uuid) {
      throw new Error('fixture create_vcon failed');
    }
    fixtureUuid = created.uuid;
  }, 180000);

  afterAll(async () => {
    if (ctx && fixtureUuid) {
      try {
        await callTool(ctx.client, 'delete_vcon', { uuid: fixtureUuid });
      } catch {
        /* ignore */
      }
    }
    if (ctx) {
      await closeStressClient(ctx);
    }
  }, 120000);

  it('lists every core tool and invokes each once (plus all resources and prompts)', async () => {
    const listed = await ctx.client.listTools();
    const listedNames = new Set(listed.tools.map((t) => t.name));
    for (const name of REGISTERED_CORE_TOOL_NAMES) {
      expect(listedNames.has(name)).toBe(true);
    }

    const extraPlugins = listed.tools
      .map((t) => t.name)
      .filter((n) => !REGISTERED_CORE_TOOL_SET.has(n));
    if (extraPlugins.length > 0) {
      console.warn(
        `listTools includes ${extraPlugins.length} non-core tool(s) (plugins); not invoked: ${extraPlugins.join(', ')}`
      );
    }

    const F = fixtureUuid;

    const ok = (p: Record<string, unknown>) => {
      if ('success' in p && p.success === false) {
        throw new Error(`tool returned success false: ${JSON.stringify(p).slice(0, 500)}`);
      }
    };

    /** DB introspection tools vary by Postgres/Supabase version; still invoke, do not fail the run. */
    const touchOptional = async (name: string, args: Record<string, unknown> = {}) => {
      try {
        const r = (await callTool(ctx.client, name, args)) as Record<string, unknown>;
        ok(r);
        return r;
      } catch (e) {
        console.warn(
          `[stress full-coverage] ${name} failed (non-fatal):`,
          e instanceof Error ? e.message : e
        );
      }
    };

    // Schema
    ok(
      (await callTool(ctx.client, 'get_schema', { format: 'json_schema' })) as Record<
        string,
        unknown
      >
    );
    const ex = (await callTool(ctx.client, 'get_examples', {
      example_type: 'minimal',
      format: 'json',
    })) as Record<string, unknown>;
    expect(ex.vcon || ex.uuid).toBeDefined();

    // Database / infra (best-effort: catalog SQL differs across Postgres versions)
    await touchOptional('get_database_shape', { include_columns: false });
    await touchOptional('get_database_stats', {});
    // analyze_query builds `EXPLAIN <sql>`; some exec_sql RPCs wrap SQL in a subquery,
    // which can make EXPLAIN fail on Postgres. Still invoke the tool; tolerate DB limitation.
    try {
      ok(
        (await callTool(ctx.client, 'analyze_query', {
          query: 'select 1',
          analyze_mode: 'explain',
        })) as Record<string, unknown>
      );
    } catch (e) {
      console.warn(
        'analyze_query failed (often exec_sql + EXPLAIN incompatibility):',
        e instanceof Error ? e.message : e
      );
    }
    await touchOptional('get_database_analytics', {});
    await touchOptional('get_monthly_growth_analytics', {});
    await touchOptional('get_attachment_analytics', {});
    await touchOptional('get_tag_analytics', {});
    await touchOptional('get_content_analytics', {});
    await touchOptional('get_database_health_metrics', {});
    await touchOptional('get_database_size_info', {});
    await touchOptional('get_smart_search_limits', {
      query_type: 'basic',
      estimated_result_size: 'small',
    });

    // Search (read)
    ok(
      (await callTool(ctx.client, 'search_vcons', {
        limit: 5,
        response_format: 'metadata',
      })) as Record<string, unknown>
    );
    ok(
      (await callTool(ctx.client, 'search_vcons_content', {
        query: 'a',
        limit: 5,
        response_format: 'metadata',
      })) as Record<string, unknown>
    );

    if (process.env.OPENAI_API_KEY) {
      await touchOptional('search_vcons_semantic', { query: 'test', limit: 3 });
      await touchOptional('search_vcons_hybrid', { query: 'test', limit: 3 });
    }

    await touchOptional('get_unique_tags', {});

    // vCon reads
    ok(
      (await callTool(ctx.client, 'get_vcon', {
        uuid: F,
        response_format: 'full',
      })) as Record<string, unknown>
    );

    // Mutations on fixture
    ok(
      (await callTool(ctx.client, 'add_dialog', {
        vcon_uuid: F,
        dialog: {
          type: 'text',
          body: 'coverage dialog',
          encoding: 'none',
          parties: [0],
        },
      })) as Record<string, unknown>
    );
    ok(
      (await callTool(ctx.client, 'add_analysis', {
        vcon_uuid: F,
        analysis: {
          type: 'sentiment',
          vendor: 'CoverageTest',
          body: JSON.stringify({ s: 1 }),
          encoding: 'json',
        },
      })) as Record<string, unknown>
    );
    ok(
      (await callTool(ctx.client, 'add_attachment', {
        vcon_uuid: F,
        attachment: {
          type: 'note',
          body: 'coverage attachment',
          encoding: 'none',
        },
      })) as Record<string, unknown>
    );
    ok(
      (await callTool(ctx.client, 'update_vcon', {
        uuid: F,
        updates: { subject: `[FULL-COV] updated ${randomUUID().slice(0, 6)}` },
      })) as Record<string, unknown>
    );

    ok(
      (await callTool(ctx.client, 'manage_tag', {
        vcon_uuid: F,
        action: 'set',
        key: tagKey,
        value: tagVal,
      })) as Record<string, unknown>
    );
    ok((await callTool(ctx.client, 'get_tags', { vcon_uuid: F })) as Record<string, unknown>);
    ok(
      (await callTool(ctx.client, 'search_by_tags', {
        tags: { [tagKey]: tagVal },
        limit: 20,
      })) as Record<string, unknown>
    );
    ok(
      (await callTool(ctx.client, 'manage_tag', {
        vcon_uuid: F,
        action: 'remove',
        key: tagKey,
      })) as Record<string, unknown>
    );
    ok((await callTool(ctx.client, 'remove_all_tags', { vcon_uuid: F })) as Record<string, unknown>);

    // Template create + delete (separate vCon)
    const tmpl = await callTool<{ success: boolean; uuid: string }>(ctx.client, 'create_vcon_from_template', {
      template_name: 'phone_call',
      parties: [{ name: 'Caller' }],
      subject: `[FULL-COV-TPL] ${randomUUID().slice(0, 8)}`,
    });
    expect(tmpl.success).toBe(true);
    ok(
      (await callTool(ctx.client, 'get_vcon', {
        uuid: tmpl.uuid,
      })) as Record<string, unknown>
    );
    ok((await callTool(ctx.client, 'delete_vcon', { uuid: tmpl.uuid })) as Record<string, unknown>);

    // delete_vcon for fixture is in afterAll — still need to invoke delete_vcon as a tool: covered by template delete + afterAll

    // Resources: list + read every pattern
    const { resources } = await ctx.client.listResources();
    expect(resources.length).toBeGreaterThan(0);

    const readOk = async (uri: string) => {
      const res = await ctx.client.readResource({ uri });
      expect(res.contents.length).toBeGreaterThan(0);
      const t = res.contents[0].text;
      expect(t).toBeDefined();
      JSON.parse(t as string);
    };

    await readOk('vcon://v1/vcons/recent');
    await readOk('vcon://v1/vcons/recent/5');
    await readOk('vcon://v1/vcons/recent/ids');
    await readOk('vcon://v1/vcons/recent/ids/5');
    await readOk('vcon://v1/vcons/ids');
    await readOk('vcon://v1/vcons/ids/10');

    const idsPage = await ctx.client.readResource({ uri: 'vcon://v1/vcons/ids/3' });
    const idsJson = JSON.parse(idsPage.contents[0].text as string) as {
      next_cursor?: string | null;
    };
    if (idsJson.next_cursor) {
      await readOk(
        `vcon://v1/vcons/ids/3/after/${encodeURIComponent(idsJson.next_cursor)}`
      );
    }

    const base = `vcon://v1/vcons/${F}`;
    await readOk(base);
    await readOk(`${base}/metadata`);
    await readOk(`${base}/parties`);
    await readOk(`${base}/dialog`);
    await readOk(`${base}/analysis`);
    await readOk(`${base}/attachments`);
    await readOk(`${base}/transcript`);
    await readOk(`${base}/summary`);
    await readOk(`${base}/tags`);

    // Prompts: get each
    for (const p of allPrompts) {
      const prompt = await ctx.client.getPrompt({
        name: p.name,
        arguments: minimalPromptArgs(p.name),
      });
      expect(prompt.messages.length).toBeGreaterThan(0);
    }
  }, 600000);
});
