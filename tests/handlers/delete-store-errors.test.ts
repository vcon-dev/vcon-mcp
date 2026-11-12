/**
 * delete_vcon in TENANT_MODE=off: a store error is an error, never "not found".
 *
 * Runs the real Supabase query layer, VConService and the delete_vcon handler against a stand-in
 * PostgREST (tests/lane/helpers.ts), so the PGRST116 not-found path and a store error take the code
 * path they take in production.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { SupabaseVConQueries } from '../../src/db/queries.js';
import { PluginManager } from '../../src/hooks/plugin-manager.js';
import { VConService } from '../../src/services/vcon-service.js';
import { DeleteVConHandler } from '../../src/tools/handlers/vcon-crud.js';
import { fakeStore, storeAnswer, TENANT_A, tenantJwt, UUID_A, UUID_B, type FakeStore } from '../lane/helpers.js';

let store: FakeStore;
let handlerContext: any;

beforeEach(() => {
  store = fakeStore();
  // The stand-in scopes rows by the bearer's tenant claim; any bearer stands in for the service key here.
  const supabase = createClient('http://store.invalid', tenantJwt(TENANT_A), {
    global: { fetch: store.fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient;
  const queries = new SupabaseVConQueries(supabase, null);
  const pluginManager = new PluginManager();
  handlerContext = { queries, pluginManager, vconService: new VConService({ queries, pluginManager }), supabase };
});

const del = (uuid: string) => new DeleteVConHandler().handle({ uuid }, handlerContext);

describe('delete_vcon (TENANT_MODE=off)', () => {
  it('deletes a vCon that exists', async () => {
    const r = await del(UUID_A);
    expect(r.content[0].text).toContain(`Deleted vCon ${UUID_A}`);
    expect(store.rows.some((x) => x.uuid === UUID_A)).toBe(false);
  });

  it('reports a uuid with no row (PGRST116) as not found', async () => {
    const error = await del(UUID_B).catch((e) => e);
    expect(error).toBeInstanceOf(McpError);
    expect(error.code).toBe(ErrorCode.InvalidRequest);
    expect(error.message).toMatch(/not found/);
    expect(store.requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  for (const [label, response] of [
    ['a 500', () => storeAnswer(500, { code: 'XX000', message: 'store unavailable' })],
    ['a refused key (401)', () => storeAnswer(401, { code: 'PGRST301', message: 'JWT expired' })],
  ] as const) {
    it(`surfaces ${label} on the existence read as an error, not not found, and deletes nothing`, async () => {
      store.override = (r) => (r.method === 'GET' && r.path === '/rest/v1/vcons' ? response() : undefined);
      const error = await del(UUID_A).catch((e) => e);
      expect(error).toBeInstanceOf(McpError);
      expect(error.code).toBe(ErrorCode.InternalError);
      expect(error.message).not.toMatch(/not found/i);
      expect(store.requests.some((r) => r.method === 'DELETE')).toBe(false);
      expect(store.rows.some((x) => x.uuid === UUID_A)).toBe(true);
    });
  }

  it('surfaces a store error on the delete itself as an error, not not found, and deletes nothing', async () => {
    store.override = (r) => (r.method === 'DELETE' ? storeAnswer(500, { code: 'XX000', message: 'store unavailable' }) : undefined);
    const error = await del(UUID_A).catch((e) => e);
    expect(error).toBeInstanceOf(McpError);
    expect(error.message).toMatch(/store unavailable/);
    expect(error.message).not.toMatch(/not found/i);
    expect(store.rows.some((x) => x.uuid === UUID_A)).toBe(true);
  });
});
