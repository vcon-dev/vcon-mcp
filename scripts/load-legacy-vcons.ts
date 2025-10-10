#!/usr/bin/env tsx

/**
 * Legacy vCon Loader Script
 * 
 * Loads production vCon files and migrates them from older spec versions to current spec
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import dotenv from 'dotenv';
import { getSupabaseClient } from '../src/db/client.js';
import { VConQueries } from '../src/db/queries.js';
import { VCon } from '../src/types/vcon.js';

// Load environment variables
dotenv.config();

interface LoadStats {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
  migrated: number;
  errors: Array<{ file: string; error: string }>;
}

/**
 * Migrate a legacy vCon to current spec (0.3.0)
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

async function loadVConsFromDirectory(directoryPath: string): Promise<LoadStats> {
  const stats: LoadStats = {
    total: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    migrated: 0,
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
    console.log('🔄 Migration mode: Converting legacy vCons to spec 0.3.0\n');

    // Process each file
    for (let i = 0; i < vconFiles.length; i++) {
      const filename = vconFiles[i];
      const filepath = join(directoryPath, filename);

      try {
        // Show progress
        if ((i + 1) % 100 === 0 || i === 0) {
          console.log(`Processing ${i + 1}/${stats.total}: ${filename}`);
        }

        // Read and parse vCon file
        const content = await readFile(filepath, 'utf-8');
        const rawVcon = JSON.parse(content);

        // Check if vCon already exists
        try {
          const existing = await queries.getVCon(rawVcon.uuid);
          if (existing) {
            stats.skipped++;
            if (stats.skipped <= 5) {
              console.log(`  ⏭️  Skipped (already exists): ${rawVcon.uuid}`);
            }
            continue;
          }
        } catch (e) {
          // vCon doesn't exist, proceed with loading
        }

        // Migrate vCon to current spec
        const needsMigration = rawVcon.vcon !== '0.3.0' || 
                               (rawVcon.attachments && rawVcon.attachments.some((a: any) => a.encoding === 'text')) ||
                               (rawVcon.dialog && rawVcon.dialog.some((d: any) => d.encoding === 'text')) ||
                               (rawVcon.analysis && rawVcon.analysis.some((a: any) => a.encoding === 'text'));

        let vcon = rawVcon;
        if (needsMigration) {
          vcon = migrateVCon(rawVcon);
          stats.migrated++;
        }

        // Load vCon into database
        await queries.createVCon(vcon);
        stats.successful++;

        if (stats.successful <= 5) {
          console.log(`  ✅ Loaded: ${vcon.uuid}${needsMigration ? ' (migrated)' : ''}`);
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
    console.log(`🔄 Migrated:      ${stats.migrated} (upgraded to spec 0.3.0)`);
    console.log(`⏭️  Skipped:       ${stats.skipped} (already in database)`);
    console.log(`❌ Failed:        ${stats.failed}`);
    console.log('='.repeat(60));

    if (stats.errors.length > 0) {
      console.log('\n⚠️  First 10 errors:');
      stats.errors.slice(0, 10).forEach(({ file, error }) => {
        console.log(`  - ${file}: ${error.substring(0, 100)}...`);
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

  console.log('🚀 Legacy vCon Loader Starting...\n');
  console.log(`Database: ${process.env.SUPABASE_URL}\n`);

  await loadVConsFromDirectory(directoryPath);
}

// Run the loader
main().catch(console.error);



