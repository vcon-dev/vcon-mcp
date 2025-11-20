#!/usr/bin/env tsx

/**
 * Legacy vCon Loader Script
 * 
 * Loads production vCon files from S3 bucket (default) or local directory and migrates them 
 * from older spec versions to current spec (0.3.0). This script is designed for bulk loading 
 * of legacy vCon files with automatic migration and performance optimizations for large datasets.
 * 
 * Key Features:
 * - S3 bucket import (default) - loads recent vCons from AWS S3
 * - Local directory import - fallback option for local files
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
 *              If S3 env vars are set, uses S3 by default
 *              If directory provided, uses local directory instead
 * 
 * Options:
 *   --batch-size=N        Number of files per batch (default: 50)
 *   --concurrency=N       Number of concurrent batches (default: 3)
 *   --retry-attempts=N    Max retry attempts for failed files (default: 3)
 *   --retry-delay=N       Delay between retries in ms (default: 1000)
 *   --dry-run             Don't actually load files, just validate
 *   --hours=N             For S3: import vCons modified in last N hours (default: 24)
 *   --prefix=PREFIX       For S3: filter objects by prefix (optional)
 *   --sync                Enable continuous sync mode (checks for new vCons periodically)
 *   --sync-interval=N     Minutes between sync checks in sync mode (default: 5)
 * 
 * Environment Variables (S3 - Default):
 *   VCON_S3_BUCKET            S3 bucket name containing vCons (required for S3 mode)
 *   VCON_S3_PREFIX            Optional S3 prefix/folder path
 *   AWS_REGION                AWS region (default: us-east-1)
 *   
 *   AWS Credentials (automatically detected via credential provider chain):
 *   - Environment variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *   - Shared credentials file: ~/.aws/credentials
 *   - IAM roles: If running on EC2/ECS/Lambda
 *   - Other credential providers in the default chain
 * 
 * Environment Variables (Database):
 *   SUPABASE_URL              Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY Service role key for admin operations
 *   REDIS_URL                 Redis connection URL (optional)
 * 
 * Environment Variables (RLS / Multi-Tenant):
 *   RLS_ENABLED               Enable Row Level Security (set to 'true' to enable)
 *   TENANT_ATTACHMENT_TYPE    Attachment type containing tenant info (default: 'tenant')
 *   TENANT_JSON_PATH          JSON path to tenant ID in attachment (default: 'id')
 *                             Example: 'id' for body.id, 'tenant.id' for body.tenant.id
 * 
 * Examples:
 *   # Import recent vCons from S3 (default - last 24 hours)
 *   npx tsx scripts/load-legacy-vcons.ts
 * 
 *   # Import vCons from S3 modified in last 7 days
 *   npx tsx scripts/load-legacy-vcons.ts --hours=168
 * 
 *   # Import from specific S3 prefix
 *   VCON_S3_PREFIX=production/2024/ npx tsx scripts/load-legacy-vcons.ts
 * 
 *   # Load from local directory instead of S3
 *   npx tsx scripts/load-legacy-vcons.ts /path/to/vcons
 * 
 *   # Load from directory with custom settings
 *   npx tsx scripts/load-legacy-vcons.ts /path/to/vcons --batch-size=100 --concurrency=5
 * 
 *   # Dry run to test migration without loading
 *   npx tsx scripts/load-legacy-vcons.ts --dry-run
 * 
 *   # Conservative settings for large datasets
 *   npx tsx scripts/load-legacy-vcons.ts --batch-size=25 --concurrency=2 --retry-attempts=5
 * 
 *   # Enable continuous sync mode (checks every 5 minutes for new vCons)
 *   npx tsx scripts/load-legacy-vcons.ts --sync
 * 
 *   # Sync mode with custom interval (check every 10 minutes)
 *   npx tsx scripts/load-legacy-vcons.ts --sync --sync-interval=10
 * 
 * @author vCon MCP Team
 * @version 3.0.0
 * @since 2024-10-01
 */

