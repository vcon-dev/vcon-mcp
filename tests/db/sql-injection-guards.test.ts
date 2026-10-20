/**
 * SQL injection guards for queries run through the exec_sql RPC.
 *
 * exec_sql does not bind arbitrary parameters, so caller input that ends up in
 * those SQL strings must be validated or canonicalised before interpolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { DatabaseAnalytics } from '../../src/db/database-analytics.js';
import { DatabaseInspector } from '../../src/db/database-inspector.js';
import { VConQueries } from '../../src/db/queries.js';
import {
  SqlInputError,
  toSqlIdentifier,
  toSqlInt,
  toSqlTimestamp,
} from '../../src/db/sql-guards.js';
import { GetDatabaseStatsHandler } from '../../src/tools/handlers/database.js';
import { GetContentAnalyticsHandler } from '../../src/tools/handlers/database-analytics.js';

const QUOTE_BREAKOUT = "2026-01-01' OR '1'='1";
const STACKED = "2026-01-01'; DROP TABLE vcons; --";

/** Every SQL string sent through exec_sql. */
function execSqlQueries(rpc: ReturnType<typeof vi.fn>): string[] {
  return rpc.mock.calls
    .filter(([fn]) => fn === 'exec_sql')
    .map(([, args]) => (args as { q: string }).q);
}

describe('sql-guards', () => {
  describe('toSqlTimestamp', () => {
    it('returns a canonical ISO string for valid dates', () => {
      expect(toSqlTimestamp('2026-04-13T00:00:00Z', 'd')).toBe('2026-04-13T00:00:00.000Z');
      expect(toSqlTimestamp('2026-04-13', 'd')).toBe('2026-04-13T00:00:00.000Z');
      expect(toSqlTimestamp('2026-04-13T05:00:00-04:00', 'd')).toBe('2026-04-13T09:00:00.000Z');
    });

    it.each([QUOTE_BREAKOUT, STACKED, 'not a date', '', '   '])('rejects %j', (value) => {
      expect(() => toSqlTimestamp(value, 'd')).toThrow(SqlInputError);
    });

    it.each([123, null, {}, ['2026-01-01']])('rejects non-string %j', (value) => {
      expect(() => toSqlTimestamp(value, 'd')).toThrow(SqlInputError);
    });
  });

  describe('toSqlInt', () => {
    it('accepts integers in range', () => {
      expect(toSqlInt(1, 'n', 1, 10)).toBe(1);
      expect(toSqlInt(10, 'n', 1, 10)).toBe(10);
    });

    it.each([
      '5',
      '5; DROP TABLE vcons',
      '1 OR 1=1',
      [9],
      1.5,
      NaN,
      Infinity,
      0,
      11,
      null,
      undefined,
    ])('rejects %j', (value) => {
      expect(() => toSqlInt(value, 'n', 1, 10)).toThrow(SqlInputError);
    });
  });

  describe('toSqlIdentifier', () => {
    it.each(['vcons', 'dialog', '_private', 'vcon_tags_mv', 'a1'])('accepts %j', (value) => {
      expect(toSqlIdentifier(value, 't')).toBe(value);
    });

    it.each([
      "vcons' OR '1'='1",
      'vcons; DROP TABLE vcons',
      'public.vcons',
      'Vcons',
      '1abc',
      'a b',
      '',
      'a'.repeat(64),
      ['vcons'],
      42,
    ])('rejects %j', (value) => {
      expect(() => toSqlIdentifier(value, 't')).toThrow(SqlInputError);
    });

    it('carries HTTP 400 for the REST error handler', () => {
      try {
        toSqlIdentifier('x;y', 't');
      } catch (e) {
        expect((e as SqlInputError).status).toBe(400);
      }
    });
  });
});

