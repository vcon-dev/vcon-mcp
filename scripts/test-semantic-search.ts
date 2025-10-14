#!/usr/bin/env tsx
/**
 * Test Semantic Search
 * 
 * This script demonstrates semantic search by:
 * 1. Taking a natural language query
 * 2. Converting it to an embedding using OpenAI
 * 3. Searching for similar vCons using vector similarity
 */

import { createClient } from '@supabase/supabase-js';
import { VConQueries } from '../src/db/queries.js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const openaiKey = process.env.OPENAI_API_KEY;

if (!openaiKey) {
  console.error('❌ OPENAI_API_KEY is required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const queries = new VConQueries(supabase);

/**
 * Generate embedding for a text query using OpenAI
 */
async function generateQueryEmbedding(text: string): Promise<number[]> {
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 384,
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI API error: ${resp.status} ${await resp.text()}`);
  }

  const json = await resp.json();
  return json.data[0].embedding;
}

/**
 * Format search results for display
 */
function displayResults(results: any[], query: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`🔍 Search Query: "${query}"`);
  console.log('='.repeat(80));
  
  if (results.length === 0) {
    console.log('\n❌ No results found');
    return;
  }

  console.log(`\n✅ Found ${results.length} results:\n`);

  results.forEach((result, index) => {
    console.log(`\n📄 Result ${index + 1}:`);
    console.log(`   vCon ID: ${result.vcon_id}`);
    console.log(`   Type: ${result.content_type}`);
    if (result.content_reference) {
      console.log(`   Reference: ${result.content_reference}`);
    }
    console.log(`   Similarity: ${(result.similarity * 100).toFixed(2)}%`);
    console.log(`   Content: ${result.content_text.substring(0, 200)}${result.content_text.length > 200 ? '...' : ''}`);
  });

  console.log('\n' + '='.repeat(80) + '\n');
}

/**
 * Run semantic search tests
 */
async function testSemanticSearch() {
  // Get query from command line or use default
  const query = process.argv[2] || 'customer wants to schedule a service appointment';
  
  console.log('🚀 Testing Semantic Search');
  console.log('━'.repeat(80));
  console.log(`Query: "${query}"`);
  console.log('━'.repeat(80));

  try {
    // Step 1: Generate embedding for the query
    console.log('\n1️⃣  Generating embedding for query...');
    const embedding = await generateQueryEmbedding(query);
    console.log(`   ✅ Generated ${embedding.length}-dimensional embedding`);

    // Step 2: Search with different thresholds
    console.log('\n2️⃣  Searching with similarity threshold 0.7 (strict)...');
    const strictResults = await queries.semanticSearch({
      embedding,
      threshold: 0.7,
      limit: 5,
    });
    displayResults(strictResults, query);

    // Try with a more lenient threshold if no results
    if (strictResults.length === 0) {
      console.log('3️⃣  No results found. Trying with threshold 0.5 (lenient)...');
      const lenientResults = await queries.semanticSearch({
        embedding,
        threshold: 0.5,
        limit: 10,
      });
      displayResults(lenientResults, query);
    }

    // Step 3: Try hybrid search (keyword + semantic)
    console.log('\n4️⃣  Testing Hybrid Search (combining keywords and semantics)...');
    try {
      const keywordQuery = query.split(' ').slice(0, 3).join(' '); // Use first few words
      const hybridResults = await queries.hybridSearch({
        keywordQuery,
        embedding,
        semanticWeight: 0.6, // 60% semantic, 40% keyword
        limit: 5,
      });

      console.log('\n' + '='.repeat(80));
      console.log('🔀 Hybrid Search Results');
      console.log('='.repeat(80));
      
      if (hybridResults.length === 0) {
        console.log('\n❌ No hybrid results found');
      } else {
        console.log(`\n✅ Found ${hybridResults.length} results:\n`);
        
        hybridResults.forEach((result, index) => {
          console.log(`\n📄 Result ${index + 1}:`);
          console.log(`   vCon ID: ${result.vcon_id}`);
          console.log(`   Combined Score: ${(result.combined_score * 100).toFixed(2)}%`);
          console.log(`   Semantic Score: ${(result.semantic_score * 100).toFixed(2)}%`);
          console.log(`   Keyword Score: ${(result.keyword_score * 100).toFixed(2)}%`);
        });
      }

      console.log('\n' + '='.repeat(80) + '\n');
    } catch (hybridError: any) {
      console.log(`\n⚠️  Hybrid search not available: ${hybridError.message}`);
      console.log('   (Semantic search is working perfectly!)\n');
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Example queries to try
console.log('\n💡 Example queries you can try:');
console.log('   npx tsx scripts/test-semantic-search.ts "customer wants to buy a car"');
console.log('   npx tsx scripts/test-semantic-search.ts "service appointment scheduled"');
console.log('   npx tsx scripts/test-semantic-search.ts "pricing information for vehicle"');
console.log('   npx tsx scripts/test-semantic-search.ts "customer complaint about service"');
console.log('');

testSemanticSearch().catch(console.error);

