#!/usr/bin/env npx tsx
/**
 * Seed database with test vCons
 */

import dotenv from 'dotenv';
dotenv.config();

import { getSupabaseClient } from '../src/db/client.js';
import { VConQueries } from '../src/db/queries.js';
import { PluginManager } from '../src/hooks/plugin-manager.js';
import { VConService } from '../src/services/vcon-service.js';
import type { VCon } from '../src/types/vcon.js';

async function seedDatabase() {
  const supabase = getSupabaseClient();
  const queries = new VConQueries(supabase, null);
  const pluginManager = new PluginManager();
  const vconService = new VConService({ queries, pluginManager });

  const testVCons: Partial<VCon>[] = [
    {
      subject: 'Customer Support Call - Order Issue',
      parties: [
        { name: 'John Smith', tel: '+1-555-0101', mailto: 'john.smith@example.com' },
        { name: 'Support Agent Sarah', tel: '+1-800-555-0199' }
      ],
      dialog: [
        { type: 'text', start_time: '2025-12-29T10:00:00Z', parties: [0, 1], body: 'Hi, I have an issue with my order #12345', encoding: 'none' },
        { type: 'text', start_time: '2025-12-29T10:01:00Z', parties: [1, 0], body: 'I would be happy to help you with that. Let me look up your order.', encoding: 'none' }
      ],
      analysis: [
        { type: 'summary', vendor: 'openai', body: 'Customer called about order #12345 delivery delay. Agent provided tracking info.', encoding: 'none' },
        { type: 'sentiment', vendor: 'openai', body: 'Customer: frustrated initially, satisfied after resolution', encoding: 'none' }
      ]
    },
    {
      subject: 'Sales Inquiry - Enterprise Plan',
      parties: [
        { name: 'Alice Johnson', tel: '+1-555-0202', mailto: 'alice@bigcorp.com' },
        { name: 'Sales Rep Mike', tel: '+1-800-555-0200' }
      ],
      dialog: [
        { type: 'text', start_time: '2025-12-29T14:00:00Z', parties: [0, 1], body: 'We are interested in your enterprise plan for 500 users', encoding: 'none' }
      ],
      analysis: [
        { type: 'summary', vendor: 'internal', body: 'Enterprise sales inquiry from BigCorp for 500 seats', encoding: 'none' }
      ]
    },
    {
      subject: 'Technical Support - API Integration',
      parties: [
        { name: 'Dev Team Lead', mailto: 'devlead@startup.io' },
        { name: 'Technical Support', tel: '+1-800-555-0300' }
      ],
      dialog: [
        { type: 'text', start_time: '2025-12-29T09:30:00Z', parties: [0, 1], body: 'Having issues with the REST API authentication', encoding: 'none' },
        { type: 'text', start_time: '2025-12-29T09:32:00Z', parties: [1, 0], body: 'Please check that your API key has the correct permissions', encoding: 'none' }
      ],
      analysis: [
        { type: 'transcript', vendor: 'whisper', body: 'Technical call regarding API authentication issues', encoding: 'none' }
      ]
    },
    {
      subject: 'Product Demo Request',
      parties: [
        { name: 'Prospect Company', mailto: 'info@prospect.com' }
      ],
      dialog: [],
      analysis: []
    },
    {
      subject: 'Billing Question - Invoice #98765',
      parties: [
        { name: 'Finance Dept', tel: '+1-555-0303' },
        { name: 'Billing Support', tel: '+1-800-555-0400' }
      ],
      dialog: [
        { type: 'text', start_time: '2025-12-29T11:00:00Z', parties: [0, 1], body: 'Question about invoice #98765 charges', encoding: 'none' }
      ]
    }
  ];

  console.log('🌱 Seeding database with test vCons...\n');
  
  for (const vcon of testVCons) {
    try {
      const result = await vconService.create(vcon, { source: 'seed-script' });
      console.log(`✅ Created: ${result.uuid} - ${vcon.subject}`);
    } catch (error: any) {
      console.error(`❌ Failed: ${vcon.subject} - ${error.message}`);
    }
  }

  // Verify by listing
  const { data } = await supabase
    .from('vcons')
    .select('id, uuid, subject')
    .order('created_at', { ascending: false });
  
  console.log('\n📋 All vCons in database:');
  console.log('ID === UUID verification:');
  for (const v of data || []) {
    const match = v.id === v.uuid ? '✅' : '❌';
    console.log(`  ${match} ${v.uuid} - ${v.subject}`);
  }
  console.log(`\nTotal: ${data?.length || 0} vCons`);
}

seedDatabase().catch(console.error);

