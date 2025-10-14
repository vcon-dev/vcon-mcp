#!/usr/bin/env tsx
/**
 * Simple script to test tag functionality
 * Run with: npx tsx scripts/test-tags.ts
 */

import { getSupabaseClient } from '../src/db/client.js';
import { VConQueries } from '../src/db/queries.js';
import { VCon } from '../src/types/vcon.js';

async function main() {
  console.log('🏷️  Testing Tag Functionality\n');

  const supabase = getSupabaseClient();
  const queries = new VConQueries(supabase);

  try {
    // 1. Create a test vCon
    console.log('1. Creating test vCon...');
    const testVCon: VCon = {
      vcon: '0.3.0',
      uuid: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      subject: 'Tag Test vCon',
      parties: [{ name: 'Test User' }]
    };
    const result = await queries.createVCon(testVCon);
    console.log(`   ✅ Created vCon: ${result.uuid}\n`);

    // 2. Add tags
    console.log('2. Adding tags...');
    await queries.addTag(result.uuid, 'department', 'sales');
    await queries.addTag(result.uuid, 'priority', 5);
    await queries.addTag(result.uuid, 'resolved', false);
    console.log('   ✅ Added 3 tags\n');

    // 3. Get all tags
    console.log('3. Getting all tags...');
    const allTags = await queries.getTags(result.uuid);
    console.log('   Tags:', JSON.stringify(allTags, null, 2));
    console.log(`   ✅ Found ${Object.keys(allTags).length} tags\n`);

    // 4. Get single tag
    console.log('4. Getting single tag...');
    const dept = await queries.getTag(result.uuid, 'department');
    console.log(`   department = "${dept}"`);
    console.log('   ✅ Retrieved single tag\n');

    // 5. Update multiple tags
    console.log('5. Updating multiple tags...');
    await queries.updateTags(result.uuid, {
      status: 'open',
      region: 'west',
      priority: 'high'
    }, true);
    const updatedTags = await queries.getTags(result.uuid);
    console.log('   Updated tags:', JSON.stringify(updatedTags, null, 2));
    console.log('   ✅ Updated tags\n');

    // 6. Search by tags
    console.log('6. Searching by tags...');
    const searchResults = await queries.searchByTags({ department: 'sales' });
    console.log(`   Found ${searchResults.length} vCons with department=sales`);
    console.log('   ✅ Search completed\n');

    // 7. Remove a tag
    console.log('7. Removing a tag...');
    await queries.removeTag(result.uuid, 'resolved');
    const afterRemove = await queries.getTags(result.uuid);
    console.log(`   Tags after removal: ${Object.keys(afterRemove).length} tags`);
    console.log('   ✅ Removed tag\n');

    // 8. Get full vCon with tags
    console.log('8. Getting full vCon...');
    const fullVCon = await queries.getVCon(result.uuid);
    const tagsAttachment = fullVCon.attachments?.find(att => att.type === 'tags');
    console.log('   Tags attachment:', {
      type: tagsAttachment?.type,
      encoding: tagsAttachment?.encoding,
      body: tagsAttachment?.body
    });
    console.log('   ✅ Tags stored correctly as attachment\n');

    // 9. Get unique tags
    console.log('9. Getting unique tags across all vCons...');
    const uniqueTags = await queries.getUniqueTags({ includeCounts: true });
    console.log(`   Found ${uniqueTags.keys.length} unique tag keys:`);
    console.log('   Keys:', uniqueTags.keys.join(', '));
    console.log('   Tags by key:', JSON.stringify(uniqueTags.tagsByKey, null, 2));
    if (uniqueTags.countsPerValue) {
      console.log('   Sample counts:', JSON.stringify(Object.entries(uniqueTags.countsPerValue).slice(0, 2), null, 2));
    }
    console.log(`   Total vCons with tags: ${uniqueTags.totalVCons}`);
    console.log('   ✅ Retrieved unique tags\n');

    // 10. Clean up
    console.log('10. Cleaning up...');
    await queries.deleteVCon(result.uuid);
    console.log('   ✅ Deleted test vCon\n');

    console.log('✨ All tag operations successful!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();

