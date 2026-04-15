/**
 * Cross-check MCP tool JSON against VConQueries (same DB layer as the server).
 */

import { expect } from 'vitest';
import { getSupabaseClient } from '../../src/db/client.js';
import { VConQueries } from '../../src/db/queries.js';
import type { VCon } from '../../src/types/vcon.js';

export function createOracleQueries(): VConQueries {
  return new VConQueries(getSupabaseClient());
}

/** Map MCP search_vcons arguments to VConQueries.searchVCons filters. */
export function mcpSearchArgsToFilters(args: Record<string, unknown>): Parameters<
  VConQueries['searchVCons']
>[0] {
  return {
    subject: args.subject as string | undefined,
    partyName: args.party_name as string | undefined,
    partyEmail: args.party_email as string | undefined,
    partyTel: args.party_tel as string | undefined,
    startDate: args.start_date as string | undefined,
    endDate: args.end_date as string | undefined,
    tags: args.tags as Record<string, string> | undefined,
    limit: (args.limit as number | undefined) ?? 10,
  };
}

export function extractUuidsFromSearchVconsMcp(parsed: {
  response_format?: string;
  results: unknown;
}): Set<string> {
  const rf = parsed.response_format || 'metadata';
  const results = parsed.results;
  if (!Array.isArray(results)) {
    return new Set();
  }
  if (rf === 'ids_only') {
    return new Set(results.filter((x): x is string => typeof x === 'string'));
  }
  const out = new Set<string>();
  for (const r of results as Array<{ uuid?: string }>) {
    if (r && typeof r.uuid === 'string') {
      out.add(r.uuid);
    }
  }
  return out;
}

export async function assertSearchVconsMatchesOracle(
  queries: VConQueries,
  mcpParsed: {
    success?: boolean;
    response_format?: string;
    results: unknown;
    count?: number;
  },
  args: Record<string, unknown>
): Promise<void> {
  expect(mcpParsed.success).toBe(true);
  const filters = mcpSearchArgsToFilters(args);
  const oracleRows = await queries.searchVCons(filters);
  const oracleSet = new Set(oracleRows.map((v) => v.uuid));
  const mcpSet = extractUuidsFromSearchVconsMcp(mcpParsed);
  expect(mcpSet.size).toBe(oracleSet.size);
  expect(mcpSet).toEqual(oracleSet);
  if (typeof mcpParsed.count === 'number') {
    expect(mcpParsed.count).toBe(oracleRows.length);
  }
}

/** Map MCP search_vcons_content args to keywordSearch params. */
export function mcpContentArgsToKeywordParams(args: Record<string, unknown>): Parameters<
  VConQueries['keywordSearch']
>[0] {
  return {
    query: args.query as string,
    startDate: args.start_date as string | undefined,
    endDate: args.end_date as string | undefined,
    tags: args.tags as Record<string, string> | undefined,
    limit: (args.limit as number | undefined) ?? 50,
  };
}

export function extractVconIdsFromContentMcp(parsed: {
  response_format?: string;
  results: unknown;
}): Set<string> {
  const rf = parsed.response_format || 'snippets';
  const results = parsed.results;
  if (!Array.isArray(results)) {
    return new Set();
  }
  if (rf === 'ids_only') {
    return new Set(results.filter((x): x is string => typeof x === 'string'));
  }
  const out = new Set<string>();
  for (const r of results as Array<{ vcon_id?: string }>) {
    if (r && typeof r.vcon_id === 'string') {
      out.add(r.vcon_id);
    }
  }
  return out;
}

export async function assertSearchVconsContentMatchesOracle(
  queries: VConQueries,
  mcpParsed: {
    success?: boolean;
    response_format?: string;
    results: unknown;
    count?: number;
  },
  args: Record<string, unknown>
): Promise<void> {
  expect(mcpParsed.success).toBe(true);
  const params = mcpContentArgsToKeywordParams(args);
  const oracleRows = await queries.keywordSearch(params);
  const oracleSet = new Set(oracleRows.map((r) => r.vcon_id));
  const mcpSet = extractVconIdsFromContentMcp(mcpParsed);
  expect(mcpSet.size).toBe(oracleSet.size);
  expect(mcpSet).toEqual(oracleSet);
}

/**
 * Verify every vcon_id in a semantic/hybrid MCP response exists in the database.
 */
export async function assertVconIdsExist(
  supabase: ReturnType<typeof getSupabaseClient>,
  vconIds: string[]
): Promise<void> {
  if (vconIds.length === 0) {
    return;
  }
  const unique = [...new Set(vconIds)];
  const { data, error } = await supabase
    .from('vcons')
    .select('uuid')
    .in('uuid', unique);
  if (error) {
    throw error;
  }
  const found = new Set((data ?? []).map((r: { uuid: string }) => r.uuid));
  for (const id of unique) {
    expect(found.has(id)).toBe(true);
  }
}

/**
 * Assert MCP get_vcon payload matches oracle `VConQueries.getVCon` for core fields.
 * If plugins implement `afterRead` and mutate the vCon, use a narrower check only.
 */
export async function assertGetVconCoreMatchesOracle(
  queries: VConQueries,
  uuid: string,
  mcpVcon: VCon
): Promise<void> {
  const oracle = await queries.getVCon(uuid);
  expect(mcpVcon.uuid).toBe(oracle.uuid);
  expect(mcpVcon.subject).toBe(oracle.subject);
  expect((mcpVcon.parties ?? []).length).toBe((oracle.parties ?? []).length);
  expect((mcpVcon.dialog ?? []).length).toBe((oracle.dialog ?? []).length);
  expect((mcpVcon.analysis ?? []).length).toBe((oracle.analysis ?? []).length);
  expect((mcpVcon.attachments ?? []).length).toBe((oracle.attachments ?? []).length);
  const a = JSON.stringify(mcpVcon);
  const b = JSON.stringify(oracle);
  expect(a).toBe(b);
}
