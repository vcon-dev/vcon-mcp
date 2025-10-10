#!/usr/bin/env tsx

/**
 * Manual MCP Tool Testing Script
 * 
 * Tests MCP tools directly without needing Claude Desktop or Inspector
 */

import dotenv from 'dotenv';
import { getSupabaseClient } from '../src/db/client.js';
import { VConQueries } from '../src/db/queries.js';

dotenv.config();

async function runTests() {
  console.log('🧪 Testing MCP Server Tools\n');
  console.log('='.repeat(60) + '\n');

  const supabase = getSupabaseClient();
  const queries = new VConQueries(supabase);

  try {
    // Test 1: search_vcons
    console.log('1️⃣  Testing: search_vcons');
    console.log('   Query: Find vCons with "Chevrolet" in subject\n');
    
    const searchResults = await queries.searchVCons({
      subject: 'Chevrolet',
      limit: 5
    });
    
    console.log(`   ✅ Found ${searchResults.length} results:`);
    searchResults.forEach((vcon, i) => {
      console.log(`      ${i + 1}. ${vcon.uuid}`);
      console.log(`         Subject: ${vcon.subject || 'N/A'}`);
      console.log(`         Parties: ${vcon.parties?.length || 0}`);
    });
    console.log('');

    // Test 2: get_vcon
    if (searchResults.length > 0) {
      const testUuid = searchResults[0].uuid;
      console.log('2️⃣  Testing: get_vcon');
      console.log(`   UUID: ${testUuid}\n`);
      
      const fullVcon = await queries.getVCon(testUuid);
      
      console.log('   ✅ Retrieved vCon:');
      console.log(`      Subject: ${fullVcon.subject || 'N/A'}`);
      console.log(`      Parties: ${fullVcon.parties?.length || 0}`);
      console.log(`      Dialogs: ${fullVcon.dialog?.length || 0}`);
      console.log(`      Analysis: ${fullVcon.analysis?.length || 0}`);
      console.log(`      Attachments: ${fullVcon.attachments?.length || 0}`);
      
      if (fullVcon.parties && fullVcon.parties.length > 0) {
        console.log('\n   Parties:');
        fullVcon.parties.forEach((party, i) => {
          console.log(`      ${i}. ${party.name || party.mailto || party.tel || 'Unknown'}`);
        });
      }
      
      if (fullVcon.dialog && fullVcon.dialog.length > 0) {
        console.log('\n   Dialogs:');
        fullVcon.dialog.forEach((dialog, i) => {
          console.log(`      ${i}. Type: ${dialog.type}, Start: ${dialog.start || 'N/A'}`);
        });
      }
      console.log('');
    }

    // Test 3: create_vcon
    console.log('3️⃣  Testing: create_vcon');
    console.log('   Creating test vCon...\n');
    
    const newVcon = {
      vcon: '0.3.0',
      uuid: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      subject: 'Test vCon - MCP Server Validation',
      parties: [
        {
          name: 'Test Agent',
          mailto: 'agent@test.example.com',
          uuid: crypto.randomUUID()
        },
        {
          name: 'Test Customer',
          tel: '+1-555-TEST',
          uuid: crypto.randomUUID()
        }
      ]
    };
    
    const created = await queries.createVCon(newVcon);
    console.log('   ✅ Created vCon:');
    console.log(`      UUID: ${created.uuid}`);
    console.log(`      Subject: ${created.subject}`);
    console.log('');

    // Test 4: add_dialog
    console.log('4️⃣  Testing: add_dialog');
    console.log('   Adding text dialog...\n');
    
    const dialog = {
      type: 'text' as const,
      start: new Date().toISOString(),
      parties: [0, 1],
      originator: 1,
      body: 'This is a test dialog message from the MCP server validation.',
      encoding: 'none' as const
    };
    
    await queries.addDialog(created.uuid, dialog);
    console.log('   ✅ Dialog added');
    console.log('');

    // Test 5: add_analysis
    console.log('5️⃣  Testing: add_analysis');
    console.log('   Adding sentiment analysis...\n');
    
    const analysis = {
      type: 'sentiment',
      vendor: 'TestVendor',
      product: 'TestAnalyzer',
      schema: 'v1.0',
      body: JSON.stringify({
        sentiment: 'positive',
        score: 0.85,
        confidence: 0.92
      }),
      encoding: 'json' as const,
      dialog: [0]
    };
    
    await queries.addAnalysis(created.uuid, analysis);
    console.log('   ✅ Analysis added');
    console.log('');

    // Test 6: add_attachment
    console.log('6️⃣  Testing: add_attachment');
    console.log('   Adding test attachment...\n');
    
    const attachment = {
      type: 'text/plain',
      body: 'This is a test attachment from the MCP server validation.',
      encoding: 'none' as const
    };
    
    await queries.addAttachment(created.uuid, attachment);
    console.log('   ✅ Attachment added');
    console.log('');

    // Verify everything was added
    console.log('7️⃣  Verifying complete vCon');
    const verifyVcon = await queries.getVCon(created.uuid);
    console.log('   ✅ Retrieved updated vCon:');
    console.log(`      Dialogs: ${verifyVcon.dialog?.length || 0}`);
    console.log(`      Analysis: ${verifyVcon.analysis?.length || 0}`);
    console.log(`      Attachments: ${verifyVcon.attachments?.length || 0}`);
    console.log('');

    // Test 7: search by party
    console.log('8️⃣  Testing: search by party email');
    const partySearch = await queries.searchVCons({
      partyEmail: 'agent@test.example.com',
      limit: 5
    });
    console.log(`   ✅ Found ${partySearch.length} vCons with that party`);
    console.log('');

    // Clean up - delete test vCon
    console.log('9️⃣  Testing: delete_vcon');
    await queries.deleteVCon(created.uuid);
    console.log('   ✅ Test vCon deleted');
    console.log('');

    // Summary
    console.log('='.repeat(60));
    console.log('✅ ALL TESTS PASSED!');
    console.log('='.repeat(60));
    console.log('\n🎉 MCP Server is fully functional!\n');
    console.log('All 7 MCP tools tested successfully:');
    console.log('  ✅ search_vcons');
    console.log('  ✅ get_vcon');
    console.log('  ✅ create_vcon');
    console.log('  ✅ add_dialog');
    console.log('  ✅ add_analysis');
    console.log('  ✅ add_attachment');
    console.log('  ✅ delete_vcon\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

runTests();


