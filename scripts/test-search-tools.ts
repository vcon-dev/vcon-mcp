#!/usr/bin/env npx tsx

/**
 * Test script for new search tools
 * Tests keyword, semantic, and hybrid search functionality
 */

import dotenv from 'dotenv';
import { getSupabaseClient } from '../src/db/client.js';
import { VConQueries } from '../src/db/queries.js';

dotenv.config();

async function main() {
  console.log('🔍 Testing vCon Search Tools\n');

  const supabase = getSupabaseClient();
  const queries = new VConQueries(supabase);

  // Test 1: Keyword Search
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 1: Keyword Search (search_vcons_content)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const keywordResults = await queries.keywordSearch({
      query: 'Chevrolet',
      limit: 5
    });

    console.log(`✅ Keyword search successful!`);
    console.log(`   Found ${keywordResults.length} results`);
    
    if (keywordResults.length > 0) {
      const first = keywordResults[0];
      console.log(`\n   Sample result:`);
      console.log(`   - vCon ID: ${first.vcon_id}`);
      console.log(`   - Type: ${first.doc_type}`);
      console.log(`   - Rank: ${first.rank.toFixed(4)}`);
      console.log(`   - Snippet: ${first.snippet?.substring(0, 100)}...`);
    }
  } catch (error) {
    console.log(`❌ Keyword search failed:`);
    console.error(error);
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
      
      const hybridResults = await queries.hybridSearch({
        keywordQuery: 'Chevrolet',
        limit: 5
      });

      console.log(`✅ Hybrid search (keyword-only) successful!`);
      console.log(`   Found ${hybridResults.length} results`);
    } else {
      const hybridResults = await queries.hybridSearch({
        keywordQuery: 'Chevrolet',
        embedding: sampleEmbedding.embedding,
        semanticWeight: 0.6,
        limit: 5
      });

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
  } catch (error) {
    console.log(`❌ Hybrid search failed:`);
    console.error(error);
  }

  // Test 5: Test search with tags
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Test 5: Tag Filtering');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Check if any tags exist
    const { data: tagsExist, error } = await supabase
      .from('attachments')
      .select('vcon_id')
      .eq('type', 'tags')
      .eq('encoding', 'json')
      .limit(1)
      .single();

    if (error || !tagsExist) {
      console.log('⚠️  No tags found in database');
      console.log('   Tag filtering requires attachments of type "tags" with encoding "json"');
    } else {
      console.log('✅ Tags found in database');
      console.log('   Tag filtering is available for all search tools');
      console.log('   Example: { "tags": {"department": "sales", "priority": "high"} }');
    }
  } catch (error) {
    console.log(`⚠️  Could not check for tags: ${error}`);
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Available search tools:');
  console.log('  1. search_vcons - Basic filtering by metadata');
  console.log('  2. search_vcons_content - Keyword search (✅ ready)');
  console.log('  3. search_vcons_semantic - Semantic search (requires embeddings)');
  console.log('  4. search_vcons_hybrid - Hybrid search (best with embeddings)');
  console.log('\nFor full documentation, see: docs/SEARCH_TOOLS_GUIDE.md\n');
}

main().catch(console.error);

