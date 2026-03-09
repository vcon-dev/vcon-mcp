/**
 * WhatsApp Adapter Plugin
 * 
 * WOW FACTOR 2: WhatsApp Chat Ingestion
 * 
 * Mode A (hackathon): Parse exported WhatsApp .txt chat files → vCon
 * Mode B (production): WhatsApp Business Cloud API webhooks → real-time vCon
 * 
 * WhatsApp export format (common patterns):
 *   [M/D/YY, H:MM AM] - Name: Message
 *   M/D/YY, H:MM AM - Name: Message
 *   [DD/MM/YYYY, HH:MM:SS] Name: Message
 * 
 * Drop folder: ./hackathon/watch/whatsapp/
 * Sample data: ./hackathon/sample-data/whatsapp-*.txt
 */

import fs from 'fs';
import path from 'path';
import { VConPlugin, RequestContext } from '../../src/hooks/plugin-interface.js';
import { VCon, Party, Dialog, Analysis } from '../../src/types/vcon.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// Types
// ============================================================================

export interface WhatsAppAdapterConfig {
  watchFolder?: string;
  pollInterval?: number;
  processedFolder?: string;
  failedFolder?: string;
  verbose?: boolean;
}

interface ChatMessage {
  timestamp: string;
  sender: string;
  text: string;
}

// ============================================================================
// WhatsApp Chat Parser
// ============================================================================

function parseWhatsAppExport(content: string): { messages: ChatMessage[]; participants: string[] } {
  const messages: ChatMessage[] = [];
  const participants = new Set<string>();

  // Common WhatsApp export patterns
  const patterns = [
    // US format: M/D/YY, H:MM AM - Name: Message
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\s*[-–]\s*(.+?):\s*([\s\S]*?)$/,
    // Bracketed: [M/D/YY, H:MM:SS AM] Name: Message
    /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\]\s*(.+?):\s*([\s\S]*?)$/,
    // EU format: DD/MM/YYYY, HH:MM - Name: Message
    /^(\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*(.+?):\s*([\s\S]*?)$/,
  ];

  const lines = content.split('\n');
  let currentMessage: ChatMessage | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip system messages
    if (trimmed.includes('Messages and calls are end-to-end encrypted') ||
        trimmed.includes('created group') ||
        trimmed.includes('added you') ||
        trimmed.includes('changed the subject') ||
        trimmed.includes('left the group')) {
      continue;
    }

    let matched = false;
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        // Save previous message
        if (currentMessage) messages.push(currentMessage);

        const [, dateStr, timeStr, sender, text] = match;
        const cleanSender = sender.trim();
        participants.add(cleanSender);

        // Parse date
        let isoDate: string;
        try {
          const combined = `${dateStr} ${timeStr}`.replace(/\./g, '/');
          const d = new Date(combined);
          isoDate = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
        } catch {
          isoDate = new Date().toISOString();
        }

        currentMessage = { timestamp: isoDate, sender: cleanSender, text: text.trim() };
        matched = true;
        break;
      }
    }

    // Continuation of previous message (multi-line)
    if (!matched && currentMessage) {
      currentMessage.text += '\n' + trimmed;
    }
  }

  // Don't forget the last message
  if (currentMessage) messages.push(currentMessage);

  return { messages, participants: Array.from(participants) };
}

