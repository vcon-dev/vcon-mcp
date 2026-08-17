/**
 * Embedding Generation Utility
 *
 * Shared query-time embedding generation for both MCP tool handlers and REST
 * API routes. Produces 384-dimensional vectors, matching vcon_embeddings.
 *
 * Providers:
 *   supabase (default) — the `embed-query` edge function, built-in gte-small.
 *                        No API key, no egress cost, natively 384 dims.
 *   openai             — text-embedding-3-small truncated to 384 dims.
 *
 * CRITICAL: query vectors must come from the same model as the stored corpus
 * vectors. gte-small and text-embedding-3-small both fit the vector(384) column
 * but are not interchangeable; mixing them makes cosine similarity meaningless
 * and fails silently. vcon_embeddings.embedding_model records what the corpus
 * was built with — check it before overriding EMBEDDING_PROVIDER.
 */

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export type QueryEmbeddingProvider = 'supabase' | 'openai';

/** Which provider generateEmbedding() will use, and the model name it implies. */
export function resolveProvider(): { provider: QueryEmbeddingProvider; model: string } {
  const forced = process.env.EMBEDDING_PROVIDER as QueryEmbeddingProvider | undefined;
  const provider: QueryEmbeddingProvider =
    forced ?? (process.env.OPENAI_API_KEY ? 'openai' : 'supabase');
  return {
    provider,
    model: provider === 'supabase' ? 'Supabase/gte-small' : 'text-embedding-3-small',
  };
}

const DIMENSIONS = 384;

async function embedViaSupabase(query: string): Promise<number[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new EmbeddingError('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to embed queries with gte-small');
  }

  const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/embed-query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: query }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new EmbeddingError(`embed-query failed (${response.status}): ${err}`);
  }

  const json = await response.json() as { embedding?: number[] };
  if (!Array.isArray(json.embedding) || json.embedding.length !== DIMENSIONS) {
    throw new EmbeddingError(`embed-query returned ${json.embedding?.length ?? 'no'} dimensions, expected ${DIMENSIONS}`);
  }
  return json.embedding;
}

async function embedViaOpenAI(query: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new EmbeddingError('OPENAI_API_KEY not set — cannot generate query embedding');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new EmbeddingError(`OpenAI embedding error: ${err}`);
  }

  const json = await response.json() as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
}

/**
 * Generate an embedding vector from a text query
 *
 * @param query - The text to embed
 * @returns 384-dimensional embedding vector
 * @throws EmbeddingError if the configured provider is unusable
 */
export async function generateEmbedding(query: string): Promise<number[]> {
  const { provider } = resolveProvider();
  return provider === 'openai' ? embedViaOpenAI(query) : embedViaSupabase(query);
}
