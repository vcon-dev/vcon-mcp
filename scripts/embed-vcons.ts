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
 *   --limit=N            Max text units to process per batch (default: 100, max: 500)
 *   --provider=PROVIDER  Embedding provider: 'openai' or 'hf' (auto-detected from env)
 *   --continuous, -c     Run continuously until all embeddings complete
 *   --delay=N            Delay in seconds between batches in continuous mode (default: 2)
 *   --oldest-first       Process oldest vCons first (for backfilling old data)
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
 *   # Run continuously until all embeddings complete
 *   npx tsx scripts/embed-vcons.ts --continuous --limit=500
 * 
 *   # Continuous mode with custom delay
 *   npx tsx scripts/embed-vcons.ts -c --limit=500 --delay=5
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

import * as dotenv from 'dotenv';
import { getSupabaseClient } from '../dist/db/client.js';
import pLimit from 'p-limit';

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
  startTime?: number;
  endTime?: number;
  newestVconDate?: string;
  oldestVconDate?: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): {
  mode: 'backfill' | 'embed';
  vconId?: string;
  limit: number;
  provider?: EmbeddingProvider;
  continuous: boolean;
  delay: number;
  oldestFirst: boolean;
} {
  const args = process.argv.slice(2);
  let mode: 'backfill' | 'embed' = 'backfill';
  let vconId: string | undefined;
  let limit = 100;
  let provider: EmbeddingProvider | undefined;
  let continuous = false;
  let delay = 2;
  let oldestFirst = false;

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
    } else if (arg === '--continuous' || arg === '-c') {
      continuous = true;
    } else if (arg.startsWith('--delay=')) {
      delay = Math.max(0, parseInt(arg.split('=')[1], 10));
    } else if (arg === '--oldest-first') {
      oldestFirst = true;
    }
  }

  return { mode, vconId, limit, provider, continuous, delay, oldestFirst };
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
 * List text units that need embeddings using efficient RPC queries
 */
