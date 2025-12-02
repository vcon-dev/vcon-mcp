#!/usr/bin/env tsx

/**
 * Unified vCon Sync Script
 *
 * A comprehensive script that performs all sync operations:
 * 1. Load/sync vCons from S3 or local directory
 * 2. Generate embeddings for new vCons
 * 3. Refresh the tags materialized view
 *
 * By default, all steps are enabled. Use flags to disable specific steps.
 *
 * Usage:
 *   npx tsx scripts/sync-all.ts [options]
 *
 * Options:
 *   --no-vcons           Skip vCon loading/sync
 *   --no-embeddings      Skip embeddings generation
 *   --no-tags            Skip tags materialized view refresh
 *   --hours=N            For S3: import vCons modified in last N hours (default: 24)
 *   --prefix=PREFIX      For S3: filter objects by prefix
 *   --batch-size=N       Number of files per batch for vCon loading (default: 50)
 *   --concurrency=N      Number of concurrent batches for vCon loading (default: 3)
 *   --embedding-limit=N  Max text units to embed per batch (default: 100)
 *   --embedding-provider=PROVIDER  openai or hf (auto-detected)
 *   --sync               Enable continuous sync mode
 *   --sync-interval=N    Minutes between sync checks (default: 5)
 *   --dry-run            Don't actually load files, just validate
 *
 * Environment Variables:
 *   SUPABASE_URL              Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY Service role key for admin operations
 *   VCON_S3_BUCKET            S3 bucket name (optional)
 *   VCON_S3_PREFIX            S3 prefix/folder path (optional)
 *   AWS_REGION                AWS region (default: us-east-1)
 *   OPENAI_API_KEY            OpenAI API key (for embeddings)
 *   HF_API_TOKEN              Hugging Face API token (alternative for embeddings)
 *   REDIS_URL                 Redis connection URL (optional, for UUID tracking)
 *
 * Examples:
 *   # Full sync: vCons + embeddings + tags view refresh
 *   npx tsx scripts/sync-all.ts
 *
 *   # Only refresh tags view
 *   npx tsx scripts/sync-all.ts --no-vcons --no-embeddings
 *
 *   # Sync vCons and refresh tags, skip embeddings
 *   npx tsx scripts/sync-all.ts --no-embeddings
 *
 *   # Continuous sync mode
 *   npx tsx scripts/sync-all.ts --sync --sync-interval=10
 *
 * @author vCon MCP Team
 * @version 1.0.0
 */

import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config();

interface SyncOptions {
  syncVcons: boolean;
  syncEmbeddings: boolean;
  refreshTags: boolean;
  hours: number;
  prefix?: string;
  batchSize: number;
  concurrency: number;
  embeddingLimit: number;
  embeddingProvider?: 'openai' | 'hf';
  sync: boolean;
  syncInterval: number;
  dryRun: boolean;
  directoryPath?: string;
}

interface SyncStats {
  vconsLoaded: number;
  vconsSkipped: number;
  vconsFailed: number;
  embeddingsGenerated: number;
  embeddingsFailed: number;
  tagsRefreshed: boolean;
  errors: string[];
}

/**
 * Parse command line arguments
 */
function parseArgs(): SyncOptions {
  const args = process.argv.slice(2);

  // Find directory path (first arg that doesn't start with --)
  const directoryArg = args.find(arg => !arg.startsWith('--'));

  return {
    syncVcons: !args.includes('--no-vcons'),
    syncEmbeddings: !args.includes('--no-embeddings'),
    refreshTags: !args.includes('--no-tags'),
    hours: parseInt(args.find(arg => arg.startsWith('--hours='))?.split('=')[1] || '24'),
    prefix: args.find(arg => arg.startsWith('--prefix='))?.split('=')[1],
    batchSize: parseInt(args.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '50'),
    concurrency: parseInt(args.find(arg => arg.startsWith('--concurrency='))?.split('=')[1] || '3'),
    embeddingLimit: parseInt(args.find(arg => arg.startsWith('--embedding-limit='))?.split('=')[1] || '100'),
    embeddingProvider: args.find(arg => arg.startsWith('--embedding-provider='))?.split('=')[1] as 'openai' | 'hf' | undefined,
    sync: args.includes('--sync'),
    syncInterval: parseInt(args.find(arg => arg.startsWith('--sync-interval='))?.split('=')[1] || '5'),
    dryRun: args.includes('--dry-run'),
    directoryPath: directoryArg,
  };
}

/**
 * Run a script as a child process and capture output
 */
