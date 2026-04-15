/**
 * Tier B (opt-in): concurrent writes + cleanup. Set STRESS_ALLOW_WRITES=true.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  checkStressEnvironment,
  createStressClient,
  closeStressClient,
  callTool,
  runWithConcurrentClients,
  getStressConcurrency,
  type StressTestContext,
} from './harness.js';

const runStress = checkStressEnvironment();
const allowWrites = process.env.STRESS_ALLOW_WRITES === 'true';

describe.skipIf(!runStress || !allowWrites)('stress: writes (STRESS_ALLOW_WRITES)', () => {
  let ctx: StressTestContext;
  const createdUuids: string[] = [];
  const prefix = `[STRESS-${randomUUID().slice(0, 8)}]`;

  beforeAll(async () => {
    const root = join(process.cwd(), 'dist', 'index.js');
    if (!existsSync(root)) {
      throw new Error('dist/index.js missing — run `npm run build` first');
    }
    ctx = await createStressClient();
  }, 120000);

  afterAll(async () => {
    for (const uuid of createdUuids) {
      try {
        await callTool(ctx.client, 'delete_vcon', { uuid });
      } catch {
        /* ignore */
      }
    }
    if (ctx) {
      await closeStressClient(ctx);
    }
  }, 120000);

  it('creates a vCon and deletes it', async () => {
    const subject = `${prefix} single create/delete`;
    const created = await callTool<{ success: boolean; uuid: string }>(ctx.client, 'create_vcon', {
      subject,
      parties: [{ name: 'Stress Bot' }],
    });
    expect(created.success).toBe(true);
    createdUuids.push(created.uuid);

    const got = await callTool<{ success: boolean; vcon: { subject?: string } }>(
      ctx.client,
      'get_vcon',
      { uuid: created.uuid }
    );
    expect(got.success).toBe(true);
    expect(got.vcon.subject).toBe(subject);

    const del = await callTool<{ success: boolean }>(ctx.client, 'delete_vcon', {
      uuid: created.uuid,
    });
    expect(del.success).toBe(true);
    createdUuids.splice(createdUuids.indexOf(created.uuid), 1);
  });

  it('concurrent add_dialog on same vCon', async () => {
    const subject = `${prefix} concurrent dialog`;
    const created = await callTool<{ success: boolean; uuid: string }>(ctx.client, 'create_vcon', {
      subject,
      parties: [{ name: 'Party A' }, { name: 'Party B' }],
    });
    expect(created.success).toBe(true);
    createdUuids.push(created.uuid);

    const n = Math.min(getStressConcurrency(), 8);
    await runWithConcurrentClients(n, async (c) => {
      const r = await callTool<{ success: boolean }>(c.client, 'add_dialog', {
        vcon_uuid: created.uuid,
        dialog: {
          type: 'text',
          body: `msg-${randomUUID().slice(0, 8)}`,
          encoding: 'none',
          parties: [0],
        },
      });
      expect(r.success).toBe(true);
    });

    const final = await callTool<{ success: boolean; vcon: { dialog?: unknown[] } }>(
      ctx.client,
      'get_vcon',
      { uuid: created.uuid }
    );
    expect(final.success).toBe(true);
    expect((final.vcon.dialog ?? []).length).toBeGreaterThanOrEqual(n);
  });
});