async function listMissingTextUnits(
  supabase: any,
  limit: number,
  vconId?: string,
  oldestFirst: boolean = false
): Promise<TextUnit[]> {
  const textUnits: TextUnit[] = [];

  // Build efficient SQL queries with LEFT JOIN to find missing embeddings
  const vconFilter = vconId ? `AND v.id = '${vconId}'` : '';
  const orderDirection = oldestFirst ? 'ASC' : 'DESC';

  try {
    // Use subqueries to efficiently find missing embeddings
    // Use NOT EXISTS for better performance on large datasets
    
    // Query for missing subject embeddings
    const { data: subjects, error: subError } = await supabase.rpc('exec_sql', {
      q: `
        SELECT v.id as vcon_id,
               'subject'::text as content_type,
               NULL::text as content_reference,
               v.subject as content_text,
               v.created_at
        FROM vcons v
        WHERE v.subject IS NOT NULL AND v.subject <> ''
          ${vconFilter}
          AND NOT EXISTS (
            SELECT 1 FROM vcon_embeddings e
            WHERE e.vcon_id = v.id 
              AND e.content_type = 'subject' 
              AND e.content_reference IS NULL
          )
        ORDER BY v.created_at ${orderDirection}
        LIMIT ${limit}
      `,
      params: {}
    });

    if (subError) {
      console.warn('Subject query error:', subError.message);
    } else if (subjects && Array.isArray(subjects)) {
      textUnits.push(...subjects);
    }

    // Query for missing dialog embeddings (optimized with CTE)
    if (textUnits.length < limit) {
      const { data: dialogs, error: dialogError } = await supabase.rpc('exec_sql', {
        q: `
          WITH candidate_vcons AS (
            SELECT id, created_at
            FROM vcons
            ${vconFilter ? 'WHERE ' + vconFilter.replace('AND ', '') : ''}
            ORDER BY created_at ${orderDirection}
            LIMIT ${(limit - textUnits.length) * 5}
          ),
          candidate_dialogs AS (
            SELECT d.vcon_id, d.dialog_index, d.body, cv.created_at
            FROM dialog d
            INNER JOIN candidate_vcons cv ON cv.id = d.vcon_id
            WHERE d.body IS NOT NULL AND d.body <> ''
          )
          SELECT cd.vcon_id,
                 'dialog'::text as content_type,
                 cd.dialog_index::text as content_reference,
                 cd.body as content_text,
                 cd.created_at
          FROM candidate_dialogs cd
          WHERE NOT EXISTS (
            SELECT 1 FROM vcon_embeddings e
            WHERE e.vcon_id = cd.vcon_id 
              AND e.content_type = 'dialog' 
              AND e.content_reference = cd.dialog_index::text
          )
          ORDER BY cd.created_at ${orderDirection}
          LIMIT ${limit - textUnits.length}
        `,
        params: {}
      });

      if (dialogError) {
        console.warn('Dialog query error:', dialogError.message);
      } else if (dialogs && Array.isArray(dialogs)) {
        textUnits.push(...dialogs);
      }
    }

    // Query for missing analysis embeddings
    // Use smaller limit multiplier since analysis table is very large
    if (textUnits.length < limit) {
      const { data: analyses, error: analysisError } = await supabase.rpc('exec_sql', {
        q: `
          WITH candidate_vcons_for_analysis AS (
            SELECT id, created_at
            FROM vcons
            ${vconFilter ? 'WHERE ' + vconFilter.replace('AND ', '') : ''}
            ORDER BY created_at ${orderDirection}
            LIMIT ${limit * 3}
          ),
          candidate_analyses AS (
            SELECT a.vcon_id, a.analysis_index, a.body, cv.created_at
            FROM analysis a
            INNER JOIN candidate_vcons_for_analysis cv ON cv.id = a.vcon_id
            WHERE a.body IS NOT NULL AND a.body <> ''
              AND (a.encoding = 'none' OR a.encoding IS NULL)
          )
          SELECT ca.vcon_id,
                 'analysis'::text as content_type,
                 ca.analysis_index::text as content_reference,
                 ca.body as content_text,
                 ca.created_at
          FROM candidate_analyses ca
          LEFT JOIN vcon_embeddings e
            ON e.vcon_id = ca.vcon_id AND e.content_type = 'analysis' AND e.content_reference = ca.analysis_index::text
          WHERE e.id IS NULL
          ORDER BY ca.created_at ${orderDirection}
          LIMIT ${limit - textUnits.length}
        `,
        params: {}
      });

      if (analysisError) {
        console.warn('Analysis query error:', analysisError.message);
      } else if (analyses && Array.isArray(analyses)) {
        textUnits.push(...analyses);
      }
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
 * Using conservative estimate: 1 token ≈ 3 characters for safety margin
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 3; // Conservative estimate
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars);
}

/**
 * Generate embeddings using OpenAI API
 */
async function embedOpenAI(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set');
  }

  try {
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
      let errorDetails = '';
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = JSON.stringify(errorJson, null, 2);
      } catch {
        errorDetails = errorText;
      }
      throw new Error(`OpenAI API error ${response.status}: ${errorDetails}`);
    }

    const json = await response.json();
    return json.data.map((d: any) => d.embedding as number[]);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`OpenAI embeddings failed: ${JSON.stringify(error)}`);
  }
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
 * Process embeddings with parallel batching for OpenAI
 */
