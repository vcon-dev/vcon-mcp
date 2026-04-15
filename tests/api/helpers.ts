/**
 * REST API Test Helpers
 *
 * Creates a Koa app with mocked dependencies for testing REST routes
 * via supertest without needing a real database.
 */

import { randomUUID } from 'crypto';
import type Koa from 'koa';
import { vi } from 'vitest';
import { createRestApi } from '../../src/api/rest-router.js';
import type { RestApiContext } from '../../src/api/context.js';
import type { VCon } from '../../src/types/vcon.js';

// ── Sample Data ─────────────────────────────────────────────────────────────

export function sampleVCon(overrides?: Partial<VCon>): VCon {
  return {
    vcon: '0.4.0',
    uuid: randomUUID(),
    created_at: new Date().toISOString(),
    subject: 'Test Conversation',
    parties: [
      { name: 'Alice', mailto: 'alice@example.com' },
      { name: 'Bob', tel: '+1-555-1234' },
    ],
    dialog: [],
    analysis: [],
    attachments: [],
    ...overrides,
  };
}

// ── Mock Factories ──────────────────────────────────────────────────────────

export function createMockQueries() {
  return {
    initialize: vi.fn(),
    createVCon: vi.fn(),
    getVCon: vi.fn(),
    addDialog: vi.fn(),
    addAnalysis: vi.fn(),
    addAttachment: vi.fn(),
    deleteVCon: vi.fn(),
    updateVCon: vi.fn(),
    keywordSearch: vi.fn().mockResolvedValue([]),
    keywordSearchCount: vi.fn().mockResolvedValue(0),
    semanticSearch: vi.fn().mockResolvedValue([]),
    hybridSearch: vi.fn().mockResolvedValue([]),
    searchVCons: vi.fn().mockResolvedValue([]),
    searchVConsCount: vi.fn().mockResolvedValue(0),
    getTags: vi.fn().mockResolvedValue({}),
    getTag: vi.fn().mockResolvedValue(null),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    removeAllTags: vi.fn(),
    searchByTags: vi.fn().mockResolvedValue([]),
    getUniqueTags: vi.fn().mockResolvedValue({ keys: [], tagsByKey: {}, totalVCons: 0 }),
  };
}

export function createMockPluginManager() {
  return {
    executeHook: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn(),
  };
}

export function createMockVConService(mockQueries: ReturnType<typeof createMockQueries>) {
  return {
    create: vi.fn().mockImplementation(async (data: any) => {
      const vcon = sampleVCon(data);
      return { uuid: vcon.uuid, id: '1', vcon };
    }),
    createBatch: vi.fn().mockImplementation(async (vcons: any[]) => ({
      total: vcons.length,
      created: vcons.length,
      failed: 0,
      results: vcons.map((_: any, i: number) => ({ uuid: randomUUID(), success: true, id: String(i + 1) })),
    })),
    get: vi.fn().mockImplementation(async (uuid: string) => {
      return sampleVCon({ uuid });
    }),
    update: vi.fn().mockImplementation(async (uuid: string, updates: any) => {
      return sampleVCon({ uuid, ...updates });
    }),
    delete: vi.fn().mockResolvedValue(true),
    search: vi.fn().mockResolvedValue([]),
  };
}

export function createMockDbInspector() {
  return {
    getDatabaseShape: vi.fn().mockResolvedValue({ tables: [] }),
    getDatabaseStats: vi.fn().mockResolvedValue({ stats: {} }),
    analyzeQuery: vi.fn().mockResolvedValue({ plan: 'Seq Scan' }),
    getConnectionInfo: vi.fn().mockResolvedValue({ connected: true }),
  };
}

export function createMockDbAnalytics() {
  return {
    getDatabaseAnalytics: vi.fn().mockResolvedValue({ overview: {} }),
    getMonthlyGrowthAnalytics: vi.fn().mockResolvedValue({ growth: [] }),
    getAttachmentAnalytics: vi.fn().mockResolvedValue({ attachments: {} }),
    getTagAnalytics: vi.fn().mockResolvedValue({ tags: {} }),
    getContentAnalytics: vi.fn().mockResolvedValue({ content: {} }),
    getDatabaseHealthMetrics: vi.fn().mockResolvedValue({ health: 'good' }),
  };
}

export function createMockDbSizeAnalyzer() {
  return {
    getDatabaseSizeInfo: vi.fn().mockResolvedValue({
      total_vcons: 100,
      total_size_bytes: 1024000,
      total_size_pretty: '1 MB',
      size_category: 'small',
      recommendations: {},
      table_sizes: {},
    }),
    getSmartSearchLimits: vi.fn().mockResolvedValue({
      query_type: 'basic',
      recommended_limit: 50,
    }),
  };
}

// ── App Factory ─────────────────────────────────────────────────────────────

export interface TestAppContext {
  app: Koa;
  mocks: {
    queries: ReturnType<typeof createMockQueries>;
    pluginManager: ReturnType<typeof createMockPluginManager>;
    vconService: ReturnType<typeof createMockVConService>;
    dbInspector: ReturnType<typeof createMockDbInspector>;
    dbAnalytics: ReturnType<typeof createMockDbAnalytics>;
    dbSizeAnalyzer: ReturnType<typeof createMockDbSizeAnalyzer>;
  };
}

/**
 * Create a fully-mocked Koa app for testing REST routes.
 * Auth is disabled by default for test convenience.
 */
export function createTestApp(): TestAppContext {
  const queries = createMockQueries();
  const pluginManager = createMockPluginManager();
  const vconService = createMockVConService(queries);
  const dbInspector = createMockDbInspector();
  const dbAnalytics = createMockDbAnalytics();
  const dbSizeAnalyzer = createMockDbSizeAnalyzer();

  const apiContext: RestApiContext = {
    queries: queries as any,
    pluginManager: pluginManager as any,
    supabase: {},
    vconService: vconService as any,
    dbInspector: dbInspector as any,
    dbAnalytics: dbAnalytics as any,
    dbSizeAnalyzer: dbSizeAnalyzer as any,
  };

  // Disable auth for tests
  process.env.API_AUTH_REQUIRED = 'false';

  const app = createRestApi(apiContext);

  return {
    app,
    mocks: { queries, pluginManager, vconService, dbInspector, dbAnalytics, dbSizeAnalyzer },
  };
}
