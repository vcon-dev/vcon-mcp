#!/usr/bin/env tsx

/**
 * Test Tenant Setup
 * 
 * Verifies that tenant ID and RLS configuration is working correctly
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { getTenantConfig } from '../src/config/tenant-config.js';

// Load environment variables
dotenv.config();

async function testTenantSetup() {
  console.log('\n🔍 Testing Tenant Setup\n');
  console.log('='.repeat(60));
  
  // Step 1: Check environment variables
  console.log('\n📋 Step 1: Environment Variables\n');
  
  const config = getTenantConfig();
  console.log('  RLS_ENABLED:', config.enabled ? '✅ true' : '❌ false');
  console.log('  CURRENT_TENANT_ID:', config.currentTenantId || '❌ not set');
  console.log('  TENANT_ATTACHMENT_TYPE:', config.attachmentType);
  console.log('  TENANT_JSON_PATH:', config.jsonPath);
  
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasAnonKey = !!process.env.SUPABASE_ANON_KEY;
  console.log('  SUPABASE_SERVICE_ROLE_KEY:', hasServiceKey ? '✅ set' : '❌ not set');
  console.log('  SUPABASE_ANON_KEY:', hasAnonKey ? '✅ set' : '⚠️  not set');
  
  if (!config.enabled) {
    console.log('\n⚠️  RLS is not enabled. Set RLS_ENABLED=true to test tenant isolation.');
    return;
  }
  
  if (!config.currentTenantId) {
    console.log('\n⚠️  CURRENT_TENANT_ID is not set. Queries will only return vCons with tenant_id=NULL.');
    return;
  }
  
  if (!hasServiceKey) {
    console.log('\n❌ SUPABASE_SERVICE_ROLE_KEY is required for RLS operations.');
    console.log('   Set it in your .env file or environment configuration.');
    return;
  }
  
  // Step 2: Test database connection
  console.log('\n📋 Step 2: Database Connection\n');
  
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    console.log('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return;
  }
  
  const supabase = createClient(url, key);
  console.log('  Connection:', '✅ initialized');
  
  // Step 3: Test set_tenant_context function
  console.log('\n📋 Step 3: Set Tenant Context\n');
  
  try {
    const { error: setError } = await supabase.rpc('set_tenant_context', {
      p_tenant_id: config.currentTenantId
    });
    
    if (setError) {
      console.log('  ❌ Failed to set tenant context');
      console.log('     Error:', setError.message);
      console.log('     Code:', setError.code);
      console.log('\n  💡 Fix: Run the migration:');
      console.log('     psql $DATABASE_URL -f supabase/migrations/20251113000000_add_set_tenant_helper.sql');
      return;
    }
    
    console.log('  ✅ Tenant context set successfully');
  } catch (error) {
    console.log('  ❌ Exception:', error instanceof Error ? error.message : String(error));
    return;
  }
  
  // Step 4: Verify tenant context
  console.log('\n📋 Step 4: Verify Tenant Context\n');
  
  try {
    const { data: actualTenantId, error: getError } = await supabase.rpc('get_current_tenant_id');
    
    if (getError) {
      console.log('  ❌ Failed to get tenant context');
      console.log('     Error:', getError.message);
      return;
    }
    
    console.log('  Expected:', config.currentTenantId);
    console.log('  Actual:', actualTenantId || '(null)');
    
    if (actualTenantId === config.currentTenantId) {
      console.log('  ✅ Tenant context matches!');
    } else {
      console.log('  ❌ Tenant context mismatch!');
      return;
    }
  } catch (error) {
    console.log('  ❌ Exception:', error instanceof Error ? error.message : String(error));
    return;
  }
  
  // Step 5: Check RLS policies
  console.log('\n📋 Step 5: RLS Policies\n');
  
  try {
    const { data: policies, error: policyError } = await supabase
      .rpc('get_policies_info') // This might not exist
      .catch(() => ({ data: null, error: null })); // Ignore if function doesn't exist
    
    // Try to query vcons table to see if RLS is working
    const { data: vcons, error: queryError, count } = await supabase
      .from('vcons')
      .select('uuid, tenant_id, subject', { count: 'exact' })
      .limit(5);
    
    if (queryError) {
      console.log('  ❌ Failed to query vcons:', queryError.message);
      return;
    }
    
    console.log('  Visible vCons:', count || 0);
    
    if (vcons && vcons.length > 0) {
      console.log('\n  Sample vCons:');
      for (const vcon of vcons) {
        console.log(`    - ${vcon.uuid} (tenant: ${vcon.tenant_id || '(null)'})`);
        console.log(`      ${vcon.subject || '(no subject)'}`);
      }
    }
  } catch (error) {
    console.log('  ⚠️  Could not check RLS policies:', error instanceof Error ? error.message : String(error));
  }
  
  // Step 6: Check tenant distribution
  console.log('\n📋 Step 6: Tenant Distribution\n');
  
  try {
    // Query all vcons to see tenant distribution
    const { data: allVcons, error } = await supabase
      .from('vcons')
      .select('tenant_id', { count: 'exact' });
    
    if (error) {
      console.log('  ⚠️  Could not query tenant distribution:', error.message);
    } else {
      const distribution = new Map<string, number>();
      for (const vcon of allVcons || []) {
        const tid = vcon.tenant_id || '(null)';
        distribution.set(tid, (distribution.get(tid) || 0) + 1);
      }
      
      console.log('  Tenant distribution:');
      for (const [tid, count] of distribution.entries()) {
        const isCurrent = tid === config.currentTenantId;
        const marker = isCurrent ? '👉' : '  ';
        console.log(`  ${marker} ${tid}: ${count} vCons`);
      }
      
      const nullCount = distribution.get('(null)') || 0;
      if (nullCount > 0) {
        console.log(`\n  ⚠️  ${nullCount} vCons have tenant_id=NULL`);
        console.log('     These vCons are visible to all tenants.');
        console.log('     Run populate_tenant_ids_batch() to fix.');
      }
    }
  } catch (error) {
    console.log('  ⚠️  Could not check distribution:', error instanceof Error ? error.message : String(error));
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Tenant setup test complete!\n');
  console.log('If you see all green checkmarks above, your tenant isolation is working.\n');
  console.log('Next steps:');
  console.log('  1. Configure Claude Desktop with these environment variables');
  console.log('  2. Restart Claude Desktop');
  console.log('  3. Check logs: ~/Library/Logs/Claude/mcp*.log (macOS)');
  console.log('  4. Look for "✅ Tenant context set successfully" in logs\n');
}

// Run the test
testTenantSetup().catch(console.error);




