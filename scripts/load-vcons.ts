#!/usr/bin/env tsx

/**
 * vCon Loader Script
 * 
 * Loads production vCon files from a directory into the local Supabase database
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import dotenv from 'dotenv';
import { getSupabaseClient } from '../src/db/client.js';
import { VConQueries } from '../src/db/queries.js';
import { VCon } from '../src/types/vcon.js';
import { validateVCon } from '../src/utils/validation.js';

// Load environment variables
dotenv.config();

interface LoadStats {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
  errors: Array<{ file: string; error: string }>;
}

async function loadVConsFromDirectory(directoryPath: string): Promise<LoadStats> {
  const stats: LoadStats = {
    total: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  try {
    // Initialize database
    const supabase = getSupabaseClient();
    const queries = new VConQueries(supabase);

    console.log(`📂 Reading vCon files from: ${directoryPath}\n`);

    // Read all files in directory
    const files = await readdir(directoryPath);
    const vconFiles = files.filter(f => f.endsWith('.vcon'));

    stats.total = vconFiles.length;
    console.log(`Found ${stats.total} vCon files\n`);

    // Process each file
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

        // Check if vCon already exists
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

        // Validate vCon
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

        // Load vCon into database
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

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const directoryPath = args[0] || '/Users/thomashowe/Downloads/31';

  console.log('🚀 vCon Loader Starting...\n');
  console.log(`Database: ${process.env.SUPABASE_URL}\n`);

  await loadVConsFromDirectory(directoryPath);
}

// Run the loader
main().catch(console.error);



