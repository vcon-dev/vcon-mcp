/**
 * vCon CRUD Route Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createTestApp, sampleVCon, type TestAppContext } from '../helpers.js';

// Mock observability (avoid real telemetry in tests)
vi.mock('../../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
  recordCounter: vi.fn(),
}));
vi.mock('../../../src/observability/attributes.js', () => ({
  ATTR_SEARCH_TYPE: 'search.type',
}));

describe('vCon CRUD Routes', () => {
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

  // ── POST /vcons ─────────────────────────────────────────────────────────

  describe('POST /vcons', () => {
    it('should create a vCon and return 201', async () => {
      const res = await request(ctx.app.callback())
        .post(`${BASE}/vcons`)
        .send({ parties: [{ name: 'Test' }] })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.uuid).toBeDefined();
      expect(ctx.mocks.vconService.create).toHaveBeenCalledOnce();
    });

    it('should return 400 for validation errors', async () => {
      const { VConValidationError } = await import('../../../src/services/vcon-service.js');
      ctx.mocks.vconService.create.mockRejectedValueOnce(new VConValidationError(['parties required']));

      const res = await request(ctx.app.callback())
        .post(`${BASE}/vcons`)
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // ── POST /vcons/batch ───────────────────────────────────────────────────

  describe('POST /vcons/batch', () => {
    it('should batch create vCons and return 201', async () => {
      const vcons = [
        { parties: [{ name: 'A' }] },
        { parties: [{ name: 'B' }] },
      ];
      const res = await request(ctx.app.callback())
        .post(`${BASE}/vcons/batch`)
        .send(vcons)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.total).toBe(2);
      expect(res.body.created).toBe(2);
    });

    it('should return 400 for non-array body', async () => {
      await request(ctx.app.callback())
        .post(`${BASE}/vcons/batch`)
        .send({ not: 'array' })
        .expect(400);
    });

    it('should return 400 for empty array', async () => {
      await request(ctx.app.callback())
        .post(`${BASE}/vcons/batch`)
        .send([])
        .expect(400);
    });
  });

  // ── GET /vcons ──────────────────────────────────────────────────────────

  describe('GET /vcons', () => {
    it('should return paginated results', async () => {
      const vcon = sampleVCon();
      ctx.mocks.vconService.search.mockResolvedValueOnce([vcon]);

      const res = await request(ctx.app.callback())
        .get(`${BASE}/vcons?limit=10`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.limit).toBe(10);
    });

    it('should accept filter query params', async () => {
      ctx.mocks.vconService.search.mockResolvedValueOnce([]);

      await request(ctx.app.callback())
        .get(`${BASE}/vcons?subject=test&party_name=Alice&start_date=2024-01-01`)
        .expect(200);

      expect(ctx.mocks.vconService.search).toHaveBeenCalledOnce();
    });

    it('should reject invalid limit', async () => {
      await request(ctx.app.callback())
        .get(`${BASE}/vcons?limit=-1`)
        .expect(400);
    });

    it('should support format=ids_only', async () => {
      const vcon = sampleVCon();
      ctx.mocks.vconService.search.mockResolvedValueOnce([vcon]);

      const res = await request(ctx.app.callback())
        .get(`${BASE}/vcons?format=ids_only`)
        .expect(200);

      expect(res.body.data[0]).toBe(vcon.uuid);
    });
  });

  // ── GET /vcons/:uuid ────────────────────────────────────────────────────

  describe('GET /vcons/:uuid', () => {
    it('should return a vCon by UUID', async () => {
      const uuid = randomUUID();
      const res = await request(ctx.app.callback())
        .get(`${BASE}/vcons/${uuid}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.vcon).toBeDefined();
      expect(res.body.vcon.uuid).toBe(uuid);
    });

    it('should return 404 for non-existent UUID', async () => {
      const uuid = randomUUID();
      ctx.mocks.vconService.get.mockRejectedValueOnce(new Error(`vCon ${uuid} not found`));

      await request(ctx.app.callback())
        .get(`${BASE}/vcons/${uuid}`)
        .expect(404);
    });

    it('should return 400 for invalid UUID', async () => {
      await request(ctx.app.callback())
        .get(`${BASE}/vcons/not-a-uuid`)
        .expect(400);
    });

    it('should support format=metadata', async () => {
      const uuid = randomUUID();
      const res = await request(ctx.app.callback())
        .get(`${BASE}/vcons/${uuid}?format=metadata`)
        .expect(200);

      expect(res.body.vcon.dialog).toBeUndefined();
      expect(res.body.vcon.analysis).toBeUndefined();
    });

    it('should support format=summary', async () => {
      const uuid = randomUUID();
      const vcon = sampleVCon({
        uuid,
        analysis: [
          { type: 'summary', vendor: 'test', body: 'summary text' } as any,
          { type: 'transcript', vendor: 'test', body: 'transcript' } as any,
        ],
      });
      ctx.mocks.vconService.get.mockResolvedValueOnce(vcon);

      const res = await request(ctx.app.callback())
        .get(`${BASE}/vcons/${uuid}?format=summary`)
        .expect(200);

      expect(res.body.vcon.analysis).toHaveLength(1);
      expect(res.body.vcon.analysis[0].type).toBe('summary');
    });
  });

  // ── PATCH /vcons/:uuid ──────────────────────────────────────────────────

  describe('PATCH /vcons/:uuid', () => {
    it('should update metadata and return the updated vCon', async () => {
      const uuid = randomUUID();
      const res = await request(ctx.app.callback())
        .patch(`${BASE}/vcons/${uuid}`)
        .send({ subject: 'Updated Subject' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.vcon).toBeDefined();
      expect(ctx.mocks.vconService.update).toHaveBeenCalledWith(
        uuid,
        { subject: 'Updated Subject' },
        expect.objectContaining({ source: 'rest-api' })
      );
    });

    it('should return 404 for non-existent vCon', async () => {
      const uuid = randomUUID();
      ctx.mocks.vconService.update.mockRejectedValueOnce(new Error(`vCon ${uuid} not found`));

      await request(ctx.app.callback())
        .patch(`${BASE}/vcons/${uuid}`)
        .send({ subject: 'X' })
        .expect(404);
    });
  });

  // ── DELETE /vcons/:uuid ─────────────────────────────────────────────────

  describe('DELETE /vcons/:uuid', () => {
    it('should delete a vCon', async () => {
      const uuid = randomUUID();
      const res = await request(ctx.app.callback())
        .delete(`${BASE}/vcons/${uuid}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should return 404 for non-existent UUID', async () => {
      const uuid = randomUUID();
      ctx.mocks.vconService.delete.mockResolvedValueOnce(false);

      await request(ctx.app.callback())
        .delete(`${BASE}/vcons/${uuid}`)
        .expect(404);
    });
  });

  // ── POST /vcons/:uuid/dialog ────────────────────────────────────────────

  describe('POST /vcons/:uuid/dialog', () => {
    it('should add dialog and return 201', async () => {
      const uuid = randomUUID();
      const res = await request(ctx.app.callback())
        .post(`${BASE}/vcons/${uuid}/dialog`)
        .send({ type: 'text', body: 'Hello', encoding: 'none' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.dialog.type).toBe('text');
      expect(ctx.mocks.queries.addDialog).toHaveBeenCalledOnce();
    });

    it('should return 400 for invalid dialog', async () => {
      const uuid = randomUUID();
      await request(ctx.app.callback())
        .post(`${BASE}/vcons/${uuid}/dialog`)
        .send({ type: 'invalid_type' })
        .expect(400);
    });
  });

  // ── POST /vcons/:uuid/analysis ──────────────────────────────────────────

  describe('POST /vcons/:uuid/analysis', () => {
    it('should add analysis and return 201', async () => {
      const uuid = randomUUID();
      const res = await request(ctx.app.callback())
        .post(`${BASE}/vcons/${uuid}/analysis`)
        .send({ type: 'summary', vendor: 'TestAI', body: 'Summary text', encoding: 'none' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.analysis.vendor).toBe('TestAI');
      expect(ctx.mocks.queries.addAnalysis).toHaveBeenCalledOnce();
    });

    it('should return 400 when vendor is missing', async () => {
      const uuid = randomUUID();
      await request(ctx.app.callback())
        .post(`${BASE}/vcons/${uuid}/analysis`)
        .send({ type: 'summary' })
        .expect(400);
    });
  });

  // ── POST /vcons/:uuid/attachments ───────────────────────────────────────

  describe('POST /vcons/:uuid/attachments', () => {
    it('should add attachment and return 201', async () => {
      const uuid = randomUUID();
      const res = await request(ctx.app.callback())
        .post(`${BASE}/vcons/${uuid}/attachments`)
        .send({ type: 'document', body: 'content', encoding: 'none' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(ctx.mocks.queries.addAttachment).toHaveBeenCalledOnce();
    });
  });
});
