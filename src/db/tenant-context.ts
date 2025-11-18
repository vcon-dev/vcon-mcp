/**
 * Tenant Context Management for RLS
 * 
 * Handles setting PostgreSQL session variables for Row Level Security
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getTenantConfig } from '../config/tenant-config.js';
import { logWithContext } from '../observability/instrumentation.js';

/**
 * Set tenant context in PostgreSQL session for RLS policies
 * 
 * This sets the app.current_tenant_id session variable that
 * get_current_tenant_id() function reads in RLS policies
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
    logWithContext('warn', 'RLS is enabled but CURRENT_TENANT_ID is not set', {
      message: 'Queries will only return vCons with tenant_id=NULL',
      hint: 'Set CURRENT_TENANT_ID environment variable to filter by tenant',
    });
    return;
  }
  
  try {
    // Set the PostgreSQL session variable using our helper function
    // This is what get_current_tenant_id() will read
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
      error_message: error instanceof Error ? error.message : String(error),
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
      error_message: error instanceof Error ? error.message : String(error),
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
      error_message: error instanceof Error ? error.message : String(error),
    });
  }
}

