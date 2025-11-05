#!/usr/bin/env tsx
/**
 * Verify if search_vcons_by_tags function exists and apply if needed
 */

import dotenv from 'dotenv';
import { getSupabaseClient } from '../dist/db/client.js';

dotenv.config();

async function main() {
  console.log('🔍 Checking search_vcons_by_tags function...\n');

  const supabase = getSupabaseClient();

  try {
    // Test if the function exists
    const { data, error } = await supabase.rpc('search_vcons_by_tags', {
      tag_filter: {},
      max_results: 1
    });

    if (error) {
      if (error.message.includes('function') && error.message.includes('does not exist')) {
        console.log('❌ Function does not exist');
        console.log('');
        console.log('📋 To apply the migration:');
        console.log('');
        console.log('1. Go to Supabase Dashboard: https://app.supabase.com');
        console.log('2. Select your project');
        console.log('3. Go to SQL Editor (left sidebar)');
        console.log('4. Click "New Query"');
        console.log('5. Copy and paste the following SQL:');
        console.log('');
        console.log('──────────────────────────────────────────────────────────────');
        console.log('');
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const migrationPath = join(process.cwd(), 'supabase/migrations/20251016000000_add_search_vcons_by_tags.sql');
        const sql = readFileSync(migrationPath, 'utf-8');
        console.log(sql);
        console.log('');
        console.log('──────────────────────────────────────────────────────────────');
        console.log('');
        console.log('6. Click "Run" (or press Cmd/Ctrl+Enter)');
        console.log('');
        console.log('✅ After applying, run this script again to verify.');
        process.exit(1);
      } else {
        console.error('❌ Error testing function:', error.message);
        process.exit(1);
      }
    } else {
      console.log('✅ Function exists and is working!');
      console.log(`   Test query returned ${Array.isArray(data) ? data.length : 0} result(s)`);
      console.log('');
      console.log('The search_by_tags tool will use the efficient RPC function.');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();

