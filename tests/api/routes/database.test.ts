/**
 * Database & Analytics Route Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestAppContext } from '../helpers.js';

vi.mock('../../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
  recordCounter: vi.fn(),
}));
vi.mock('../../../src/observability/attributes.js', () => ({
  ATTR_SEARCH_TYPE: 'search.type',
}));

describe('Database Routes', () => {
  let ctx: TestAppContext;
  const BASE = '/api/v1';
  let savedAuthRequired: string | undefined;

  beforeEach(() => {
    savedAuthRequired = process.env.API_AUTH_REQUIRED;
    ctx = createTestApp();
  });

  afterEach(() => {
    if (savedAuthRequired !== undefined) {
      process.env.API_AUTH_REQUIRED = savedAuthRequired;
    } else {
      delete process.env.API_AUTH_REQUIRED;
    }
  });

  describe('GET /database/shape', () => {
    it('should return database shape', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/database/shape`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(ctx.mocks.dbInspector.getDatabaseShape).toHaveBeenCalledOnce();
    });

    it('should pass query params as options', async () => {
      await request(ctx.app.callback())
        .get(`${BASE}/database/shape?include_columns=true&include_counts=false`)
        .expect(200);

      expect(ctx.mocks.dbInspector.getDatabaseShape).toHaveBeenCalledWith(
        expect.objectContaining({ includeColumns: true, includeCounts: false })
      );
    });
  });

  describe('GET /database/stats', () => {
    it('should return database stats', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/database/stats`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(ctx.mocks.dbInspector.getDatabaseStats).toHaveBeenCalledOnce();
    });
  });

  describe('GET /database/size', () => {
    it('should return database size info', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/database/size`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.total_vcons).toBe(100);
    });
  });

  describe('GET /database/health', () => {
    it('should return health metrics', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/database/health`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(ctx.mocks.dbAnalytics.getDatabaseHealthMetrics).toHaveBeenCalledOnce();
    });
  });

  describe('POST /database/analyze', () => {
    it('should analyze a query', async () => {
      const res = await request(ctx.app.callback())
        .post(`${BASE}/database/analyze`)
        .send({ query: 'SELECT * FROM vcons LIMIT 10' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(ctx.mocks.dbInspector.analyzeQuery).toHaveBeenCalledWith(
        'SELECT * FROM vcons LIMIT 10', 'explain'
      );
    });

    it('should return 400 without query', async () => {
      await request(ctx.app.callback())
        .post(`${BASE}/database/analyze`)
        .send({})
        .expect(400);
    });
  });
});

describe('Analytics Routes', () => {
  let ctx: TestAppContext;
  const BASE = '/api/v1';
  let savedAuthRequired: string | undefined;

  beforeEach(() => {
    savedAuthRequired = process.env.API_AUTH_REQUIRED;
    ctx = createTestApp();
  });

  afterEach(() => {
    if (savedAuthRequired !== undefined) {
      process.env.API_AUTH_REQUIRED = savedAuthRequired;
    } else {
      delete process.env.API_AUTH_REQUIRED;
    }
  });

  describe('GET /analytics', () => {
    it('should return full analytics', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/analytics`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(ctx.mocks.dbAnalytics.getDatabaseAnalytics).toHaveBeenCalledOnce();
    });
  });

  describe('GET /analytics/growth', () => {
    it('should return growth analytics', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/analytics/growth?granularity=daily`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(ctx.mocks.dbAnalytics.getMonthlyGrowthAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ granularity: 'daily' })
      );
    });
  });

  describe('GET /analytics/content', () => {
    it('should return content analytics', async () => {
      await request(ctx.app.callback())
        .get(`${BASE}/analytics/content?start_date=2024-01-01&end_date=2024-12-31`)
        .expect(200);

      expect(ctx.mocks.dbAnalytics.getContentAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: '2024-01-01', endDate: '2024-12-31' })
      );
    });
  });

  describe('GET /analytics/tags', () => {
    it('should return tag analytics', async () => {
      await request(ctx.app.callback())
        .get(`${BASE}/analytics/tags`)
        .expect(200);

      expect(ctx.mocks.dbAnalytics.getTagAnalytics).toHaveBeenCalledOnce();
    });
  });

  describe('GET /analytics/attachments', () => {
    it('should return attachment analytics', async () => {
      await request(ctx.app.callback())
        .get(`${BASE}/analytics/attachments`)
        .expect(200);

      expect(ctx.mocks.dbAnalytics.getAttachmentAnalytics).toHaveBeenCalledOnce();
    });
  });
});
