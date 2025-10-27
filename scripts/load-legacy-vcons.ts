#!/usr/bin/env tsx

/**
 * Legacy vCon Loader Script
 * 
 * Loads production vCon files and migrates them from older spec versions to current spec (0.3.0).
 * This script is designed for bulk loading of legacy vCon files with automatic migration
 * and performance optimizations for large datasets.
 * 
 * Key Features:
 * - Automatic migration from legacy spec versions (0.0.1, 0.1.0, 0.2.0) to 0.3.0
 * - Encoding normalization (converts 'text' encoding to 'none' for plain text)
 * - Redis-based UUID tracking for fast duplicate detection
 * - Parallel processing with configurable concurrency
 * - Retry logic with exponential backoff
 * - Comprehensive error reporting and statistics
 * - Dry-run mode for testing
 * 
 * Migration Strategy:
 * - Updates vcon version field to '0.3.0'
 * - Normalizes encoding values in attachments, dialog, and analysis
 * - Preserves all other vCon data unchanged
 * 
 * Performance Features:
 * - Uses Redis for fast UUID duplicate checking
 * - Falls back to temporary file if Redis unavailable
 * - Configurable batch processing and concurrency
 * - Progress reporting with ETA calculations
 * 
 * Usage:
 *   npx tsx scripts/load-legacy-vcons.ts [directory] [options]
 * 
 * Arguments:
 *   directory  Path to directory containing .vcon files (optional)
 *              Default: /Users/thomashowe/Downloads/31
 * 
 * Options:
 *   --batch-size=N        Number of files per batch (default: 50)
 *   --concurrency=N       Number of concurrent batches (default: 3)
 *   --retry-attempts=N    Max retry attempts for failed files (default: 3)
 *   --retry-delay=N       Delay between retries in ms (default: 1000)
 *   --dry-run             Don't actually load files, just validate
 * 
 * Environment Variables:
 *   SUPABASE_URL              Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY Service role key for admin operations
 *   REDIS_URL                 Redis connection URL (optional)
 * 
 * Examples:
 *   # Basic usage with defaults
 *   npx tsx scripts/load-legacy-vcons.ts
 * 
 *   # Load from specific directory with custom settings
 *   npx tsx scripts/load-legacy-vcons.ts /path/to/vcons --batch-size=100 --concurrency=5
 * 
 *   # Dry run to test migration without loading
 *   npx tsx scripts/load-legacy-vcons.ts --dry-run
 * 
 *   # Conservative settings for large datasets
 *   npx tsx scripts/load-legacy-vcons.ts --batch-size=25 --concurrency=2 --retry-attempts=5
 * 
 * @author vCon MCP Team
 * @version 2.0.0
 * @since 2024-10-01
 */

import { readdir, readFile, stat, writeFile, readFile as readFileSync } from 'fs/promises';
import { join } from 'path';
import dotenv from 'dotenv';
import { getSupabaseClient } from '../dist/db/client.js';
import { VConQueries } from '../dist/db/queries.js';
import { VCon } from '../dist/types/vcon.js';
import { createClient } from 'redis';

// Load environment variables
dotenv.config();

/**
 * Statistics tracking for legacy vCon loading operations
 */
interface LoadStats {
  /** Total number of vCon files found */
  total: number;
  /** Number of vCons successfully loaded */
  successful: number;
  /** Number of vCons that failed to load */
  failed: number;
  /** Number of vCons skipped (already exist in database) */
  skipped: number;
  /** Number of vCons that required migration to spec 0.3.0 */
  migrated: number;
  /** Array of error details for failed loads */
  errors: Array<{ file: string; error: string }>;
}

/**
 * Configuration options for processing vCon files
 */
interface ProcessingOptions {
  /** Number of files to process in each batch */
  batchSize: number;
  /** Number of concurrent batches to process simultaneously */
  concurrency: number;
  /** If true, validate files but don't load into database */
  dryRun: boolean;
  /** Maximum number of retry attempts for failed files */
  retryAttempts?: number;
  /** Delay between retry attempts in milliseconds */
  retryDelay?: number;
}

/**
 * Interface for tracking loaded vCon UUIDs to prevent duplicates
 * Supports both Redis and file-based storage with automatic fallback
 */
