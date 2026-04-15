/**
 * Search Route Tests
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

// Mock embedding generation to avoid needing OPENAI_API_KEY
vi.mock('../../../src/utils/embeddings.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  EmbeddingError: class EmbeddingError extends Error {
    constructor(msg: string) { super(msg); this.name = 'EmbeddingError'; }
  },
}));

describe('Search Routes', () => {
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

  // ── GET /vcons/search/content ───────────────────────────────────────────

  describe('GET /vcons/search/content', () => {
    it('should perform keyword search', async () => {
      ctx.mocks.queries.keywordSearch.mockResolvedValueOnce([
        { vcon_id: randomUUID(), doc_type: 'dialog', ref_index: 0, rank: 1.5, snippet: 'test match' },
      ]);

      const res = await request(ctx.app.callback())
        .get(`${BASE}/vcons/search/content?q=test`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.results[0].snippet).toBe('test match');
    });

    it('should return 400 without q parameter', async () => {
      await request(ctx.app.callback())
        .get(`${BASE}/vcons/search/content`)
        .expect(400);
    });

    it('should support format=ids_only', async () => {
      const id = randomUUID();
      ctx.mocks.queries.keywordSearch.mockResolvedValueOnce([
        { vcon_id: id, doc_type: 'dialog', ref_index: 0, rank: 1.0, snippet: 'x' },
      ]);

      const res = await request(ctx.app.callback())
        .get(`${BASE}/vcons/search/content?q=test&format=ids_only`)
        .expect(200);

      expect(res.body.results[0]).toBe(id);
    });

    it('should support include_count', async () => {
      ctx.mocks.queries.keywordSearch.mockResolvedValueOnce([]);
      ctx.mocks.queries.keywordSearchCount.mockResolvedValueOnce(42);

      const res = await request(ctx.app.callback())
        .get(`${BASE}/vcons/search/content?q=test&include_count=true`)
        .expect(200);

      expect(res.body.total_count).toBe(42);
    });
  });

  // ── GET /vcons/search/semantic ──────────────────────────────────────────

  describe('GET /vcons/search/semantic', () => {
    it('should perform semantic search with query', async () => {
      ctx.mocks.queries.semanticSearch.mockResolvedValueOnce([
        { vcon_id: randomUUID(), content_type: 'dialog', content_reference: null, content_text: 'match', similarity: 0.95 },
      ]);

      const res = await request(ctx.app.callback())
        .get(`${BASE}/vcons/search/semantic?q=customer+complaint`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.results[0].similarity_score).toBe(0.95);
    });

    it('should return 400 without query or embedding', async () => {
      await request(ctx.app.callback())
        .get(`${BASE}/vcons/search/semantic`)
        .expect(400);
    });
  });

  // ── GET /vcons/search/hybrid ────────────────────────────────────────────

  describe('GET /vcons/search/hybrid', () => {
    it('should perform hybrid search', async () => {
      ctx.mocks.queries.hybridSearch.mockResolvedValueOnce([
        { vcon_id: randomUUID(), combined_score: 0.9, semantic_score: 0.85, keyword_score: 0.95 },
      ]);

      const res = await request(ctx.app.callback())
        .get(`${BASE}/vcons/search/hybrid?q=billing+issue`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.results[0].combined_score).toBe(0.9);
    });

    it('should return 400 without q parameter', async () => {
      await request(ctx.app.callback())
        .get(`${BASE}/vcons/search/hybrid`)
        .expect(400);
    });
  });
});