import { readdir, readFile, stat, writeFile, readFile as readFileSync, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import dotenv from 'dotenv';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { getSupabaseClient } from '../dist/db/client.js';
import { VConQueries } from '../dist/db/queries.js';
import { VCon } from '../dist/types/vcon.js';
import { createClient } from 'redis';
import { getTenantConfig, extractTenantFromVCon } from '../src/config/tenant-config.js';
import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Test database connection and provide helpful error messages
 */
async function testDatabaseConnection(supabase: any): Promise<void> {
  try {
    // Try a simple query to test the connection
    const { error } = await supabase
      .from('vcons')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    
    if (error) {
      throw error;
    }
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const supabaseUrl = process.env.SUPABASE_URL || 'unknown';
    
    // Check for common connection errors
    if (errorMessage.includes('fetch failed') || 
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('network') ||
        errorMessage.includes('connection')) {
      
      console.error('\n❌ Database Connection Failed\n');
      console.error('The database is not accessible. Common causes:');
      console.error('  1. Docker is not running');
      console.error('  2. Supabase local instance is not started');
      console.error('  3. Database URL is incorrect');
      console.error(`\n  Current SUPABASE_URL: ${supabaseUrl}\n`);
      
      if (supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost')) {
        console.error('💡 To start local Supabase:');
        console.error('     supabase start');
        console.error('  Or check if Docker is running:\n');
        console.error('     docker ps\n');
      }
      
      throw new Error(`Database connection failed: ${errorMessage}`);
    }
    
    // Re-throw other errors as-is
    throw error;
  }
}

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
  /** Number of vCons with tenant_id assigned (RLS) */
  withTenant: number;
  /** Number of vCons without tenant_id (RLS) */
  withoutTenant: number;
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
  /** For S3: hours to look back for recent vCons */
  hours?: number;
  /** For S3: prefix to filter objects */
  prefix?: string;
  /** If true, continuously sync new vCons after initial load */
  sync?: boolean;
  /** Interval in minutes between sync checks (default: 5) */
  syncInterval?: number;
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
  init(): Promise<void>;
  /** Check if a UUID has already been loaded */
  hasUUID(uuid: string): Promise<boolean>;
  /** Add a UUID to the tracking system */
  addUUID(uuid: string): Promise<void>;
  /** Clean up resources */
  close(): Promise<void>;
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

  // Normalize encoding values for attachments and serialize body if needed
  if (vcon.attachments) {
    vcon.attachments = vcon.attachments.map((att: any) => {
      if (att.encoding === 'text') {
        // Convert 'text' to 'none' (plain text, no encoding)
        att.encoding = 'none';
      }
      
      // Serialize body if it's an object or array (database expects string)
      if (att.body !== undefined && att.body !== null && typeof att.body !== 'string') {
        att.body = JSON.stringify(att.body);
        // Set encoding to 'json' if not already set
        if (!att.encoding) {
          att.encoding = 'json';
        }
      }
      
      return att;
    });
  }

  // Normalize encoding values for dialog and serialize body if needed
  if (vcon.dialog) {
    vcon.dialog = vcon.dialog.map((dlg: any) => {
      if (dlg.encoding === 'text') {
        dlg.encoding = 'none';
      }
      
      // Serialize body if it's an object or array
      if (dlg.body !== undefined && dlg.body !== null && typeof dlg.body !== 'string') {
        dlg.body = JSON.stringify(dlg.body);
        if (!dlg.encoding) {
          dlg.encoding = 'json';
        }
      }
      
      return dlg;
    });
  }

  // Normalize encoding values for analysis and serialize body if needed
  if (vcon.analysis) {
    vcon.analysis = vcon.analysis.map((ana: any) => {
      if (ana.encoding === 'text') {
        ana.encoding = 'none';
      }
      
      // Serialize body if it's an object or array
      if (ana.body !== undefined && ana.body !== null && typeof ana.body !== 'string') {
        ana.body = JSON.stringify(ana.body);
        // Set encoding to 'json' if not already set, but preserve 'none' if explicitly set
        // Some legacy vCons may have encoding='none' with object bodies
        if (!ana.encoding || ana.encoding === 'none') {
          ana.encoding = 'json';
        }
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
 * Generate date prefixes for the time window (YYYY/MM/DD format)
 * 
 * @param hours - Hours to look back
 * @param basePrefix - Optional base prefix to prepend
 * @returns Array of date prefixes in YYYY/MM/DD format
 */
function generateDatePrefixes(hours: number, basePrefix?: string): string[] {
  const prefixes: string[] = [];
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - hours * 60 * 60 * 1000);
  
  // Generate prefixes for each day in the range
  const currentDate = new Date(cutoffTime);
  currentDate.setHours(0, 0, 0, 0); // Start of day
  
  while (currentDate <= now) {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    const datePrefix = `${year}/${month}/${day}`;
    
    if (basePrefix) {
      prefixes.push(`${basePrefix}${datePrefix}/`);
    } else {
      prefixes.push(`${datePrefix}/`);
    }
    
    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return prefixes;
}

/**
 * List recent vCons from S3 bucket using date-based prefixes for efficiency
 * 
 * Lists objects from S3 bucket that match the .vcon extension and were
 * modified within the specified time window. Uses YYYY/MM/DD directory
 * structure to optimize the search by only scanning relevant date directories.
 * Downloads them to a temporary directory for processing.
 * 
 * @param bucket - S3 bucket name
 * @param prefix - Optional base S3 prefix/folder path (will have date appended)
 * @param hours - Hours to look back for recent vCons
 * @param s3Client - Initialized S3 client
 * @returns Promise resolving to array of downloaded vCon file paths
 */
async function listAndDownloadVConsFromS3(
  bucket: string,
  prefix: string | undefined,
  hours: number,
  s3Client: S3Client
): Promise<string[]> {
  const vconFiles: string[] = [];
  const tempDir = await mkdtemp(join(tmpdir(), 'vcon-import-'));
  const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  console.log(`📦 Listing vCons from S3 bucket: ${bucket}`);
  if (prefix) {
    console.log(`   Base prefix: ${prefix}`);
  }
  console.log(`   Modified after: ${cutoffTime.toISOString()}`);
  
  // Generate date prefixes for efficient searching
  const datePrefixes = generateDatePrefixes(hours, prefix);
  console.log(`   Searching ${datePrefixes.length} date directories (YYYY/MM/DD format)\n`);
  
  let totalObjects = 0;
  let recentObjects = 0;
  let downloadedCount = 0;
  const startTime = Date.now();
  const progressInterval = 100; // Show progress every N objects checked
  const downloadProgressInterval = 10; // Show progress every N downloads
  
  // Process each date prefix
  for (let i = 0; i < datePrefixes.length; i++) {
    const datePrefix = datePrefixes[i];
    console.log(`📅 Searching ${datePrefix} (${i + 1}/${datePrefixes.length})...`);
    
    let continuationToken: string | undefined;
    let prefixObjects = 0;
    let prefixRecent = 0;
    
    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: datePrefix,
        ContinuationToken: continuationToken
      });
      
      const response = await s3Client.send(command);
      
      if (response.Contents) {
        for (const object of response.Contents) {
          totalObjects++;
          prefixObjects++;
          
          // Show progress periodically while listing
          if (totalObjects % progressInterval === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            process.stdout.write(`\r🔍 Checking objects... ${totalObjects} checked, ${recentObjects} recent vCons found, ${downloadedCount} downloaded (${elapsed}s)`);
          }
          
          // Check if object is recent enough and is a .vcon file
          if (object.LastModified && object.LastModified >= cutoffTime && object.Key?.endsWith('.vcon')) {
            recentObjects++;
            prefixRecent++;
            
            // Download object to temp directory
            const getCommand = new GetObjectCommand({
              Bucket: bucket,
              Key: object.Key
            });
            
            try {
              const getResponse = await s3Client.send(getCommand);
              
              if (getResponse.Body) {
                // Convert stream to string
                const chunks: Uint8Array[] = [];
                const stream = getResponse.Body as any;
                
                for await (const chunk of stream) {
                  chunks.push(chunk);
                }
                
                const bodyString = Buffer.concat(chunks).toString('utf-8');
                const localPath = join(tempDir, object.Key.split('/').pop() || `vcon-${recentObjects}.vcon`);
                await writeFile(localPath, bodyString, 'utf-8');
                vconFiles.push(localPath);
                downloadedCount++;
                
                // Show progress periodically while downloading
                if (downloadedCount % downloadProgressInterval === 0) {
                  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                  process.stdout.write(`\r📥 Downloading... ${downloadedCount}/${recentObjects} vCons downloaded (${elapsed}s)`);
                }
              }
            } catch (error) {
              console.warn(`\n⚠️  Failed to download ${object.Key}: ${error}`);
            }
          }
        }
      }
      
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    
    // Clear progress line and show date summary
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
    if (prefixRecent > 0) {
      console.log(`   ✅ Found ${prefixRecent} vCons in ${datePrefix}`);
    } else {
      console.log(`   ⏭️  No vCons found in ${datePrefix}`);
    }
  }
  
  // Clear progress line and show final summary
  process.stdout.write('\r' + ' '.repeat(80) + '\r');
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n📊 Summary: ${totalObjects} total objects checked, ${recentObjects} recent .vcon files found, ${downloadedCount} downloaded (${elapsed}s)\n`);
  
  return vconFiles;
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
): Promise<{ success: boolean; migrated: boolean; skipped: boolean; hasTenant: boolean; error?: string }> {
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
        return { success: false, migrated: false, skipped: false, hasTenant: false, error: 'Missing UUID field' };
      }

      // Check if vCon already exists using UUID tracker (much faster than DB query)
      if (!options.dryRun) {
        const alreadyExists = await uuidTracker.hasUUID(rawVcon.uuid);
        if (alreadyExists) {
          return { success: true, migrated: false, skipped: true, hasTenant: false };
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

      // Check tenant_id extraction (for RLS) before loading
      const tenantConfig = getTenantConfig();
      const hasTenant = tenantConfig.enabled && extractTenantFromVCon(vcon, tenantConfig) !== null;

      // Load vCon into database (skip if dry run)
      if (!options.dryRun) {
        await queries.createVCon(vcon);
        // Add UUID to tracker after successful load
        await uuidTracker.addUUID(vcon.uuid);
      }

      return { success: true, migrated: needsMigration, skipped: false, hasTenant };
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
      
      return { success: false, migrated: false, skipped: false, hasTenant: false, error: detailedError };
    }
  }
  
  return { success: false, migrated: false, skipped: false, hasTenant: false, error: 'Max retry attempts exceeded' };
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
        // Track tenant assignment for RLS
        if (result.hasTenant) {
          stats.withTenant++;
        } else {
          stats.withoutTenant++;
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
 * Load legacy vCon files from S3 bucket or local directory with migration and performance optimizations
 * 
 * This is the main processing function that orchestrates the entire loading workflow:
 * - If S3 credentials are configured, loads from S3 bucket (default)
 * - Otherwise, recursively finds all .vcon files in the specified directory
 * - Initializes UUID tracking system (Redis or file-based)
 * - Processes files in parallel batches with configurable concurrency
 * - Migrates legacy vCons to spec 0.3.0
 * - Provides comprehensive progress reporting and statistics
 * - Handles errors gracefully with detailed reporting
 * 
 * @param directoryPath - Path to directory containing .vcon files (optional if using S3)
 * @param options - Processing configuration options
 * @returns Promise resolving to comprehensive loading statistics
 */
async function loadVConsFromDirectory(directoryPath: string | undefined, options: ProcessingOptions = { batchSize: 50, concurrency: 3, dryRun: false, retryAttempts: 3, retryDelay: 1000 }): Promise<LoadStats> {
  const stats: LoadStats = {
    total: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    migrated: 0,
    withTenant: 0,
    withoutTenant: 0,
    errors: []
  };

  let uuidTracker: UUIDTracker | null = null;

  try {
    // Initialize database
    console.log('🔌 Testing database connection...');
    // Use service role key for admin operations (bypasses RLS)
    // Fall back to anon key if service role not available
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)');
    }
    
    const supabase: SupabaseClient = createSupabaseClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    
    // Test connection before proceeding
    await testDatabaseConnection(supabase);
    console.log('   ✅ Database connection successful\n');
    
    const queries = new VConQueries(supabase);

    // Initialize UUID tracker
    uuidTracker = new UUIDTrackerImpl();
    await uuidTracker.init();

    let vconFiles: string[] = [];
    
    // Check if S3 is configured and no directory path provided
    // Use AWS SDK default credential provider chain which checks:
    // 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
    // 2. Shared credentials file (~/.aws/credentials)
    // 3. IAM roles (if running on EC2/ECS/Lambda)
    // 4. Other credential providers
    const s3Bucket = process.env.VCON_S3_BUCKET;
    
    if (s3Bucket && !directoryPath) {
      // Use S3 as source with default credential provider chain
      const s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: fromNodeProviderChain()
      });
      
      const prefix = options.prefix || process.env.VCON_S3_PREFIX;
      const hours = options.hours || 24;
      
      vconFiles = await listAndDownloadVConsFromS3(s3Bucket, prefix, hours, s3Client);
    } else if (directoryPath) {
      // Use local directory
      console.log(`📂 Recursively searching for vCon files in: ${directoryPath}\n`);
      vconFiles = await findVConFiles(directoryPath);
    } else {
      throw new Error('Either S3 bucket (VCON_S3_BUCKET) or a directory path must be provided. AWS credentials will be automatically detected from environment variables, AWS credentials file, or IAM roles.');
    }

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

    // Backfill tenant_id if RLS is enabled and we have vCons without tenant_id
    const tenantConfig = getTenantConfig();
    if (tenantConfig.enabled && stats.successful > 0) {
      console.log('\n🔐 Backfilling tenant_id for loaded vCons...');
      try {
        const { data: backfillResults, error: backfillError } = await supabase.rpc('populate_tenant_ids_batch', {
          p_attachment_type: tenantConfig.attachmentType,
          p_json_path: tenantConfig.jsonPath,
          p_batch_size: Math.max(1000, stats.successful)
        });
        
        if (backfillError) {
          console.log(`   ⚠️  Backfill failed: ${backfillError.message}`);
        } else if (backfillResults && backfillResults.length > 0) {
          const backfilled = backfillResults.filter((r: any) => r.updated && r.tenant_id).length;
          if (backfilled > 0) {
            console.log(`   ✅ Backfilled tenant_id for ${backfilled} vCons`);
            // Update stats
            stats.withTenant += backfilled;
            stats.withoutTenant = Math.max(0, stats.withoutTenant - backfilled);
          }
        }
      } catch (error: any) {
        console.log(`   ⚠️  Backfill error: ${error.message}`);
      }
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
    
    // RLS/Tenant statistics
    if (tenantConfig.enabled) {
      console.log('\n🔐 RLS / Tenant Statistics:');
      console.log(`   ✅ With tenant_id:    ${stats.withTenant}`);
      console.log(`   ⚠️  Without tenant_id: ${stats.withoutTenant}`);
      if (stats.withoutTenant > 0) {
        console.log(`\n   ⚠️  WARNING: ${stats.withoutTenant} vCons loaded without tenant_id.`);
        console.log(`      These vCons will be accessible to all tenants (tenant_id IS NULL).`);
        console.log(`      Consider adding tenant attachments or manually setting tenant_id.`);
        console.log(`      Tenant config: type='${tenantConfig.attachmentType}', path='${tenantConfig.jsonPath}'`);
      }
    }
    
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

  } catch (error: any) {
    // Check if it's a database connection error that we've already handled
    if (error?.message?.includes('Database connection failed')) {
      console.error(error.message);
      process.exit(1);
    }
    
    // For other errors, provide context
    const errorMessage = error?.message || String(error);
    console.error('\n❌ Fatal error:', errorMessage);
    
    // Check if it might be a connection error we didn't catch
    if (errorMessage.includes('fetch failed') || 
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('network')) {
      console.error('\n💡 This might be a database connection issue.');
      console.error('   Make sure Docker and Supabase are running.\n');
    }
    
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
  
  // Parse directory path - if first arg doesn't start with --, it's the directory
  const directoryArg = args.find(arg => !arg.startsWith('--'));
  const directoryPath = directoryArg || undefined;
  
  // Parse command line options with improved defaults
  const batchSize = parseInt(args.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '50');
  const concurrency = parseInt(args.find(arg => arg.startsWith('--concurrency='))?.split('=')[1] || '3');
  const retryAttempts = parseInt(args.find(arg => arg.startsWith('--retry-attempts='))?.split('=')[1] || '3');
  const retryDelay = parseInt(args.find(arg => arg.startsWith('--retry-delay='))?.split('=')[1] || '1000');
  const dryRun = args.includes('--dry-run');
  const hours = parseInt(args.find(arg => arg.startsWith('--hours='))?.split('=')[1] || '24');
  const prefix = args.find(arg => arg.startsWith('--prefix='))?.split('=')[1] || undefined;
  const sync = args.includes('--sync');
  const syncInterval = parseInt(args.find(arg => arg.startsWith('--sync-interval='))?.split('=')[1] || '5');
  
  const options: ProcessingOptions = {
    batchSize,
    concurrency,
    dryRun,
    retryAttempts,
    retryDelay,
    hours,
    prefix,
    sync,
    syncInterval
  };

  console.log('🚀 Legacy vCon Loader Starting...\n');
  
  // Check environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    console.error('❌ Error: SUPABASE_URL environment variable is not set\n');
    console.error('   Please set SUPABASE_URL in your .env file or environment\n');
    process.exit(1);
  }
  
  console.log(`Database: ${supabaseUrl}\n`);
  
  // Check RLS configuration
  const tenantConfig = getTenantConfig();
  if (tenantConfig.enabled) {
    console.log('🔐 Row Level Security (RLS): ENABLED');
    console.log(`   Tenant attachment type: ${tenantConfig.attachmentType}`);
    console.log(`   Tenant JSON path: ${tenantConfig.jsonPath}`);
    console.log(`   Tenant ID will be extracted from attachments during load\n`);
  } else {
    console.log('🔐 Row Level Security (RLS): DISABLED');
    console.log(`   Set RLS_ENABLED=true to enable multi-tenant support\n`);
  }
  
  // Determine source
  const s3Bucket = process.env.VCON_S3_BUCKET;
  const source = (s3Bucket && !directoryPath) ? 'S3' : 'Local Directory';
  
  console.log(`Source: ${source}`);
  if (source === 'S3') {
    console.log(`  Bucket: ${s3Bucket}`);
    if (options.prefix || process.env.VCON_S3_PREFIX) {
      console.log(`  Prefix: ${options.prefix || process.env.VCON_S3_PREFIX}`);
    }
    console.log(`  Hours: ${hours}`);
  } else {
    console.log(`  Directory: ${directoryPath || 'Not specified'}`);
  }
  
  console.log(`\nOptions: batchSize=${batchSize}, concurrency=${concurrency}, retryAttempts=${retryAttempts}, retryDelay=${retryDelay}ms, dryRun=${dryRun}`);
  if (sync) {
    console.log(`Sync mode: Enabled (checking every ${syncInterval} minutes)\n`);
  } else {
    console.log();
  }

  await loadVConsFromDirectory(directoryPath, options);
  
  // If sync mode is enabled, start continuous syncing
  if (sync && !dryRun) {
    await startSyncMode(directoryPath, options);
  }
}

/**
 * Continuous sync mode - periodically checks for and loads new vCons
 */
async function startSyncMode(directoryPath: string | undefined, options: ProcessingOptions): Promise<void> {
  const syncIntervalMs = (options.syncInterval || 5) * 60 * 1000; // Convert minutes to milliseconds
  let syncCount = 0;
  let lastSyncTime = Date.now() - syncIntervalMs; // Start from one interval ago to catch recent vCons
  
  console.log('\n' + '='.repeat(60));
  console.log('🔄 Starting Continuous Sync Mode');
  console.log('='.repeat(60));
  console.log(`Checking for new vCons every ${options.syncInterval || 5} minutes`);
  console.log('Press Ctrl+C to stop\n');
  
  // Handle graceful shutdown
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n\n🛑 Shutting down sync mode...');
    console.log(`   Completed ${syncCount} sync cycles`);
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  while (!isShuttingDown) {
    try {
      // Wait for the sync interval
      console.log(`\n⏳ Waiting ${options.syncInterval || 5} minutes until next sync check...`);
      await new Promise(resolve => setTimeout(resolve, syncIntervalMs));
      
      if (isShuttingDown) break;
      
      syncCount++;
      const now = Date.now();
      const timeSinceLastSync = Math.floor((now - lastSyncTime) / 1000 / 60); // minutes
      
      console.log('\n' + '='.repeat(60));
      console.log(`🔄 Sync Check #${syncCount} (${new Date().toISOString()})`);
      console.log('='.repeat(60));
      
      // For sync mode, check for vCons modified since last sync
      // Use a time window slightly larger than sync interval to account for clock skew
      // Add 5 minutes buffer to ensure we don't miss any vCons
      const bufferMinutes = 5;
      const hoursToCheck = Math.max(1, Math.ceil((timeSinceLastSync + bufferMinutes) / 60)); // Convert to hours, minimum 1 hour
      const syncOptions: ProcessingOptions = {
        ...options,
        hours: hoursToCheck
      };
      
      console.log(`   Checking for vCons modified in last ${hoursToCheck} hour(s) (${timeSinceLastSync + bufferMinutes} minutes)`);
      
      // Only works with S3, not local directories
      const s3Bucket = process.env.VCON_S3_BUCKET;
      if (!s3Bucket && !directoryPath) {
        console.error('❌ Sync mode requires S3 bucket (VCON_S3_BUCKET) or directory path');
        break;
      }
      
      if (directoryPath) {
        console.log('⚠️  Sync mode with local directory will re-scan all files');
        console.log('   Consider using S3 for incremental sync\n');
      }
      
      const stats = await loadVConsFromDirectory(directoryPath, syncOptions);
      
      lastSyncTime = now;
      
      if (stats.total === 0) {
        console.log('✅ No new vCons found');
      } else {
        console.log(`✅ Sync complete: ${stats.successful} loaded, ${stats.skipped} skipped, ${stats.failed} failed`);
      }
      
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      console.error(`\n❌ Error during sync check: ${errorMessage}`);
      
      // Check if it's a connection error
      if (errorMessage.includes('Database connection failed') || 
          errorMessage.includes('fetch failed') ||
          errorMessage.includes('ECONNREFUSED')) {
        console.error('⚠️  Database connection lost. Will retry on next sync cycle.');
      } else {
        // For other errors, log but continue
        console.error('⚠️  Continuing sync mode. Will retry on next cycle.');
      }
    }
  }
}

// Run the loader
main().catch(console.error);



