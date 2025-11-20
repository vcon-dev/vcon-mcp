#!/usr/bin/env tsx

/**
 * vCon Embeddings Generator
 * 
 * Generates 384-dimensional embeddings for vCon content using OpenAI or Hugging Face.
 * This script processes vCon subjects, dialog entries, and analysis text to create
 * semantic search vectors stored in the vcon_embeddings table.
 * 
 * Features:
 * - Automatic detection of missing embeddings
 * - Token-aware batching for OpenAI API
 * - Support for both OpenAI and Hugging Face providers
 * - Backfill mode for batch processing
 * - Single vCon mode for targeted embedding
 * - Rate limit friendly with configurable batch sizes
 * 
 * Usage:
 *   npx tsx scripts/embed-vcons.ts [options]
 * 
 * Options:
 *   --mode=MODE          Mode: 'backfill' (default) or 'embed'
 *   --vcon-id=UUID       Specific vCon UUID to embed (required for embed mode)
 *   --limit=N            Max text units to process (default: 100, max: 500)
 *   --provider=PROVIDER  Embedding provider: 'openai' or 'hf' (auto-detected from env)
 * 
 * Environment Variables:
 *   SUPABASE_URL              Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY Service role key for admin operations
 *   OPENAI_API_KEY            OpenAI API key (for text-embedding-3-small)
 *   HF_API_TOKEN              Hugging Face API token (for sentence-transformers)
 * 
 * Examples:
 *   # Backfill all missing embeddings (default 100 units)
 *   npx tsx scripts/embed-vcons.ts
 * 
 *   # Backfill with larger batch
 *   npx tsx scripts/embed-vcons.ts --limit=500
 * 
 *   # Embed specific vCon
 *   npx tsx scripts/embed-vcons.ts --mode=embed --vcon-id=abc123...
 * 
 *   # Force Hugging Face provider
 *   npx tsx scripts/embed-vcons.ts --provider=hf
 * 
 * @author vCon MCP Team
 * @version 1.0.0
 * @since 2024-11-20
 */

import dotenv from 'dotenv';
import { getSupabaseClient } from '../dist/db/client.js';

// Load environment variables
dotenv.config();

type EmbeddingProvider = 'openai' | 'hf';

interface TextUnit {
  vcon_id: string;
  content_type: 'subject' | 'dialog' | 'analysis';
  content_reference: string | null;
  content_text: string;
}

interface EmbeddingStats {
  embedded: number;
  skipped: number;
  errors: number;
}

/**
 * Parse command line arguments
 */
function parseArgs(): {
  mode: 'backfill' | 'embed';
  vconId?: string;
  limit: number;
  provider?: EmbeddingProvider;
} {
  const args = process.argv.slice(2);
  let mode: 'backfill' | 'embed' = 'backfill';
  let vconId: string | undefined;
  let limit = 100;
  let provider: EmbeddingProvider | undefined;

  for (const arg of args) {
    if (arg.startsWith('--mode=')) {
      const value = arg.split('=')[1];
      if (value === 'backfill' || value === 'embed') {
        mode = value;
      }
    } else if (arg.startsWith('--vcon-id=')) {
      vconId = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      limit = Math.max(1, Math.min(500, parseInt(arg.split('=')[1], 10)));
    } else if (arg.startsWith('--provider=')) {
      const value = arg.split('=')[1] as EmbeddingProvider;
      if (value === 'openai' || value === 'hf') {
        provider = value;
      }
    }
  }

  return { mode, vconId, limit, provider };
}

/**
 * Detect embedding provider from environment variables
 */
function detectProvider(preferredProvider?: EmbeddingProvider): EmbeddingProvider {
  if (preferredProvider) {
    return preferredProvider;
  }
  return process.env.OPENAI_API_KEY ? 'openai' : 'hf';
}

/**
 * List text units that need embeddings
 */
