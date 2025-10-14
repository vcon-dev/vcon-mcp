#!/usr/bin/env tsx
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const openaiKey = process.env.OPENAI_API_KEY;

if (!openaiKey) {
  console.error('❌ OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface TextUnit {
  vcon_id: string;
  content_type: 'subject' | 'dialog' | 'analysis';
  content_reference: string | null;
  content_text: string;
}

async function embedOpenAI(texts: string[]): Promise<number[][]> {
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts,
      dimensions: 384,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI API error: ${resp.status} ${text}`);
  }

  const json = await resp.json();
  return json.data.map((d: any) => d.embedding as number[]);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars) + '...';
}

async function findMissingTextUnits(limit: number): Promise<TextUnit[]> {
  const textUnits: TextUnit[] = [];

  // Find missing subject embeddings using a LEFT JOIN
  const { data: missingSubjects, error: subError } = await supabase.rpc('exec_sql', {
    q: `
      SELECT v.id as vcon_id,
             'subject'::text as content_type,
             NULL::text as content_reference,
             v.subject as content_text
      FROM vcons v
      LEFT JOIN vcon_embeddings e
        ON e.vcon_id = v.id AND e.content_type = 'subject' AND e.content_reference IS NULL
      WHERE v.subject IS NOT NULL AND v.subject <> ''
        AND e.id IS NULL
      LIMIT :limit
    `,
    params: { limit }
  });

  if (missingSubjects && Array.isArray(missingSubjects)) {
    textUnits.push(...missingSubjects);
  }

  if (textUnits.length < limit) {
    // Find missing dialog embeddings
    const { data: missingDialogs } = await supabase.rpc('exec_sql', {
      q: `
        SELECT d.vcon_id,
               'dialog'::text as content_type,
               d.dialog_index::text as content_reference,
               d.body as content_text
        FROM dialog d
        LEFT JOIN vcon_embeddings e
          ON e.vcon_id = d.vcon_id AND e.content_type = 'dialog' AND e.content_reference = d.dialog_index::text
        WHERE d.body IS NOT NULL AND d.body <> ''
          AND e.id IS NULL
        LIMIT :limit
      `,
      params: { limit: limit - textUnits.length }
    });

    if (missingDialogs && Array.isArray(missingDialogs)) {
      textUnits.push(...missingDialogs);
    }
  }

  if (textUnits.length < limit) {
    // Find missing analysis embeddings - prioritize encoding='none' which contains text-based analysis
    const { data: missingAnalyses } = await supabase.rpc('exec_sql', {
      q: `
        SELECT a.vcon_id,
               'analysis'::text as content_type,
               a.analysis_index::text as content_reference,
               a.body as content_text
        FROM analysis a
        LEFT JOIN vcon_embeddings e
          ON e.vcon_id = a.vcon_id AND e.content_type = 'analysis' AND e.content_reference = a.analysis_index::text
        WHERE a.body IS NOT NULL AND a.body <> ''
          AND (a.encoding = 'none' OR a.encoding IS NULL)
          AND e.id IS NULL
        ORDER BY 
          CASE WHEN a.encoding = 'none' THEN 0 ELSE 1 END,
          a.vcon_id
        LIMIT :limit
      `,
      params: { limit: limit - textUnits.length }
    });

    if (missingAnalyses && Array.isArray(missingAnalyses)) {
      textUnits.push(...missingAnalyses);
    }
  }

  return textUnits;
}

async function upsertEmbeddings(units: TextUnit[], vectors: number[][]) {
  const rows = units.map((u, i) => ({
    vcon_id: u.vcon_id,
    content_type: u.content_type,
    content_reference: u.content_reference,
    content_text: u.content_text,
    embedding: `[${vectors[i].join(',')}]`,
    embedding_model: 'text-embedding-3-small',
    embedding_dimension: 384,
  }));

  const { error } = await supabase
    .from('vcon_embeddings')
    .upsert(rows, {
      onConflict: 'vcon_id,content_type,content_reference',
    });

  if (error) throw error;
}

async function generateEmbeddings(batchSize: number = 100, delaySeconds: number = 2) {
  console.log('🚀 Starting embedding generation...');
  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Delay between batches: ${delaySeconds}s`);
  console.log('');

  let totalEmbedded = 0;
  let totalErrors = 0;
  let batchCount = 0;
  const MAX_CHARS_PER_ITEM = 12000; // ~3000 tokens, leaving room for overhead

  while (true) {
    batchCount++;
    console.log(`📦 Batch ${batchCount}: Finding up to ${batchSize} missing embeddings...`);

    const units = await findMissingTextUnits(batchSize);

    if (units.length === 0) {
      console.log('');
      console.log('🎉 All embeddings generated!');
      console.log(`   Total text units embedded: ${totalEmbedded}`);
      console.log(`   Total errors: ${totalErrors}`);
      console.log(`   Batches processed: ${batchCount}`);
      break;
    }

    console.log(`   Found ${units.length} text units to embed`);

    // Process items in smaller batches to avoid token limits
    const ITEMS_PER_API_CALL = 20;
    let batchEmbedded = 0;
    let batchErrors = 0;

    for (let i = 0; i < units.length; i += ITEMS_PER_API_CALL) {
      const chunk = units.slice(i, i + ITEMS_PER_API_CALL);
      
      try {
        // Truncate texts to fit within limits
        const truncatedChunk = chunk.map(u => ({
          ...u,
          content_text: truncateText(u.content_text, MAX_CHARS_PER_ITEM)
        }));
        
        const texts = truncatedChunk.map((u) => u.content_text);
        const vectors = await embedOpenAI(texts);
        await upsertEmbeddings(truncatedChunk, vectors);
        batchEmbedded += chunk.length;
      } catch (error: any) {
        console.error(`   ❌ Chunk failed (${chunk.length} items):`, error.message.substring(0, 150));
        
        // Try individual items if batch fails
        for (const unit of chunk) {
          try {
            const truncated = truncateText(unit.content_text, MAX_CHARS_PER_ITEM);
            const vectors = await embedOpenAI([truncated]);
            await upsertEmbeddings([{ ...unit, content_text: truncated }], vectors);
            batchEmbedded++;
          } catch (itemError: any) {
            console.error(`   ❌ Item failed (${unit.content_type}/${unit.content_reference}):`, itemError.message.substring(0, 100));
            batchErrors++;
          }
        }
      }
    }

    totalEmbedded += batchEmbedded;
    totalErrors += batchErrors;
    
    console.log(`   ✅ Embedded: ${batchEmbedded}`);
    if (batchErrors > 0) {
      console.log(`   ⚠️  Errors: ${batchErrors}`);
    }
    console.log(`   📊 Total embedded so far: ${totalEmbedded}`);

    if (units.length < batchSize) {
      console.log('');
      console.log('🎉 All embeddings generated!');
      console.log(`   Total text units embedded: ${totalEmbedded}`);
      console.log(`   Total errors: ${totalErrors}`);
      console.log(`   Batches processed: ${batchCount}`);
      break;
    }

    console.log(`   ⏳ Waiting ${delaySeconds}s before next batch...`);
    console.log('');
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
  }
}

// Parse command line arguments
const batchSize = parseInt(process.argv[2]) || 100;
const delaySeconds = parseFloat(process.argv[3]) || 2;

generateEmbeddings(batchSize, delaySeconds).catch(console.error);