function buildVconFromChat(messages: ChatMessage[], participants: string[], filename: string): Partial<VCon> {
  if (messages.length === 0) {
    throw new Error('No messages found in chat export');
  }

  const startTime = messages[0].timestamp;
  const endTime = messages[messages.length - 1].timestamp;
  const durationSec = Math.max(60, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);

  // Build parties
  const parties: Party[] = participants.map(name => {
    const isAgent = /agent/i.test(name) || /support/i.test(name);
    return {
      name,
      meta: { role: isAgent ? 'agent' : 'customer' },
    } as any;
  });

  // Build transcript from messages
  const transcript = messages.map(m => `${m.sender}: ${m.text}`).join('\n\n');

  // Build analysis
  const analysis: Analysis[] = [];

  analysis.push({
    type: 'transcript',
    vendor: 'whatsapp-adapter',
    body: transcript,
    encoding: 'none',
    dialog: 0,
  });

  // Keyword sentiment
  const lower = transcript.toLowerCase();
  const posWords = ['thank', 'great', 'appreciate', 'excellent', 'resolved', 'happy', 'perfect', 'awesome', 'wonderful', 'pleasure'];
  const negWords = ['frustrat', 'angry', 'terrible', 'worst', 'upset', 'complain', 'unacceptable', 'ridiculous', 'disappointed', 'problem'];
  const posCount = posWords.filter(w => lower.includes(w)).length;
  const negCount = negWords.filter(w => lower.includes(w)).length;
  const score = Math.max(0, Math.min(1, 0.5 + (posCount - negCount) * 0.1));
  analysis.push({
    type: 'sentiment',
    vendor: 'keyword-heuristic',
    body: JSON.stringify({ overall: parseFloat(score.toFixed(2)), positive: posCount, negative: negCount }),
    encoding: 'json',
  });

  // Topic extraction
  const topicPatterns = [
    { pattern: /bill|charg|refund|payment|invoice|subscript|credit|pricing|plan|cost/i, topic: 'Billing' },
    { pattern: /technical|vpn|error|bug|crash|slow|broken|update|version|config|connect|disconnect/i, topic: 'Technical Support' },
    { pattern: /cancel|close|terminat|switch|competi/i, topic: 'Cancellation' },
    { pattern: /upgrade|premium|professional|enterprise|tier|feature/i, topic: 'Upgrade' },
    { pattern: /ship|deliver|track|order/i, topic: 'Shipping' },
    { pattern: /password|login|access|secur|auth|lock|unlock/i, topic: 'Account Security' },
    { pattern: /remote|work from home|connectivity|network/i, topic: 'Remote Work' },
  ];
  const topics = topicPatterns.filter(t => t.pattern.test(lower)).map(t => t.topic);
  if (topics.length > 0) {
    analysis.push({
      type: 'topics',
      vendor: 'keyword-heuristic',
      body: JSON.stringify(topics),
      encoding: 'json',
    });
  }

  // Source metadata
  analysis.push({
    type: 'source-metadata',
    vendor: 'whatsapp-adapter',
    body: JSON.stringify({
      source: 'whatsapp-export',
      filename,
      messageCount: messages.length,
      participantCount: participants.length,
      firstMessage: startTime,
      lastMessage: endTime,
    }),
    encoding: 'json',
  });

  // Auto-generate subject
  const subject = `WhatsApp: ${participants.join(' ↔ ')}${topics.length > 0 ? ` — ${topics[0]}` : ''}`;

  return {
    vcon: '0.3.0',
    created_at: new Date().toISOString(),
    subject,
    parties,
    dialog: [{
      type: 'text',
      start: startTime,
      duration: durationSec,
      parties: parties.map((_, i) => i),
      mediatype: 'text/plain',
    }],
    analysis,
  };
}

// ============================================================================
// WhatsApp Adapter Plugin
// ============================================================================

export class WhatsAppAdapterPlugin implements VConPlugin {
  name = 'whatsapp-adapter';
  version = '1.0.0';

  private watchFolder: string = '';
  private processedFolder: string = '';
  private failedFolder: string = '';
  private pollInterval: number = 3000;
  private verbose: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing: boolean = false;
  private apiBaseUrl: string = 'http://localhost:3000/api/v1';

  private stats = { imported: 0, failed: 0, lastImport: null as string | null };

  constructor(private config?: WhatsAppAdapterConfig) {}

  async initialize(config?: any): Promise<void> {
    const merged = { ...this.config, ...config };
    const projectRoot = process.cwd();

    this.watchFolder = merged?.watchFolder
      || process.env.WHATSAPP_WATCH_FOLDER
      || path.join(projectRoot, 'hackathon', 'watch', 'whatsapp');
    this.processedFolder = merged?.processedFolder
      || path.join(projectRoot, 'hackathon', 'watch', 'processed');
    this.failedFolder = merged?.failedFolder
      || path.join(projectRoot, 'hackathon', 'watch', 'failed');
    this.pollInterval = merged?.pollInterval || 3000;
    this.verbose = merged?.verbose || process.env.WHATSAPP_VERBOSE === 'true';
    this.apiBaseUrl = process.env.REST_API_URL || `http://localhost:${process.env.MCP_HTTP_PORT || 3000}/api/v1`;

    for (const dir of [this.watchFolder, this.processedFolder, this.failedFolder]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    this.timer = setInterval(() => this.pollForFiles(), this.pollInterval);
    this.log(`WhatsApp Adapter initialized — watching ${this.watchFolder}`);
  }

  async shutdown(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.log('WhatsApp Adapter shut down');
  }

  private async pollForFiles(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const files = fs.readdirSync(this.watchFolder)
        .filter(f => f.endsWith('.txt'))
        .map(f => path.join(this.watchFolder, f));

      for (const filePath of files) {
        try {
          await this.importFile(filePath);
          this.moveFile(filePath, this.processedFolder);
          this.stats.imported++;
          this.stats.lastImport = new Date().toISOString();
        } catch (err) {
          this.log(`Failed to import ${path.basename(filePath)}: ${err}`, true);
          this.moveFile(filePath, this.failedFolder);
          this.stats.failed++;
        }
      }
    } catch {}

    this.processing = false;
  }

