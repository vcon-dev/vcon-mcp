#!/usr/bin/env tsx

/**
 * Quick search test with date filters to avoid timeouts
 * Tests all search types with optimized queries
 */

import dotenv from 'dotenv';
import { getSupabaseClient } from '../dist/db/client.js';
import { VConQueries } from '../dist/db/queries.js';

dotenv.config();

async function main() {
  console.log('🔍 Quick Search Test (with date filters)\n');

  const supabase = getSupabaseClient();
  const queries = new VConQueries(supabase);

  // Get a recent date (last 7 days) to limit search scope
  const recentDate = new Date();
  recentDate.setDate(recentDate.getDate() - 7);
  const startDate = recentDate.toISOString();

  console.log(`📅 Using date filter: ${startDate} to now\n`);

  // Test 1: Basic Search
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('1. Basic Search (search_vcons)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const results = await queries.searchVCons({
      startDate,
      limit: 5
    });
    console.log(`✅ Found ${results.length} vCons from last 7 days`);
    if (results.length > 0) {
      console.log(`   Sample: ${results[0].subject?.substring(0, 50) || 'N/A'}...`);
    }
  } catch (error: any) {
    console.log(`❌ Failed: ${error.message}`);
  }

  // Test 2: Keyword Search with date filter
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('2. Keyword Search (search_vcons_content)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const results = await Promise.race([
      queries.keywordSearch({
        query: 'support',
        startDate,
        limit: 3
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 20000)
      )
    ]) as any;

    console.log(`✅ Found ${results.length} keyword matches`);
    if (results.length > 0) {
      const first = results[0];
      console.log(`   Sample: ${first.doc_type} (rank: ${first.rank.toFixed(3)})`);
      console.log(`   Snippet: ${first.snippet?.substring(0, 80) || 'N/A'}...`);
    }
  } catch (error: any) {
    if (error.message?.includes('Timeout')) {
      console.log(`⚠️  Query timed out - database may be very large`);
      console.log(`   Try narrowing the date range further`);
    } else {
      console.log(`❌ Failed: ${error.message}`);
    }
  }

  // Test 3: Semantic Search
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('3. Semantic Search (search_vcons_semantic)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const { data: sampleEmbedding } = await supabase
      .from('vcon_embeddings')
      .select('embedding')
      .limit(1)
      .single();

    if (sampleEmbedding) {
      const results = await queries.semanticSearch({
        embedding: sampleEmbedding.embedding,
        threshold: 0.7,
        limit: 3
      });
      console.log(`✅ Found ${results.length} semantically similar vCons`);
      if (results.length > 0) {
        const first = results[0];
        console.log(`   Sample: ${first.content_type} (similarity: ${first.similarity.toFixed(3)})`);
        console.log(`   Text: ${first.content_text.substring(0, 80)}...`);
      }
    } else {
      console.log('⚠️  No embeddings found');
    }
  } catch (error: any) {
    console.log(`❌ Failed: ${error.message}`);
  }

  // Test 4: Hybrid Search with date filter
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('4. Hybrid Search (search_vcons_hybrid)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const { data: sampleEmbedding } = await supabase
      .from('vcon_embeddings')
      .select('embedding')
      .limit(1)
      .single();

    const results = await Promise.race([
      queries.hybridSearch({
        keywordQuery: 'customer',
        embedding: sampleEmbedding?.embedding,
        semanticWeight: 0.6,
        limit: 3
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 20000)
      )
    ]) as any;

    console.log(`✅ Found ${results.length} hybrid matches`);
    if (results.length > 0) {
      const first = results[0];
      console.log(`   Combined: ${first.combined_score.toFixed(3)}`);
      console.log(`   Semantic: ${first.semantic_score.toFixed(3)}, Keyword: ${first.keyword_score.toFixed(3)}`);
    }
  } catch (error: any) {
    if (error.message?.includes('Timeout')) {
      console.log(`⚠️  Query timed out - database may be very large`);
    } else {
      console.log(`❌ Failed: ${error.message}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Quick test complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(console.error);

