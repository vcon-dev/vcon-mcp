#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const TABLES = [
  'vcons',
  'parties',
  'dialog',
  'analysis'
];

async function main() {
  console.log('🚀 Starting batched search index backfill...');
  console.log('   This script updates tsvector columns in small batches to avoid database timeouts.');
  
  for (const table of TABLES) {
    console.log(`\n📋 Processing table: ${table}`);
    
    let totalUpdated = 0;
    let batchSize = 1000; // Start with 1000
    let consecutiveErrors = 0;
    
    while (true) {
      try {
        const startTime = Date.now();
        
        // Call the RPC function created by migration
        const { data: count, error } = await supabase.rpc('backfill_search_vector_batch', {
          p_table_name: table,
          p_batch_size: batchSize
        });

        if (error) {
          throw error;
        }

        const elapsed = Date.now() - startTime;
        const rowsUpdated = Number(count);
        
        if (rowsUpdated === 0) {
          console.log(`   ✅ Completed ${table}: ${totalUpdated} total rows updated`);
          break;
        }

        totalUpdated += rowsUpdated;
        
        // Adaptive batch sizing
        if (elapsed > 1000 && batchSize > 100) {
          batchSize = Math.floor(batchSize * 0.8); // Reduce if slow
        } else if (elapsed < 200 && batchSize < 5000) {
          batchSize = Math.floor(batchSize * 1.2); // Increase if fast
        }

        if (totalUpdated % 5000 === 0 || rowsUpdated < batchSize) {
          console.log(`   Updated ${rowsUpdated} rows in ${elapsed}ms (Total: ${totalUpdated}, Batch: ${batchSize})`);
        }
        
        consecutiveErrors = 0;
        
        // Small delay to let DB breathe
        await new Promise(r => setTimeout(r, 50));

      } catch (err: any) {
        console.error(`   ⚠️  Error updating batch: ${err.message}`);
        consecutiveErrors++;
        
        if (consecutiveErrors > 5) {
          console.error(`   ❌ Too many errors for ${table}, skipping to next table.`);
          break;
        }
        
        // Backoff
        batchSize = Math.max(100, Math.floor(batchSize / 2));
        console.log(`   Reduced batch size to ${batchSize}, waiting 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  
  console.log('\n✨ Search index backfill finished!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});



