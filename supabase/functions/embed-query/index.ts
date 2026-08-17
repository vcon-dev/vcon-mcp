/**
 * embed-query — embed a single string with the Edge Runtime's built-in gte-small.
 *
 * Exists so query-time embedding can use the SAME model as the corpus without
 * the MCP server needing an external embedding provider or any new secret. The
 * server already holds SUPABASE_URL and a service role key, so this closes the
 * loop inside the Supabase project: a dataset is self-contained and semantic
 * search works with no third-party API key anywhere.
 *
 * JWT verification is left ON. Callers present the project's service role key.
 *
 *   POST { "input": "some text" }
 *   200  { "model": "Supabase/gte-small", "dimension": 384, "embedding": [...] }
 */
import { embedSupabase } from "../_shared/embeddings.ts";

const MODEL = "Supabase/gte-small";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST required" }, { status: 405 });
  }

  let input: unknown;
  try {
    ({ input } = await req.json());
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (typeof input !== "string" || input.trim() === "") {
    return Response.json({ error: "input is required and must be a non-empty string" }, { status: 400 });
  }

  try {
    const [embedding] = await embedSupabase([input]);
    return Response.json({ model: MODEL, dimension: embedding.length, embedding });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