interface UUIDTracker {
  /** Whether Redis is available for UUID tracking */
  isRedisAvailable: boolean;
  /** Redis client instance (if available) */
  redisClient?: any;
  /** Temporary file path for UUID storage (fallback) */
  tempFile?: string;
  /** In-memory set of loaded UUIDs for fast lookup */
  loadedUUIDs: Set<string>;
  
  /** Initialize the tracker (Redis or file-based) */
  async init(): Promise<void>;
  /** Check if a UUID has already been loaded */
  async hasUUID(uuid: string): Promise<boolean>;
  /** Add a UUID to the tracking system */
  async addUUID(uuid: string): Promise<void>;
  /** Clean up resources */
  async close(): Promise<void>;
}

/**
 * Migrate a legacy vCon to current spec (0.3.0)
 * 
 * This function performs the following migrations:
 * - Updates vcon version field from legacy versions (0.0.1, 0.1.0, 0.2.0) to 0.3.0
 * - Normalizes encoding values: converts 'text' to 'none' for plain text content
 * - Applies normalization to attachments, dialog, and analysis arrays
 * - Preserves all other vCon data unchanged
 * 
 * @param vcon - The legacy vCon object to migrate
 * @returns The migrated vCon conforming to spec 0.3.0
 */
function migrateVCon(vcon: any): VCon {
  // Update version to 0.3.0
  if (vcon.vcon === '0.0.1' || vcon.vcon === '0.1.0' || vcon.vcon === '0.2.0') {
    vcon.vcon = '0.3.0';
  }

  // Normalize encoding values for attachments
  if (vcon.attachments) {
    vcon.attachments = vcon.attachments.map((att: any) => {
      if (att.encoding === 'text') {
        // Convert 'text' to 'none' (plain text, no encoding)
        att.encoding = 'none';
      }
      return att;
    });
  }

  // Normalize encoding values for dialog
  if (vcon.dialog) {
    vcon.dialog = vcon.dialog.map((dlg: any) => {
      if (dlg.encoding === 'text') {
        dlg.encoding = 'none';
      }
      return dlg;
    });
  }

  // Normalize encoding values for analysis
  if (vcon.analysis) {
    vcon.analysis = vcon.analysis.map((ana: any) => {
      if (ana.encoding === 'text') {
        ana.encoding = 'none';
      }
      return ana;
    });
  }

  return vcon as VCon;
}

/**
 * UUID Tracker implementation using Redis or temp file
 * 
 * This class provides fast UUID duplicate detection by maintaining a set of
 * already-loaded UUIDs. It tries to use Redis for persistence across runs,
 * but falls back to a temporary file if Redis is unavailable.
 */
class UUIDTrackerImpl implements UUIDTracker {
  isRedisAvailable: boolean = false;
  redisClient?: any;
  tempFile?: string;
  loadedUUIDs: Set<string> = new Set();

  async init(): Promise<void> {
    try {
      // Try to connect to Redis
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      await this.redisClient.connect();
      await this.redisClient.ping();
      this.isRedisAvailable = true;
      console.log('✅ Using Redis for UUID tracking');
      
      // Load existing UUIDs from Redis
      const existingUUIDs = await this.redisClient.sMembers('vcon_loaded_uuids');
      this.loadedUUIDs = new Set(existingUUIDs);
      console.log(`📊 Loaded ${this.loadedUUIDs.size} existing UUIDs from Redis`);
      
    } catch (error) {
      console.log('⚠️  Redis not available, using temporary file for UUID tracking');
      this.isRedisAvailable = false;
      
      // Use temp file as fallback
      this.tempFile = join(process.cwd(), 'temp_loaded_uuids.json');
      
      try {
        const content = await readFileSync(this.tempFile, 'utf-8');
        const uuids = JSON.parse(content);
        this.loadedUUIDs = new Set(uuids);
        console.log(`📊 Loaded ${this.loadedUUIDs.size} existing UUIDs from temp file`);
      } catch (e) {
        // File doesn't exist or is empty, start fresh
        this.loadedUUIDs = new Set();
        console.log('📊 Starting with empty UUID cache');
      }
    }
  }