describe('DatabaseAnalytics injection guards', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let analytics: DatabaseAnalytics;

  beforeEach(() => {
    rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    analytics = new DatabaseAnalytics({ rpc } as any);
  });

  it.each([
    ['startDate', { startDate: QUOTE_BREAKOUT }],
    ['startDate', { startDate: STACKED }],
    ['endDate', { endDate: QUOTE_BREAKOUT }],
    ['endDate', { endDate: STACKED }],
  ])('rejects an injected %s before any query runs', async (_name, opts) => {
    await expect(analytics.getContentAnalytics(opts)).rejects.toThrow(SqlInputError);
    expect(execSqlQueries(rpc)).toHaveLength(0);
  });

  it('emits canonical ISO timestamps for valid dates', async () => {
    await analytics.getContentAnalytics({
      startDate: '2026-04-13',
      endDate: '2026-04-14T00:00:00Z',
    });
    const queries = execSqlQueries(rpc);
    expect(queries.length).toBeGreaterThan(0);
    const filtered = queries.filter((q) => q.includes('v.created_at >='));
    expect(filtered.length).toBeGreaterThan(0);
    for (const q of filtered) {
      expect(q).toContain("v.created_at >= '2026-04-13T00:00:00.000Z'");
      expect(q).toContain("v.created_at < '2026-04-14T00:00:00.000Z'");
    }
  });

  it.each(["12 months' OR '1'='1", '12', 0, 1.5, -1])(
    'rejects monthsBack %j',
    async (monthsBack) => {
      await expect(
        analytics.getMonthlyGrowthAnalytics({ monthsBack: monthsBack as any, includeProjections: false }),
      ).rejects.toThrow(SqlInputError);
      expect(execSqlQueries(rpc)).toHaveLength(0);
    },
  );

  it('accepts a valid monthsBack', async () => {
    await analytics.getMonthlyGrowthAnalytics({ monthsBack: 6, includeProjections: false });
    const queries = execSqlQueries(rpc);
    expect(queries.length).toBe(3);
    for (const q of queries) expect(q).toContain("INTERVAL '6 months'");
  });

  it('rejects an injected topNTypes', async () => {
    await expect(
      analytics.getAttachmentAnalytics({
        topNTypes: '10; DROP TABLE vcons' as any,
        includeSizeDistribution: false,
      }),
    ).rejects.toThrow(SqlInputError);
    expect(execSqlQueries(rpc).some((q) => q.includes('DROP'))).toBe(false);
  });

  it('accepts a valid topNTypes', async () => {
    await analytics.getAttachmentAnalytics({ topNTypes: 5, includeSizeDistribution: false });
    expect(execSqlQueries(rpc).some((q) => /LIMIT 5\b/.test(q))).toBe(true);
  });

  it.each([
    ['topNKeys', { topNKeys: '20 UNION SELECT 1' as any }],
    ['minUsageCount', { minUsageCount: '1 OR 1=1' as any }],
  ])('rejects an injected %s', async (_name, opts) => {
    await expect(
      analytics.getTagAnalytics({ ...opts, includeValueDistribution: false }),
    ).rejects.toThrow(SqlInputError);
    expect(execSqlQueries(rpc).some((q) => /UNION SELECT 1|OR 1=1/.test(q))).toBe(false);
  });

  it('accepts valid tag analytics numbers', async () => {
    await analytics.getTagAnalytics({ topNKeys: 7, minUsageCount: 3 });
    const queries = execSqlQueries(rpc);
    expect(queries.some((q) => q.includes('HAVING COUNT(*) >= 3'))).toBe(true);
    expect(queries.some((q) => /LIMIT 7\b/.test(q))).toBe(true);
  });
});

describe('DatabaseInspector.getDatabaseStats tableName guard', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let inspector: DatabaseInspector;

  beforeEach(() => {
    rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    inspector = new DatabaseInspector({ rpc } as any);
  });

  it.each(["vcons' OR '1'='1", "vcons'; DROP TABLE vcons; --", 'public.vcons'])(
    'rejects %j before any query runs',
    async (tableName) => {
      await expect(inspector.getDatabaseStats({ tableName })).rejects.toThrow(SqlInputError);
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('accepts a plain table name', async () => {
    await inspector.getDatabaseStats({ tableName: 'vcons' });
    const queries = execSqlQueries(rpc);
    expect(queries.some((q) => q.includes("AND relname = 'vcons'"))).toBe(true);
    expect(queries.some((q) => q.includes("AND tablename = 'vcons'"))).toBe(true);
  });

  it('treats an empty or missing tableName as no filter', async () => {
    await inspector.getDatabaseStats({ tableName: '' });
    await inspector.getDatabaseStats({});
    expect(execSqlQueries(rpc).some((q) => q.includes('relname ='))).toBe(false);
  });
});

describe('VConQueries minCount guards', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let queries: VConQueries;

  beforeEach(() => {
    rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    queries = new VConQueries({ rpc } as any);
  });

  it.each(['2 OR 1=1', '5', 1.5, 0])('getUniqueAttachmentTypes rejects minCount %j', async (minCount) => {
    await expect(
      queries.getUniqueAttachmentTypes({ minCount: minCount as any }),
    ).rejects.toThrow(SqlInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('getUniqueAnalysisTypes accepts a valid minCount', async () => {
    await queries.getUniqueAnalysisTypes({ minCount: 4 });
    const q = execSqlQueries(rpc);
    expect(q.some((s) => s.includes('HAVING COUNT(*) >= 4') && s.includes('FROM analysis'))).toBe(true);
  });

  it('getUniqueTags rejects an injected minCount', async () => {
    await expect(queries.getUniqueTags({ minCount: '2 OR 1=1' as any })).rejects.toThrow(SqlInputError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('getUniqueTags accepts a valid minCount', async () => {
    await queries.getUniqueTags({ minCount: 3 });
    expect(execSqlQueries(rpc).some((s) => s.includes('HAVING COUNT(*) >= 3'))).toBe(true);
  });
});

describe('MCP handlers surface guard failures as InvalidParams', () => {
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  const context: any = {
    dbInspector: new DatabaseInspector({ rpc } as any),
    dbAnalytics: new DatabaseAnalytics({ rpc } as any),
  };

  async function expectInvalidParams(p: Promise<unknown>) {
    const err = await p.then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(ErrorCode.InvalidParams);
  }

  it('get_database_stats with an injected table_name', async () => {
    await expectInvalidParams(
      new GetDatabaseStatsHandler().handle({ table_name: "vcons' OR '1'='1" }, context),
    );
  });

  it('get_content_analytics with an injected start_date', async () => {
    await expectInvalidParams(
      new GetContentAnalyticsHandler().handle({ start_date: STACKED }, context),
    );
  });
});
