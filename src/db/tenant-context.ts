/**
 * Tenant Context Management for RLS
 * 
 * Handles setting PostgreSQL session variables for Row Level Security
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getTenantConfig } from '../config/tenant-config.js';
import { logWithContext } from '../observability/instrumentation.js';
import { extractErrorMessage } from '../utils/errors.js';

/**
 * Set app.current_tenant_id on one pooled database connection (legacy).
 *
 * This does not scope reads. The service role key bypasses row level security,
 * so table reads through it return every tenant's rows whatever is set here.
 * Before the strict pack, get_current_tenant_id() fell back to this session
 * variable when a request carried no tenant claim, so it changed only the RPCs
 * that call get_current_tenant_id(), and only on the pooled connection the call
 * happened to use; that connection then handed the tenant to later requests
 * with no claim. Migration 20261109163739_revoke_anon_read_paths.sql limits
 * set_tenant_context to service_role, and the strict pack (supabase/strict/)
 * makes get_current_tenant_id() read the signed JWT claim only, so with the
 * pack applied this call has no effect. Tenant scoping comes from a JWT that
 * carries tenant_id. See docs/guide/strict-tenant-pack.md.
 */
export async function setTenantContext(
  supabase: SupabaseClient
): Promise<void> {
  const config = getTenantConfig();
  
  // Debug: Log configuration
  logWithContext('debug', 'Tenant configuration loaded', {
    rls_enabled: config.enabled,
    current_tenant_id: config.currentTenantId || '(not set)',
    attachment_type: config.attachmentType,
    json_path: config.jsonPath,
  });
  
  if (!config.enabled) {
    logWithContext('info', 'RLS is disabled, skipping tenant context setup');
    return;
  }
  
  if (!config.currentTenantId) {
    // The message below is not accurate. With the service role key, which
    // bypasses row level security, table reads return every tenant's rows
    // whether or not CURRENT_TENANT_ID is set. Without a tenant the search RPCs
    // also returned every tenant's rows before the strict pack, and return none
    // after it. Only an `authenticated` JWT with no tenant claim was limited to
    // rows with a NULL tenant, and the strict pack closes that as well.
    logWithContext('warn', 'RLS is enabled but CURRENT_TENANT_ID is not set', {
      message: 'Queries will only return vCons with tenant_id=NULL',
      hint: 'Set CURRENT_TENANT_ID environment variable to filter by tenant',
    });
    return;
  }
  
  try {
    // Sets app.current_tenant_id on whichever pooled connection serves this
    // call. get_current_tenant_id() read it as a fallback before the strict
    // pack; with the pack applied it is ignored.
    const { error } = await supabase.rpc('set_tenant_context', {
      p_tenant_id: config.currentTenantId,
    });
    
    if (error) {
      logWithContext('error', 'Failed to set tenant context', {
        error_message: error.message,
        error_code: error.code,
        error_details: error.details,
        tenant_id: config.currentTenantId,
        hint: 'Make sure you have run the migration: 20251113000000_add_set_tenant_helper.sql',
      });
      throw error;
    }
    
    logWithContext('info', '✅ Tenant context set successfully', {
      tenant_id: config.currentTenantId,
      session_var: 'app.current_tenant_id',
    });
  } catch (error) {
    logWithContext('error', 'Exception setting tenant context', {
      error_message: extractErrorMessage(error),
      tenant_id: config.currentTenantId,
    });
    throw error;
  }
}

/**
 * Verify tenant context is working by testing RLS
 */
export async function verifyTenantContext(
  supabase: SupabaseClient
): Promise<void> {
  const config = getTenantConfig();
  
  if (!config.enabled) {
    return;
  }
  
  try {
    // Check what tenant ID the database thinks we have
    const { data, error } = await supabase.rpc('get_current_tenant_id');
    
    if (error) {
      logWithContext('warn', 'Could not verify tenant context', {
        error_message: error.message,
      });
      return;
    }
    
    logWithContext('info', 'Tenant context verification', {
      expected_tenant_id: config.currentTenantId || '(not set)',
      actual_tenant_id: data || '(null)',
      match: data === config.currentTenantId,
    });
    
    if (config.currentTenantId && data !== config.currentTenantId) {
      logWithContext('error', '❌ Tenant context mismatch!', {
        expected: config.currentTenantId,
        actual: data,
        message: 'RLS policies may not work correctly',
      });
    }
  } catch (error) {
    logWithContext('warn', 'Exception during tenant context verification', {
      error_message: extractErrorMessage(error),
    });
  }
}

/**
 * Debug: Show what vCons are visible with current tenant context
 */
export async function debugTenantVisibility(
  supabase: SupabaseClient
): Promise<void> {
  const config = getTenantConfig();
  
  if (!config.enabled) {
    return;
  }
  
  try {
    // Count vCons by tenant
    const { data: counts, error } = await supabase
      .from('vcons')
      .select('tenant_id', { count: 'exact', head: false });
    
    if (error) {
      logWithContext('warn', 'Could not query vCon tenant distribution', {
        error_message: error.message,
      });
      return;
    }
    
    // Group by tenant_id
    const tenantCounts = new Map<string, number>();
    for (const row of counts || []) {
      const tid = row.tenant_id || '(null)';
      tenantCounts.set(tid, (tenantCounts.get(tid) || 0) + 1);
    }
    
    logWithContext('info', 'vCon visibility report', {
      current_tenant_id: config.currentTenantId || '(not set)',
      visible_vcons: counts?.length || 0,
      tenant_distribution: Object.fromEntries(tenantCounts),
      message: 'These are the vCons visible with current RLS context',
    });
  } catch (error) {
    logWithContext('warn', 'Exception during tenant visibility debug', {
      error_message: extractErrorMessage(error),
    });
  }
}