async function processEmbeddings(
  supabase: any,
  units: TextUnit[],
  provider: EmbeddingProvider
): Promise<EmbeddingStats> {
  const stats: EmbeddingStats = {
    embedded: 0,
    skipped: 0,
    errors: 0,
    startTime: Date.now()
  };

  if (units.length === 0) {
    return stats;
  }

  // Track date range of vCons being processed
  const vconDates = units.map((u: any) => u.created_at).filter(Boolean);
  if (vconDates.length > 0) {
    stats.newestVconDate = vconDates[0];
    stats.oldestVconDate = vconDates[vconDates.length - 1];
  }

  const MAX_TOKENS_PER_BATCH = 250000;
  const MAX_TOKENS_PER_ITEM = 8000;
  const CONCURRENCY_LIMIT = 15; // Process 15 batches concurrently

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

    console.log(`  Split into ${batches.length} batches, processing ${CONCURRENCY_LIMIT} concurrently...`);

    // Process batches in parallel with concurrency limit
    const limit = pLimit(CONCURRENCY_LIMIT);
    let completed = 0;
    const startTime = Date.now();

    const processBatch = async (batch: TextUnit[], batchIndex: number) => {
      try {
        const texts = batch.map((u) => u.content_text);
        const vectors = await embedOpenAI(texts);
        await upsertEmbeddings(supabase, batch, vectors, provider);
        
        completed++;
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (stats.embedded + batch.length) / elapsed;
        const remaining = batches.length - completed;
        const eta = remaining > 0 ? Math.ceil(remaining / (completed / elapsed)) : 0;
        
        console.log(
          `  ✓ Batch ${completed}/${batches.length} (${batch.length} items) | ` +
          `Rate: ${rate.toFixed(1)}/s | ETA: ${eta}s`
        );
        
        stats.embedded += batch.length;
        return { success: true, count: batch.length };
      } catch (error) {
        let errorMsg = 'Unknown error';
        if (error instanceof Error) {
          errorMsg = error.message;
        } else if (typeof error === 'object' && error !== null) {
          errorMsg = JSON.stringify(error);
        } else {
          errorMsg = String(error);
        }
        console.error(`  ✗ Batch ${batchIndex + 1} failed: ${errorMsg.substring(0, 200)}`);
        stats.errors += batch.length;
        return { success: false, count: 0, error: errorMsg };
      }
    };

    // Execute all batches with concurrency control
    const results = await Promise.allSettled(
      batches.map((batch, i) => limit(() => processBatch(batch, i)))
    );

    // Handle any retry logic for failed batches with rate limit errors
    const failedIndices = results
      .map((result, i) => ({ result, index: i }))
      .filter(({ result }) => result.status === 'rejected' || 
        (result.status === 'fulfilled' && !result.value.success))
      .map(({ index }) => index);

    if (failedIndices.length > 0) {
      console.log(`\n  Retrying ${failedIndices.length} failed batches with exponential backoff...`);
      
      for (const index of failedIndices) {
        const batch = batches[index];
        let retries = 0;
        const maxRetries = 3;
        
        while (retries < maxRetries) {
          try {
            const backoffMs = Math.pow(2, retries) * 1000;
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            
            const texts = batch.map((u) => u.content_text);
            const vectors = await embedOpenAI(texts);
            await upsertEmbeddings(supabase, batch, vectors, provider);
            
            // Success - adjust stats
            stats.embedded += batch.length;
            stats.errors -= batch.length;
            console.log(`  ✓ Retry successful for batch ${index + 1}`);
            break;
          } catch (error) {
            retries++;
            if (retries >= maxRetries) {
              console.error(`  ✗ Batch ${index + 1} failed after ${maxRetries} retries`);
            }
          }
        }
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

  stats.endTime = Date.now();
  return stats;
}

/**
 * Main function
 */
async function main() {
  console.log('\n🔮 vCon Embeddings Generator\n');
  console.log('='.repeat(60));

  // Parse arguments
  const { mode, vconId, limit, provider: preferredProvider, continuous, delay, oldestFirst } = parseArgs();
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
  console.log(`  Mode:          ${continuous ? 'continuous' : mode}`);
  console.log(`  Provider:      ${provider === 'openai' ? 'OpenAI (text-embedding-3-small)' : 'Hugging Face (all-MiniLM-L6-v2)'}`);
  console.log(`  Batch Limit:   ${limit}`);
  console.log(`  Order:         ${oldestFirst ? 'oldest-first' : 'newest-first'}`);
  if (continuous) {
    console.log(`  Delay:         ${delay}s between batches`);
  }
  if (vconId) {
    console.log(`  vCon ID:       ${vconId}`);
  }
  console.log(`  Database:      ${supabaseUrl}`);
  console.log('='.repeat(60));
  console.log();

  try {
    // Initialize Supabase client
    const supabase = getSupabaseClient();

    // Continuous mode: loop until no more embeddings
    if (continuous) {
      let batchNumber = 0;
      let totalEmbedded = 0;
      let totalErrors = 0;
      const overallStartTime = Date.now();

      console.log('🔄 Running in continuous mode (Ctrl+C to stop)\n');

      while (true) {
        batchNumber++;
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📦 BATCH ${batchNumber}`);
        console.log('='.repeat(60));

        // Find text units needing embeddings
        console.log('🔍 Finding text units needing embeddings...');
        const units = await listMissingTextUnits(supabase, limit, mode === 'embed' ? vconId : undefined, oldestFirst);

        if (units.length === 0) {
          console.log('✅ No more text units need embeddings. All caught up!');
          break;
        }

        console.log(`📝 Found ${units.length} text units to embed:`);
        const subjectCount = units.filter(u => u.content_type === 'subject').length;
        const dialogCount = units.filter(u => u.content_type === 'dialog').length;
        const analysisCount = units.filter(u => u.content_type === 'analysis').length;
        console.log(`   - ${subjectCount} subjects`);
        console.log(`   - ${dialogCount} dialogs`);
        console.log(`   - ${analysisCount} analyses`);
        
        // Show date range of vCons being processed
        const vconDates = units.map((u: any) => u.created_at).filter(Boolean);
        if (vconDates.length > 0) {
          console.log(`\n📅 vCon Date Range:`);
          console.log(`   Newest: ${new Date(vconDates[0]).toLocaleString()}`);
          console.log(`   Oldest: ${new Date(vconDates[vconDates.length - 1]).toLocaleString()}`);
        }
        console.log();

        // Process embeddings
        console.log('🚀 Generating embeddings with parallel processing...');
        const stats = await processEmbeddings(supabase, units, provider);

        totalEmbedded += stats.embedded;
        totalErrors += stats.errors;

        // Display batch results
        console.log();
        console.log('📊 Batch Results:');
        console.log(`   Embedded: ${stats.embedded}`);
        console.log(`   Errors:   ${stats.errors}`);
        
        if (stats.startTime && stats.endTime) {
          const durationSec = (stats.endTime - stats.startTime) / 1000;
          const rate = stats.embedded / durationSec;
          console.log(`   Duration: ${durationSec.toFixed(1)}s`);
          console.log(`   Rate:     ${rate.toFixed(1)} items/sec`);
        }

        // Display cumulative stats
        const overallDurationSec = (Date.now() - overallStartTime) / 1000;
        const overallRate = totalEmbedded / overallDurationSec;
        console.log(`\n📈 Cumulative Stats:`);
        console.log(`   Batches:       ${batchNumber}`);
        console.log(`   Total Embedded: ${totalEmbedded}`);
        console.log(`   Total Errors:   ${totalErrors}`);
        console.log(`   Overall Rate:   ${overallRate.toFixed(1)} items/sec`);
        console.log(`   Runtime:        ${Math.floor(overallDurationSec / 60)}m ${Math.floor(overallDurationSec % 60)}s`);

        if (stats.errors > 0) {
          console.log('\n⚠️  Some embeddings failed in this batch.');
        }

        // Delay before next batch
        if (delay > 0) {
          console.log(`\n⏸️  Waiting ${delay}s before next batch...`);
          await new Promise(resolve => setTimeout(resolve, delay * 1000));
        }
      }

      // Final summary
      console.log();
      console.log('='.repeat(60));
      console.log('🎉 CONTINUOUS MODE COMPLETE');
      console.log('='.repeat(60));
      const overallDurationSec = (Date.now() - overallStartTime) / 1000;
      console.log(`✅ Total Embedded:  ${totalEmbedded}`);
      console.log(`❌ Total Errors:    ${totalErrors}`);
      console.log(`📦 Total Batches:   ${batchNumber}`);
      console.log(`⚡ Total Runtime:   ${Math.floor(overallDurationSec / 60)}m ${Math.floor(overallDurationSec % 60)}s`);
      console.log(`📈 Average Rate:    ${(totalEmbedded / overallDurationSec).toFixed(1)} items/sec`);
      console.log('='.repeat(60));
      console.log('\n✅ All embeddings complete!\n');

    } else {
      // Single batch mode (original behavior)
      console.log('🔍 Finding text units needing embeddings...');
      const units = await listMissingTextUnits(supabase, limit, mode === 'embed' ? vconId : undefined, oldestFirst);

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
      
      // Show date range of vCons being processed
      const vconDates = units.map((u: any) => u.created_at).filter(Boolean);
      if (vconDates.length > 0) {
        console.log(`\n📅 vCon Date Range:`);
        console.log(`   Newest: ${new Date(vconDates[0]).toLocaleString()}`);
        console.log(`   Oldest: ${new Date(vconDates[vconDates.length - 1]).toLocaleString()}`);
      }
      console.log();

      // Process embeddings
      console.log('🚀 Generating embeddings with parallel processing...');
      const stats = await processEmbeddings(supabase, units, provider);

      // Display results
      console.log();
      console.log('='.repeat(60));
      console.log('📊 RESULTS');
      console.log('='.repeat(60));
      console.log(`✅ Embedded:  ${stats.embedded}`);
      console.log(`⏭️  Skipped:   ${stats.skipped}`);
      console.log(`❌ Errors:    ${stats.errors}`);
      
      if (stats.startTime && stats.endTime) {
        const durationSec = (stats.endTime - stats.startTime) / 1000;
        const rate = stats.embedded / durationSec;
        console.log(`⚡ Duration:  ${durationSec.toFixed(1)}s`);
        console.log(`📈 Rate:      ${rate.toFixed(1)} items/sec`);
      }
      
      if (stats.newestVconDate && stats.oldestVconDate) {
        console.log(`\n📅 Processed vCon Range:`);
        console.log(`   Newest: ${new Date(stats.newestVconDate).toLocaleString()}`);
        console.log(`   Oldest: ${new Date(stats.oldestVconDate).toLocaleString()}`);
      }
      console.log('='.repeat(60));

      if (stats.errors > 0) {
        console.log('\n⚠️  Some embeddings failed. Review errors above.');
        process.exit(1);
      }

      console.log('\n✅ Embedding generation complete!\n');
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);

