/**
 * Schema, Health, Version Route Tests
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

describe('Infrastructure Routes', () => {
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

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/health`)
        .expect(200);

      expect(res.body.status).toBe('healthy');
      expect(res.body.version).toBeDefined();
    });

    it('should return 503 when DB is unhealthy', async () => {
      ctx.mocks.dbInspector.getConnectionInfo.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await request(ctx.app.callback())
        .get(`${BASE}/health`)
        .expect(503);

      expect(res.body.status).toBe('unhealthy');
      expect(res.body.database).toBe('error');
    });
  });

  describe('GET /version', () => {
    it('should return version info', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/version`)
        .expect(200);

      expect(res.body.version).toBeDefined();
    });
  });

  describe('GET /schema', () => {
    it('should return schema info (json_schema format)', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/schema`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.spec_version).toBe('0.4.0');
    });

    it('should return typescript format info', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/schema?format=typescript`)
        .expect(200);

      expect(res.body.format).toBe('typescript');
    });
  });

  describe('GET /examples/:type', () => {
    it('should return a minimal example', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/examples/minimal`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.type).toBe('minimal');
      expect(res.body.vcon.vcon).toBe('0.4.0');
      expect(res.body.vcon.parties).toHaveLength(1);
    });

    it('should return a full_featured example', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/examples/full_featured`)
        .expect(200);

      expect(res.body.vcon.parties).toHaveLength(2);
      expect(res.body.vcon.dialog).toBeDefined();
      expect(res.body.vcon.analysis).toBeDefined();
    });

    it('should return 400 for unknown type', async () => {
      await request(ctx.app.callback())
        .get(`${BASE}/examples/nonexistent`)
        .expect(400);
    });
  });

  describe('Response Headers', () => {
    it('should include version headers on all responses', async () => {
      const res = await request(ctx.app.callback())
        .get(`${BASE}/version`)
        .expect(200);

      expect(res.headers['x-version']).toBeDefined();
      expect(res.headers['x-git-commit']).toBeDefined();
      expect(res.headers['x-build-time']).toBeDefined();
    });
  });
});
