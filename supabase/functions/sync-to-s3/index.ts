// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VCON_S3_BUCKET = Deno.env.get("VCON_S3_BUCKET") ?? "";
const VCON_S3_PREFIX = Deno.env.get("VCON_S3_PREFIX") ?? "";
const AWS_REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";
const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID") ?? "";
const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const HF_API_TOKEN = Deno.env.get("HF_API_TOKEN");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// AWS S3 signing utilities for Deno
// Using native fetch API to avoid Node.js filesystem dependencies

async function signS3Request(
  method: string,
  bucket: string,
  key: string,
  body: string,
  contentType: string
): Promise<Request> {
  const url = `https://${bucket}.s3.${AWS_REGION}.amazonaws.com/${key}`;
  const now = new Date();
  // AWS Signature V4 date format: YYYYMMDDTHHmmssZ
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "").replace("T", "T").replace("Z", "Z");
  const dateStamp = date.substring(0, 8); // YYYYMMDD
  
  // Calculate payload hash (required for x-amz-content-sha256 header)
  const payloadHash = await sha256(body);
  
  // Create canonical request
  const canonicalUri = `/${key}`;
  const canonicalQueryString = "";
  const canonicalHeaders = `host:${bucket}.s3.${AWS_REGION}.amazonaws.com\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${date}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  
  // Create string to sign
  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${AWS_REGION}/s3/aws4_request`;
  const stringToSign = `${algorithm}\n${date}\n${credentialScope}\n${await sha256(canonicalRequest)}`;
  
  // Calculate signature (HMAC keys must be binary, not hex)
  const kSecret = new TextEncoder().encode(`AWS4${AWS_SECRET_ACCESS_KEY}`);
  const kDate = await hmacSha256Binary(kSecret, dateStamp);
  const kRegion = await hmacSha256Binary(kDate, AWS_REGION);
  const kService = await hmacSha256Binary(kRegion, "s3");
  const kSigning = await hmacSha256Binary(kService, "aws4_request");
  const signature = await hmacSha256Hex(kSigning, stringToSign);
  
  // Create authorization header
  const authorization = `${algorithm} Credential=${AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  
  // Create request
  return new Request(url, {
    method,
    headers: {
      "Host": `${bucket}.s3.${AWS_REGION}.amazonaws.com`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": date,
      "Authorization": authorization,
      "Content-Type": contentType,
      "Content-Length": body.length.toString()
    },
    body: body
  });
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Binary(key: Uint8Array, message: string): Promise<Uint8Array> {
  const messageBuffer = new TextEncoder().encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageBuffer);
  return new Uint8Array(signature);
}

async function hmacSha256Hex(key: Uint8Array, message: string): Promise<string> {
  const signature = await hmacSha256Binary(key, message);
  return Array.from(signature)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

type EmbeddingProvider = "openai" | "hf";

const PROVIDER: EmbeddingProvider = OPENAI_API_KEY
  ? "openai"
  : HF_API_TOKEN
    ? "hf"
    : "openai";

interface TextUnit {
  vcon_id: string;
  content_type: "subject" | "dialog" | "analysis";
  content_reference: string | null;
  content_text: string;
}

interface VConData {
  vcon: any;
  parties: any[];
  dialog: any[];
  analysis: any[];
  attachments: any[];
}

// Estimate token count (roughly 1 token per 4 characters for English)
// Use more conservative estimate to be safe
function estimateTokens(text: string): number {
  // More conservative: assume 3.5 chars per token for safety
  return Math.ceil(text.length / 3.5);
}

// Truncate text to fit within token limit
// OpenAI text-embedding-3-small has a max of 8192 tokens per input
// Use very conservative limit to ensure we never exceed
function truncateToTokens(text: string, maxTokens: number = 7500): string {
  // Use conservative 3.5 chars per token estimate
  const maxChars = Math.floor(maxTokens * 3.5);
  if (text.length <= maxChars) return text;
  // Truncate and add ellipsis
  return text.substring(0, maxChars - 3) + "...";
}

// Generate embeddings for a vCon (reuse logic from embed-vcons)
async function generateEmbeddingsForVCon(vconId: string): Promise<void> {
  const limit = 1000; // Large limit to get all text units for this vCon
  
  // Gather subject
  const subjectSql = `
    SELECT v.id as vcon_id,
           'subject'::text as content_type,
           NULL::text as content_reference,
           v.subject as content_text
    FROM vcons v
    LEFT JOIN vcon_embeddings e
      ON e.vcon_id = v.id AND e.content_type = 'subject' AND e.content_reference IS NULL
    WHERE v.id = :vcon_id
      AND v.subject IS NOT NULL AND v.subject <> ''
      AND e.id IS NULL
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
    WHERE d.vcon_id = :vcon_id
      AND d.body IS NOT NULL AND d.body <> ''
      AND e.id IS NULL
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
    WHERE a.vcon_id = :vcon_id
      AND a.body IS NOT NULL AND a.body <> ''
      AND (a.encoding = 'none' OR a.encoding IS NULL)
      AND e.id IS NULL
    ORDER BY 
      CASE WHEN a.encoding = 'none' THEN 0 ELSE 1 END,
      a.vcon_id
    LIMIT :limit
  `;

  const textUnits: TextUnit[] = [];

  const { data: subjects } = await supabase.rpc("exec_sql", {
    q: subjectSql,
    params: { vcon_id: vconId, limit }
  });
  if (Array.isArray(subjects)) textUnits.push(...subjects);

  const { data: dialogs } = await supabase.rpc("exec_sql", {
    q: dialogSql,
    params: { vcon_id: vconId, limit }
  });
  if (Array.isArray(dialogs)) textUnits.push(...dialogs);

  const { data: analyses } = await supabase.rpc("exec_sql", {
    q: analysisSql,
    params: { vcon_id: vconId, limit }
  });
  if (Array.isArray(analyses)) textUnits.push(...analyses);

  if (textUnits.length === 0) {
    return; // No text units to embed
  }

  // Truncate texts to fit within token limits before generating embeddings
  // OpenAI text-embedding-3-small has max 8192 tokens per input
  // Use very conservative limit (7500) to ensure we never exceed
  const MAX_TOKENS_PER_ITEM = 7500; // Very safe limit with buffer
  const truncatedTextUnits = textUnits.map((u) => {
    const originalLength = u.content_text.length;
    const truncated = truncateToTokens(u.content_text, MAX_TOKENS_PER_ITEM);
    if (truncated.length < originalLength) {
      console.log(`Truncated ${u.content_type} text from ${originalLength} to ${truncated.length} chars`);
    }
    return {
      ...u,
      content_text: truncated
    };
  });

  // Generate embeddings
  const texts = truncatedTextUnits.map((u) => u.content_text);
  let vectors: number[][];

  if (PROVIDER === "openai") {
    // Process each text individually to ensure we never exceed per-item limits
    // OpenAI processes each item in the array separately, but each must be < 8192 tokens
    vectors = [];
    
    for (let i = 0; i < truncatedTextUnits.length; i++) {
      const unit = truncatedTextUnits[i];
      const text = unit.content_text;
      const estimatedTokens = estimateTokens(text);
      
      // Double-check token count and truncate further if needed
      let finalText = text;
      if (estimatedTokens > 7500) {
        console.warn(`Text still too long after truncation: ${estimatedTokens} tokens, truncating further`);
        finalText = truncateToTokens(text, 7000);
      }
      
      try {
        // Send one text at a time to be absolutely safe
        const resp = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({ 
            model: "text-embedding-3-small", 
            input: [finalText], // Single item array
            dimensions: 384 
          })
        });
        
        if (!resp.ok) {
          const errorText = await resp.text();
          // If still too long, skip this item and log
          if (resp.status === 400 && errorText.includes("maximum context length")) {
            console.error(`Skipping ${unit.content_type} (${unit.content_reference || 'subject'}) - too long even after truncation`);
            // Push null to maintain index alignment, we'll filter later
            vectors.push(null as any);
            continue;
          }
          throw new Error(`OpenAI embeddings failed: ${resp.status} ${errorText}`);
        }
        
        const json = await resp.json();
        if (json.data && json.data.length > 0) {
          vectors.push(json.data[0].embedding as number[]);
        } else {
          console.error(`No embedding returned for ${unit.content_type}`);
          vectors.push(null as any);
        }
      } catch (error) {
        console.error(`Failed to embed ${unit.content_type} (${unit.content_reference || 'subject'}): ${error}`);
        // Push null to maintain alignment, we'll filter later
        vectors.push(null as any);
      }
    }
    
    // Filter out nulls and corresponding text units
    const validIndices: number[] = [];
    const validVectors: number[][] = [];
    for (let i = 0; i < vectors.length; i++) {
      if (vectors[i] !== null) {
        validIndices.push(i);
        validVectors.push(vectors[i]);
      }
    }
    
    // Update truncatedTextUnits to only include successfully embedded items
    const successfullyEmbedded = validIndices.map(idx => truncatedTextUnits[idx]);
    truncatedTextUnits.length = 0;
    truncatedTextUnits.push(...successfullyEmbedded);
    vectors = validVectors;
  } else {
    // Hugging Face - process one by one
    vectors = [];
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
      if (!resp.ok) {
        throw new Error(`HF embeddings failed: ${resp.status} ${await resp.text()}`);
      }
      const json = await resp.json();
      const vec = Array.isArray(json[0]) ? json[0] : json;
      vectors.push(vec as number[]);
    }
  }

  // Upsert embeddings (use truncatedTextUnits to match vector indices)
  const rows = truncatedTextUnits.map((u, i) => ({
    vcon_id: u.vcon_id,
    content_type: u.content_type,
    content_reference: u.content_reference,
    content_text: u.content_text, // Store truncated version
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

// Fetch full vCon data
async function getVConData(vconUuid: string): Promise<VConData | null> {
  // Get main vcon
  const { data: vconData, error: vconError } = await supabase
    .from("vcons")
    .select("*")
    .eq("uuid", vconUuid)
    .single();

  if (vconError || !vconData) return null;

  // Get parties
  const { data: parties } = await supabase
    .from("parties")
    .select("*")
    .eq("vcon_id", vconData.id)
    .order("party_index");

  // Get dialog
  const { data: dialog } = await supabase
    .from("dialog")
    .select("*")
    .eq("vcon_id", vconData.id)
    .order("dialog_index");

  // Get analysis
  const { data: analysis } = await supabase
    .from("analysis")
    .select("*")
    .eq("vcon_id", vconData.id)
    .order("analysis_index");

  // Get attachments
  const { data: attachments } = await supabase
    .from("attachments")
    .select("*")
    .eq("vcon_id", vconData.id)
    .order("attachment_index");

  return {
    vcon: vconData,
    parties: parties || [],
    dialog: dialog || [],
    analysis: analysis || [],
    attachments: attachments || []
  };
}

// Build S3 key from vCon UUID and date
function buildS3Key(vconUuid: string, createdAt: string): string {
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const prefix = VCON_S3_PREFIX ? `${VCON_S3_PREFIX}/` : "";
  return `${prefix}${year}/${month}/${vconUuid}.vcon.json`;
}

// Upload vCon to S3 using native fetch API
async function uploadToS3(
  key: string,
  content: string,
  retries: number = 3
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const request = await signS3Request(
        "PUT",
        VCON_S3_BUCKET,
        key,
        content,
        "application/json"
      );
      
      const response = await fetch(request);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`S3 upload failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      return;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
    }
  }
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? "50")));
    const sinceDays = url.searchParams.get("since_days") ? Number(url.searchParams.get("since_days")) : null;

    if (!VCON_S3_BUCKET) {
      return new Response(
        JSON.stringify({ error: "VCON_S3_BUCKET environment variable is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate AWS credentials are configured
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      return new Response(
        JSON.stringify({ error: "AWS credentials not configured. AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get unsynced vCons - use date-based query if since_days is provided
    let unsyncedVCons: any[] | null = null;
    let unsyncedError: any = null;

    if (sinceDays && sinceDays > 0) {
      // Backfill mode: get all vCons from the past N days (regardless of sync status)
      const { data, error } = await supabase.rpc(
        "get_vcons_since_days",
        { p_days: sinceDays }
      );
      unsyncedVCons = data;
      unsyncedError = error;
      
      // Apply limit to backfill results
      if (unsyncedVCons && unsyncedVCons.length > limit) {
        unsyncedVCons = unsyncedVCons.slice(0, limit);
      }
    } else {
      // Normal incremental sync mode
      const { data, error } = await supabase.rpc(
        "get_unsynced_vcons",
        { p_limit: limit }
      );
      unsyncedVCons = data;
      unsyncedError = error;
    }

    if (unsyncedError) {
      throw unsyncedError;
    }

    if (!unsyncedVCons || unsyncedVCons.length === 0) {
      return new Response(
        JSON.stringify({ 
          synced: 0, 
          embedded: 0, 
          errors: 0, 
          message: sinceDays ? `No vCons found from the past ${sinceDays} days` : "No vCons to sync" 
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    let synced = 0;
    let embedded = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    // Process each vCon
    for (const vconRow of unsyncedVCons) {
      try {
        const vconId = vconRow.vcon_id;
        const vconUuid = vconRow.vcon_uuid;

        // Check if embeddings are complete
        const { data: embeddingsComplete, error: checkError } = await supabase.rpc(
          "check_vcon_embeddings_complete",
          { p_vcon_id: vconId }
        );

        if (checkError) {
          throw checkError;
        }

        // Generate embeddings if needed
        if (!embeddingsComplete) {
          try {
            await generateEmbeddingsForVCon(vconId);
            embedded++;
          } catch (embedError) {
            console.error(`Failed to generate embeddings for ${vconUuid}:`, embedError);
            // Continue anyway - we'll sync without embeddings
          }
        }

        // Fetch vCon data
        const vconData = await getVConData(vconUuid);
        if (!vconData) {
          throw new Error(`Failed to fetch vCon data for ${vconUuid}`);
        }

        // Get embeddings
        const { data: embeddings, error: embeddingsError } = await supabase.rpc(
          "get_vcon_embeddings",
          { p_vcon_id: vconId }
        );

        if (embeddingsError) {
          console.warn(`Failed to fetch embeddings for ${vconUuid}:`, embeddingsError);
        }

        // Build vCon JSON with embeddings
        const vconJson: any = {
          vcon: vconData.vcon.vcon_version || "0.3.0",
          uuid: vconData.vcon.uuid,
          extensions: vconData.vcon.extensions,
          must_support: vconData.vcon.must_support,
          created_at: vconData.vcon.created_at,
          updated_at: vconData.vcon.updated_at,
          subject: vconData.vcon.subject,
          parties: vconData.parties.map((p: any) => ({
            tel: p.tel,
            sip: p.sip,
            stir: p.stir,
            mailto: p.mailto,
            name: p.name,
            did: p.did,
            uuid: p.uuid,
            validation: p.validation,
            jcard: p.jcard,
            gmlpos: p.gmlpos,
            civicaddress: p.civicaddress,
            timezone: p.timezone
          })),
          dialog: vconData.dialog.map((d: any) => ({
            type: d.type,
            start: d.start_time,
            duration: d.duration_seconds,
            parties: d.parties,
            originator: d.originator,
            mediatype: d.mediatype,
            filename: d.filename,
            body: d.body,
            encoding: d.encoding,
            url: d.url,
            content_hash: d.content_hash,
            disposition: d.disposition,
            session_id: d.session_id,
            application: d.application,
            message_id: d.message_id
          })),
          analysis: vconData.analysis.map((a: any) => ({
            type: a.type,
            body: a.body,
            encoding: a.encoding,
            schema: a.schema,
            vendor: a.vendor,
            vendor_schema: a.vendor_schema,
            url: a.url,
            content_hash: a.content_hash
          })),
          attachments: vconData.attachments.map((a: any) => ({
            type: a.type,
            encoding: a.encoding,
            url: a.url,
            content_hash: a.content_hash,
            body: a.body
          }))
        };

        // Add embeddings if available
        if (embeddings && Object.keys(embeddings).length > 0) {
          vconJson._embeddings = embeddings;
          vconJson._sync_metadata = {
            synced_at: new Date().toISOString(),
            embedding_model: PROVIDER === "openai" ? "text-embedding-3-small" : "sentence-transformers/all-MiniLM-L6-v2",
            embedding_dimension: 384
          };
        }

        // Build S3 key
        const s3Key = buildS3Key(vconUuid, vconData.vcon.created_at);

        // Upload to S3
        await uploadToS3(s3Key, JSON.stringify(vconJson, null, 2));

        // Mark as synced
        const { error: markError } = await supabase.rpc("mark_vcon_synced", {
          p_vcon_id: vconId,
          p_vcon_uuid: vconUuid,
          p_s3_key: s3Key,
          p_embedding_model: PROVIDER === "openai" ? "text-embedding-3-small" : "sentence-transformers/all-MiniLM-L6-v2",
          p_embedding_dimension: 384
        });

        if (markError) {
          throw markError;
        }

        synced++;
      } catch (error) {
        errors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        errorDetails.push(`${vconRow.vcon_uuid}: ${errorMsg}`);
        console.error(`Failed to sync vCon ${vconRow.vcon_uuid}:`, error);
      }
    }

    return new Response(
      JSON.stringify({
        synced,
        embedded,
        errors,
        total_processed: unsyncedVCons.length,
        error_details: errorDetails.slice(0, 10) // Limit error details
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

