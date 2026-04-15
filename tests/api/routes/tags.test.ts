/**
 * Tag Route Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, type TestAppContext } from '../helpers.js';

vi.mock('../../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
  recordCounter: vi.fn(),
}));
vi.mock('../../../src/observability/attributes.js', () => ({
  ATTR_SEARCH_TYPE: 'search.type',
}));

describe('Tag Routes', () => {
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

  // ── GET /vcons/:uuid/tags ───────────────────────────────────────────────

  describe('GET /vcons/:uuid/tags', () => {
    it('should return all tags', async () => {
      const uuid = randomUUID();
      ctx.mocks.queries.getTags.mockResolvedValueOnce({ department: 'sales', priority: 'high' });

      const res = await request(ctx.app.callback())
        .get(`${BASE}/vcons/${uuid}/tags`)
        .expect(200);

      expect(res.body.tags).toEqual({ department: 'sales', priority: 'high' });
    });

    it('should return a single tag via ?key', async () => {
      const uuid = randomUUID();
      ctx.mocks.queries.getTag.mockResolvedValueOnce('sales');

      const res = await request(ctx.app.callback())
        .get(`${BASE}/vcons/${uuid}/tags?key=department`)
        .expect(200);

      expect(res.body.key).toBe('department');
      expect(res.body.value).toBe('sales');
    });
  });

  // ── PUT /vcons/:uuid/tags/:key ──────────────────────────────────────────

  describe('PUT /vcons/:uuid/tags/:key', () => {
    it('should set a tag', async () => {
      const uuid = randomUUID();
      const res = await request(ctx.app.callback())
        .put(`${BASE}/vcons/${uuid}/tags/department`)
        .send({ value: 'engineering' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.key).toBe('department');
      expect(ctx.mocks.queries.addTag).toHaveBeenCalledWith(uuid, 'department', 'engineering', true);
    });

    it('should return 400 without value', async () => {
      const uuid = randomUUID();
      await request(ctx.app.callback())
        .put(`${BASE}/vcons/${uuid}/tags/department`)
        .send({})
        .expect(400);
    });
  });

  // ── DELETE /vcons/:uuid/tags/:key ───────────────────────────────────────

  describe('DELETE /vcons/:uuid/tags/:key', () => {
    it('should remove a tag and return 204', async () => {
      const uuid = randomUUID();
      await request(ctx.app.callback())
        .delete(`${BASE}/vcons/${uuid}/tags/department`)
        .expect(204);

      expect(ctx.mocks.queries.removeTag).toHaveBeenCalledWith(uuid, 'department');
    });
  });

  // ── DELETE /vcons/:uuid/tags ────────────────────────────────────────────

  describe('DELETE /vcons/:uuid/tags', () => {
    it('should remove all tags and return 204', async () => {
      const uuid = randomUUID();
      await request(ctx.app.callback())
        .delete(`${BASE}/vcons/${uuid}/tags`)
        .expect(204);

      expect(ctx.mocks.queries.removeAllTags).toHaveBeenCalledWith(uuid);
    });
  });

  // ── GET /tags ───────────────────────────────────────────────────────────

  describe('GET /tags', () => {
    it('should return unique tags', async () => {
      ctx.mocks.queries.getUniqueTags.mockResolvedValueOnce({
        keys: ['department', 'priority'],
        tagsByKey: { department: ['sales', 'eng'], priority: ['high', 'low'] },
        totalVCons: 50,
      });

      const res = await request(ctx.app.callback())
        .get(`${BASE}/tags`)
        .expect(200);

      expect(res.body.keys).toHaveLength(2);
    });
  });

  // ── GET /tags/search ────────────────────────────────────────────────────

  describe('GET /tags/search', () => {
    it('should search by tags', async () => {
      ctx.mocks.queries.searchByTags.mockResolvedValueOnce([randomUUID(), randomUUID()]);

      const res = await request(ctx.app.callback())
        .get(`${BASE}/tags/search?tags=${encodeURIComponent('{"department":"sales"}')}`)
        .expect(200);

      expect(res.body.count).toBe(2);
      expect(res.body.uuids).toHaveLength(2);
    });

    it('should return 400 without tags param', async () => {
      await request(ctx.app.callback())
        .get(`${BASE}/tags/search`)
        .expect(400);
    });

    it('should return 400 for invalid JSON', async () => {
      await request(ctx.app.callback())
        .get(`${BASE}/tags/search?tags=not-json`)
        .expect(400);
    });
  });
});
