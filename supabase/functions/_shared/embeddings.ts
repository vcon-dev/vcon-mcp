/**
 * Shared embedding functions for LiteLLM, OpenAI, Azure OpenAI, and Hugging Face.
 * Used by scripts/embed-vcons.ts (Node) and supabase/functions/embed-vcons (Deno).
 * All functions take explicit options (no process.env / Deno.env) so callers supply credentials.
 */

export type EmbeddingProvider = "supabase" | "litellm" | "openai" | "azure" | "hf";

const EMBEDDING_MODEL = "text-embedding-3-small";
const DIMENSIONS = 384;

// gte-small is natively 384-dimensional, which is what vcon_embeddings.embedding
// is sized for. The OpenAI-family providers above only reach 384 by asking for
// truncation, so their vectors are NOT interchangeable with these ones.
const SUPABASE_MODEL = "Supabase/gte-small";

export interface LiteLLMOptions {
  baseUrl: string;
  apiKey: string;
}

export interface OpenAIOptions {
  apiKey: string;
}

export interface AzureOpenAIOptions {
  endpoint: string;
  apiKey: string;
  apiVersion?: string;
}

export interface HFOptions {
  apiToken: string;
}

/**
 * Generate embeddings with the Edge Runtime's built-in gte-small model.
 *
 * No API key, no network egress, no per-token cost. Only works inside the
 * Supabase Edge Runtime — `Supabase.ai` does not exist under Node, so the Node
 * callers of this module must pick a different provider.
 *
 * gte-small is English-only and truncates input at 512 tokens.
 */
export async function embedSupabase(texts: string[]): Promise<number[][]> {
  const ai = (globalThis as { Supabase?: { ai?: { Session: new (m: string) => { run(input: string, opts: Record<string, boolean>): Promise<unknown> } } } }).Supabase?.ai;
  if (!ai) {
    throw new Error("Supabase.ai is only available in the Supabase Edge Runtime; use another provider under Node");
  }
  const session = new ai.Session("gte-small");
  const out: number[][] = [];
  for (const text of texts) {
    const vector = await session.run(text, { mean_pool: true, normalize: true });
    if (!Array.isArray(vector) || vector.length !== DIMENSIONS) {
      throw new Error(`gte-small returned ${Array.isArray(vector) ? vector.length : typeof vector}, expected ${DIMENSIONS} dimensions`);
    }
    out.push(vector as number[]);
  }
  return out;
}

/**
 * Generate embeddings via LiteLLM proxy (OpenAI-compatible /v1/embeddings)
 */
export async function embedLiteLLM(texts: string[], options: LiteLLMOptions): Promise<number[][]> {
  const { baseUrl, apiKey } = options;
  const normalized = baseUrl.trim().replace(/\/$/, "");
  if (!normalized || !apiKey) {
    throw new Error("LITELLM_PROXY_URL and LITELLM_MASTER_KEY (or LITELLM_API_KEY) are required");
  }
  const url = normalized.startsWith("http") ? `${normalized}/v1/embeddings` : `https://${normalized}/v1/embeddings`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: DIMENSIONS }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LiteLLM embeddings failed: ${resp.status} ${text}`);
  }
  const json = await resp.json();
  return json.data.map((d: { embedding: number[] }) => d.embedding);
}

/**
 * Generate embeddings using OpenAI API
 */
export async function embedOpenAI(texts: string[], options: OpenAIOptions): Promise<number[][]> {
  const { apiKey } = options;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: DIMENSIONS }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI embeddings failed: ${resp.status} ${text}`);
  }
  const json = await resp.json();
  return json.data.map((d: { embedding: number[] }) => d.embedding);
}

/**
 * Generate embeddings using Azure OpenAI API
 */
export async function embedAzureOpenAI(texts: string[], options: AzureOpenAIOptions): Promise<number[][]> {
  const { endpoint, apiKey, apiVersion = "2024-02-01" } = options;
  if (!endpoint || !apiKey) {
    throw new Error("AZURE_OPENAI_EMBEDDING_ENDPOINT and AZURE_OPENAI_EMBEDDING_API_KEY are required");
  }
  const normalized = endpoint.replace(/\/$/, "");
  const url = `${normalized}/openai/deployments/${EMBEDDING_MODEL}/embeddings?api-version=${apiVersion}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({ input: texts, dimensions: DIMENSIONS }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Azure OpenAI embeddings failed: ${resp.status} ${text}`);
  }
  const json = await resp.json();
  return json.data.map((d: { embedding: number[] }) => d.embedding);
}

const HF_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const HF_URL = "https://api-inference.huggingface.co/pipeline/feature-extraction/" + HF_MODEL;

/**
 * Generate embeddings using Hugging Face Inference API (one request per text)
 */
export async function embedHF(texts: string[], options: HFOptions): Promise<number[][]> {
  const { apiToken } = options;
  if (!apiToken) throw new Error("HF_API_TOKEN not set");
  const result: number[][] = [];
  for (const text of texts) {
    const resp = await fetch(HF_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
    });
    if (!resp.ok) {
      const textErr = await resp.text();
      throw new Error(`HF embeddings failed: ${resp.status} ${textErr}`);
    }
    const json = await resp.json();
    const vec = Array.isArray(json[0]) ? json[0] : json;
    result.push(vec as number[]);
  }
  return result;
}

/**
 * Model name for storage (embedding_model column)
 */
export function getModelName(provider: EmbeddingProvider): string {
  switch (provider) {
    case "supabase":
      return SUPABASE_MODEL;
    case "litellm":
    case "openai":
    case "azure":
      return EMBEDDING_MODEL;
    case "hf":
      return HF_MODEL;
  }
}
