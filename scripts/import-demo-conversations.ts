#!/usr/bin/env npx tsx
/**
 * Import demo conversations from files into the vCon database.
 *
 * Supports:
 *   - Plain text call transcripts (Agent Name: ... / Customer Name: ... format)
 *   - WhatsApp-style chat exports (MM/DD/YY, HH:MM AM/PM - Name: message)
 *   - Teams JSON exports (with _simulated.transcript field)
 *
 * Usage:
 *   npx tsx scripts/import-demo-conversations.ts [path/to/conversations/]
 *
 * Defaults to hackathon/sample-data/ if no path is given.
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { getSupabaseClient } from '../src/db/client.js';
import { VConQueries } from '../src/db/queries.js';
import { PluginManager } from '../src/hooks/plugin-manager.js';
import { VConService } from '../src/services/vcon-service.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParsedMessage {
  speaker: string;
  text: string;
  timestamp?: string;
}

interface ConversationData {
  subject: string;
  parties: { name: string; tel?: string; mailto?: string }[];
  dialog: { type: 'text'; start: string; parties: number[]; body: string; encoding: 'none' }[];
  tags: string[];
  source: string;
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Parse plain-text call transcript:
 *   Agent Mike Rivera: Hello, how can I help?
 *   Sarah Johnson: I have a billing issue.
 */
function parsePlainTextTranscript(content: string, filename: string): ConversationData {
  const lines = content.trim().split('\n').filter(l => l.trim());
  const messages: ParsedMessage[] = [];
  const speakerSet = new Set<string>();

  for (const line of lines) {
    const match = line.match(/^([^:]{2,50}):\s+(.+)$/);
    if (match) {
      const speaker = match[1].trim();
      const text = match[2].trim();
      speakerSet.add(speaker);
      messages.push({ speaker, text });
    }
  }

  const speakerList = Array.from(speakerSet);
  const parties = speakerList.map(name => {
    const isAgent = /agent|support|rep|mike|lisa|sarah agent/i.test(name);
    return isAgent ? { name, tel: '+1-800-555-0100' } : { name, mailto: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com` };
  });

  const startTime = new Date('2026-03-09T10:00:00Z');
  const dialog = messages.map((msg, i) => {
    const speakerIdx = speakerList.indexOf(msg.speaker);
    const time = new Date(startTime.getTime() + i * 60_000).toISOString();
    return { type: 'text' as const, start: time, parties: [speakerIdx], body: msg.text, encoding: 'none' as const };
  });

  const subject = deriveSubject(filename, messages);
  const tags = deriveTags(filename, messages);

  return { subject, parties, dialog, tags, source: filename };
}

/**
 * Parse WhatsApp export:
 *   3/5/26, 10:15 AM - Sarah Johnson: Hi, is this TechCorp support?
 */
function parseWhatsAppChat(content: string, filename: string): ConversationData {
  const lines = content.trim().split('\n').filter(l => l.trim());
  const messages: ParsedMessage[] = [];
  const speakerSet = new Set<string>();

  for (const line of lines) {
    // M/D/YY, H:MM AM/PM - Name: message
    const match = line.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}\s+[AP]M)\s+-\s+([^:]+):\s+(.+)$/);
    if (match) {
      const dateStr = match[1];
      const timeStr = match[2];
      const speaker = match[3].trim();
      const text = match[4].trim();
      speakerSet.add(speaker);
      messages.push({ speaker, text, timestamp: `${dateStr} ${timeStr}` });
    }
  }

  const speakerList = Array.from(speakerSet);
  const parties = speakerList.map(name => {
    const isAgent = /agent|support|rep|mike|lisa/i.test(name);
    return isAgent ? { name, tel: '+1-800-555-0100' } : { name, mailto: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com` };
  });

  const dialog = messages.map(msg => {
    const speakerIdx = speakerList.indexOf(msg.speaker);
    const time = parseWhatsAppTime(msg.timestamp || '') || new Date('2026-03-05T10:00:00Z').toISOString();
    return { type: 'text' as const, start: time, parties: [speakerIdx], body: msg.text, encoding: 'none' as const };
  });

  const subject = deriveSubject(filename, messages);
  const tags = deriveTags(filename, messages);

  return { subject, parties, dialog, tags, source: filename };
}