async function listMissingTextUnits(
  supabase: any,
  limit: number,
  vconId?: string
): Promise<TextUnit[]> {
  const textUnits: TextUnit[] = [];

  // Query for missing subject embeddings
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
      ${vconId ? "AND v.id = '" + vconId + "'" : ''}
    LIMIT ${limit}
  `;

  // Query for missing dialog embeddings
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
      ${vconId ? "AND d.vcon_id = '" + vconId + "'" : ''}
    LIMIT ${limit}
  `;

  // Query for missing analysis embeddings (prioritize encoding='none')
  const analysisSql = `
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
      ${vconId ? "AND a.vcon_id = '" + vconId + "'" : ''}
    ORDER BY 
      CASE WHEN a.encoding = 'none' THEN 0 ELSE 1 END,
      a.vcon_id
    LIMIT ${limit}
  `;

  // Execute queries using exec_sql RPC
  try {
    const { data: subjects, error: errSub } = await supabase.rpc('exec_sql', {
      q: subjectSql,
      params: {}
    });
    if (!errSub && Array.isArray(subjects)) {
      textUnits.push(...subjects);
    }

    const { data: dialogs, error: errDlg } = await supabase.rpc('exec_sql', {
      q: dialogSql,
      params: {}
    });
    if (!errDlg && Array.isArray(dialogs)) {
      textUnits.push(...dialogs);
    }

    const { data: analyses, error: errAna } = await supabase.rpc('exec_sql', {
      q: analysisSql,
      params: {}
    });
    if (!errAna && Array.isArray(analyses)) {
      textUnits.push(...analyses);
    }
  } catch (error) {
    console.error('Error querying for missing text units:', error);
    throw error;
  }

  return textUnits.slice(0, limit);
}

/**
 * Estimate token count (roughly 1 token per 4 characters for English)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within token limit
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars) + '...';
}

/**
 * Generate embeddings using OpenAI API
 */
async function embedOpenAI(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts,
      dimensions: 384
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI embeddings failed: ${response.status} ${errorText}`);
  }

  const json = await response.json();
  return json.data.map((d: any) => d.embedding as number[]);
}

/**
 * Generate embeddings using Hugging Face API
 */
async function embedHF(texts: string[]): Promise<number[][]> {
  const apiToken = process.env.HF_API_TOKEN;
  if (!apiToken) {
    throw new Error('HF_API_TOKEN not set');
  }

  const result: number[][] = [];
  
  for (const text of texts) {
    const response = await fetch(
      'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: text,
          options: { wait_for_model: true }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HF embeddings failed: ${response.status} ${errorText}`);
    }

    const json = await response.json();
    const vec = Array.isArray(json[0]) ? json[0] : json;
    result.push(vec as number[]);
  }

  return result;
}

/**
 * Upsert embeddings into the database
 */
async function upsertEmbeddings(
  supabase: any,
  units: TextUnit[],
  vectors: number[][],
  provider: EmbeddingProvider
): Promise<void> {
  const rows = units.map((u, i) => ({
    vcon_id: u.vcon_id,
    content_type: u.content_type,
    content_reference: u.content_reference,
    content_text: u.content_text,
    embedding: vectors[i],
    embedding_model:
      provider === 'openai' ? 'text-embedding-3-small' : 'sentence-transformers/all-MiniLM-L6-v2',
    embedding_dimension: 384
  }));

  const { error } = await supabase.from('vcon_embeddings').upsert(rows, {
    onConflict: 'vcon_id,content_type,content_reference'
  });

  if (error) {
    throw error;
  }
}

/**
 * Process embeddings with token-aware batching for OpenAI
 */
