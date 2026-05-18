import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestAppContext } from '../helpers.js';

describe('Discovery Routes', () => {
  let ctx: TestAppContext;
  const BASE = '/api/v1';

  beforeEach(() => {
    ctx = createTestApp();
  });

  describe('GET /discovery/attachments/types', () => {
    it('should return discovered attachment types with counts by default', async () => {
      ctx.mocks.queries.getUniqueAttachmentTypes.mockResolvedValueOnce({
        values: ['document', 'tags'],
        countsPerValue: { document: 4, tags: 2 },
        totalVCons: 5,
      });

      const res = await request(ctx.app.callback())
        .get(`${BASE}/discovery/attachments/types`)
        .expect(200);

      expect(res.body.count).toBe(2);
      expect(res.body.total_vcons).toBe(5);
      expect(res.body.attachment_types).toEqual([
        { value: 'document', count: 4 },
        { value: 'tags', count: 2 },
      ]);
      expect(ctx.mocks.queries.getUniqueAttachmentTypes).toHaveBeenCalledWith({
        includeCounts: true,
        minCount: 1,
      });
    });
  });

  describe('GET /discovery/attachments/purposes', () => {
    it('should honor include_counts and min_count query params', async () => {
      ctx.mocks.queries.getUniqueAttachmentPurposes.mockResolvedValueOnce({
        values: ['dealer_info'],
        totalVCons: 2,
      });

      const res = await request(ctx.app.callback())
        .get(`${BASE}/discovery/attachments/purposes?include_counts=false&min_count=2`)
        .expect(200);

      expect(res.body.attachment_purposes).toEqual([
        { value: 'dealer_info' },
      ]);
      expect(ctx.mocks.queries.getUniqueAttachmentPurposes).toHaveBeenCalledWith({
        includeCounts: false,
        minCount: 2,
      });
    });
  });

  describe('GET /discovery/analysis/types', () => {
    it('should reject invalid min_count values', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/discovery/analysis/types?min_count=0`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('min_count');
    });
  });
});
