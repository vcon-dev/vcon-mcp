/**
 * Query Embedding Provider Tests
 *
 * The failure this guards against is silent: query vectors from a different
 * model than the stored corpus still fit vector(384), so cosine similarity
 * returns confident nonsense rather than an error. These tests pin which
 * provider (and therefore which model) gets selected for a given environment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateEmbedding, resolveProvider, EmbeddingError } from '../src/utils/embeddings.js';

describe('query embedding provider selection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to the built-in gte-small when no OpenAI key is present', () => {
    expect(resolveProvider()).toEqual({ provider: 'supabase', model: 'Supabase/gte-small' });
  });

  it('prefers OpenAI when a key is present, preserving prior behaviour', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(resolveProvider()).toEqual({ provider: 'openai', model: 'text-embedding-3-small' });
  });

  it('lets EMBEDDING_PROVIDER override an available OpenAI key', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.EMBEDDING_PROVIDER = 'supabase';
    expect(resolveProvider().model).toBe('Supabase/gte-small');
  });

  it('never silently reports the wrong model for a provider', () => {
    // gte-small and text-embedding-3-small both yield 384 dims; the model name
    // is the only thing that distinguishes them once stored.
    process.env.EMBEDDING_PROVIDER = 'openai';
    const openai = resolveProvider();
    process.env.EMBEDDING_PROVIDER = 'supabase';
    const supa = resolveProvider();
    expect(openai.model).not.toBe(supa.model);
  });

  it('fails loudly when the supabase path lacks project credentials', async () => {
    await expect(generateEmbedding('anything')).rejects.toThrow(EmbeddingError);
  });

  it('rejects a wrong-dimension response instead of storing it', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ embedding: [1, 2, 3] }), { status: 200 })) as typeof fetch;
    try {
      await expect(generateEmbedding('anything')).rejects.toThrow(/expected 384/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
