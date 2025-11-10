#!/usr/bin/env tsx

/**
 * Migrate database to enable Row Level Security (RLS) for multi-tenant support
 * 
 * This script:
 * 1. Reads tenant configuration from environment variables
 * 2. Connects to Supabase
 * 3. Checks if tenant_id column exists (migration already run)
 * 4. Runs SQL migration to add tenant_id column and RLS policies
 * 5. Populates tenant_id for existing vCons from attachments
 * 6. Reports migration status and any vCons without tenant assignments
 * 
 * Usage:
 *   SUPABASE_URL=https://your-project.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
 *   RLS_ENABLED=true \
 *   TENANT_ATTACHMENT_TYPE=tenant \
 *   TENANT_JSON_PATH=id \
 *   npx tsx scripts/migrate-to-rls.ts
 * 
 * Options:
 *   --dry-run    Show what would be done without making changes
 *   --skip-rls   Skip enabling RLS (only populate tenant_id)
 */

import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getTenantConfig } from '../src/config/tenant-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

interface MigrationStats {
  totalVCons: number;
  vConsWithTenant: number;
  vConsWithoutTenant: number;
  errors: string[];
}

/**
 * Check if tenant_id column exists
 */
async function checkTenantIdColumn(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('exec_sql', {
      q: `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'vcons' 
          AND column_name = 'tenant_id'
      `,
      params: {}
    });
    
    if (error) {
      // If exec_sql doesn't exist, try direct query
      const { error: directError } = await supabase
        .from('vcons')
        .select('tenant_id')
        .limit(1);
      
      return !directError;
    }
    
    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    // If exec_sql doesn't exist, try direct query
    try {
      const { error: directError } = await supabase
        .from('vcons')
        .select('tenant_id')
        .limit(1);
      
      return !directError;
    } catch {
      return false;
    }
  }
}

/**
 * Check if RLS is enabled on vcons table
 */
async function checkRLSEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('exec_sql', {
      q: `
        SELECT relname, relrowsecurity
        FROM pg_class
        WHERE relname = 'vcons'
      `,
      params: {}
    });
    
    if (error) {
      // Fallback: try to query with anon key (should fail if RLS is enabled without policies)
      return false;
    }
    
    return Array.isArray(data) && data.length > 0 && data[0]?.relrowsecurity === true;
  } catch {
    return false;
  }
}

/**
 * Run SQL migration file
 * 
 * Note: This migration contains complex PL/pgSQL functions that need to be
 * executed as a single transaction. The script will provide instructions
 * for running it via Supabase SQL Editor or CLI.
 */
async function runMigration(supabase: SupabaseClient, dryRun: boolean): Promise<void> {
  const migrationPath = join(__dirname, '../supabase/migrations/20251110094042_add_tenant_rls.sql');
  const migrationSQL = readFileSync(migrationPath, 'utf-8');
  
  if (dryRun) {
    console.log('\n📋 Migration SQL (dry-run, not executed):');
    console.log('─'.repeat(80));
    console.log(migrationSQL.substring(0, 500) + '...\n');
    return;
  }
  
  console.log('\n⚠️  This migration contains complex PL/pgSQL functions.');
  console.log('   It must be executed as a single transaction via Supabase SQL Editor or CLI.\n');
  console.log('📋 To apply the migration:\n');
  console.log('   Option 1: Supabase Dashboard (Recommended)');
  console.log('   1. Go to https://app.supabase.com');
  console.log('   2. Select your project');
  console.log('   3. Go to SQL Editor (left sidebar)');
  console.log('   4. Click "New Query"');
  console.log('   5. Copy and paste the SQL from:');
  console.log(`      ${migrationPath}`);
  console.log('   6. Click "Run" (or press Cmd/Ctrl+Enter)\n');
  console.log('   Option 2: Supabase CLI');
  console.log('   supabase db push\n');
  console.log('   Option 3: psql (if you have direct database access)');
  console.log(`   psql $DATABASE_URL -f ${migrationPath}\n`);
  console.log('─'.repeat(80));
  console.log('\n💡 After running the migration, run this script again to populate tenant IDs.\n');
  
  // Check if migration was already applied
  const tenantIdExists = await checkTenantIdColumn(supabase);
  if (tenantIdExists) {
    console.log('✅ Migration appears to have been applied (tenant_id column exists)');
    console.log('   Proceeding to populate tenant IDs...\n');
    return;
  } else {
    console.log('❌ Migration not yet applied. Please run the migration first.\n');
    throw new Error('Migration must be applied manually before populating tenant IDs');
  }
}

/**
 * Populate tenant_id using TypeScript batch processing (fallback)
 */
