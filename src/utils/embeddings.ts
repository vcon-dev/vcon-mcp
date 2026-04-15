/**
 * Embedding Generation Utility
 *
 * Shared embedding generation for both MCP tool handlers and REST API routes.
 * Uses OpenAI's text-embedding-3-small model with 384 dimensions.
 */

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/**
 * Generate an embedding vector from a text query using OpenAI
 *
 * @param query - The text to embed
 * @returns 384-dimensional embedding vector
 * @throws EmbeddingError if OPENAI_API_KEY is not set or the API call fails
 */
export async function generateEmbedding(query: string): Promise<number[]> {
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
      dimensions: 384,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new EmbeddingError(`OpenAI embedding error: ${err}`);
  }

  const json = await response.json() as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
}
