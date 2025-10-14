#!/usr/bin/env tsx
/**
 * Migration script to fix tags attachment encoding
 * 
 * This script updates all tags attachments to use encoding='json'
 * since the body contains JSON.stringify'd arrays.
 * 
 * Usage: npx tsx scripts/migrate-tags-encoding.ts
 */

import { getSupabaseClient } from '../src/db/client.js';

async function main() {
  console.log('🔧 Migrating tags attachments encoding\n');

  const supabase = getSupabaseClient();

  try {
    // Step 1: Find all tags attachments
    console.log('Step 1: Finding tags attachments...');
    const { data: allTags, error: findError } = await supabase
      .from('attachments')
      .select('id, vcon_id, encoding, body')
      .eq('type', 'tags');

    if (findError) {
      throw findError;
    }

    console.log(`   Found ${allTags?.length || 0} tags attachments\n`);

    if (!allTags || allTags.length === 0) {
      console.log('✓ No tags attachments found. Nothing to migrate.');
      process.exit(0);
    }

    // Step 2: Analyze current state
    console.log('Step 2: Analyzing current state...');
    const withJson = allTags.filter(t => t.encoding === 'json');
    const withNone = allTags.filter(t => t.encoding === 'none');
    const withNull = allTags.filter(t => t.encoding === null || t.encoding === undefined);
    const withOther = allTags.filter(t => t.encoding && t.encoding !== 'json' && t.encoding !== 'none');

    console.log(`   encoding='json': ${withJson.length}`);
    console.log(`   encoding='none': ${withNone.length}`);
    console.log(`   encoding=NULL:   ${withNull.length}`);
    console.log(`   other encoding:  ${withOther.length}`);
    console.log('');

    // Step 3: Update attachments that need fixing
    const needsUpdate = allTags.filter(t => t.encoding !== 'json');
    
    if (needsUpdate.length === 0) {
      console.log('✓ All tags attachments already have encoding=\'json\'. Nothing to update.');
      process.exit(0);
    }

    console.log(`Step 3: Updating ${needsUpdate.length} attachments...\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const tag of needsUpdate) {
      // Verify the body is valid JSON
      try {
        const parsed = JSON.parse(tag.body);
        if (!Array.isArray(parsed)) {
          console.warn(`   ⚠️  Attachment ${tag.id}: body is not an array, skipping`);
          errorCount++;
          continue;
        }
      } catch (parseError) {
        console.warn(`   ⚠️  Attachment ${tag.id}: invalid JSON body, skipping`);
        errorCount++;
        continue;
      }

      // Update the encoding
      const { error: updateError } = await supabase
        .from('attachments')
        .update({ encoding: 'json' })
        .eq('id', tag.id);

      if (updateError) {
        console.error(`   ❌ Failed to update attachment ${tag.id}:`, updateError.message);
        errorCount++;
      } else {
        successCount++;
        if (successCount % 10 === 0) {
          console.log(`   Updated ${successCount}/${needsUpdate.length} attachments...`);
        }
      }
    }

    console.log('');
    console.log('─────────────────────────────────────');
    console.log('Migration Complete');
    console.log('─────────────────────────────────────');
    console.log(`✓ Successfully updated: ${successCount}`);
    if (errorCount > 0) {
      console.log(`❌ Failed to update: ${errorCount}`);
    }
    console.log('');

    // Step 4: Verify the migration
    console.log('Step 4: Verifying migration...');
    const { data: afterMigration, error: verifyError } = await supabase
      .from('attachments')
      .select('id, encoding')
      .eq('type', 'tags');

    if (verifyError) {
      throw verifyError;
    }

    const allCorrect = afterMigration?.every(t => t.encoding === 'json');
    const correctCount = afterMigration?.filter(t => t.encoding === 'json').length || 0;

    console.log(`   Total tags attachments: ${afterMigration?.length || 0}`);
    console.log(`   With encoding='json': ${correctCount}`);
    
    if (allCorrect) {
      console.log('   ✓ All tags attachments now have correct encoding!\n');
    } else {
      console.warn('   ⚠️  Some attachments still have incorrect encoding\n');
    }

    process.exit(errorCount > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

main();