async function populateTenantIdsTypeScript(
  supabase: SupabaseClient,
  config: ReturnType<typeof getTenantConfig>,
  totalCount: number,
  batchSize: number
): Promise<MigrationStats> {
  let totalWithTenant = 0;
  let totalWithoutTenant = 0;
  let offset = 0;
  let hasMore = true;
  let batchNumber = 0;
  
  while (hasMore) {
    batchNumber++;
    
    // Get batch of vCons without tenant_id
    const { data: vcons, error: fetchError } = await supabase
      .from('vcons')
      .select('id, uuid')
      .is('tenant_id', null)
      .range(offset, offset + batchSize - 1);
    
    if (fetchError) {
      throw new Error(`Failed to fetch vCons batch: ${fetchError.message}`);
    }
    
    if (!vcons || vcons.length === 0) {
      hasMore = false;
      break;
    }
    
    // Process each vCon in the batch
    for (const vcon of vcons) {
      try {
        // Extract tenant using the SQL function
        const { data: tenantData, error: extractError } = await supabase.rpc('extract_tenant_from_attachments', {
          p_vcon_id: vcon.id,
          p_attachment_type: config.attachmentType,
          p_json_path: config.jsonPath,
        });
        
        if (extractError) {
          console.warn(`   ⚠️  Failed to extract tenant for vCon ${vcon.uuid}: ${extractError.message}`);
          totalWithoutTenant++;
          continue;
        }
        
        const tenantId = tenantData as string | null;
        
        if (tenantId) {
          // Update vCon with tenant_id
          const { error: updateError } = await supabase
            .from('vcons')
            .update({ tenant_id: tenantId })
            .eq('id', vcon.id);
          
          if (updateError) {
            console.warn(`   ⚠️  Failed to update tenant_id for vCon ${vcon.uuid}: ${updateError.message}`);
            totalWithoutTenant++;
          } else {
            totalWithTenant++;
          }
        } else {
          totalWithoutTenant++;
        }
      } catch (error: any) {
        console.warn(`   ⚠️  Error processing vCon ${vcon.uuid}: ${error.message}`);
        totalWithoutTenant++;
      }
    }
    
    const processed = offset + vcons.length;
    console.log(`   Batch ${batchNumber}: Processed ${vcons.length} vCons (${totalWithTenant} with tenant, ${totalWithoutTenant} without)`);
    console.log(`   Progress: ${processed} / ${totalCount} (${Math.round((processed / totalCount) * 100)}%)\n`);
    
    offset += batchSize;
    
    // Check if we got fewer than batch size (last batch)
    if (vcons.length < batchSize) {
      hasMore = false;
    }
    
    // Small delay between batches
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return {
    totalVCons: totalCount,
    vConsWithTenant: totalWithTenant,
    vConsWithoutTenant: totalWithoutTenant,
    errors: [],
  };
}

/**
 * Populate tenant_id for existing vCons
 */
async function populateTenantIds(
  supabase: SupabaseClient,
  config: ReturnType<typeof getTenantConfig>,
  dryRun: boolean
): Promise<MigrationStats> {
  console.log('\n🔍 Populating tenant_id for existing vCons...');
  
  // Get total count
  const { count: totalCount, error: countError } = await supabase
    .from('vcons')
    .select('*', { count: 'exact', head: true });
  
  if (countError) {
    throw new Error(`Failed to count vCons: ${countError.message}`);
  }
  
  if (!totalCount || totalCount === 0) {
    console.log('   ℹ️  No vCons found in database');
    return {
      totalVCons: 0,
      vConsWithTenant: 0,
      vConsWithoutTenant: 0,
      errors: [],
    };
  }
  
  console.log(`   Found ${totalCount} vCons to process\n`);
  
  if (dryRun) {
    console.log('   📋 Would populate tenant_id using:');
    console.log(`      - Attachment type: ${config.attachmentType}`);
    console.log(`      - JSON path: ${config.jsonPath}`);
    return {
      totalVCons: totalCount,
      vConsWithTenant: 0,
      vConsWithoutTenant: totalCount,
      errors: [],
    };
  }
  
  // Process in batches to avoid timeouts
  const batchSize = parseInt(process.env.TENANT_MIGRATION_BATCH_SIZE || '1000', 10);
  let totalProcessed = 0;
  let totalWithTenant = 0;
  let totalWithoutTenant = 0;
  let hasMore = true;
  let batchNumber = 0;
  
  console.log(`   Processing in batches of ${batchSize}...\n`);
  
  while (hasMore) {
    batchNumber++;
    
    try {
      // Try batched function first (if it exists)
      const { data, error } = await supabase.rpc('populate_tenant_ids_batch', {
        p_attachment_type: config.attachmentType,
        p_json_path: config.jsonPath,
        p_batch_size: batchSize,
      });
      
      if (error) {
        // If batched function doesn't exist, fall back to processing in TypeScript
        if (error.message.includes('does not exist') || error.message.includes('function')) {
          console.log('   ⚠️  Batched function not found, using TypeScript batch processing...\n');
          return await populateTenantIdsTypeScript(supabase, config, totalCount, batchSize);
        }
        throw error;
      }
      
      const results = data as Array<{ 
        vcon_uuid: string; 
        tenant_id: string | null; 
        updated: boolean;
        processed_count?: number;
      }> | null;
      
      if (!results || results.length === 0) {
        hasMore = false;
        break;
      }
      
      const batchWithTenant = results.filter(r => r.updated && r.tenant_id).length;
      const batchWithoutTenant = results.filter(r => !r.updated || !r.tenant_id).length;
      // Each row represents one vCon processed, so results.length is the batch size
      const processedInBatch = results.length;
      
      totalProcessed += processedInBatch;
      totalWithTenant += batchWithTenant;
      totalWithoutTenant += batchWithoutTenant;
      
      // Continue if we processed a full batch (might be more to process)
      // Stop if we processed fewer than batch size (last batch)
      // Also stop if we've processed all vCons
      if (processedInBatch < batchSize || totalProcessed >= totalCount) {
        hasMore = false;
      }
      
      console.log(`   Batch ${batchNumber}: Processed ${processedInBatch} vCons (${batchWithTenant} with tenant, ${batchWithoutTenant} without)`);
      console.log(`   Progress: ${totalProcessed} / ${totalCount} (${Math.round((totalProcessed / totalCount) * 100)}%)\n`);
      
      // Small delay between batches to avoid overwhelming the database
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error: any) {
      throw new Error(`Failed to populate tenant IDs in batch ${batchNumber}: ${error.message}`);
    }
  }
  
  console.log(`   ✅ Completed: Updated ${totalWithTenant} vCons with tenant_id`);
  if (totalWithoutTenant > 0) {
    console.log(`   ⚠️  ${totalWithoutTenant} vCons do not have tenant attachments`);
  }
  
  return {
    totalVCons: totalCount,
    vConsWithTenant: totalWithTenant,
    vConsWithoutTenant: totalWithoutTenant,
    errors: [],
  };
}

/**
 * Main migration function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipRLS = args.includes('--skip-rls');
  
  console.log('🚀 RLS Multi-Tenant Migration Script\n');
  
  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }
  
  // Get configuration
  const config = getTenantConfig();
  console.log('📋 Configuration:');
  console.log(`   RLS Enabled: ${config.enabled}`);
  console.log(`   Tenant Attachment Type: ${config.attachmentType}`);
  console.log(`   Tenant JSON Path: ${config.jsonPath}`);
  if (config.currentTenantId) {
    console.log(`   Current Tenant ID: ${config.currentTenantId}`);
  }
  console.log();
  
  // Check required environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Error: Missing required environment variables');
    console.error('   Required: SUPABASE_URL');
    console.error('   Required: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');
    console.error('\n   Note: Use SERVICE_ROLE_KEY for migrations to bypass RLS');
    process.exit(1);
  }
  
  // Create Supabase client
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  
  // Test connection
  console.log('🔌 Testing database connection...');
  try {
    const { error } = await supabase
      .from('vcons')
      .select('id')
      .limit(1);
    
    if (error) throw error;
    console.log('   ✅ Connection successful\n');
  } catch (error: any) {
    console.error(`   ❌ Connection failed: ${error.message}`);
    process.exit(1);
  }
  
  // Check if tenant_id column exists
  console.log('🔍 Checking migration status...');
  const tenantIdExists = await checkTenantIdColumn(supabase);
  const rlsEnabled = await checkRLSEnabled(supabase);
  
  console.log(`   Tenant ID column: ${tenantIdExists ? '✅ Exists' : '❌ Missing'}`);
  console.log(`   RLS enabled: ${rlsEnabled ? '✅ Enabled' : '❌ Disabled'}\n`);
  
  // Run migration if needed
  if (!tenantIdExists || (!skipRLS && !rlsEnabled)) {
    if (dryRun) {
      console.log('📋 Would run migration to add tenant_id and RLS...');
    } else {
      await runMigration(supabase, false);
    }
  } else {
    console.log('✅ Migration already applied\n');
  }
  
  // Populate tenant IDs
  const stats = await populateTenantIds(supabase, config, dryRun);
  
  // Print summary
  console.log('\n📊 Migration Summary:');
  console.log('─'.repeat(80));
  console.log(`   Total vCons: ${stats.totalVCons}`);
  console.log(`   vCons with tenant_id: ${stats.vConsWithTenant}`);
  console.log(`   vCons without tenant_id: ${stats.vConsWithoutTenant}`);
  
  if (stats.vConsWithoutTenant > 0) {
    console.log('\n   ⚠️  Some vCons do not have tenant attachments.');
    console.log('   These vCons will be accessible to all tenants (tenant_id IS NULL).');
    console.log('   Consider adding tenant attachments or manually setting tenant_id.');
  }
  
  if (dryRun) {
    console.log('\n⚠️  This was a dry run. No changes were made.');
    console.log('   Run without --dry-run to apply changes.');
  } else {
    console.log('\n✅ Migration completed successfully!');
  }
  
  console.log();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate-to-rls.ts')) {
  main().catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });
}

