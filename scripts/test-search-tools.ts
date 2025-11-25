#!/usr/bin/env tsx

/**
 * Test script for new search tools
 * Tests keyword, semantic, and hybrid search functionality
 */

import dotenv from 'dotenv';
import { getSupabaseClient } from '../dist/db/client.js';
import { VConQueries } from '../dist/db/queries.js';

dotenv.config();

async function main() {
  console.log('🔍 Testing vCon Search Tools\n');

  const supabase = getSupabaseClient();
  const queries = new VConQueries(supabase);

  // Test 0: Basic Search (search_vcons) - Fastest
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 0: Basic Search (search_vcons)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const basicResults = await queries.searchVCons({
      limit: 5
    });

    console.log(`✅ Basic search successful!`);
    console.log(`   Found ${basicResults.length} results`);
    
    if (basicResults.length > 0) {
      const first = basicResults[0];
      console.log(`\n   Sample result:`);
      console.log(`   - vCon ID: ${first.uuid}`);
      console.log(`   - Subject: ${first.subject?.substring(0, 60) || 'N/A'}...`);
      console.log(`   - Created: ${first.created_at}`);
      console.log(`   - Parties: ${first.parties?.length || 0}`);
    }
  } catch (error: any) {
    console.log(`❌ Basic search failed: ${error.message || error}`);
  }

  // Test 1: Keyword Search with timeout handling
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 1: Keyword Search (search_vcons_content)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Try with a simpler query and smaller limit
    const keywordResults = await Promise.race([
      queries.keywordSearch({
        query: 'Volkswagen',
        limit: 3
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout after 30 seconds')), 30000)
      )
    ]) as any;

    console.log(`✅ Keyword search successful!`);
    console.log(`   Found ${keywordResults.length} results`);
    
    if (keywordResults.length > 0) {
      const first = keywordResults[0];
      console.log(`\n   Sample result:`);
      console.log(`   - vCon ID: ${first.vcon_id}`);
      console.log(`   - Type: ${first.doc_type}`);
      console.log(`   - Rank: ${first.rank.toFixed(4)}`);
      console.log(`   - Snippet: ${first.snippet?.substring(0, 100) || 'N/A'}...`);
    } else {
      console.log('   ⚠️  No results found. Try a different search term.');
    }
  } catch (error: any) {
    if (error.message?.includes('timeout')) {
      console.log(`⚠️  Keyword search timed out (database may be very large)`);
      console.log(`   Try using date filters or smaller limits to reduce query scope.`);
    } else {
      console.log(`❌ Keyword search failed: ${error.message || error}`);
      if (error.code === '57014') {
        console.log(`   This is a database statement timeout. Consider:`);
        console.log(`   - Adding date range filters to reduce scope`);
        console.log(`   - Using smaller limit values`);
        console.log(`   - Checking database indexes are properly created`);
      }
    }
  }

  // Test 2: Check for embeddings
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 2: Check Embedding Coverage');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const { data: embeddingStats, error } = await supabase.rpc('exec_sql', {
      q: `
        SELECT 
          content_type,
          COUNT(*) as count
        FROM vcon_embeddings
        GROUP BY content_type
        ORDER BY count DESC
      `,
      params: {}
    });

    if (error) throw error;

    if (embeddingStats && Array.isArray(embeddingStats) && embeddingStats.length > 0) {
      console.log('✅ Embeddings found:');
      embeddingStats.forEach((stat: any) => {
        console.log(`   - ${stat.content_type}: ${stat.count} embeddings`);
      });
    } else {
      console.log('⚠️  No embeddings found in database');
      console.log('   Semantic and hybrid search will not work without embeddings.');
      console.log('   Run: ./scripts/backfill-embeddings.sh');
    }
  } catch (error) {
    console.log(`❌ Failed to check embeddings: ${error}`);
  }

  // Test 3: Semantic Search (if embeddings exist)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 3: Semantic Search (search_vcons_semantic)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Get a sample embedding to test with
    const { data: sampleEmbedding, error } = await supabase
      .from('vcon_embeddings')
      .select('embedding')
      .limit(1)
      .single();

    if (error || !sampleEmbedding) {
      console.log('⚠️  Cannot test semantic search: No embeddings in database');
      console.log('   Generate embeddings first: ./scripts/backfill-embeddings.sh');
    } else {
      const semanticResults = await queries.semanticSearch({
        embedding: sampleEmbedding.embedding,
        threshold: 0.7,
        limit: 5
      });

      console.log(`✅ Semantic search successful!`);
      console.log(`   Found ${semanticResults.length} results`);
      
      if (semanticResults.length > 0) {
        const first = semanticResults[0];
        console.log(`\n   Sample result:`);
        console.log(`   - vCon ID: ${first.vcon_id}`);
        console.log(`   - Type: ${first.content_type}`);
        console.log(`   - Similarity: ${first.similarity.toFixed(4)}`);
        console.log(`   - Text: ${first.content_text.substring(0, 100)}...`);
      }
    }
  } catch (error) {
    console.log(`❌ Semantic search failed: ${error}`);
  }

  // Test 4: Hybrid Search
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 4: Hybrid Search (search_vcons_hybrid)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Get a sample embedding
    const { data: sampleEmbedding, error } = await supabase
      .from('vcon_embeddings')
      .select('embedding')
      .limit(1)
      .single();

    if (error || !sampleEmbedding) {
      console.log('⚠️  Testing keyword-only hybrid search (no embeddings)');
      
      const hybridResults = await Promise.race([
        queries.hybridSearch({
          keywordQuery: 'Volkswagen',
          limit: 3
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout after 30 seconds')), 30000)
        )
      ]) as any;

      console.log(`✅ Hybrid search (keyword-only) successful!`);
      console.log(`   Found ${hybridResults.length} results`);
    } else {
      const hybridResults = await Promise.race([
        queries.hybridSearch({
          keywordQuery: 'Volkswagen',
          embedding: sampleEmbedding.embedding,
          semanticWeight: 0.6,
          limit: 3
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout after 30 seconds')), 30000)
        )
      ]) as any;

      console.log(`✅ Hybrid search successful!`);
      console.log(`   Found ${hybridResults.length} results`);
      
      if (hybridResults.length > 0) {
        const first = hybridResults[0];
        console.log(`\n   Sample result:`);
        console.log(`   - vCon ID: ${first.vcon_id}`);
        console.log(`   - Combined Score: ${first.combined_score.toFixed(4)}`);
        console.log(`   - Semantic Score: ${first.semantic_score.toFixed(4)}`);
        console.log(`   - Keyword Score: ${first.keyword_score.toFixed(4)}`);
      }
    }
  } catch (error: any) {
    if (error.message?.includes('timeout')) {
      console.log(`⚠️  Hybrid search timed out (database may be very large)`);
      console.log(`   Try using date filters or smaller limits to reduce query scope.`);
    } else {
      console.log(`❌ Hybrid search failed: ${error.message || error}`);
      if (error.code === '57014') {
        console.log(`   This is a database statement timeout. Consider:`);
        console.log(`   - Adding date range filters to reduce scope`);
        console.log(`   - Using smaller limit values`);
        console.log(`   - Checking database indexes are properly created`);
      }
    }
  }

  // Test 5: Test search with tags
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 5: Tag Filtering');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Check if any tags exist (with timeout)
    const tagsCheck = await Promise.race([
      supabase
        .from('attachments')
        .select('vcon_id')
        .eq('type', 'tags')
        .eq('encoding', 'json')
        .limit(1)
        .maybeSingle(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Query timeout')), 10000)
      )
    ]) as any;

    const { data: tagsExist, error } = tagsCheck || {};

    if (error || !tagsExist) {
      console.log('⚠️  No tags found in database');
      console.log('   Tag filtering requires attachments of type "tags" with encoding "json"');
    } else {
      console.log('✅ Tags found in database');
      console.log('   Tag filtering is available for all search tools');
      console.log('   Example: { "tags": {"department": "sales", "priority": "high"} }');
    }
  } catch (error: any) {
    if (error.message?.includes('timeout')) {
      console.log(`⚠️  Tag check timed out (database may be very large)`);
    } else {
      console.log(`⚠️  Could not check for tags: ${error.message || error}`);
    }
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Available search tools:');
  console.log('  1. search_vcons - Basic filtering by metadata (fastest)');
  console.log('  2. search_vcons_content - Keyword search (may timeout on large DB)');
  console.log('  3. search_vcons_semantic - Semantic search (requires embeddings)');
  console.log('  4. search_vcons_hybrid - Hybrid search (best with embeddings)');
  console.log('\nPerformance Tips:');
  console.log('  - Use date filters to reduce search scope');
  console.log('  - Start with smaller limits (3-10)');
  console.log('  - Use basic search_vcons for metadata-only queries');
  console.log('  - Consider adding indexes if queries are slow');
  console.log('\nFor full documentation, see: docs/guide/search.md\n');
}

main().catch(console.error);

