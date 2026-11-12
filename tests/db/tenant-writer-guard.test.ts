/**
 * Guard: in TENANT_MODE=writer no vCon insert path reaches the store without
 * the writer stamp.
 *
 * 1. Static: enumerate every place in src that can insert a vcons row and
 *    check each one is the stamped path. A new insert path fails this test
 *    until it is routed through createVCon or added here with a reason.
 * 2. Dynamic: post through MCP create_vcon, MCP create_vcon_from_template,
 *    REST POST /vcons and REST POST /vcons/batch, with a real VConService and
 *    real query layer over a store spy, and check every row the store receives
 *    carries the stamp, or _quarantine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { SupabaseVConQueries } from '../../src/db/queries.js';
import { _resetBatchWriterForTests } from '../../src/db/batch-writer.js';
import { VConService } from '../../src/services/vcon-service.js';
import { createRestApi } from '../../src/api/rest-router.js';
import { CreateVConHandler, CreateVConFromTemplateHandler } from '../../src/tools/handlers/vcon-crud.js';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

const files = sourceFiles(SRC).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));
const where = (re: RegExp) => files.filter((f) => re.test(f.text)).map((f) => f.path).sort();

/** The body of `async <name>(` up to the next method at the same indent. */
function methodBody(path: string, name: string): string {
  const text = files.find((f) => f.path === path)!.text;
  const start = text.indexOf(`async ${name}(`);
  expect(start, `${path} ${name}`).toBeGreaterThan(-1);
  const next = text.slice(start + 1).search(/\n {2}(?:async |private |public |protected |\/\*\*)/);
  return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
}