function parseWhatsAppTime(ts: string): string | null {
  try {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch { /* ignore */ }
  return null;
}

/**
 * Parse Teams JSON export with _simulated.transcript field.
 */
function parseTeamsJson(content: string, filename: string): ConversationData {
  const data = JSON.parse(content);
  const transcript: string = data._simulated?.transcript || '';
  const subject = data._simulated?.subject || deriveSubject(filename, []);
  const startTime = data.startDateTime || new Date('2026-03-05T16:15:00Z').toISOString();

  const messages: ParsedMessage[] = [];
  const speakerSet = new Set<string>();

  for (const line of transcript.split('\n').filter((l: string) => l.trim())) {
    const match = line.match(/^([^:]{2,60}):\s+(.+)$/);
    if (match) {
      const speaker = match[1].trim();
      const text = match[2].trim();
      speakerSet.add(speaker);
      messages.push({ speaker, text });
    }
  }

  const speakerList = Array.from(speakerSet);
  const participants: { name: string; tel?: string; mailto?: string }[] = (data.participants || []).map((p: any) => ({
    name: p.user?.displayName || 'Unknown',
    mailto: p.user?.userPrincipalName,
  }));

  // Fill in parties from transcript speakers if participants list is empty
  const parties = participants.length > 0 ? participants : speakerList.map(name => ({
    name,
    mailto: `${name.toLowerCase().replace(/\s+/g, '.')}@techcorp.com`,
  }));

  const dialog = messages.map((msg, i) => {
    const speakerIdx = speakerList.indexOf(msg.speaker);
    const partyIdx = Math.max(0, speakerIdx); // fall back to 0 if not found
    const time = new Date(new Date(startTime).getTime() + i * 60_000).toISOString();
    return { type: 'text' as const, start: time, parties: [partyIdx], body: msg.text, encoding: 'none' as const };
  });

  const tags = deriveTags(filename, messages);

  return { subject, parties, dialog, tags, source: filename };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveSubject(filename: string, messages: ParsedMessage[]): string {
  const base = path.basename(filename, path.extname(filename)).replace(/[-_]/g, ' ');

  const subjectMap: Record<string, string> = {
    'billing complaint': 'Billing Complaint - Duplicate Charge',
    'tech support escalation': 'Technical Support Escalation',
    'whatsapp account lockout': 'Account Lockout Support (WhatsApp)',
    'whatsapp plan upgrade': 'Plan Upgrade Inquiry (WhatsApp)',
    'followup positive': 'Follow-up: Positive Resolution',
    'teams vpn support': 'Teams VPN Support Call',
    'teams escalation review': 'Teams Escalation Review Meeting',
  };

  return subjectMap[base.toLowerCase()] || base.replace(/\b\w/g, c => c.toUpperCase());
}

function deriveTags(filename: string, messages: ParsedMessage[]): string[] {
  const base = path.basename(filename, path.extname(filename)).toLowerCase();
  const tags: string[] = ['source:demo'];

  if (base.includes('billing') || base.includes('charge') || base.includes('invoice')) {
    tags.push('department:billing');
  } else if (base.includes('vpn') || base.includes('tech') || base.includes('support')) {
    tags.push('department:technical-support');
  } else if (base.includes('sales') || base.includes('upgrade') || base.includes('plan')) {
    tags.push('department:sales');
  }

  if (base.includes('escalat')) tags.push('priority:high');
  if (base.includes('positive') || base.includes('followup')) tags.push('sentiment:positive');
  if (base.includes('complaint')) tags.push('sentiment:negative');
  if (base.includes('whatsapp')) tags.push('channel:whatsapp');
  if (base.includes('teams')) tags.push('channel:teams');
  if (!base.includes('whatsapp') && !base.includes('teams')) tags.push('channel:phone');

  return tags;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function importConversations(dir: string) {
  const supabase = getSupabaseClient();
  const queries = new VConQueries(supabase, null);
  const pluginManager = new PluginManager();
  const vconService = new VConService({ queries, pluginManager });

  const files = fs.readdirSync(dir)
    .filter(f => /\.(txt|json)$/.test(f) && !f.startsWith('.'))
    .map(f => path.join(dir, f));

  if (files.length === 0) {
    console.log(`No .txt or .json files found in ${dir}`);
    process.exit(1);
  }

  console.log(`\nImporting ${files.length} conversation files from ${dir}\n`);

  let created = 0;
  let failed = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8').trim();
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file).toLowerCase();

    let conv: ConversationData;
    try {
      if (ext === '.json') {
        conv = parseTeamsJson(content, base);
      } else if (base.includes('whatsapp')) {
        conv = parseWhatsAppChat(content, base);
      } else {
        conv = parsePlainTextTranscript(content, base);
      }
    } catch (err: any) {
      console.error(`  SKIP ${base} — parse error: ${err.message}`);
      failed++;
      continue;
    }

    try {
      const result = await vconService.create({
        subject: conv.subject,
        parties: conv.parties,
        dialog: conv.dialog,
        attachments: conv.tags.length > 0 ? [{
          type: 'tags',
          encoding: 'json',
          body: JSON.stringify(conv.tags),
        }] : [],
      }, { source: 'import-demo-conversations' });

      console.log(`  OK  ${result.uuid}  ${conv.subject}`);
      console.log(`      ${conv.dialog.length} turns, ${conv.parties.length} parties, tags: ${conv.tags.join(', ')}`);
      created++;
    } catch (err: any) {
      console.error(`  ERR ${base} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${created} imported, ${failed} failed`);

  // Summary of what's now in the DB
  const { data, error } = await supabase
    .from('vcons')
    .select('uuid, subject, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (!error && data) {
    console.log('\nLatest vCons in database:');
    for (const v of data) {
      console.log(`  ${v.uuid}  ${v.subject}`);
    }
  }
}

const dir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..', 'hackathon', 'sample-data');

importConversations(dir).catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
