#!/usr/bin/env tsx

/**
 * Load Existing vCon UUIDs Script
 * 
 * Loads existing vCon UUIDs from PostgreSQL into Redis for faster duplicate checking
 * Supports time-based filtering (e.g., load UUIDs from October)
 */

import dotenv from 'dotenv';
import { createClient } from 'redis';
import { getSupabaseClient } from '../dist/db/client.js';
import { VConQueries } from '../dist/db/queries.js';

// Load environment variables
dotenv.config();

interface LoadOptions {
  startDate?: string; // ISO date string (e.g., '2024-10-01')
  endDate?: string;   // ISO date string (e.g., '2024-10-31')
  month?: number;     // Month number (1-12)
  year?: number;      // Year (e.g., 2024)
  batchSize?: number; // Batch size for processing
  dryRun?: boolean;   // Don't actually load into Redis
}

interface LoadStats {
  total: number;
  loaded: number;
  skipped: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
}

/**
 * Parse date range options
 */
function parseDateRange(options: LoadOptions): { start: Date; end: Date } {
  let start: Date;
  let end: Date;

  if (options.startDate && options.endDate) {
    start = new Date(options.startDate);
    end = new Date(options.endDate);
  } else if (options.month && options.year) {
    start = new Date(options.year, options.month - 1, 1);
    end = new Date(options.year, options.month, 0, 23, 59, 59, 999);
  } else if (options.month) {
    const now = new Date();
    start = new Date(now.getFullYear(), options.month - 1, 1);
    end = new Date(now.getFullYear(), options.month, 0, 23, 59, 59, 999);
  } else {
    // Default to current month
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  return { start, end };
}

/**
 * Load existing vCon UUIDs from PostgreSQL into Redis
 */
async function loadExistingUUIDs(options: LoadOptions = {}): Promise<LoadStats> {
  const stats: LoadStats = {
    total: 0,
    loaded: 0,
    skipped: 0,
    errors: 0,
    startTime: new Date()
  };

  let redisClient: any = null;

  try {
    // Initialize database
    const supabase = getSupabaseClient();
    const queries = new VConQueries(supabase);

    // Initialize Redis
    try {
      redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      await redisClient.connect();
      await redisClient.ping();
      console.log('✅ Connected to Redis');
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error);
      process.exit(1);
    }

    // Parse date range
    const { start, end } = parseDateRange(options);
    
    if (options.startDate || options.endDate || options.month || options.year) {
      console.log(`📅 Loading UUIDs from ${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`);
    } else {
      console.log(`📅 Loading ALL vCon UUIDs from database`);
    }

    // Fetch all vCons with pagination (without count to avoid timeout)
    const allVcons = [];
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      let query = supabase
        .from('vcons')
        .select('uuid, created_at')
        .order('created_at', { ascending: true })
        .range(offset, offset + pageSize - 1);
      
      // Only apply date filters if dates are specified
      if (options.startDate || options.endDate || options.month || options.year) {
        query = query
          .gte('created_at', start.toISOString())
          .lte('created_at', end.toISOString());
      }
      
      const { data: pageVcons, error } = await query;
      
      if (error) {
        throw new Error(`Page query failed: ${error.message}`);
      }
      
      if (!pageVcons || pageVcons.length === 0) {
        hasMore = false;
      } else {
        allVcons.push(...pageVcons);
        offset += pageSize;
        console.log(`📄 Loaded page ${Math.floor(offset / pageSize)} (${allVcons.length} vCons so far)`);
      }
    }
    
    const vcons = allVcons;

    stats.total = vcons?.length || 0;
    console.log(`📊 Found ${stats.total} vCons in date range`);

    if (stats.total === 0) {
      console.log('ℹ️  No vCons found in the specified date range');
      return stats;
    }

    const batchSize = options.batchSize || 1000;
    const batches = [];
    
    // Create batches
    for (let i = 0; i < vcons.length; i += batchSize) {
      batches.push(vcons.slice(i, i + batchSize));
    }

    console.log(`🚀 Processing ${batches.length} batches of up to ${batchSize} UUIDs each`);

    if (options.dryRun) {
      console.log('🔍 DRY RUN MODE - No UUIDs will be loaded into Redis');
    }

    // Process batches
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      try {
        if (!options.dryRun) {
          // Load batch into Redis
          const uuids = batch.map(vcon => vcon.uuid);
          await redisClient.sAdd('vcon_loaded_uuids', uuids);
        }
        
        stats.loaded += batch.length;
        
        // Progress reporting
        const progress = ((i + 1) / batches.length * 100).toFixed(1);
        console.log(`📊 Progress: ${i + 1}/${batches.length} batches (${progress}%) - ${stats.loaded}/${stats.total} UUIDs`);
        
      } catch (error) {
        stats.errors++;
        console.error(`❌ Error processing batch ${i + 1}:`, error);
      }
    }

    // Get final count from Redis
    if (!options.dryRun) {
      const redisCount = await redisClient.sCard('vcon_loaded_uuids');
      console.log(`📊 Total UUIDs now in Redis: ${redisCount}`);
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    // Clean up Redis connection
    if (redisClient) {
      await redisClient.quit();
    }
    stats.endTime = new Date();
  }

  return stats;
}