  async importFile(filePath: string): Promise<string> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const filename = path.basename(filePath);

    this.log(`Parsing WhatsApp export: ${filename}`);
    const { messages, participants } = parseWhatsAppExport(content);

    if (messages.length === 0) {
      throw new Error('No messages parsed from file');
    }

    this.log(`Found ${messages.length} messages from ${participants.length} participants`);
    const vcon = buildVconFromChat(messages, participants, filename);

    const res = await fetch(`${this.apiBaseUrl}/vcons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vcon),
    });

    const data = await res.json() as any;
    if (!data.success) throw new Error(`API error: ${data.message || JSON.stringify(data)}`);

    this.log(`Created vCon ${data.uuid} from WhatsApp chat (${messages.length} msgs, ${data.duration_ms}ms)`);
    return data.uuid;
  }

  registerTools(): Tool[] {
    return [
      {
        name: 'whatsapp_import_file',
        description: 'Import a WhatsApp exported chat .txt file and create a vCon.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filePath: { type: 'string', description: 'Path to WhatsApp exported .txt chat file' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'whatsapp_import_folder',
        description: 'Import all WhatsApp .txt files from a folder. Defaults to sample-data directory.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            folderPath: { type: 'string', description: 'Path to folder (default: sample-data)' },
          },
        },
      },
      {
        name: 'whatsapp_parse_preview',
        description: 'Parse a WhatsApp chat export and return a preview without creating a vCon.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            content: { type: 'string', description: 'Raw WhatsApp chat export text' },
          },
          required: ['content'],
        },
      },
      {
        name: 'whatsapp_status',
        description: 'Get WhatsApp adapter status.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
    ];
  }

  async handleToolCall(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'whatsapp_import_file': {
        if (!args.filePath || !fs.existsSync(args.filePath)) {
          return { error: `File not found: ${args.filePath}` };
        }
        try {
          const uuid = await this.importFile(args.filePath);
          return { success: true, uuid, source: path.basename(args.filePath) };
        } catch (err: any) {
          return { error: err.message };
        }
      }

      case 'whatsapp_import_folder': {
        const folderPath = args.folderPath || path.join(process.cwd(), 'hackathon', 'sample-data');
        if (!fs.existsSync(folderPath)) return { error: `Folder not found: ${folderPath}` };
        const files = fs.readdirSync(folderPath).filter(f => f.startsWith('whatsapp-') && f.endsWith('.txt'));
        const results: any[] = [];
        for (const file of files) {
          try {
            const uuid = await this.importFile(path.join(folderPath, file));
            results.push({ file, success: true, uuid });
          } catch (err: any) {
            results.push({ file, success: false, error: err.message });
          }
        }
        return { imported: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results };
      }

      case 'whatsapp_parse_preview': {
        try {
          const { messages, participants } = parseWhatsAppExport(args.content);
          return {
            success: true,
            messageCount: messages.length,
            participants,
            firstMessage: messages[0]?.timestamp,
            lastMessage: messages[messages.length - 1]?.timestamp,
            preview: messages.slice(0, 5).map(m => ({ sender: m.sender, text: m.text.slice(0, 80) })),
          };
        } catch (err: any) {
          return { error: err.message };
        }
      }

      case 'whatsapp_status':
        return { adapter: this.name, version: this.version, watchFolder: this.watchFolder, stats: this.stats };

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }

  private moveFile(src: string, destDir: string): void {
    try { fs.renameSync(src, path.join(destDir, path.basename(src))); } catch {}
  }

  private log(msg: string, isError = false): void {
    const prefix = '[WhatsAppAdapter]';
    if (isError) console.error(`${prefix} ${msg}`);
    else if (this.verbose || process.env.WHATSAPP_VERBOSE === 'true') console.log(`${prefix} ${msg}`);
  }
}

// Exported parser for use from ingest page
export { parseWhatsAppExport, buildVconFromChat };
export default WhatsAppAdapterPlugin;