function runScript(scriptPath: string, args: string[]): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', scriptPath, ...args], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: process.env,
    });

    let output = '';

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      resolve({ success: code === 0, output });
    });

    child.on('error', (error) => {
      output += `Error: ${error.message}`;
      resolve({ success: false, output });
    });
  });
}

/**
 * Refresh the tags materialized view
 */
async function refreshTagsMaterializedView(supabase: SupabaseClient): Promise<boolean> {
  console.log('\n' + '='.repeat(60));
  console.log('🏷️  REFRESHING TAGS MATERIALIZED VIEW');
  console.log('='.repeat(60));

  try {
    // Call the refresh function
    const { error } = await supabase.rpc('refresh_vcon_tags_mv');

    if (error) {
      // Check if it's because the function doesn't exist
      if (error.message.includes('does not exist') || error.code === '42883') {
        console.log('⚠️  refresh_vcon_tags_mv function not found.');
        console.log('   The materialized view may not be set up yet.');
        console.log('   Run migrations to create it: supabase db push\n');
        return false;
      }
      throw error;
    }

    // Get row count from the refreshed view
    const { count, error: countError } = await supabase
      .from('vcon_tags_mv')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      // View might not exist
      if (countError.message.includes('does not exist') || countError.code === '42P01') {
        console.log('⚠️  vcon_tags_mv materialized view not found.');
        console.log('   Run migrations to create it: supabase db push\n');
        return false;
      }
      console.log('⚠️  Could not get row count:', countError.message);
    } else {
      console.log(`✅ Tags materialized view refreshed successfully`);
      console.log(`   Total rows in view: ${count ?? 'unknown'}\n`);
    }

    return true;
  } catch (error: any) {
    console.error('❌ Failed to refresh tags view:', error.message);
    return false;
  }
}

/**
 * Run a single sync cycle
 */
async function runSyncCycle(
  options: SyncOptions,
  supabase: SupabaseClient,
  stats: SyncStats
): Promise<void> {
  // Step 1: Sync vCons
  if (options.syncVcons) {
    console.log('\n' + '='.repeat(60));
    console.log('📦 STEP 1: LOADING/SYNCING VCONS');
    console.log('='.repeat(60));

    const vconArgs: string[] = [];
    if (options.directoryPath) {
      vconArgs.push(options.directoryPath);
    }
    vconArgs.push(`--hours=${options.hours}`);
    vconArgs.push(`--batch-size=${options.batchSize}`);
    vconArgs.push(`--concurrency=${options.concurrency}`);
    if (options.prefix) {
      vconArgs.push(`--prefix=${options.prefix}`);
    }
    if (options.dryRun) {
      vconArgs.push('--dry-run');
    }

    const result = await runScript('scripts/load-legacy-vcons.ts', vconArgs);

    if (!result.success) {
      stats.errors.push('vCon loading failed');
    }

    // Parse stats from output (best effort)
    const successMatch = result.output.match(/✅ Successful:\s+(\d+)/);
    const skippedMatch = result.output.match(/⏭️\s+Skipped:\s+(\d+)/);
    const failedMatch = result.output.match(/❌ Failed:\s+(\d+)/);

    if (successMatch) stats.vconsLoaded = parseInt(successMatch[1]);
    if (skippedMatch) stats.vconsSkipped = parseInt(skippedMatch[1]);
    if (failedMatch) stats.vconsFailed = parseInt(failedMatch[1]);
  } else {
    console.log('\n⏭️  Skipping vCon sync (--no-vcons)');
  }

  // Step 2: Generate embeddings
  if (options.syncEmbeddings) {
    console.log('\n' + '='.repeat(60));
    console.log('🔮 STEP 2: GENERATING EMBEDDINGS');
    console.log('='.repeat(60));

    // Check if we have the necessary API keys
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasHF = !!process.env.HF_API_TOKEN;

    if (!hasOpenAI && !hasHF) {
      console.log('⚠️  No embedding API keys found (OPENAI_API_KEY or HF_API_TOKEN)');
      console.log('   Skipping embeddings generation\n');
    } else {
      const embeddingArgs: string[] = [
        `--limit=${options.embeddingLimit}`,
      ];

      if (options.embeddingProvider) {
        embeddingArgs.push(`--provider=${options.embeddingProvider}`);
      }

      const result = await runScript('scripts/embed-vcons.ts', embeddingArgs);

      if (!result.success) {
        stats.errors.push('Embeddings generation failed');
      }

      // Parse stats from output
      const embeddedMatch = result.output.match(/✅ Embedded:\s+(\d+)/);
      const errorsMatch = result.output.match(/❌ Errors:\s+(\d+)/);

      if (embeddedMatch) stats.embeddingsGenerated = parseInt(embeddedMatch[1]);
      if (errorsMatch) stats.embeddingsFailed = parseInt(errorsMatch[1]);
    }
  } else {
    console.log('\n⏭️  Skipping embeddings (--no-embeddings)');
  }

  // Step 3: Refresh tags materialized view
  if (options.refreshTags) {
    stats.tagsRefreshed = await refreshTagsMaterializedView(supabase);
    if (!stats.tagsRefreshed) {
      stats.errors.push('Tags view refresh failed or view not found');
    }
  } else {
    console.log('\n⏭️  Skipping tags refresh (--no-tags)');
  }
}