describe('static: every vcons insert path in src is the stamped one', () => {
  it('save_vcon_batch is called from the batch writer, and from the startup probe with empty arrays only', () => {
    expect(where(/rpc\(\s*['"]save_vcon_batch['"]/)).toEqual(['src/db/batch-writer.ts', 'src/server/tenant-writer.ts']);
    const probe = files.find((f) => f.path === 'src/server/tenant-writer.ts')!.text;
    expect(probe).toMatch(/rpc\('save_vcon_batch', \{\s*p_vcons: \[\], p_parties: \[\], p_dialog: \[\], p_analysis: \[\], p_attachments: \[\],\s*\}\)/);
  });

  it('batchSaveVCon has one caller: createVCon, after the writer stamp', () => {
    const callers = files.flatMap((f) =>
      [...f.text.matchAll(/(?<!function )batchSaveVCon\(/g)].map(() => f.path));
    expect(callers).toEqual(['src/db/queries.ts']);
    const body = methodBody('src/db/queries.ts', 'createVCon');
    expect(body).toMatch(/getTenantMode\(\) === 'writer'/);
    expect(body.indexOf('resolveWriterTenant(')).toBeGreaterThan(-1);
    expect(body.indexOf('resolveWriterTenant(')).toBeLessThan(body.indexOf('batchSaveVCon('));
  });

  it('a direct vcons insert or upsert exists only in the per-table fallback, which a writer refuses', () => {
    expect(where(/from\(\s*['"]vcons['"]\s*\)\s*\.\s*(insert|upsert)\(/)).toEqual(['src/db/batch-writer.ts']);
    const writer = files.find((f) => f.path === 'src/db/batch-writer.ts')!.text;
    const fallbackCalls = [...writer.matchAll(/await commitBatchLegacy\(/g)];
    expect(fallbackCalls).toHaveLength(1);
    const before = writer.slice(0, fallbackCalls[0].index);
    expect(before.slice(before.lastIndexOf('isSaveVConBatchMissing('))).toMatch(
      /if \(getTenantMode\(\) === 'writer'\) \{\s*refuseLegacyWrite\(/);
  });

  it('queries.createVCon is called only by VConService.create', () => {
    expect(where(/queries\.createVCon\(/)).toEqual(['src/services/vcon-service.ts']);
    expect(where(/\.createVCon\(/)).toEqual(['src/services/vcon-service.ts']);
  });

  it('no vcons update writes tenant_id', () => {
    const sites = files.flatMap((f) =>
      [...f.text.matchAll(/from\(\s*['"]vcons['"]\s*\)\s*\.\s*update\(([^)]*)\)/g)].map((m) => ({ path: f.path, arg: m[1], at: m.index! })));
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) {
      expect(s.arg, `${s.path}`).not.toMatch(/tenant_id/);
      if (/^\w+$/.test(s.arg.trim())) {
        // A named update object: the enclosing method must not set tenant_id on it.
        const text = files.find((f) => f.path === s.path)!.text;
        const methodStart = text.lastIndexOf('\n  async ', s.at);
        expect(text.slice(methodStart, s.at), `${s.path}`).not.toMatch(/tenant_id/);
      }
    }
  });
});

// ---------------------------------------------------------------------------

const TA = 't-aaaaaaaaaaaaaaaa';
const stamp = { purpose: 'tenant', start: '2026-11-01T00:00:00Z', party: 0, dialog: 0, encoding: 'json', body: { id: TA } };
// Synthetic vCons with no lawful_basis attachment, on purpose.
const body = (attachments: unknown[]) => ({
  vcon: '0.4.0',
  uuid: randomUUID(),
  created_at: '2026-11-01T00:00:00Z',
  subject: 'guard',
  parties: [{ name: 'Caller', mailto: 'caller@example.invalid' }, { name: 'Agent' }],
  dialog: [{ type: 'text', start: '2026-11-01T00:00:00Z', parties: [0, 1], body: 'hello', encoding: 'none' }],
  attachments,
});

describe('dynamic: every create entry point stamps what reaches the store (writer)', () => {
  const ENV_KEYS = ['TENANT_MODE', 'RLS_ENABLED', 'API_AUTH_REQUIRED'];
  let saved: Record<string, string | undefined>;
  let rows: Array<{ vcons: any[]; children: any[] }>;
  let tableWrites: string[];
  let supabase: any;
  let vconService: VConService;
  let context: any;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.TENANT_MODE = 'writer';
    delete process.env.RLS_ENABLED;
    process.env.API_AUTH_REQUIRED = 'false';
    _resetBatchWriterForTests();
    rows = [];
    tableWrites = [];
    supabase = {
      rpc: vi.fn((fn: string, args: any) => {
        if (fn === 'save_vcon_batch') {
          rows.push({ vcons: args.p_vcons, children: [...args.p_parties, ...args.p_dialog, ...args.p_analysis, ...args.p_attachments] });
        }
        return Promise.resolve({ data: null, error: null });
      }),
      from: vi.fn((table: string) => ({
        insert: vi.fn(() => { tableWrites.push(table); return Promise.resolve({ error: null }); }),
        upsert: vi.fn(() => { tableWrites.push(table); return Promise.resolve({ error: null }); }),
        select: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
      })),
    };
    const queries = new SupabaseVConQueries(supabase);
    const pluginManager = { executeHook: vi.fn().mockResolvedValue(undefined), hasHook: vi.fn(() => false) } as any;
    vconService = new VConService({ queries, pluginManager });
    context = { queries, pluginManager, vconService, supabase, dbInspector: {}, dbAnalytics: {}, dbSizeAnalyzer: {} };
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    _resetBatchWriterForTests();
  });

  /** Every vcons row and child row the store received carries `tenant`, and nothing went around the RPC. */
  function expectStored(tenant: string, count: number) {
    expect(tableWrites).toEqual([]);
    const vconRows = rows.flatMap((r) => r.vcons);
    expect(vconRows).toHaveLength(count);
    for (const r of rows) {
      for (const v of r.vcons) expect(v.tenant_id).toBe(tenant);
      for (const c of r.children) expect(c.tenant_id).toBe(tenant);
    }
  }

  const app = () => createRestApi(context);

  it('MCP create_vcon: stamped', async () => {
    const v = body([stamp]);
    await new CreateVConHandler().handle({ uuid: v.uuid, subject: v.subject, parties: v.parties, dialog: v.dialog, attachments: v.attachments }, context);
    expectStored(TA, 1);
  });

  it('MCP create_vcon: unstamped goes to _quarantine', async () => {
    const v = body([]);
    await new CreateVConHandler().handle({ subject: v.subject, parties: v.parties }, context);
    expectStored('_quarantine', 1);
  });

  it('MCP create_vcon_from_template: no stamp is possible, so _quarantine', async () => {
    await new CreateVConFromTemplateHandler().handle({
      template_name: 'phone_call',
      subject: 'guard',
      parties: [{ name: 'Caller' }, { name: 'Agent' }],
    }, context);
    expectStored('_quarantine', 1);
  });

  it('REST POST /vcons: stamped and unstamped', async () => {
    await request(app().callback()).post('/api/v1/vcons').send(body([stamp])).expect(201);
    expectStored(TA, 1);
    rows = [];
    await request(app().callback()).post('/api/v1/vcons').send(body([])).expect(201);
    expectStored('_quarantine', 1);
  });

  it('REST POST /vcons/batch: each vCon stamped on its own', async () => {
    const res = await request(app().callback())
      .post('/api/v1/vcons/batch')
      .send([body([stamp]), body([]), body([stamp, { ...stamp, body: { id: 't-bbbbbbbbbbbbbbbb' } }])])
      .expect(201);
    expect(res.body.created).toBe(3);
    expect(tableWrites).toEqual([]);
    const byTenant = rows.flatMap((r) => r.vcons).map((v) => v.tenant_id).sort();
    expect(byTenant).toEqual(['_quarantine', '_quarantine', TA]);
    for (const r of rows) {
      for (const c of r.children) expect(c.tenant_id).toBe(r.vcons.find((v) => v.id === c.vcon_id).tenant_id);
    }
  });
});
