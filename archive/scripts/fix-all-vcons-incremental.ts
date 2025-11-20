#!/usr/bin/env tsx

/**
 * Fix All vCons Incrementally
 * 
 * Processes vCons in batches by date to avoid database timeouts.
 * This is more practical for large databases than scanning everything at once.
 * 
 * Usage:
 *   npx tsx scripts/fix-all-vcons-incremental.ts [days] [batch-size]
 * 
 * Arguments:
 *   days        Number of days to look back (default: 30)
 *   batch-size  Number of vCons to process per batch (default: 50)
 * 
 * Environment Variables:
 *   SUPABASE_URL              Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY Service role key
 *   VCON_S3_BUCKET            S3 bucket name
 *   AWS_REGION                AWS region
 */

import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

dotenv.config();

// Import the fix function from the main script
// For now, we'll duplicate the logic here

interface FixResult {
  attachmentsFixed: number;
  analysisFixed: number;
  errors: number;
}

async function getVConFromS3(uuid: string, s3Client: S3Client, bucket: string): Promise<any | null> {
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
      if (error.name !== 'NoSuchKey') {
        // console.warn(`Error checking ${key}: ${error.message}`);
      }
    }
  }
  
  return null;
}

async function fixVConData(
  supabase: SupabaseClient,
  vconUuid: string,
  s3Client: S3Client,
  s3Bucket: string
): Promise<FixResult> {
  let attachmentsFixed = 0;
  let analysisFixed = 0;
  let errors = 0;
  
  try {
    const { data: vconData, error: vconError } = await supabase
      .from('vcons')
      .select('id, uuid')
      .eq('uuid', vconUuid)
      .single();
    
    if (vconError || !vconData) {
      return { attachmentsFixed: 0, analysisFixed: 0, errors: 1 };
    }
    
    const originalVCon = await getVConFromS3(vconUuid, s3Client, s3Bucket);
    
    if (!originalVCon) {
      return { attachmentsFixed: 0, analysisFixed: 0, errors: 1 };
    }
    
    // Fix attachments
    const { data: attachments } = await supabase
      .from('attachments')
      .select('id, attachment_index, body, type, encoding')
      .eq('vcon_id', vconData.id);
    
    if (attachments && attachments.length > 0 && originalVCon.attachments) {
      for (const dbAttachment of attachments) {
        const origAttachment = originalVCon.attachments[dbAttachment.attachment_index];
        
        if (!origAttachment) continue;
        
        let needsFix = false;
        let newBody = origAttachment.body;
        let newEncoding = origAttachment.encoding;
        
        if (origAttachment.body !== undefined && 
            origAttachment.body !== null && 
            typeof origAttachment.body !== 'string') {
          newBody = JSON.stringify(origAttachment.body);
          newEncoding = origAttachment.encoding || 'json';
          needsFix = true;
        }
        
        if (!dbAttachment.body && newBody) {
          needsFix = true;
        }
        
        if (needsFix) {
          const { error: updateError } = await supabase
            .from('attachments')
            .update({ body: newBody, encoding: newEncoding })
            .eq('id', dbAttachment.id);
          
          if (!updateError) {
            attachmentsFixed++;
          } else {
            errors++;
          }
        }
      }
    }
    
    // Fix analysis
    const { data: analysisRecords } = await supabase
      .from('analysis')
      .select('id, analysis_index, body, type, encoding')
      .eq('vcon_id', vconData.id);
    
    if (analysisRecords && analysisRecords.length > 0 && originalVCon.analysis) {
      for (const dbAnalysis of analysisRecords) {
        const origAnalysis = originalVCon.analysis[dbAnalysis.analysis_index];
        
        if (!origAnalysis) continue;
        
        let needsFix = false;
        let newBody = origAnalysis.body;
        let newEncoding = origAnalysis.encoding;
        
        if (origAnalysis.body !== undefined && 
            origAnalysis.body !== null && 
            typeof origAnalysis.body !== 'string') {
          newBody = JSON.stringify(origAnalysis.body);
          newEncoding = origAnalysis.encoding || 'json';
          needsFix = true;
        }
        
        if (!dbAnalysis.body && newBody) {
          needsFix = true;
        }
        
        if (needsFix) {
          const { error: updateError } = await supabase
            .from('analysis')
            .update({ body: newBody, encoding: newEncoding })
            .eq('id', dbAnalysis.id);
          
          if (!updateError) {
            analysisFixed++;
          } else {
            errors++;
          }
        }
      }
    }
    
  } catch (error: any) {
    errors++;
  }
  
  return { attachmentsFixed, analysisFixed, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const daysBack = parseInt(args[0] || '30');
  const batchSize = parseInt(args[1] || '50');
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const s3Bucket = process.env.VCON_S3_BUCKET;
  
  if (!supabaseUrl || !supabaseKey || !s3Bucket) {
    console.error('❌ Missing required environment variables');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  
  const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: fromNodeProviderChain()
  });
  
  console.log('🔧 Incremental vCon Fixer');
  console.log(`📅 Processing vCons from last ${daysBack} days`);
  console.log(`📦 Batch size: ${batchSize}\n`);
  
  // Get vCons from the last N days
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  
  const { data: vcons, error } = await supabase
    .from('vcons')
    .select('uuid, created_at')
    .gte('created_at', cutoffDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(batchSize);
  
  if (error) {
    console.error(`❌ Error fetching vCons: ${error.message}`);
    process.exit(1);
  }
  
  if (!vcons || vcons.length === 0) {
    console.log('✅ No vCons found in date range');
    return;
  }
  
  console.log(`Found ${vcons.length} vCons to process\n`);
  
  let totalAttachmentsFixed = 0;
  let totalAnalysisFixed = 0;
  let totalErrors = 0;
  let processed = 0;
  
  for (const vcon of vcons) {
    processed++;
    process.stdout.write(`\r[${processed}/${vcons.length}] Processing ${vcon.uuid}...`);
    
    const result = await fixVConData(supabase, vcon.uuid, s3Client, s3Bucket);
    totalAttachmentsFixed += result.attachmentsFixed;
    totalAnalysisFixed += result.analysisFixed;
    totalErrors += result.errors;
    
    if (result.attachmentsFixed > 0 || result.analysisFixed > 0) {
      process.stdout.write(` ✅ Fixed ${result.attachmentsFixed} att, ${result.analysisFixed} ana\n`);
    } else if (result.errors > 0) {
      process.stdout.write(` ❌ Error\n`);
    } else {
      process.stdout.write(` ⏭️  No changes needed\n`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`vCons processed:       ${processed}`);
  console.log(`Attachments fixed:     ${totalAttachmentsFixed}`);
  console.log(`Analysis fixed:        ${totalAnalysisFixed}`);
  console.log(`Errors:                ${totalErrors}`);
  console.log('='.repeat(60));
  console.log('\n✅ Done!\n');
}

main().catch(console.error);

