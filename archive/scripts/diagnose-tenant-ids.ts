#!/usr/bin/env tsx

/**
 * Diagnostic script to analyze vCons without tenant_id
 * 
 * This script helps understand why some vCons don't have tenant_id assigned:
 * - Checks if vCons have attachments
 * - Checks if they have tenant-type attachments
 * - Analyzes the structure of tenant attachments
 * - Provides statistics and sample data
 * 
 * Usage:
 *   SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   RLS_ENABLED=true \
 *   TENANT_ATTACHMENT_TYPE=tenant \
 *   TENANT_JSON_PATH=id \
 *   npx tsx scripts/diagnose-tenant-ids.ts [options]
 * 
 * Options:
 *   --limit=N        Limit analysis to N vCons (default: 100)
 *   --sample         Show sample vCons and their attachments
 *   --stats-only     Only show statistics, no samples
 */

import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getTenantConfig } from '../src/config/tenant-config.js';

dotenv.config();

interface DiagnosticStats {
  totalVCons: number;
  withTenantId: number;
  withoutTenantId: number;
  withAttachments: number;
  withTenantAttachments: number;
  tenantAttachmentTypes: { [key: string]: number };
  sampleVCons: Array<{
    uuid: string;
    created_at: string;
    hasAttachments: boolean;
    attachmentCount: number;
    hasTenantAttachment: boolean;
    tenantAttachmentBody?: string;
    extractedTenantId?: string;
  }>;
}

