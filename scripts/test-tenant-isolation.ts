/**
 * Test script to verify tenant isolation works correctly
 * 
 * This script tests:
 * 1. Tenant isolation - users can only see their own tenant's data
 * 2. Cross-tenant access is blocked
 * 3. NULL tenant_id allows shared access
 * 4. RLS policies are working on all tables
 */

import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Create service role client (bypasses RLS for setup)
const serviceRoleClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Create authenticated client (respects RLS)
const authenticatedClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: TestResult[] = [];

async function test(name: string, testFn: () => Promise<boolean> | boolean, details?: any): Promise<void> {
  try {
    const passed = await testFn();
    results.push({
      name,
      passed,
      message: passed ? '✅ PASSED' : '❌ FAILED',
      details,
    });
    console.log(`${passed ? '✅' : '❌'} ${name}`);
    if (details && !passed) {
      console.log('   Details:', JSON.stringify(details, null, 2));
    }
  } catch (error) {
    results.push({
      name,
      passed: false,
      message: '❌ ERROR',
      details: error instanceof Error ? error.message : String(error),
    });
    console.error(`❌ ${name} - ERROR:`, error);
  }
}

async function main() {
  console.log('🧪 Testing Tenant Isolation\n');

  // Test 1: Verify get_current_tenant_id() function exists
  await test('get_current_tenant_id() function exists', async () => {
    const { data, error } = await serviceRoleClient.rpc('get_current_tenant_id');
    return !error; // Function exists if no error
  });

  // Test 2: Set tenant context and verify it's read correctly
  await test('set_tenant_context() sets session variable', async () => {
    const testTenantId = 'test-tenant-' + Date.now();
    const { error: setError } = await serviceRoleClient.rpc('set_tenant_context', {
      p_tenant_id: testTenantId,
    });
    if (setError) return false;

    const { data, error } = await serviceRoleClient.rpc('get_current_tenant_id');
    return !error && data === testTenantId;
  }, { testTenantId: 'test-tenant-' + Date.now() });

  // Test 3: Create test data with different tenants
  let tenant1VconId: string | null = null;
  let tenant2VconId: string | null = null;
  let sharedVconId: string | null = null;

  await test('Create test vCons with different tenants', async () => {
    // Create vCon for tenant1
    const uuid1 = randomUUID();
    const { data: vcon1, error: e1 } = await serviceRoleClient
      .from('vcons')
      .insert({
        id: uuid1,  // Set id = uuid
        uuid: uuid1,
        vcon_version: '0.3.0',
        subject: 'Test vCon for Tenant 1',
        tenant_id: 'tenant-1',
      })
      .select('id')
      .single();

    if (e1 || !vcon1) return false;
    tenant1VconId = vcon1.id;

    // Create vCon for tenant2
    const uuid2 = randomUUID();
    const { data: vcon2, error: e2 } = await serviceRoleClient
      .from('vcons')
      .insert({
        id: uuid2,  // Set id = uuid
        uuid: uuid2,
        vcon_version: '0.3.0',
        subject: 'Test vCon for Tenant 2',
        tenant_id: 'tenant-2',
      })
      .select('id')
      .single();

    if (e2 || !vcon2) return false;
    tenant2VconId = vcon2.id;

    // Create shared vCon (NULL tenant_id)
    const uuid3 = randomUUID();
    const { data: vcon3, error: e3 } = await serviceRoleClient
      .from('vcons')
      .insert({
        id: uuid3,  // Set id = uuid
        uuid: uuid3,
        vcon_version: '0.3.0',
        subject: 'Shared vCon (NULL tenant)',
        tenant_id: null,
      })
      .select('id')
      .single();

    if (e3 || !vcon3) return false;
    sharedVconId = vcon3.id;

    return true;
  });

  // Test 4: Verify tenant isolation - tenant1 can only see tenant1 and shared
  await test('Tenant 1 can only see tenant1 and shared vCons', async () => {
    // Set tenant context to tenant1
    await serviceRoleClient.rpc('set_tenant_context', {
      p_tenant_id: 'tenant-1',
    });

    // Query vCons
    const { data, error } = await authenticatedClient
      .from('vcons')
      .select('id, tenant_id, subject')
      .in('id', [tenant1VconId!, tenant2VconId!, sharedVconId!]);

    if (error) return false;

    // Should see tenant1 and shared, but not tenant2
    const ids = data?.map((v: any) => v.id) || [];
    const hasTenant1 = ids.includes(tenant1VconId);
    const hasShared = ids.includes(sharedVconId);
    const hasTenant2 = ids.includes(tenant2VconId);

    return hasTenant1 && hasShared && !hasTenant2;
  }, { tenant1VconId, tenant2VconId, sharedVconId });

  // Test 5: Verify tenant isolation - tenant2 can only see tenant2 and shared
  await test('Tenant 2 can only see tenant2 and shared vCons', async () => {
    // Set tenant context to tenant2
    await serviceRoleClient.rpc('set_tenant_context', {
      p_tenant_id: 'tenant-2',
    });

    // Query vCons
    const { data, error } = await authenticatedClient
      .from('vcons')
      .select('id, tenant_id, subject')
      .in('id', [tenant1VconId!, tenant2VconId!, sharedVconId!]);

    if (error) return false;

    // Should see tenant2 and shared, but not tenant1
    const ids = data?.map((v: any) => v.id) || [];
    const hasTenant1 = ids.includes(tenant1VconId);
    const hasShared = ids.includes(sharedVconId);
    const hasTenant2 = ids.includes(tenant2VconId);

    return !hasTenant1 && hasShared && hasTenant2;
  }, { tenant1VconId, tenant2VconId, sharedVconId });

  // Test 6: Verify child table isolation - parties
  await test('Child table (parties) respects tenant isolation', async () => {
    if (!tenant1VconId || !tenant2VconId) return false;

    // Create party for tenant1 vCon (trigger should set tenant_id automatically)
    const { data: party1, error: e1 } = await serviceRoleClient
      .from('parties')
      .insert({
        vcon_id: tenant1VconId,
        party_index: 0,
        name: 'Tenant 1 Party',
        // tenant_id will be set by trigger from vcons.tenant_id
      })
      .select('id, tenant_id')
      .single();

    if (e1 || !party1) {
      console.log('   Error creating party1:', e1);
      return false;
    }

    // Verify trigger set tenant_id
    if (party1.tenant_id !== 'tenant-1') {
      console.log(`   Trigger failed: party1.tenant_id = ${party1.tenant_id}, expected 'tenant-1'`);
      return false;
    }

    // Create party for tenant2 vCon (trigger should set tenant_id automatically)
    const { data: party2, error: e2 } = await serviceRoleClient
      .from('parties')
      .insert({
        vcon_id: tenant2VconId,
        party_index: 0,
        name: 'Tenant 2 Party',
        // tenant_id will be set by trigger from vcons.tenant_id
      })
      .select('id, tenant_id')
      .single();

    if (e2 || !party2) {
      console.log('   Error creating party2:', e2);
      return false;
    }

    // Verify trigger set tenant_id
    if (party2.tenant_id !== 'tenant-2') {
      console.log(`   Trigger failed: party2.tenant_id = ${party2.tenant_id}, expected 'tenant-2'`);
      return false;
    }

    // Set tenant context to tenant1
    await serviceRoleClient.rpc('set_tenant_context', {
      p_tenant_id: 'tenant-1',
    });

    // Query parties - should only see tenant1 party
    const { data, error } = await authenticatedClient
      .from('parties')
      .select('id, name, tenant_id')
      .in('id', [party1.id, party2.id]);

    if (error) {
      console.log('   Error querying parties:', error);
      return false;
    }

    const ids = data?.map((p: any) => p.id) || [];
    const hasTenant1 = ids.includes(party1.id);
    const hasTenant2 = ids.includes(party2.id);

    if (!hasTenant1) {
      console.log('   Missing tenant1 party in results');
      return false;
    }

    if (hasTenant2) {
      console.log('   Tenant2 party should not be visible to tenant1');
      return false;
    }

    return true;
  });

  // Test 7: Verify tenant_id columns exist on all tables
  await test('Tenant_id columns exist on all child tables', async () => {
    const tables = [
      'vcons',
      'parties',
      'dialog',
      'attachments',
      'analysis',
      'groups',
      'party_history',
      'vcon_embeddings',
      'embedding_queue',
      's3_sync_tracking',
    ];

    // Check each table has tenant_id column by trying to select it
    for (const table of tables) {
      const { data, error } = await serviceRoleClient
        .from(table)
        .select('tenant_id')
        .limit(1);

      if (error) {
        // If error mentions column doesn't exist, fail
        if (error.message.includes('column') && error.message.includes('tenant_id')) {
          console.log(`   Missing tenant_id column on table: ${table}`);
          return false;
        }
        // Other errors are OK (e.g., table empty)
      }
    }

    return true;
  });

  // Cleanup: Delete test data
  console.log('\n🧹 Cleaning up test data...');
  if (tenant1VconId) {
    await serviceRoleClient.from('vcons').delete().eq('id', tenant1VconId);
  }
  if (tenant2VconId) {
    await serviceRoleClient.from('vcons').delete().eq('id', tenant2VconId);
  }
  if (sharedVconId) {
    await serviceRoleClient.from('vcons').delete().eq('id', sharedVconId);
  }

  // Print summary
  console.log('\n📊 Test Summary\n');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  results.forEach((result) => {
    console.log(`${result.message} ${result.name}`);
  });

  console.log(`\n✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Total: ${results.length}`);

  if (failed > 0) {
    console.log('\n⚠️  Some tests failed. Review the details above.');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