  async hasUUID(uuid: string): Promise<boolean> {
    // Always check local Set first (faster and more reliable)
    if (this.loadedUUIDs.has(uuid)) {
      return true;
    }
    
    // If Redis is available, also check Redis as a fallback
    if (this.isRedisAvailable && this.redisClient) {
      try {
        const exists = await this.redisClient.sIsMember('vcon_loaded_uuids', uuid);
        if (exists) {
          // Add to local Set for future checks
          this.loadedUUIDs.add(uuid);
        }
        return exists;
      } catch (error) {
        console.warn('Redis check failed, falling back to local Set only');
        return false;
      }
    }
    
    return false;
  }

  async addUUID(uuid: string): Promise<void> {
    if (this.isRedisAvailable && this.redisClient) {
      await this.redisClient.sAdd('vcon_loaded_uuids', uuid);
    } else {
      this.loadedUUIDs.add(uuid);
      // Periodically save to temp file (every 1000 additions)
      if (this.loadedUUIDs.size % 1000 === 0) {
        await this.saveToTempFile();
      }
    }
  }

  async saveToTempFile(): Promise<void> {
    if (this.tempFile) {
      const uuids = Array.from(this.loadedUUIDs);
      await writeFile(this.tempFile, JSON.stringify(uuids, null, 2));
    }
  }

  async close(): Promise<void> {
    if (this.isRedisAvailable && this.redisClient) {
      await this.redisClient.quit();
    } else if (this.tempFile) {
      // Save final state to temp file
      await this.saveToTempFile();
    }
  }
}

/**
 * Recursively find all .vcon files in a directory
 * 
 * Searches through the directory and all subdirectories to find files
 * with the .vcon extension. Handles errors gracefully by logging warnings
 * for inaccessible directories.
 * 
 * @param directoryPath - Path to the directory to search
 * @returns Promise resolving to array of .vcon file paths
 */
