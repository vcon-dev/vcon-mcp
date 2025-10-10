// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type EmbeddingProvider = "openai" | "hf";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const HF_API_TOKEN = Deno.env.get("HF_API_TOKEN");

const PROVIDER: EmbeddingProvider = OPENAI_API_KEY
  ? "openai"
  : HF_API_TOKEN
    ? "hf"
    : "openai";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

interface TextUnit {
  vcon_id: string;
  content_type: "subject" | "dialog" | "analysis";
  content_reference: string | null;
  content_text: string;
}

async function listMissingTextUnits(limit: number, vconId?: string): Promise<TextUnit[]> {
  // Gather subject
  const subjectSql = `
    SELECT v.id as vcon_id,
           'subject'::text as content_type,
           NULL::text as content_reference,
           v.subject as content_text
    FROM vcons v
    LEFT JOIN vcon_embeddings e
      ON e.vcon_id = v.id AND e.content_type = 'subject' AND e.content_reference IS NULL
    WHERE v.subject IS NOT NULL AND v.subject <> ''
      AND e.id IS NULL
      ${vconId ? "AND v.id = :vcon_id" : ""}
    LIMIT :limit
  `;

  // Gather dialog bodies
  const dialogSql = `
    SELECT d.vcon_id,
           'dialog'::text as content_type,
           d.dialog_index::text as content_reference,
           d.body as content_text
    FROM dialog d
    LEFT JOIN vcon_embeddings e
      ON e.vcon_id = d.vcon_id AND e.content_type = 'dialog' AND e.content_reference = d.dialog_index::text
    WHERE d.body IS NOT NULL AND d.body <> ''
      AND e.id IS NULL
      ${vconId ? "AND d.vcon_id = :vcon_id" : ""}
    LIMIT :limit
  `;

  // Gather analysis bodies
  const analysisSql = `
    SELECT a.vcon_id,
           'analysis'::text as content_type,
           a.analysis_index::text as content_reference,
           a.body as content_text
    FROM analysis a
    LEFT JOIN vcon_embeddings e
      ON e.vcon_id = a.vcon_id AND e.content_type = 'analysis' AND e.content_reference = a.analysis_index::text
    WHERE a.body IS NOT NULL AND a.body <> ''
      AND e.id IS NULL
      ${vconId ? "AND a.vcon_id = :vcon_id" : ""}
    LIMIT :limit
  `;

  const textUnits: TextUnit[] = [];

  // Run SQL via rpc or query
  const { data: subjects, error: errSub } = await supabase.rpc("exec_sql", {
    q: subjectSql,
    params: { vcon_id: vconId ?? null, limit }
  });
  if (!errSub && Array.isArray(subjects)) textUnits.push(...subjects);

  const { data: dialogs, error: errDlg } = await supabase.rpc("exec_sql", {
    q: dialogSql,
    params: { vcon_id: vconId ?? null, limit }
  });
  if (!errDlg && Array.isArray(dialogs)) textUnits.push(...dialogs);

  const { data: analyses, error: errAna } = await supabase.rpc("exec_sql", {
    q: analysisSql,
    params: { vcon_id: vconId ?? null, limit }
  });
  if (!errAna && Array.isArray(analyses)) textUnits.push(...analyses);

  return textUnits.slice(0, limit);
}

async function embedOpenAI(texts: string[]): Promise<number[][]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 384 })
  });
  if (!resp.ok) throw new Error(`OpenAI embeddings failed: ${resp.status} ${await resp.text()}`);
  const json = await resp.json();
  return json.data.map((d: any) => d.embedding as number[]);
}

async function embedHF(texts: string[]): Promise<number[][]> {
  // Hugging Face Inference API batched: one by one fallback for simplicity
  const result: number[][] = [];
  for (const t of texts) {
    const resp = await fetch(
      "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ inputs: t, options: { wait_for_model: true } })
      }
    );
    if (!resp.ok) throw new Error(`HF embeddings failed: ${resp.status} ${await resp.text()}`);
    const json = await resp.json();
    // Response is nested array [1 x 384] → flatten
    const vec = Array.isArray(json[0]) ? json[0] : json;
    result.push(vec as number[]);
  }
  return result;
}

async function upsertEmbeddings(units: TextUnit[], vectors: number[][]) {
  const rows = units.map((u, i) => ({
    vcon_id: u.vcon_id,
    content_type: u.content_type,
    content_reference: u.content_reference,
    content_text: u.content_text,
    embedding: vectors[i],
    embedding_model:
      PROVIDER === "openai" ? "text-embedding-3-small" : "sentence-transformers/all-MiniLM-L6-v2",
    embedding_dimension: 384
  }));

  const { error } = await supabase.from("vcon_embeddings").upsert(rows, {
    onConflict: "vcon_id,content_type,content_reference"
  });
  if (error) throw error;
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") ?? "backfill"; // backfill | embed
    const vconId = url.searchParams.get("vcon_id") ?? undefined;
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? "100")));

    if (PROVIDER === "openai" && !OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY missing" }), { status: 400 });
    }
    if (PROVIDER === "hf" && !HF_API_TOKEN) {
      return new Response(JSON.stringify({ error: "HF_API_TOKEN missing" }), { status: 400 });
    }

    const units = await listMissingTextUnits(limit, mode === "embed" ? vconId : undefined);
    if (units.length === 0) {
      return new Response(JSON.stringify({ embedded: 0, skipped: 0, errors: 0 }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const texts = units.map((u) => u.content_text);
    const vectors = PROVIDER === "openai" ? await embedOpenAI(texts) : await embedHF(texts);
    await upsertEmbeddings(units, vectors);

    return new Response(
      JSON.stringify({ embedded: units.length, skipped: 0, errors: 0 }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});


