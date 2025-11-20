#!/usr/bin/env tsx

/**
 * Fix Attachment Bodies Script
 * 
 * This script fixes vCons that were loaded with object/array attachment bodies
 * that were not properly serialized to JSON strings. The bodies end up as NULL
 * in the database because PostgreSQL TEXT columns cannot store objects directly.
 * 
 * The script:
 * 1. Re-downloads the original vCon JSON from S3 (if available)
 * 2. Extracts the attachment bodies
 * 3. Properly serializes them to JSON strings
 * 4. Updates the attachments table in the database
 * 
 * Usage:
 *   npx tsx scripts/fix-attachment-bodies.ts <vcon-uuid>
 *   npx tsx scripts/fix-attachment-bodies.ts --all  # Fix all vCons with NULL attachment bodies
 * 
 * Environment Variables:
 *   SUPABASE_URL              Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY Service role key
 *   VCON_S3_BUCKET            S3 bucket name (optional, for re-downloading)
 *   AWS_REGION                AWS region (default: us-east-1)
 * 
 * @author vCon MCP Team
 */

import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

dotenv.config();

interface AttachmentFix {
  vconUuid: string;
  attachmentId: string;
  attachmentIndex: number;
  body: string;
  encoding: string;
}

interface AnalysisFix {
  vconUuid: string;
  analysisId: string;
  analysisIndex: number;
  body: string;
  encoding: string;
}

/**
 * Get vCon from S3
 */
async function getVConFromS3(uuid: string, s3Client: S3Client, bucket: string): Promise<any | null> {
  try {
    // Try to find the vCon in S3 by searching common date patterns
    // This assumes the S3 structure is YYYY/MM/DD/*.vcon
    const now = new Date();
    
    // Try the last 30 days
    for (let daysBack = 0; daysBack < 30; daysBack++) {
      const date = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const key = `${year}/${month}/${day}/${uuid}.vcon`;
      
      try {
        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: key
        });
        
        const response = await s3Client.send(command);
        
        if (response.Body) {
          const chunks: Uint8Array[] = [];
          const stream = response.Body as any;
          
          for await (const chunk of stream) {
            chunks.push(chunk);
          }
          
          const bodyString = Buffer.concat(chunks).toString('utf-8');
          return JSON.parse(bodyString);
        }
      } catch (error: any) {
        // If not found, continue to next date
        if (error.name !== 'NoSuchKey') {
          console.warn(`Error checking ${key}: ${error.message}`);
        }
      }
    }
    
    console.warn(`Could not find vCon ${uuid} in S3`);
    return null;
  } catch (error) {
    console.error(`Error getting vCon from S3: ${error}`);
    return null;
  }
}

/**
 * Fix attachments and analysis for a single vCon
 */