async function findVConFiles(directoryPath: string): Promise<string[]> {
  const vconFiles: string[] = [];
  
  async function searchDirectory(dir: string) {
    try {
      const items = await readdir(dir);
      
      for (const item of items) {
        const fullPath = join(dir, item);
        const stats = await stat(fullPath);
        
        if (stats.isDirectory()) {
          // Recursively search subdirectories
          await searchDirectory(fullPath);
        } else if (item.endsWith('.vcon')) {
          vconFiles.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read directory ${dir}: ${error}`);
    }
  }
  
  await searchDirectory(directoryPath);
  return vconFiles;
}

/**
 * Process a single vCon file with retry logic and better error handling
 * 
 * This function handles the complete lifecycle of processing a vCon file:
 * - Reads and parses the JSON file
 * - Validates required fields (UUID)
 * - Checks for duplicates using UUID tracker
 * - Migrates legacy spec versions to 0.3.0
 * - Loads into database (unless dry run)
 * - Implements retry logic for transient failures
 * 
 * @param filepath - Path to the vCon file to process
 * @param queries - Database query interface
 * @param options - Processing configuration options
 * @param uuidTracker - UUID tracking system for duplicate detection
 * @returns Promise resolving to processing result with success status and details
 */
async function processVConFile(
  filepath: string, 
  queries: VConQueries, 
  options: ProcessingOptions,
  uuidTracker: UUIDTracker
): Promise<{ success: boolean; migrated: boolean; skipped: boolean; error?: string }> {
  const filename = filepath.split('/').pop() || filepath;
  const retryAttempts = options.retryAttempts || 3;
  const retryDelay = options.retryDelay || 1000;
  
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      // Read and parse vCon file
      const content = await readFile(filepath, 'utf-8');
      const rawVcon = JSON.parse(content);

      // Validate vCon has required fields
      if (!rawVcon.uuid) {
        return { success: false, migrated: false, skipped: false, error: 'Missing UUID field' };
      }

      // Check if vCon already exists using UUID tracker (much faster than DB query)
      if (!options.dryRun) {
        const alreadyExists = await uuidTracker.hasUUID(rawVcon.uuid);
        if (alreadyExists) {
          return { success: true, migrated: false, skipped: true };
        }
      }

      // Migrate vCon to current spec
      const needsMigration = rawVcon.vcon !== '0.3.0' || 
                             (rawVcon.attachments && rawVcon.attachments.some((a: any) => a.encoding === 'text')) ||
                             (rawVcon.dialog && rawVcon.dialog.some((d: any) => d.encoding === 'text')) ||
                             (rawVcon.analysis && rawVcon.analysis.some((a: any) => a.encoding === 'text'));

      let vcon = rawVcon;
      if (needsMigration) {
        vcon = migrateVCon(rawVcon);
      }

      // Load vCon into database (skip if dry run)
      if (!options.dryRun) {
        await queries.createVCon(vcon);
        // Add UUID to tracker after successful load
        await uuidTracker.addUUID(vcon.uuid);
      }

      return { success: true, migrated: needsMigration, skipped: false };
    } catch (error) {
      // Improved error message extraction for Supabase errors
      let errorMsg: string;
      if (error instanceof Error) {
        errorMsg = error.message;
      } else if (error && typeof error === 'object' && error.message) {
        errorMsg = error.message;
      } else {
        errorMsg = String(error);
      }
      
      // Check if it's a retryable error
      const isRetryable = errorMsg.includes('timeout') || 
                         errorMsg.includes('connection') || 
                         errorMsg.includes('ECONNRESET') ||
                         errorMsg.includes('duplicate key') ||
                         errorMsg.includes('unique constraint');
      
      if (attempt < retryAttempts && isRetryable) {
        console.log(`⚠️  Retry ${attempt}/${retryAttempts} for ${filename}: ${errorMsg}`);
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        continue;
      }
      
      // Format error message with more details
      let detailedError = errorMsg;
      if (error instanceof Error && error.stack) {
        // Include error type and first line of stack for debugging
        const stackLines = error.stack.split('\n');
        detailedError = `${error.name}: ${errorMsg} (${stackLines[1]?.trim() || 'no stack'})`;
      } else if (error && typeof error === 'object' && error.code) {
        // For Supabase errors, include the error code
        detailedError = `${error.code}: ${errorMsg}`;
      }
      
      return { success: false, migrated: false, skipped: false, error: detailedError };
    }
  }
  
  return { success: false, migrated: false, skipped: false, error: 'Max retry attempts exceeded' };
}

/**
 * Process files in parallel batches
 */
async function processBatch(
  files: string[], 
  queries: VConQueries, 
  options: ProcessingOptions,
  stats: LoadStats,
  uuidTracker: UUIDTracker
): Promise<void> {
  const promises = files.map(async (filepath) => {
    const result = await processVConFile(filepath, queries, options, uuidTracker);
    
    if (result.success) {
      if (result.skipped) {
        stats.skipped++;
      } else {
        stats.successful++;
        if (result.migrated) {
          stats.migrated++;
        }
      }
    } else {
      stats.failed++;
      const filename = filepath.split('/').pop() || filepath;
      stats.errors.push({ file: filename, error: result.error || 'Unknown error' });
    }
  });

  await Promise.all(promises);
}

/**
 * Create batches from array
 */
function createBatches<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Load legacy vCon files from a directory with migration and performance optimizations
 * 
 * This is the main processing function that orchestrates the entire loading workflow:
 * - Recursively finds all .vcon files in the directory
 * - Initializes UUID tracking system (Redis or file-based)
 * - Processes files in parallel batches with configurable concurrency
 * - Migrates legacy vCons to spec 0.3.0
 * - Provides comprehensive progress reporting and statistics
 * - Handles errors gracefully with detailed reporting
 * 
 * @param directoryPath - Path to directory containing .vcon files
 * @param options - Processing configuration options
 * @returns Promise resolving to comprehensive loading statistics
 */
async function loadVConsFromDirectory(directoryPath: string, options: ProcessingOptions = { batchSize: 50, concurrency: 3, dryRun: false, retryAttempts: 3, retryDelay: 1000 }): Promise<LoadStats> {
  const stats: LoadStats = {
    total: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    migrated: 0,
    errors: []
  };

  let uuidTracker: UUIDTracker | null = null;

  try {
    // Initialize database
    const supabase = getSupabaseClient();
    const queries = new VConQueries(supabase);

    // Initialize UUID tracker
    uuidTracker = new UUIDTrackerImpl();
    await uuidTracker.init();

    console.log(`📂 Recursively searching for vCon files in: ${directoryPath}\n`);

    // Recursively find all .vcon files
    const vconFiles = await findVConFiles(directoryPath);

    stats.total = vconFiles.length;
    console.log(`Found ${stats.total} vCon files\n`);
    console.log(`🚀 Processing with ${options.concurrency} concurrent batches of ${options.batchSize} files each\n`);
    
    if (options.dryRun) {
      console.log('🔍 DRY RUN MODE - No files will be written to database\n');
    } else {
      console.log('🔄 Migration mode: Converting legacy vCons to spec 0.3.0\n');
    }

    // Create batches for parallel processing
    const batches = createBatches(vconFiles, options.batchSize);
    const concurrencyBatches = createBatches(batches, options.concurrency);

    let processedCount = 0;
    const startTime = Date.now();

    // Process batches with controlled concurrency
    for (let i = 0; i < concurrencyBatches.length; i++) {
      const concurrencyBatch = concurrencyBatches[i];
      
      // Process this concurrency batch in parallel
      const batchPromises = concurrencyBatch.map(async (batch, batchIndex) => {
        const globalBatchIndex = i * options.concurrency + batchIndex;
        await processBatch(batch, queries, options, stats, uuidTracker!);
        processedCount += batch.length;
        
        // Progress reporting
        const elapsed = Date.now() - startTime;
        const rate = processedCount / (elapsed / 1000);
        const eta = (stats.total - processedCount) / rate;
        
        console.log(`📊 Progress: ${processedCount}/${stats.total} (${(processedCount/stats.total*100).toFixed(1)}%) | Rate: ${rate.toFixed(1)} files/sec | ETA: ${Math.round(eta/60)}min`);
      });

      await Promise.all(batchPromises);
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 LOAD SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total files:      ${stats.total}`);
    console.log(`✅ Successful:    ${stats.successful}`);
    console.log(`🔄 Migrated:      ${stats.migrated} (upgraded to spec 0.3.0)`);
    console.log(`⏭️  Skipped:       ${stats.skipped} (already in database)`);
    console.log(`❌ Failed:        ${stats.failed}`);
    console.log('='.repeat(60));

    if (stats.errors.length > 0) {
      console.log('\n⚠️  First 10 errors:');
      stats.errors.slice(0, 10).forEach(({ file, error }) => {
        console.log(`  - ${file}: ${error}`);
      });

      if (stats.errors.length > 10) {
        console.log(`  ... and ${stats.errors.length - 10} more errors`);
      }
      
      // Show error summary by type
      const errorTypes: { [key: string]: number } = {};
      stats.errors.forEach(({ error }) => {
        const errorType = error.split(':')[0] || 'Unknown';
        errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
      });
      
      if (Object.keys(errorTypes).length > 0) {
        console.log(`\n📊 Error Summary:`);
        Object.entries(errorTypes).forEach(([type, count]) => {
          console.log(`  ${type}: ${count} errors`);
        });
      }
    }

    console.log('\n✅ Load complete!\n');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    // Clean up UUID tracker
    if (uuidTracker) {
      await uuidTracker.close();
    }
  }

  return stats;
}

/**
 * Main execution function
 * 
 * Parses command line arguments and initiates the legacy vCon loading process.
 * Supports various command line options for batch processing, concurrency control,
 * retry configuration, and dry-run mode.
 */
async function main() {
  const args = process.argv.slice(2);
  const directoryPath = args[0] || '/Users/thomashowe/Downloads/31';
  
  // Parse command line options with improved defaults
  const batchSize = parseInt(args.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '50');
  const concurrency = parseInt(args.find(arg => arg.startsWith('--concurrency='))?.split('=')[1] || '3');
  const retryAttempts = parseInt(args.find(arg => arg.startsWith('--retry-attempts='))?.split('=')[1] || '3');
  const retryDelay = parseInt(args.find(arg => arg.startsWith('--retry-delay='))?.split('=')[1] || '1000');
  const dryRun = args.includes('--dry-run');
  
  const options: ProcessingOptions = {
    batchSize,
    concurrency,
    dryRun,
    retryAttempts,
    retryDelay
  };

  console.log('🚀 Legacy vCon Loader Starting...\n');
  console.log(`Database: ${process.env.SUPABASE_URL}\n`);
  console.log(`Options: batchSize=${batchSize}, concurrency=${concurrency}, retryAttempts=${retryAttempts}, retryDelay=${retryDelay}ms, dryRun=${dryRun}\n`);

  await loadVConsFromDirectory(directoryPath, options);
}

// Run the loader
main().catch(console.error);