/**
 * Print final summary
 */
function printSummary(stats: SyncStats, durationMs: number): void {
  console.log('\n' + '='.repeat(60));
  console.log('📊 SYNC SUMMARY');
  console.log('='.repeat(60));

  console.log('\nvCons:');
  console.log(`  ✅ Loaded:   ${stats.vconsLoaded}`);
  console.log(`  ⏭️  Skipped:  ${stats.vconsSkipped}`);
  console.log(`  ❌ Failed:   ${stats.vconsFailed}`);

  console.log('\nEmbeddings:');
  console.log(`  ✅ Generated: ${stats.embeddingsGenerated}`);
  console.log(`  ❌ Failed:    ${stats.embeddingsFailed}`);

  console.log('\nTags View:');
  console.log(`  ${stats.tagsRefreshed ? '✅ Refreshed' : '⚠️  Not refreshed'}`);

  const durationSec = durationMs / 1000;
  console.log(`\n⚡ Total Duration: ${Math.floor(durationSec / 60)}m ${Math.floor(durationSec % 60)}s`);

  if (stats.errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    stats.errors.forEach(err => console.log(`  - ${err}`));
  }

  console.log('='.repeat(60));
  console.log('\n✅ Sync complete!\n');
}

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log('\n🔄 vCon Unified Sync\n');
  console.log('='.repeat(60));

  const options = parseArgs();

  // Validate environment
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing required environment variables:');
    console.error('   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  // Initialize Supabase client
  const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  // Display configuration
  console.log('Configuration:');
  console.log(`  Sync vCons:      ${options.syncVcons ? 'YES' : 'NO (--no-vcons)'}`);
  console.log(`  Sync Embeddings: ${options.syncEmbeddings ? 'YES' : 'NO (--no-embeddings)'}`);
  console.log(`  Refresh Tags:    ${options.refreshTags ? 'YES' : 'NO (--no-tags)'}`);
  console.log(`  Hours:           ${options.hours}`);
  console.log(`  Batch Size:      ${options.batchSize}`);
  console.log(`  Concurrency:     ${options.concurrency}`);
  console.log(`  Embedding Limit: ${options.embeddingLimit}`);
  console.log(`  Continuous:      ${options.sync ? `YES (every ${options.syncInterval} min)` : 'NO'}`);
  console.log(`  Dry Run:         ${options.dryRun ? 'YES' : 'NO'}`);
  console.log(`  Database:        ${supabaseUrl}`);
  console.log('='.repeat(60));

  const stats: SyncStats = {
    vconsLoaded: 0,
    vconsSkipped: 0,
    vconsFailed: 0,
    embeddingsGenerated: 0,
    embeddingsFailed: 0,
    tagsRefreshed: false,
    errors: [],
  };

  const startTime = Date.now();

  if (options.sync) {
    // Continuous sync mode
    console.log('\n🔄 Running in continuous sync mode');
    console.log('   Press Ctrl+C to stop\n');

    let isShuttingDown = false;
    let cycleCount = 0;

    const shutdown = () => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log('\n\n🛑 Shutting down...');
      printSummary(stats, Date.now() - startTime);
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    while (!isShuttingDown) {
      cycleCount++;
      console.log('\n' + '█'.repeat(60));
      console.log(`📅 SYNC CYCLE ${cycleCount} - ${new Date().toISOString()}`);
      console.log('█'.repeat(60));

      await runSyncCycle(options, supabase, stats);

      if (!isShuttingDown) {
        console.log(`\n⏳ Waiting ${options.syncInterval} minutes until next sync...`);
        await new Promise(resolve => setTimeout(resolve, options.syncInterval * 60 * 1000));
      }
    }
  } else {
    // Single sync run
    await runSyncCycle(options, supabase, stats);
    printSummary(stats, Date.now() - startTime);
  }
}

// Run
main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
