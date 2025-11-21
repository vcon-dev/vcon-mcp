#!/usr/bin/env tsx

/**
 * Backup vCons from remote Supabase database to local
 * 
 * This script:
 * 1. Exports all vCons from remote database
 * 2. Connects to local Supabase project
 * 3. Optionally clears existing local data (with confirmation)
 * 4. Imports all remote vCons to local
 * 
 * Usage:
 *   LOCAL_SUPABASE_URL=http://127.0.0.1:54321 \
 *   LOCAL_SUPABASE_KEY=your_local_key \
 *   REMOTE_SUPABASE_URL=https://ijuooeoejxyjmoxrwgzg.supabase.co \
 *   REMOTE_SUPABASE_KEY=your_remote_key \
 *   npx tsx scripts/backup-from-remote.ts
 * 
 * Environment Variables:
 *   EXPORT_BATCH_SIZE    Batch size for exporting vCons (default: 100)
 *   IMPORT_BATCH_SIZE    Batch size for importing vCons (default: 100)
 *                        Can increase to 200-500 for very large datasets
 *   CLEAR_LOCAL          Set to "true" to clear local database before import (default: false)
 * 
 * Examples:
 *   # Backup without clearing local data (additive)
 *   npx tsx scripts/backup-from-remote.ts
 * 
 *   # Backup and replace local data
 *   CLEAR_LOCAL=true npx tsx scripts/backup-from-remote.ts
 * 
 *   # Use larger batches for faster backup
 *   IMPORT_BATCH_SIZE=200 EXPORT_BATCH_SIZE=150 npx tsx scripts/backup-from-remote.ts
 */

import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { VConQueries } from '../dist/db/queries.js';
import { VCon } from '../dist/types/vcon.js';
import * as readline from 'readline';

dotenv.config();

interface BackupStats {
  exported: number;
  imported: number;
  failed: number;
  errors: string[];
}

/**
 * Test database connection
 */
async function testConnection(supabase: SupabaseClient, label: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('vcons')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    
    if (error) throw error;
    console.log(`   ✅ ${label} connection successful`);
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    throw new Error(`${label} connection failed: ${errorMessage}`);
  }
}

/**
 * Export all vCons from source database
 */
