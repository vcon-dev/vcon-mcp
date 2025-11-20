/**
 * Check Remote Database Status
 * 
 * Comprehensive database status check that reports:
 * - Total counts for all tables (vcons, parties, dialog, attachments, analysis)
 * - Most recent vCon information
 * - Last 24 hours activity
 * - Data population status
 * - Average counts per vCon
 * - Sample data from each table
 * - Distribution of types
 */

import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function formatDateTime(dateString: string | null): string {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  } catch {
    return dateString;
  }
}

function printSection(title: string) {
  console.log(`\n${colors.green}${title}${colors.reset}`);
  console.log('-'.repeat(80));
}

function printHeader(title: string) {
  console.log(`\n${colors.blue}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.blue}${title}${colors.reset}`);
  console.log(`${colors.blue}${'='.repeat(80)}${colors.reset}`);
}

async function checkDatabaseStatus() {
  // Get credentials from environment
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(`${colors.red}ERROR: Missing database credentials${colors.reset}`);
    console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables');
    process.exit(1);
  }

  printHeader('Remote Database Status Check');
  console.log(`Connecting to: ${supabaseUrl}\n`);

  // Create Supabase client
  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  try {
    // Test connection
    const { error: testError } = await supabase.from('vcons').select('id').limit(1);
    if (testError) {
      console.error(`${colors.red}ERROR: Failed to connect to database${colors.reset}`);
      console.error(testError.message);
      process.exit(1);
    }
    console.log(`${colors.green}✓ Connected successfully${colors.reset}`);
  } catch (error) {
    console.error(`${colors.red}ERROR: Connection failed${colors.reset}`);
    console.error(error);
    process.exit(1);
  }

  // 1. Check vcons table
  printSection('1. VCONS TABLE STATUS');

  const { count: totalVcons, error: vconsCountError } = await supabase
    .from('vcons')
    .select('*', { count: 'exact', head: true });

  if (vconsCountError) {
    console.error(`${colors.red}Error checking vcons: ${vconsCountError.message}${colors.reset}`);
  } else {
    console.log(`Total vCons: ${totalVcons || 0}`);

    if (totalVcons && totalVcons > 0) {
      // Get most recent vcon
      const { data: recentVcon, error: recentError } = await supabase
        .from('vcons')
        .select('uuid, subject, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!recentError && recentVcon) {
        console.log('\nMost Recent vCon:');
        console.log(`  UUID: ${recentVcon.uuid}`);
        console.log(`  Subject: ${recentVcon.subject || 'N/A'}`);
        console.log(`  Created: ${formatDateTime(recentVcon.created_at)}`);
        console.log(`  Updated: ${formatDateTime(recentVcon.updated_at)}`);
      }

      // Get oldest vcon
      const { data: oldestVcon, error: oldestError } = await supabase
        .from('vcons')
        .select('created_at')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (!oldestError && oldestVcon) {
        console.log(`\nOldest vCon Created: ${formatDateTime(oldestVcon.created_at)}`);
      }

      // Get vcons from last 24 hours
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count: recentCount } = await supabase
        .from('vcons')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterday);

      console.log(`\nvCons in Last 24 Hours: ${recentCount || 0}`);
    } else {
      console.log(`${colors.yellow}No vCons found in database${colors.reset}`);
    }
  }

  // 2. Check parties table
  printSection('2. PARTIES TABLE STATUS');

  const { count: totalParties, error: partiesCountError } = await supabase
    .from('parties')
    .select('*', { count: 'exact', head: true });

  if (partiesCountError) {
    console.error(`${colors.red}Error checking parties: ${partiesCountError.message}${colors.reset}`);
  } else {
    console.log(`Total Parties: ${totalParties || 0}`);

    if (totalParties && totalParties > 0) {
      // Get sample parties
      const { data: sampleParties, error: sampleError } = await supabase
        .from('parties')
        .select('party_index, name, mailto, tel')
        .limit(5);

      if (!sampleError && sampleParties) {
        console.log('\nSample Parties (first 5):');
        sampleParties.forEach((party) => {
          console.log(`  - Party Index ${party.party_index}: ${party.name || 'N/A'}`);
          if (party.mailto) console.log(`    Email: ${party.mailto}`);
          if (party.tel) console.log(`    Tel: ${party.tel}`);
        });
      }
    } else {
      console.log(`${colors.yellow}WARNING: No parties found in database${colors.reset}`);
    }
  }

  // 3. Check dialog table
  printSection('3. DIALOG TABLE STATUS');

  const { count: totalDialog, error: dialogCountError } = await supabase
    .from('dialog')
    .select('*', { count: 'exact', head: true });

  if (dialogCountError) {
    console.error(`${colors.red}Error checking dialog: ${dialogCountError.message}${colors.reset}`);
  } else {
    console.log(`Total Dialog Entries: ${totalDialog || 0}`);

    if (totalDialog && totalDialog > 0) {
      // Get sample dialogs
      const { data: sampleDialogs, error: sampleError } = await supabase
        .from('dialog')
        .select('dialog_index, type, start_time, duration')
        .limit(5);

      if (!sampleError && sampleDialogs) {
        console.log('\nSample Dialog Entries (first 5):');
        sampleDialogs.forEach((dialog) => {
          console.log(`  - Dialog Index ${dialog.dialog_index}: Type=${dialog.type}`);
          if (dialog.start_time) console.log(`    Start Time: ${formatDateTime(dialog.start_time)}`);
          if (dialog.duration) console.log(`    Duration: ${dialog.duration}s`);
        });
      }

      // Get dialog types distribution using aggregation
      // Note: Supabase doesn't support GROUP BY directly, so we fetch types and aggregate
      const { data: allDialogs } = await supabase.from('dialog').select('type');
      if (allDialogs) {
        const typeCounts: Record<string, number> = {};
        allDialogs.forEach((d) => {
          const type = d.type || 'unknown';
          typeCounts[type] = (typeCounts[type] || 0) + 1;
        });

        console.log('\nDialog Types Distribution:');
        Object.entries(typeCounts)
          .sort(([, a], [, b]) => b - a)
          .forEach(([type, count]) => {
            console.log(`  - ${type}: ${count.toLocaleString()}`);
          });
      }
    } else {
      console.log(`${colors.yellow}WARNING: No dialog entries found in database${colors.reset}`);
    }
  }

  // 4. Check attachments table
  printSection('4. ATTACHMENTS TABLE STATUS');

  const { count: totalAttachments, error: attachmentsCountError } = await supabase
    .from('attachments')
    .select('*', { count: 'exact', head: true });

  if (attachmentsCountError) {
    console.error(`${colors.red}Error checking attachments: ${attachmentsCountError.message}${colors.reset}`);
  } else {
    console.log(`Total Attachments: ${totalAttachments || 0}`);

    if (totalAttachments && totalAttachments > 0) {
      // Get attachment types distribution
      const { data: allAttachments } = await supabase.from('attachments').select('type');
      if (allAttachments) {
        const typeCounts: Record<string, number> = {};
        allAttachments.forEach((a) => {
          const type = a.type || 'unknown';
          typeCounts[type] = (typeCounts[type] || 0) + 1;
        });

        console.log('\nAttachment Types Distribution:');
        Object.entries(typeCounts)
          .sort(([, a], [, b]) => b - a)
          .forEach(([type, count]) => {
            console.log(`  - ${type}: ${count.toLocaleString()}`);
          });
      }
    } else {
      console.log(`${colors.yellow}WARNING: No attachments found in database${colors.reset}`);
    }
  }

  // 5. Check analysis table
  printSection('5. ANALYSIS TABLE STATUS');

  const { count: totalAnalysis, error: analysisCountError } = await supabase
    .from('analysis')
    .select('*', { count: 'exact', head: true });

  if (analysisCountError) {
    console.error(`${colors.red}Error checking analysis: ${analysisCountError.message}${colors.reset}`);
  } else {
    console.log(`Total Analysis Entries: ${totalAnalysis || 0}`);

    if (totalAnalysis && totalAnalysis > 0) {
      // Get analysis data
      const { data: allAnalysis } = await supabase.from('analysis').select('type, vendor, product, analysis_index');
      if (allAnalysis) {
        const typeCounts: Record<string, number> = {};
        const vendorCounts: Record<string, number> = {};

        allAnalysis.forEach((a) => {
          const type = a.type || 'unknown';
          const vendor = a.vendor || 'unknown';
          typeCounts[type] = (typeCounts[type] || 0) + 1;
          vendorCounts[vendor] = (vendorCounts[vendor] || 0) + 1;
        });

        console.log('\nAnalysis Types Distribution:');
        Object.entries(typeCounts)
          .sort(([, a], [, b]) => b - a)
          .forEach(([type, count]) => {
            console.log(`  - ${type}: ${count.toLocaleString()}`);
          });

        console.log('\nAnalysis Vendors Distribution:');
        Object.entries(vendorCounts)
          .sort(([, a], [, b]) => b - a)
          .forEach(([vendor, count]) => {
            console.log(`  - ${vendor}: ${count.toLocaleString()}`);
          });

        // Get sample analysis
        console.log('\nSample Analysis Entries (first 5):');
        allAnalysis.slice(0, 5).forEach((analysis) => {
          console.log(`  - Index ${analysis.analysis_index}: ${analysis.type} by ${analysis.vendor}`);
          if (analysis.product) console.log(`    Product: ${analysis.product}`);
        });
      }
    } else {
      console.log(`${colors.yellow}WARNING: No analysis entries found in database${colors.reset}`);
    }
  }

  // Summary
  printHeader('SUMMARY');

  const { count: vconsCount } = await supabase.from('vcons').select('*', { count: 'exact', head: true });
  const { count: partiesCount } = await supabase.from('parties').select('*', { count: 'exact', head: true });
  const { count: dialogCount } = await supabase.from('dialog').select('*', { count: 'exact', head: true });
  const { count: attachmentsCount } = await supabase.from('attachments').select('*', { count: 'exact', head: true });
  const { count: analysisCount } = await supabase.from('analysis').select('*', { count: 'exact', head: true });

  console.log(`Total vCons:       ${String(vconsCount || 0).padStart(8)}`);
  console.log(`Total Parties:     ${String(partiesCount || 0).padStart(8)}`);
  console.log(`Total Dialog:      ${String(dialogCount || 0).padStart(8)}`);
  console.log(`Total Attachments: ${String(attachmentsCount || 0).padStart(8)}`);
  console.log(`Total Analysis:    ${String(analysisCount || 0).padStart(8)}`);

  console.log('\nData Population Status:');
  console.log(`  Parties:     ${partiesCount && partiesCount > 0 ? colors.green + 'YES' + colors.reset : colors.red + 'NO' + colors.reset}`);
  console.log(`  Dialog:      ${dialogCount && dialogCount > 0 ? colors.green + 'YES' + colors.reset : colors.red + 'NO' + colors.reset}`);
  console.log(`  Attachments: ${attachmentsCount && attachmentsCount > 0 ? colors.green + 'YES' + colors.reset : colors.red + 'NO' + colors.reset}`);
  console.log(`  Analysis:    ${analysisCount && analysisCount > 0 ? colors.green + 'YES' + colors.reset : colors.red + 'NO' + colors.reset}`);

  if (vconsCount && vconsCount > 0) {
    console.log('\nAverage per vCon:');
    console.log(`  Parties:     ${((partiesCount || 0) / vconsCount).toFixed(2)}`);
    console.log(`  Dialog:      ${((dialogCount || 0) / vconsCount).toFixed(2)}`);
    console.log(`  Attachments: ${((attachmentsCount || 0) / vconsCount).toFixed(2)}`);
    console.log(`  Analysis:    ${((analysisCount || 0) / vconsCount).toFixed(2)}`);
  }

  console.log(`\n${colors.blue}${'='.repeat(80)}${colors.reset}\n`);
}

checkDatabaseStatus().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});