async function fixVConData(
  supabase: SupabaseClient,
  vconUuid: string,
  s3Client: S3Client | null,
  s3Bucket: string | null
): Promise<{ attachmentsFixed: number; analysisFixed: number; errors: number }> {
  let attachmentsFixed = 0;
  let analysisFixed = 0;
  let errors = 0;
  
  try {
    console.log(`\n📦 Processing vCon: ${vconUuid}`);
    
    // Get vCon from database
    const { data: vconData, error: vconError } = await supabase
      .from('vcons')
      .select('id, uuid')
      .eq('uuid', vconUuid)
      .single();
    
    if (vconError || !vconData) {
      console.error(`   ❌ vCon not found in database`);
      return { attachmentsFixed: 0, analysisFixed: 0, errors: 1 };
    }
    
    // Get attachments with NULL or empty bodies
    const { data: attachments, error: attachError } = await supabase
      .from('attachments')
      .select('id, attachment_index, body, type, encoding')
      .eq('vcon_id', vconData.id);
    
    if (attachError) {
      console.error(`   ❌ Error fetching attachments: ${attachError.message}`);
      return { attachmentsFixed: 0, analysisFixed: 0, errors: 1 };
    }
    
    // Get analysis records
    const { data: analysisRecords, error: analysisError } = await supabase
      .from('analysis')
      .select('id, analysis_index, body, type, encoding')
      .eq('vcon_id', vconData.id);
    
    if (analysisError) {
      console.error(`   ❌ Error fetching analysis: ${analysisError.message}`);
      return { attachmentsFixed: 0, analysisFixed: 0, errors: 1 };
    }
    
    console.log(`   Found ${attachments?.length || 0} attachments, ${analysisRecords?.length || 0} analysis`);
    
    // Try to get original vCon from S3
    let originalVCon: any = null;
    if (s3Client && s3Bucket) {
      console.log(`   📥 Attempting to download from S3...`);
      originalVCon = await getVConFromS3(vconUuid, s3Client, s3Bucket);
    }
    
    if (!originalVCon) {
      console.error(`   ❌ Could not retrieve original vCon from S3`);
      console.error(`      Manual fix required - provide vCon JSON file`);
      return { attachmentsFixed: 0, analysisFixed: 0, errors: 1 };
    }
    
    console.log(`   ✅ Retrieved original vCon from S3`);
    
    // Fix attachments
    if (attachments && attachments.length > 0 && originalVCon.attachments && originalVCon.attachments.length > 0) {
      for (const dbAttachment of attachments) {
        const origAttachment = originalVCon.attachments[dbAttachment.attachment_index];
        
        if (!origAttachment) {
          console.warn(`   ⚠️  Attachment index ${dbAttachment.attachment_index} not found in original`);
          continue;
        }
        
        // Check if body needs fixing
        let needsFix = false;
        let newBody = origAttachment.body;
        let newEncoding = origAttachment.encoding;
        
        // If original body is object/array, serialize it
        if (origAttachment.body !== undefined && 
            origAttachment.body !== null && 
            typeof origAttachment.body !== 'string') {
          newBody = JSON.stringify(origAttachment.body);
          newEncoding = origAttachment.encoding || 'json';
          needsFix = true;
        }
        
        // Also fix if current body is NULL but original has content
        if (!dbAttachment.body && newBody) {
          needsFix = true;
        }
        
        if (needsFix) {
          const { error: updateError } = await supabase
            .from('attachments')
            .update({
              body: newBody,
              encoding: newEncoding
            })
            .eq('id', dbAttachment.id);
          
          if (updateError) {
            console.error(`   ❌ Failed to update attachment ${dbAttachment.attachment_index}: ${updateError.message}`);
            errors++;
          } else {
            console.log(`   ✅ Fixed attachment ${dbAttachment.attachment_index} (type: ${dbAttachment.type})`);
            attachmentsFixed++;
          }
        } else {
          console.log(`   ⏭️  Attachment ${dbAttachment.attachment_index} already correct`);
        }
      }
    }
    
    // Fix analysis
    if (analysisRecords && analysisRecords.length > 0 && originalVCon.analysis && originalVCon.analysis.length > 0) {
      for (const dbAnalysis of analysisRecords) {
        const origAnalysis = originalVCon.analysis[dbAnalysis.analysis_index];
        
        if (!origAnalysis) {
          console.warn(`   ⚠️  Analysis index ${dbAnalysis.analysis_index} not found in original`);
          continue;
        }
        
        // Check if body needs fixing
        let needsFix = false;
        let newBody = origAnalysis.body;
        let newEncoding = origAnalysis.encoding;
        
        // If original body is object/array, serialize it
        if (origAnalysis.body !== undefined && 
            origAnalysis.body !== null && 
            typeof origAnalysis.body !== 'string') {
          newBody = JSON.stringify(origAnalysis.body);
          // Preserve existing encoding if set, otherwise use 'json'
          newEncoding = origAnalysis.encoding || 'json';
          needsFix = true;
        }
        
        // Also fix if current body is NULL but original has content
        if (!dbAnalysis.body && newBody) {
          needsFix = true;
        }
        
        if (needsFix) {
          const { error: updateError } = await supabase
            .from('analysis')
            .update({
              body: newBody,
              encoding: newEncoding
            })
            .eq('id', dbAnalysis.id);
          
          if (updateError) {
            console.error(`   ❌ Failed to update analysis ${dbAnalysis.analysis_index}: ${updateError.message}`);
            errors++;
          } else {
            console.log(`   ✅ Fixed analysis ${dbAnalysis.analysis_index} (type: ${dbAnalysis.type})`);
            analysisFixed++;
          }
        } else {
          console.log(`   ⏭️  Analysis ${dbAnalysis.analysis_index} already correct`);
        }
      }
    }
    
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    errors++;
  }
  
  return { attachmentsFixed, analysisFixed, errors };
}

/**
 * Find all vCons with NULL attachment or analysis bodies
 * Uses direct table queries instead of RPC to avoid timeouts
 */