async function exportAllVCons(sourceSupabase: SupabaseClient, sourceQueries: VConQueries): Promise<VCon[]> {
  console.log('\n📤 Exporting vCons from remote database...\n');
  
  // First, get total count
  const { count: totalCount, error: countError } = await sourceSupabase
    .from('vcons')
    .select('*', { count: 'exact', head: true });
  
  if (countError) throw countError;
  
  if (!totalCount || totalCount === 0) {
    console.log('   ⚠️  No vCons found in remote database');
    return [];
  }
  
  console.log(`   Found ${totalCount} vCons to export\n`);
  
  // Get all vCon UUIDs with pagination (Supabase default limit is 1000)
  const pageSize = 1000;
  const allVconRows: Array<{ uuid: string }> = [];
  let offset = 0;
  let hasMore = true;
  
  while (hasMore) {
    const { data: page, error: pageError } = await sourceSupabase
      .from('vcons')
      .select('uuid')
      .order('created_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    
    if (pageError) throw pageError;
    
    if (!page || page.length === 0) {
      hasMore = false;
    } else {
      allVconRows.push(...page);
      offset += pageSize;
      console.log(`   Loaded ${allVconRows.length}/${totalCount} vCon UUIDs...`);
      
      if (page.length < pageSize) {
        hasMore = false;
      }
    }
  }
  
  console.log(`   ✅ Loaded all ${allVconRows.length} vCon UUIDs\n`);
  
  // Export each vCon with full data
  const vcons: VCon[] = [];
  // Larger batch size for export since we're just reading data
  const exportBatchSize = parseInt(process.env.EXPORT_BATCH_SIZE || '100');
  
  for (let i = 0; i < allVconRows.length; i += exportBatchSize) {
    const batch = allVconRows.slice(i, i + exportBatchSize);
    const batchNum = Math.floor(i / exportBatchSize) + 1;
    const totalBatches = Math.ceil(allVconRows.length / exportBatchSize);
    
    console.log(`   Exporting batch ${batchNum}/${totalBatches} (${batch.length} vCons)...`);
    
    const batchPromises = batch.map(async (row) => {
      try {
        const vcon = await sourceQueries.getVCon(row.uuid);
        return vcon;
      } catch (error: any) {
        console.error(`   ⚠️  Failed to export ${row.uuid}: ${error.message}`);
        return null;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    const validVcons = batchResults.filter((v): v is VCon => v !== null);
    vcons.push(...validVcons);
    
    console.log(`   ✅ Exported ${validVcons.length}/${batch.length} vCons (${vcons.length}/${allVconRows.length} total)`);
  }
  
  console.log(`\n✅ Export complete: ${vcons.length} vCons exported\n`);
  return vcons;
}

/**
 * Clear all data from target database
 */
async function clearTargetDatabase(targetSupabase: SupabaseClient): Promise<void> {
  console.log('🗑️  Clearing local database...\n');
  
  // Delete in order to respect foreign key constraints
  // Order matters: delete child tables first, then parent
  const tables = ['attachments', 'analysis', 'dialog', 'parties', 'vcons'];
  
  for (const table of tables) {
    try {
      console.log(`   Clearing ${table}...`);
      
      // First, try to get count
      const { count } = await targetSupabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (count === 0) {
        console.log(`   ✅ ${table} is already empty`);
        continue;
      }
      
      // Delete all rows using a select that matches all rows
      // We'll delete in batches to handle large tables
      let deleted = 0;
      const batchSize = 1000;
      
      while (true) {
        // Get a batch of IDs to delete
        const { data: batch, error: selectError } = await targetSupabase
          .from(table)
          .select('id')
          .limit(batchSize);
        
        if (selectError || !batch || batch.length === 0) {
          break;
        }
        
        const ids = batch.map(row => row.id);
        
        // Delete the batch
        const { error: deleteError } = await targetSupabase
          .from(table)
          .delete()
          .in('id', ids);
        
        if (deleteError) {
          console.error(`   ⚠️  Error deleting batch from ${table}: ${deleteError.message}`);
          break;
        }
        
        deleted += batch.length;
        
        if (batch.length < batchSize) {
          break; // No more rows
        }
      }
      
      console.log(`   ✅ Cleared ${table} (${deleted} rows)`);
    } catch (error: any) {
      console.error(`   ⚠️  Error clearing ${table}: ${error.message}`);
      // Continue with other tables
    }
  }
  
  console.log();
}

/**
 * Import vCons into target database
 */
async function importVCons(
  targetSupabase: SupabaseClient,
  targetQueries: VConQueries,
  vcons: VCon[]
): Promise<BackupStats> {
  console.log(`📥 Importing ${vcons.length} vCons into local database...\n`);
  
  const stats: BackupStats = {
    exported: vcons.length,
    imported: 0,
    failed: 0,
    errors: []
  };
  
  // Larger batch size for import - can handle more concurrent operations
  // Default to 100, but can be increased to 200-500 for very large migrations
  const batchSize = parseInt(process.env.IMPORT_BATCH_SIZE || '100');
  
  console.log(`   Using batch size: ${batchSize} vCons per batch\n`);
  
  for (let i = 0; i < vcons.length; i += batchSize) {
    const batch = vcons.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(vcons.length / batchSize);
    
    console.log(`   Importing batch ${batchNum}/${totalBatches} (${batch.length} vCons)...`);
    
    const batchPromises = batch.map(async (vcon) => {
      try {
        await targetQueries.createVCon(vcon);
        return { success: true, uuid: vcon.uuid, error: null };
      } catch (error: any) {
        const errorMsg = error?.message || String(error);
        // Extract more details if available
        let detailedError = errorMsg;
        if (error?.details) {
          detailedError += ` | Details: ${error.details}`;
        }
        if (error?.hint) {
          detailedError += ` | Hint: ${error.hint}`;
        }
        if (error?.code) {
          detailedError += ` | Code: ${error.code}`;
        }
        return { success: false, uuid: vcon.uuid, error: detailedError };
      }
    });
    
    const results = await Promise.all(batchPromises);
    
    let batchSuccess = 0;
    let batchFailed = 0;
    
    results.forEach(result => {
      if (result.success) {
        batchSuccess++;
        stats.imported++;
      } else {
        batchFailed++;
        stats.failed++;
        const errorMsg = `${result.uuid}: ${result.error}`;
        stats.errors.push(errorMsg);
        // Log first few errors immediately for visibility
        if (stats.failed <= 5) {
          console.error(`   ❌ Failed: ${errorMsg}`);
        }
      }
    });
    
    console.log(`   ✅ Imported ${batchSuccess}/${batch.length} vCons (${batchFailed} failed)`);
    
    // If too many failures in a batch, show warning
    if (batchFailed > batch.length / 2) {
      console.error(`   ⚠️  WARNING: High failure rate in batch ${batchNum} (${batchFailed}/${batch.length} failed)`);
    }
  }
  
  return stats;
}

/**
 * Prompt user for confirmation
 */
function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

/**
 * Main backup function
 */
async function backup(): Promise<void> {
  console.log('💾 Starting vCon Backup from Remote\n');
  console.log('='.repeat(60));
  
  // Get environment variables
  const localUrl = process.env.LOCAL_SUPABASE_URL || 'http://127.0.0.1:54321';
  const localKey = process.env.LOCAL_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  const remoteUrl = process.env.REMOTE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://ijuooeoejxyjmoxrwgzg.supabase.co';
  const remoteKey = process.env.REMOTE_SUPABASE_KEY || process.env.REMOTE_SUPABASE_SERVICE_ROLE_KEY;
  
  if (!localKey) {
    console.error('❌ Error: Local Supabase credentials not set');
    console.error('   Set LOCAL_SUPABASE_KEY (or use SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY)');
    process.exit(1);
  }
  
  if (!remoteKey) {
    console.error('❌ Error: Remote Supabase credentials not set');
    console.error('   Set REMOTE_SUPABASE_KEY (or REMOTE_SUPABASE_SERVICE_ROLE_KEY)');
    process.exit(1);
  }
  
  console.log(`Remote: ${remoteUrl}`);
  console.log(`Local:  ${localUrl}`);
  console.log('='.repeat(60));
  console.log();
  
  // Connect to databases
  console.log('🔌 Connecting to databases...\n');
  
  const sourceSupabase = createClient(remoteUrl, remoteKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  
  const targetSupabase = createClient(localUrl, localKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  
  // Test connections
  try {
    await testConnection(sourceSupabase, 'Remote');
    await testConnection(targetSupabase, 'Local');
  } catch (error: any) {
    console.error(`\n❌ ${error.message}\n`);
    process.exit(1);
  }
  
  console.log();
  
  // Initialize query interfaces
  const sourceQueries = new VConQueries(sourceSupabase);
  const targetQueries = new VConQueries(targetSupabase);
  
  // Export from remote
  const vcons = await exportAllVCons(sourceSupabase, sourceQueries);
  
  if (vcons.length === 0) {
    console.log('⚠️  No vCons to backup. Exiting.');
    return;
  }
  
  // Check if we should clear local database
  const shouldClear = process.env.CLEAR_LOCAL === 'true';
  
  if (shouldClear) {
    // Check current local count
    const { count: localCount } = await targetSupabase
      .from('vcons')
      .select('*', { count: 'exact', head: true });
    
    if (localCount && localCount > 0) {
      console.log('⚠️  WARNING: This will DELETE ALL existing data in the local database!');
      console.log(`   Local project: ${localUrl}`);
      console.log(`   Current local vCons: ${localCount}`);
      console.log(`   Will import ${vcons.length} vCons from remote database\n`);
      
      const answer = await askQuestion('   Are you sure you want to continue? (yes/no): ');
      if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
        console.log('\n❌ Backup cancelled.\n');
        process.exit(0);
      }
      
      await clearTargetDatabase(targetSupabase);
      
      // Verify it's cleared
      const { count: remainingCount } = await targetSupabase
        .from('vcons')
        .select('*', { count: 'exact', head: true });
      
      if (remainingCount && remainingCount > 0) {
        console.error(`⚠️  WARNING: ${remainingCount} vCons still remain after clearing. Attempting to clear again...`);
        await clearTargetDatabase(targetSupabase);
      } else {
        console.log('✅ Local database cleared successfully\n');
      }
    }
  } else {
    console.log('ℹ️  Adding to existing local data (not clearing).');
    console.log('   Set CLEAR_LOCAL=true to replace local data.\n');
  }
  
  // Import to local
  const stats = await importVCons(targetSupabase, targetQueries, vcons);
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 BACKUP SUMMARY');
  console.log('='.repeat(60));
  console.log(`Exported:  ${stats.exported} vCons`);
  console.log(`Imported:  ${stats.imported} vCons`);
  console.log(`Failed:    ${stats.failed} vCons`);
  console.log('='.repeat(60));
  
  if (stats.errors.length > 0) {
    console.log('\n⚠️  Errors:');
    stats.errors.slice(0, 10).forEach(error => {
      console.log(`   - ${error}`);
    });
    if (stats.errors.length > 10) {
      console.log(`   ... and ${stats.errors.length - 10} more errors`);
    }
  }
  
  if (stats.failed === 0) {
    console.log('\n✅ Backup completed successfully!\n');
  } else {
    console.log(`\n⚠️  Backup completed with ${stats.failed} errors\n`);
    process.exit(1);
  }
}

// Run backup
backup().catch(error => {
  console.error('\n❌ Backup failed:', error);
  process.exit(1);
});