/**
 * Print summary statistics
 */
function printSummary(stats: LoadStats) {
  const duration = stats.endTime ? 
    (stats.endTime.getTime() - stats.startTime.getTime()) / 1000 : 0;
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 UUID LOAD SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total vCons found: ${stats.total}`);
  console.log(`UUIDs loaded:      ${stats.loaded}`);
  console.log(`Errors:            ${stats.errors}`);
  console.log(`Duration:          ${duration.toFixed(1)}s`);
  console.log(`Rate:              ${(stats.loaded / duration).toFixed(1)} UUIDs/sec`);
  console.log('='.repeat(60));
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  const options: LoadOptions = {
    batchSize: 1000,
    dryRun: false
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--start-date=')) {
      options.startDate = arg.split('=')[1];
    } else if (arg.startsWith('--end-date=')) {
      options.endDate = arg.split('=')[1];
    } else if (arg.startsWith('--month=')) {
      options.month = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--year=')) {
      options.year = parseInt(arg.split('=')[1]);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: npx tsx scripts/load-existing-uuids.ts [options]

Options:
  --dry-run                    Don't actually load into Redis
  --batch-size=N              Batch size for processing (default: 1000)
  --start-date=YYYY-MM-DD     Start date (ISO format)
  --end-date=YYYY-MM-DD       End date (ISO format)
  --month=N                   Load specific month (1-12)
  --year=YYYY                 Load specific year (default: current year)
  --help, -h                  Show this help

Examples:
  # Load current month
  npx tsx scripts/load-existing-uuids.ts

  # Load October 2024
  npx tsx scripts/load-existing-uuids.ts --month=10 --year=2024

  # Load specific date range
  npx tsx scripts/load-existing-uuids.ts --start-date=2024-10-01 --end-date=2024-10-31

  # Dry run to see what would be loaded
  npx tsx scripts/load-existing-uuids.ts --month=10 --dry-run
      `);
      process.exit(0);
    }
  }

  console.log('🚀 Loading existing vCon UUIDs into Redis...\n');
  console.log(`Database: ${process.env.SUPABASE_URL}\n`);
  console.log(`Redis: ${process.env.REDIS_URL || 'redis://localhost:6379'}\n`);

  const stats = await loadExistingUUIDs(options);
  printSummary(stats);

  if (stats.loaded > 0) {
    console.log('\n✅ UUID loading complete!');
    console.log('💡 You can now run the vCon loader with improved performance.');
  } else {
    console.log('\n⚠️  No UUIDs were loaded.');
  }
}

// Run the loader
main().catch(console.error);