async function findVConsWithNullBodies(supabase: SupabaseClient): Promise<string[]> {
  const uuidsSet = new Set<string>();
  
  // Find vCons with NULL attachment bodies (limit to reasonable batch size)
  console.log('   Checking attachments...');
  const { data: attachmentVCons, error: attError } = await supabase
    .from('attachments')
    .select('vcon_id')
    .or('body.is.null,body.eq.')
    .limit(1000);
  
  if (attError) {
    throw new Error(`Failed to find attachments: ${attError.message}`);
  }
  
  if (attachmentVCons && attachmentVCons.length > 0) {
    // Get UUIDs for these vcon_ids
    const vconIds = [...new Set(attachmentVCons.map(a => a.vcon_id))];
    console.log(`   Found ${vconIds.length} vCons with NULL attachment bodies`);
    
    // Get UUIDs in batches to avoid URL length limits
    const batchSize = 100;
    for (let i = 0; i < vconIds.length; i += batchSize) {
      const batch = vconIds.slice(i, i + batchSize);
      const { data: vcons, error: vconError } = await supabase
        .from('vcons')
        .select('uuid')
        .in('id', batch);
      
      if (vconError) {
        console.warn(`Warning: Failed to get UUIDs for batch: ${vconError.message}`);
        continue;
      }
      
      if (vcons) {
        vcons.forEach(v => uuidsSet.add(v.uuid));
      }
    }
  }
  
  // Find vCons with NULL analysis bodies (limit to reasonable batch size)
  console.log('   Checking analysis...');
  const { data: analysisVCons, error: anaError } = await supabase
    .from('analysis')
    .select('vcon_id')
    .or('body.is.null,body.eq.')
    .limit(1000);
  
  if (anaError) {
    throw new Error(`Failed to find analysis: ${anaError.message}`);
  }
  
  if (analysisVCons && analysisVCons.length > 0) {
    // Get UUIDs for these vcon_ids
    const vconIds = [...new Set(analysisVCons.map(a => a.vcon_id))];
    console.log(`   Found ${vconIds.length} vCons with NULL analysis bodies`);
    
    // Get UUIDs in batches
    const batchSize = 100;
    for (let i = 0; i < vconIds.length; i += batchSize) {
      const batch = vconIds.slice(i, i + batchSize);
      const { data: vcons, error: vconError } = await supabase
        .from('vcons')
        .select('uuid')
        .in('id', batch);
      
      if (vconError) {
        console.warn(`Warning: Failed to get UUIDs for batch: ${vconError.message}`);
        continue;
      }
      
      if (vcons) {
        vcons.forEach(v => uuidsSet.add(v.uuid));
      }
    }
  }
  
  return Array.from(uuidsSet);
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: npx tsx scripts/fix-attachment-bodies.ts <vcon-uuid>');
    console.error('   or: npx tsx scripts/fix-attachment-bodies.ts --all');
    process.exit(1);
  }
  
  // Initialize Supabase client
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  
  // Initialize S3 client (optional)
  let s3Client: S3Client | null = null;
  const s3Bucket = process.env.VCON_S3_BUCKET;
  
  if (s3Bucket) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: fromNodeProviderChain()
    });
    console.log(`📦 Using S3 bucket: ${s3Bucket}`);
  } else {
    console.warn('⚠️  VCON_S3_BUCKET not set - cannot retrieve original vCons from S3');
    console.warn('   This script requires access to the original vCon JSON files');
    process.exit(1);
  }
  
  console.log('🔧 Attachment & Analysis Body Fixer\n');
  
  const fixAll = args.includes('--all');
  let vconUuids: string[] = [];
  
  if (fixAll) {
    console.log('🔍 Finding all vCons with NULL attachment or analysis bodies...\n');
    vconUuids = await findVConsWithNullBodies(supabase);
    console.log(`Found ${vconUuids.length} vCons with NULL bodies\n`);
  } else {
    vconUuids = args;
  }
  
  if (vconUuids.length === 0) {
    console.log('✅ No vCons to fix!');
    return;
  }
  
  let totalAttachmentsFixed = 0;
  let totalAnalysisFixed = 0;
  let totalErrors = 0;
  
  for (const uuid of vconUuids) {
    const result = await fixVConData(supabase, uuid, s3Client, s3Bucket);
    totalAttachmentsFixed += result.attachmentsFixed;
    totalAnalysisFixed += result.analysisFixed;
    totalErrors += result.errors;
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`vCons processed:       ${vconUuids.length}`);
  console.log(`Attachments fixed:     ${totalAttachmentsFixed}`);
  console.log(`Analysis fixed:        ${totalAnalysisFixed}`);
  console.log(`Errors:                ${totalErrors}`);
  console.log('='.repeat(60));
  console.log('\n✅ Done!\n');
}

main().catch(console.error);

