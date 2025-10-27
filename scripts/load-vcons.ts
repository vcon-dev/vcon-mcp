#!/usr/bin/env tsx

/**
 * vCon Loader Script
 * 
 * Loads production vCon files from a directory into the local Supabase database.
 * This script is designed for loading standard vCon files that conform to the
 * current vCon specification (0.3.0).
 * 
 * Features:
 * - Validates vCon structure before loading
 * - Skips vCons that already exist in the database
 * - Provides detailed progress reporting
 * - Handles errors gracefully with detailed error messages
 * 
 * Usage:
 *   npx tsx scripts/load-vcons.ts [directory_path]
 * 
 * Arguments:
 *   directory_path  Path to directory containing .vcon files (optional)
 *                   Default: /Users/thomashowe/Downloads/31
 * 
 * Environment Variables:
 *   SUPABASE_URL              Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY Service role key for admin operations
 * 
 * Examples:
 *   # Load from default directory
 *   npx tsx scripts/load-vcons.ts
 * 
 *   # Load from specific directory
 *   npx tsx scripts/load-vcons.ts /path/to/vcon/files
 * 
 *   # Load with environment variables
 *   SUPABASE_URL=http://127.0.0.1:54321 npx tsx scripts/load-vcons.ts
 * 
 * @author vCon MCP Team
 * @version 1.0.0
 * @since 2024-10-01
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import dotenv from 'dotenv';
import { getSupabaseClient } from '../dist/db/client.js';
import { VConQueries } from '../dist/db/queries.js';
import { VCon } from '../dist/types/vcon.js';
import { validateVCon } from '../dist/utils/validation.js';

// Load environment variables
dotenv.config();

/**
 * Statistics tracking for vCon loading operations
 */
interface LoadStats {
  /** Total number of vCon files found */
  total: number;
  /** Number of vCons successfully loaded */
  successful: number;
  /** Number of vCons that failed to load */
  failed: number;
  /** Number of vCons skipped (already exist) */
  skipped: number;
  /** Array of error details for failed loads */
  errors: Array<{ file: string; error: string }>;
}

/**
 * Load vCon files from a directory into the database
 * 
 * This function processes all .vcon files in the specified directory,
 * validates them, and loads them into the Supabase database. It skips
 * vCons that already exist and provides detailed progress reporting.
 * 
 * @param directoryPath - Path to directory containing .vcon files
 * @returns Promise resolving to loading statistics
 */
async function loadVConsFromDirectory(directoryPath: string): Promise<LoadStats> {
  const stats: LoadStats = {
    total: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  try {
    // Initialize database connection and query interface
    const supabase = getSupabaseClient();
    const queries = new VConQueries(supabase);

    console.log(`📂 Reading vCon files from: ${directoryPath}\n`);

    // Read all files in directory and filter for .vcon files
    const files = await readdir(directoryPath);
    const vconFiles = files.filter(f => f.endsWith('.vcon'));

    stats.total = vconFiles.length;
    console.log(`Found ${stats.total} vCon files\n`);

    // Process each vCon file sequentially
    for (let i = 0; i < vconFiles.length; i++) {
      const filename = vconFiles[i];
      const filepath = join(directoryPath, filename);

      try {
        // Show progress
        if ((i + 1) % 10 === 0 || i === 0) {
          console.log(`Processing ${i + 1}/${stats.total}: ${filename}`);
        }

        // Read and parse vCon file
        const content = await readFile(filepath, 'utf-8');
        const vcon: VCon = JSON.parse(content);

        // Check if vCon already exists in database to avoid duplicates
        try {
          const existing = await queries.getVCon(vcon.uuid);
          if (existing) {
            stats.skipped++;
            if (stats.skipped <= 5) {
              console.log(`  ⏭️  Skipped (already exists): ${vcon.uuid}`);
            }
            continue;
          }
        } catch (e) {
          // vCon doesn't exist, proceed with loading
        }

        // Validate vCon structure before loading
        const validation = validateVCon(vcon);
        if (!validation.valid) {
          stats.failed++;
          const errorMsg = `Validation failed: ${validation.errors.join(', ')}`;
          stats.errors.push({ file: filename, error: errorMsg });
          if (stats.failed <= 5) {
            console.log(`  ❌ ${filename}: ${errorMsg}`);
          }
          continue;
        }

        // Load validated vCon into database
        await queries.createVCon(vcon);
        stats.successful++;

        if (stats.successful <= 5) {
          console.log(`  ✅ Loaded: ${vcon.uuid}`);
        }

      } catch (error) {
        stats.failed++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        stats.errors.push({ file: filename, error: errorMsg });
        
        if (stats.failed <= 5) {
          console.error(`  ❌ Error loading ${filename}: ${errorMsg}`);
        }
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 LOAD SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total files:      ${stats.total}`);
    console.log(`✅ Successful:    ${stats.successful}`);
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
    }

    console.log('\n✅ Load complete!\n');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }

  return stats;
}

/**
 * Main execution function
 * 
 * Parses command line arguments and initiates the vCon loading process.
 * Uses the first argument as the directory path, or defaults to a predefined path.
 */
async function main() {
  const args = process.argv.slice(2);
  const directoryPath = args[0] || '/Users/thomashowe/Downloads/31';

  console.log('🚀 vCon Loader Starting...\n');
  console.log(`Database: ${process.env.SUPABASE_URL}\n`);

  await loadVConsFromDirectory(directoryPath);
}

// Run the loader
main().catch(console.error);