async function processEmbeddings(
  supabase: any,
  units: TextUnit[],
  provider: EmbeddingProvider
): Promise<EmbeddingStats> {
  const stats: EmbeddingStats = {
    embedded: 0,
    skipped: 0,
    errors: 0
  };

  if (units.length === 0) {
    return stats;
  }

  const MAX_TOKENS_PER_BATCH = 250000;
  const MAX_TOKENS_PER_ITEM = 8000;

  if (provider === 'openai') {
    // Group units into token-aware batches
    const batches: TextUnit[][] = [];
    let currentBatch: TextUnit[] = [];
    let currentTokens = 0;

    for (const unit of units) {
      const truncated = truncateToTokens(unit.content_text, MAX_TOKENS_PER_ITEM);
      const tokens = estimateTokens(truncated);

      if (currentBatch.length > 0 && currentTokens + tokens > MAX_TOKENS_PER_BATCH) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }

      currentBatch.push({ ...unit, content_text: truncated });
      currentTokens += tokens;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        console.log(`  Processing batch ${i + 1}/${batches.length} (${batch.length} items)...`);
        const texts = batch.map((u) => u.content_text);
        const vectors = await embedOpenAI(texts);
        await upsertEmbeddings(supabase, batch, vectors, provider);
        stats.embedded += batch.length;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`  Batch ${i + 1} failed: ${errorMsg}`);
        stats.errors += batch.length;
      }
    }
  } else {
    // HF processes one at a time
    try {
      console.log(`  Processing ${units.length} items with Hugging Face...`);
      const texts = units.map((u) => u.content_text);
      const vectors = await embedHF(texts);
      await upsertEmbeddings(supabase, units, vectors, provider);
      stats.embedded = units.length;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  Processing failed: ${errorMsg}`);
      stats.errors = units.length;
    }
  }

  return stats;
}

/**
 * Main function
 */
async function main() {
  console.log('\n🔮 vCon Embeddings Generator\n');
  console.log('='.repeat(60));

  // Parse arguments
  const { mode, vconId, limit, provider: preferredProvider } = parseArgs();
  const provider = detectProvider(preferredProvider);

  // Validate environment
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing required environment variables:');
    console.error('   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set (required for OpenAI provider)');
    console.error('   Set OPENAI_API_KEY or use --provider=hf for Hugging Face');
    process.exit(1);
  }

  if (provider === 'hf' && !process.env.HF_API_TOKEN) {
    console.error('❌ HF_API_TOKEN not set (required for Hugging Face provider)');
    console.error('   Set HF_API_TOKEN or use --provider=openai for OpenAI');
    process.exit(1);
  }

  if (mode === 'embed' && !vconId) {
    console.error('❌ --vcon-id required for embed mode');
    process.exit(1);
  }

  // Display configuration
  console.log('Configuration:');
  console.log(`  Mode:          ${mode}`);
  console.log(`  Provider:      ${provider === 'openai' ? 'OpenAI (text-embedding-3-small)' : 'Hugging Face (all-MiniLM-L6-v2)'}`);
  console.log(`  Limit:         ${limit}`);
  if (vconId) {
    console.log(`  vCon ID:       ${vconId}`);
  }
  console.log(`  Database:      ${supabaseUrl}`);
  console.log('='.repeat(60));
  console.log();

  try {
    // Initialize Supabase client
    const supabase = getSupabaseClient();

    // Find text units needing embeddings
    console.log('🔍 Finding text units needing embeddings...');
    const units = await listMissingTextUnits(supabase, limit, mode === 'embed' ? vconId : undefined);

    if (units.length === 0) {
      console.log('✅ No text units need embeddings. All caught up!');
      return;
    }

    console.log(`📝 Found ${units.length} text units to embed:`);
    const subjectCount = units.filter(u => u.content_type === 'subject').length;
    const dialogCount = units.filter(u => u.content_type === 'dialog').length;
    const analysisCount = units.filter(u => u.content_type === 'analysis').length;
    console.log(`   - ${subjectCount} subjects`);
    console.log(`   - ${dialogCount} dialogs`);
    console.log(`   - ${analysisCount} analyses`);
    console.log();

    // Process embeddings
    console.log('🚀 Generating embeddings...');
    const stats = await processEmbeddings(supabase, units, provider);

    // Display results
    console.log();
    console.log('='.repeat(60));
    console.log('📊 RESULTS');
    console.log('='.repeat(60));
    console.log(`✅ Embedded:  ${stats.embedded}`);
    console.log(`⏭️  Skipped:   ${stats.skipped}`);
    console.log(`❌ Errors:    ${stats.errors}`);
    console.log('='.repeat(60));

    if (stats.errors > 0) {
      console.log('\n⚠️  Some embeddings failed. Review errors above.');
      process.exit(1);
    }

    console.log('\n✅ Embedding generation complete!\n');
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);