async function diagnoseTenantIds(
  supabase: SupabaseClient,
  limit: number = 100,
  showSamples: boolean = true
): Promise<DiagnosticStats> {
  const tenantConfig = getTenantConfig();
  
  console.log('🔍 Diagnosing tenant_id assignment...\n');
  console.log(`Configuration:`);
  console.log(`  RLS Enabled: ${tenantConfig.enabled}`);
  console.log(`  Tenant Attachment Type: ${tenantConfig.attachmentType}`);
  console.log(`  Tenant JSON Path: ${tenantConfig.jsonPath}\n`);

  // Get overall statistics
  const { data: totalData, error: totalError } = await supabase
    .from('vcons')
    .select('id, tenant_id', { count: 'exact', head: false })
    .limit(1);

  if (totalError) throw totalError;

  const { count: totalCount } = await supabase
    .from('vcons')
    .select('*', { count: 'exact', head: true });

  const { count: withTenantCount } = await supabase
    .from('vcons')
    .select('*', { count: 'exact', head: true })
    .not('tenant_id', 'is', null);

  const { count: withoutTenantCount } = await supabase
    .from('vcons')
    .select('*', { count: 'exact', head: true })
    .is('tenant_id', null);

  // Get vCons without tenant_id and their attachments
  const { data: vconsWithoutTenant, error: vconsError } = await supabase
    .from('vcons')
    .select(`
      id,
      uuid,
      created_at,
      tenant_id,
      attachments!inner(
        id,
        type,
        body,
        encoding
      )
    `)
    .is('tenant_id', null)
    .limit(limit);

  if (vconsError) throw vconsError;

  // Analyze attachments
  let withAttachments = 0;
  let withTenantAttachments = 0;
  const tenantAttachmentTypes: { [key: string]: number } = {};
  const sampleVCons: DiagnosticStats['sampleVCons'] = [];

  // Get all vCons without tenant_id (for attachment count)
  const { data: allVConsWithoutTenant } = await supabase
    .from('vcons')
    .select('id')
    .is('tenant_id', null)
    .limit(10000);

  // Check which ones have attachments
  if (allVConsWithoutTenant && allVConsWithoutTenant.length > 0) {
    const vconIds = allVConsWithoutTenant.map(v => v.id);
    
    const { data: attachmentsData } = await supabase
      .from('attachments')
      .select('vcon_id, type')
      .in('vcon_id', vconIds);

    if (attachmentsData) {
      const vconsWithAttachments = new Set(attachmentsData.map(a => a.vcon_id));
      withAttachments = vconsWithAttachments.size;

      // Count tenant attachment types
      attachmentsData
        .filter(a => a.type === tenantConfig.attachmentType)
        .forEach(a => {
          tenantAttachmentTypes[a.type] = (tenantAttachmentTypes[a.type] || 0) + 1;
        });
      
      withTenantAttachments = tenantAttachmentTypes[tenantConfig.attachmentType] || 0;
    }
  }

  // Sample analysis
  if (showSamples && vconsWithoutTenant) {
    for (const vcon of vconsWithoutTenant.slice(0, Math.min(10, limit))) {
      const attachments = (vcon as any).attachments || [];
      const tenantAttachments = attachments.filter((a: any) => a.type === tenantConfig.attachmentType);
      
      let extractedTenantId: string | undefined;
      let tenantAttachmentBody: string | undefined;

      if (tenantAttachments.length > 0) {
        const tenantAtt = tenantAttachments[0];
        tenantAttachmentBody = tenantAtt.body;
        
        // Try to extract tenant ID
        try {
          if (tenantAtt.body) {
            const bodyData = JSON.parse(tenantAtt.body);
            const pathParts = tenantConfig.jsonPath.split('.');
            let value: any = bodyData;
            
            for (const part of pathParts) {
              if (value === null || value === undefined || typeof value !== 'object') {
                break;
              }
              value = value[part];
            }
            
            if (value !== null && value !== undefined) {
              extractedTenantId = String(value);
            }
          }
        } catch (e) {
          // Not valid JSON or extraction failed
        }
      }

      sampleVCons.push({
        uuid: vcon.uuid,
        created_at: vcon.created_at,
        hasAttachments: attachments.length > 0,
        attachmentCount: attachments.length,
        hasTenantAttachment: tenantAttachments.length > 0,
        tenantAttachmentBody,
        extractedTenantId,
      });
    }
  }

  return {
    totalVCons: totalCount || 0,
    withTenantId: withTenantCount || 0,
    withoutTenantId: withoutTenantCount || 0,
    withAttachments,
    withTenantAttachments,
    tenantAttachmentTypes,
    sampleVCons,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '100');
  const showSamples = !args.includes('--stats-only');
  const sampleOnly = args.includes('--sample');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Error: Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)');
    console.error('\n💡 For local Supabase, you can use:');
    console.error('   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU');
    console.error('\n   Or get the service role key from: supabase status');
    process.exit(1);
  }

  // Validate the key format (basic check)
  if (supabaseKey === 'your_key' || supabaseKey.length < 50) {
    console.error('❌ Error: Invalid Supabase key provided');
    console.error('   The key appears to be a placeholder or invalid');
    console.error('\n💡 For local Supabase, try:');
    console.error('   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    const stats = await diagnoseTenantIds(supabase, limit, showSamples);

    console.log('='.repeat(60));
    console.log('📊 DIAGNOSTIC SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total vCons:           ${stats.totalVCons.toLocaleString()}`);
    console.log(`✅ With tenant_id:     ${stats.withTenantId.toLocaleString()} (${((stats.withTenantId / stats.totalVCons) * 100).toFixed(1)}%)`);
    console.log(`⚠️  Without tenant_id:  ${stats.withoutTenantId.toLocaleString()} (${((stats.withoutTenantId / stats.totalVCons) * 100).toFixed(1)}%)`);
    console.log();

    if (stats.withoutTenantId > 0) {
      console.log('📎 Attachment Analysis (vCons without tenant_id):');
      console.log(`   vCons with any attachments:     ${stats.withAttachments.toLocaleString()}`);
      console.log(`   vCons with tenant attachments: ${stats.withTenantAttachments.toLocaleString()}`);
      console.log(`   vCons with no attachments:      ${(stats.withoutTenantId - stats.withAttachments).toLocaleString()}`);
      console.log();

      if (Object.keys(stats.tenantAttachmentTypes).length > 0) {
        console.log('📋 Tenant Attachment Types Found:');
        Object.entries(stats.tenantAttachmentTypes).forEach(([type, count]) => {
          console.log(`   ${type}: ${count.toLocaleString()}`);
        });
        console.log();
      }

      if (showSamples && stats.sampleVCons.length > 0) {
        console.log('='.repeat(60));
        console.log(`🔍 SAMPLE ANALYSIS (first ${Math.min(10, limit)} vCons without tenant_id)`);
        console.log('='.repeat(60));
        
        stats.sampleVCons.forEach((vcon, idx) => {
          console.log(`\n${idx + 1}. UUID: ${vcon.uuid}`);
          console.log(`   Created: ${vcon.created_at}`);
          console.log(`   Attachments: ${vcon.attachmentCount} total`);
          console.log(`   Has tenant attachment: ${vcon.hasTenantAttachment ? '✅' : '❌'}`);
          
          if (vcon.hasTenantAttachment && vcon.tenantAttachmentBody) {
            console.log(`   Tenant attachment body: ${vcon.tenantAttachmentBody.substring(0, 200)}${vcon.tenantAttachmentBody.length > 200 ? '...' : ''}`);
            if (vcon.extractedTenantId) {
              console.log(`   ✅ Extracted tenant_id: ${vcon.extractedTenantId}`);
            } else {
              console.log(`   ⚠️  Could not extract tenant_id from body`);
              console.log(`      Expected path: ${getTenantConfig().jsonPath}`);
            }
          } else if (!vcon.hasAttachments) {
            console.log(`   ⚠️  No attachments at all`);
          } else {
            console.log(`   ⚠️  Has attachments but none with type='${getTenantConfig().attachmentType}'`);
          }
        });
        console.log();
      }
    }

    console.log('='.repeat(60));
    console.log('💡 Recommendations:');
    
    if (stats.withoutTenantId - stats.withAttachments > 0) {
      console.log(`   • ${(stats.withoutTenantId - stats.withAttachments).toLocaleString()} vCons have no attachments`);
      console.log(`     → Add tenant attachments to these vCons`);
    }
    
    if (stats.withAttachments - stats.withTenantAttachments > 0) {
      console.log(`   • ${(stats.withAttachments - stats.withTenantAttachments).toLocaleString()} vCons have attachments but no tenant attachment`);
      console.log(`     → Add attachments with type='${getTenantConfig().attachmentType}'`);
    }
    
    if (stats.withTenantAttachments > 0 && stats.sampleVCons.some(s => s.hasTenantAttachment && !s.extractedTenantId)) {
      console.log(`   • Some vCons have tenant attachments but extraction failed`);
      console.log(`     → Check JSON path '${getTenantConfig().jsonPath}' matches attachment body structure`);
      console.log(`     → Verify attachment body is valid JSON`);
    }

    console.log('='.repeat(60));

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch(console.error);

