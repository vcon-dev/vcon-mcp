/**
 * CON-1239: REST correctness. Missing vCon -> 404, semantic validation on child
 * writes, strict query-param validation, 400 for disallowed analyze queries,
 * and status-only unauthenticated /health.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, type TestAppContext } from '../helpers.js';
import { VConNotFoundError } from '../../../src/utils/errors.js';
import { InvalidQueryError } from '../../../src/db/database-inspector.js';

vi.mock('../../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
  recordCounter: vi.fn(),
}));
vi.mock('../../../src/observability/attributes.js', () => ({
  ATTR_SEARCH_TYPE: 'search.type',
}));

const BASE = '/api/v1';

describe('REST correctness (CON-1239)', () => {
  let ctx: TestAppContext;
  const saved = { auth: process.env.API_AUTH_REQUIRED, keys: process.env.API_KEYS };
  const uuid = randomUUID();

  beforeEach(() => { ctx = createTestApp(); });
  afterEach(() => {
    for (const [k, v] of [['API_AUTH_REQUIRED', saved.auth], ['API_KEYS', saved.keys]] as const) {
      if (v !== undefined) process.env[k] = v; else delete process.env[k];
    }
  });

  describe('missing vCon -> 404', () => {
    it('POST dialog on a missing vCon is 404', async () => {
      ctx.mocks.queries.addDialog.mockRejectedValueOnce(new VConNotFoundError(uuid));
      await request(ctx.app.callback())
        .post(`${BASE}/vcons/${uuid}/dialog`)
        .send({ type: 'text', start: new Date().toISOString(), parties: [0], body: 'hi', encoding: 'none' })
        .expect(404);
    });

    it('PATCH dialog by index on a missing vCon is 404', async () => {
      ctx.mocks.queries.updateDialog.mockRejectedValueOnce(new VConNotFoundError(uuid));
      await request(ctx.app.callback())
        .patch(`${BASE}/vcons/${uuid}/dialog/0`)
        .send({ type: 'text', start: new Date().toISOString(), parties: [0], body: 'hi', encoding: 'none' })
        .expect(404);
    });

    it('GET tags on a missing vCon is 404', async () => {
      ctx.mocks.queries.getTags.mockRejectedValueOnce(new VConNotFoundError(uuid));
      await request(ctx.app.callback()).get(`${BASE}/vcons/${uuid}/tags`).expect(404);
    });
  });

  describe('semantic validation on child writes -> 400', () => {
    it('rejects an attachment with neither body+encoding nor url+content_hash', async () => {
      const res = await request(ctx.app.callback())
        .post(`${BASE}/vcons/${uuid}/attachments`)
        .send({ type: 'note' })
        .expect(400);
      expect(res.body.message).toMatch(/body \+ encoding/);
      expect(ctx.mocks.queries.addAttachment).not.toHaveBeenCalled();
    });

    it('rejects an incomplete dialog without disposition', async () => {
      const res = await request(ctx.app.callback())
        .post(`${BASE}/vcons/${uuid}/dialog`)
        .send({ type: 'incomplete', start: new Date().toISOString(), parties: [0] })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/disposition/);
      expect(ctx.mocks.queries.addDialog).not.toHaveBeenCalled();
    });

    it('rejects the same on PATCH attachments/:index', async () => {
      await request(ctx.app.callback())
        .patch(`${BASE}/vcons/${uuid}/attachments/0`)
        .send({ type: 'note' })
        .expect(400);
      expect(ctx.mocks.queries.updateAttachment).not.toHaveBeenCalled();
    });

    it('rejects an incomplete dialog on PATCH dialog/:index', async () => {
      await request(ctx.app.callback())
        .patch(`${BASE}/vcons/${uuid}/dialog/0`)
        .send({ type: 'incomplete', start: new Date().toISOString(), parties: [0] })
        .expect(400);
      expect(ctx.mocks.queries.updateDialog).not.toHaveBeenCalled();
    });

    it('still accepts a valid attachment', async () => {
      await request(ctx.app.callback())
        .post(`${BASE}/vcons/${uuid}/attachments`)
        .send({ type: 'note', body: 'hello', encoding: 'none' })
        .expect(201);
    });
  });

  describe('query params are validated, not defaulted', () => {
    it.each([
      '/vcons/search/content?q=x&limit=abc',
      '/vcons/search/content?q=x&limit=0',
      '/vcons/search/hybrid?q=x&limit=99999',
      '/vcons/search/hybrid?q=x&semantic_weight=abc',
      '/vcons/search/hybrid?q=x&semantic_weight=2',
      '/vcons/search/semantic?q=x&threshold=NaN',
      '/vcons/search/semantic?embedding=%5B1&threshold=0.5',
      '/analytics/growth?months_back=-3',
      '/analytics/tags?top_n=lots',
      '/analytics/attachments?top_n=1000',
      '/tags?min_count=0',
      '/tags/search?tags=%7B%22a%22%3A%221%22%7D&limit=500',
    ])('GET %s is 400', async (path) => {
      await request(ctx.app.callback()).get(`${BASE}${path}`).expect(400);
    });

    it('absent params keep their defaults', async () => {
      await request(ctx.app.callback()).get(`${BASE}/vcons/search/hybrid?q=x`).expect(200);
      expect(ctx.mocks.queries.hybridSearch).toHaveBeenCalledWith(
        expect.objectContaining({ semanticWeight: 0.6, limit: 50 })
      );
      await request(ctx.app.callback()).get(`${BASE}/analytics/growth`).expect(200);
      expect(ctx.mocks.dbAnalytics.getMonthlyGrowthAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({ monthsBack: 12 })
      );
    });
  });

  describe('POST /database/analyze', () => {
    it('returns 400 when the inspector rejects a non-SELECT query', async () => {
      ctx.mocks.dbInspector.analyzeQuery.mockRejectedValueOnce(
        new InvalidQueryError('Only SELECT queries are allowed for analysis')
      );
      const res = await request(ctx.app.callback())
        .post(`${BASE}/database/analyze`)
        .send({ query: 'DELETE FROM vcons' })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/SELECT/);
    });
  });

  describe('GET /health exposure', () => {
    const detail = { database_name: 'postgres', current_schema: 'public', postgres_version: 'PostgreSQL 15', database_size: '1 GB' };

    it('unauthenticated response is status only when auth is required', async () => {
      process.env.API_KEYS = 'secret-key';
      ctx = createTestApp({ authRequired: true });
      ctx.mocks.dbInspector.getConnectionInfo.mockResolvedValueOnce(detail);
      const res = await request(ctx.app.callback()).get(`${BASE}/health`).expect(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.version).toBeDefined();
      for (const k of Object.keys(detail)) expect(res.body).not.toHaveProperty(k);
      expect(res.body).not.toHaveProperty('schema');
    });

    it('unauthenticated 503 carries no raw error text', async () => {
      process.env.API_KEYS = 'secret-key';
      ctx = createTestApp({ authRequired: true });
      ctx.mocks.dbInspector.getConnectionInfo.mockRejectedValueOnce(new Error('password auth failed for user "x"'));
      const res = await request(ctx.app.callback()).get(`${BASE}/health`).expect(503);
      expect(res.body.status).toBe('unhealthy');
      expect(JSON.stringify(res.body)).not.toMatch(/password/);
      expect(res.body).not.toHaveProperty('error');
    });

    it('a valid API key still gets connection details', async () => {
      process.env.API_KEYS = 'secret-key';
      ctx = createTestApp({ authRequired: true });
      ctx.mocks.dbInspector.getConnectionInfo.mockResolvedValueOnce(detail);
      const res = await request(ctx.app.callback())
        .get(`${BASE}/health`)
        .set('Authorization', 'Bearer secret-key')
        .expect(200);
      expect(res.body.database_name).toBe('postgres');
    });

    it('an invalid API key does not get connection details', async () => {
      process.env.API_KEYS = 'secret-key';
      ctx = createTestApp({ authRequired: true });
      ctx.mocks.dbInspector.getConnectionInfo.mockResolvedValueOnce(detail);
      const res = await request(ctx.app.callback())
        .get(`${BASE}/health`)
        .set('Authorization', 'Bearer wrong')
        .expect(200);
      expect(res.body).not.toHaveProperty('database_name');
    });
  });
});
