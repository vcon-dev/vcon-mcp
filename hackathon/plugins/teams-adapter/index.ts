/**
 * Teams Adapter Plugin
 * 
 * BASE CHALLENGE 4: MS Teams Post-Call Extractor
 * 
 * Production architecture: MSAL auth → poll MS Graph /communications/callRecords
 * → extract participants, transcript, recording → map to vCon.
 * 
 * Hackathon mode: Watches a folder for exported Teams call record JSON files
 * (matching MS Graph API schema) and ingests them as vCons. The adapter code
 * is production-shaped — swap the file watcher for Graph API polling and it works.
 * 
 * Drop folder: ./hackathon/watch/teams/
 * Sample data: ./hackathon/sample-data/teams-*.json
 * 
 * MS Graph callRecord schema: https://learn.microsoft.com/en-us/graph/api/resources/callrecords-callrecord
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { VConPlugin, RequestContext } from '../../src/hooks/plugin-interface.js';
import { VCon, Party, Dialog, Analysis } from '../../src/types/vcon.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// Types
// ============================================================================

export interface TeamsAdapterConfig {
  /** Folder to watch for Teams export JSON files */
  watchFolder?: string;
  /** Poll interval in milliseconds (default: 3000) */
  pollInterval?: number;
  /** Processed files destination */
  processedFolder?: string;
  /** Failed files destination */
  failedFolder?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

/** MS Graph callRecord participant */
interface TeamsParticipant {
  user?: {
    id?: string;
    displayName?: string;
    userPrincipalName?: string;
  };
  phone?: {
    id?: string;
    displayName?: string;
  };
  role?: string;
}

/** MS Graph callRecord (simplified) */
interface TeamsCallRecord {
  id: string;
  version?: number;
  type?: string;             // 'peerToPeer' | 'groupCall'
  modalities?: string[];     // ['audio'] | ['audio', 'video']
  lastModifiedDateTime?: string;
  startDateTime: string;
  endDateTime: string;
  joinWebUrl?: string;
  organizer?: TeamsParticipant;
  participants: TeamsParticipant[];
  sessions?: Array<{
    id?: string;
    startDateTime?: string;
    endDateTime?: string;
    modalities?: string[];
  }>;
  /** Simulated data for hackathon — not in real Graph API */
  _simulated?: {
    subject?: string;
    transcript?: string;
    recording_url?: string;
    summary?: string;
  };
}

// ============================================================================
// Teams Adapter Plugin
// ============================================================================

export class TeamsAdapterPlugin implements VConPlugin {
  name = 'teams-adapter';
  version = '1.0.0';

  private watchFolder: string = '';
  private processedFolder: string = '';
  private failedFolder: string = '';
  private pollInterval: number = 3000;
  private verbose: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing: boolean = false;
  private apiBaseUrl: string = 'http://localhost:3000/api/v1';

  // Metrics
  private stats = { imported: 0, failed: 0, lastImport: null as string | null };

  constructor(private config?: TeamsAdapterConfig) {}

  // ========== Lifecycle ==========

  async initialize(config?: any): Promise<void> {
    const merged = { ...this.config, ...config };

    const projectRoot = process.cwd();
    this.watchFolder = merged?.watchFolder
      || process.env.TEAMS_WATCH_FOLDER
      || path.join(projectRoot, 'hackathon', 'watch', 'teams');
    this.processedFolder = merged?.processedFolder
      || path.join(projectRoot, 'hackathon', 'watch', 'processed');
    this.failedFolder = merged?.failedFolder
      || path.join(projectRoot, 'hackathon', 'watch', 'failed');
    this.pollInterval = merged?.pollInterval || 3000;
    this.verbose = merged?.verbose || process.env.TEAMS_VERBOSE === 'true';
    this.apiBaseUrl = process.env.REST_API_URL || `http://localhost:${process.env.MCP_HTTP_PORT || 3000}/api/v1`;

    // Ensure directories
    for (const dir of [this.watchFolder, this.processedFolder, this.failedFolder]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    // Start polling
    this.timer = setInterval(() => this.pollForFiles(), this.pollInterval);
    this.log(`Teams Adapter initialized — watching ${this.watchFolder}`);
    this.log(`Production mode: Replace file watcher with MS Graph API polling`);
  }

  async shutdown(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.log('Teams Adapter shut down');
  }

  // ========== File Polling ==========

  private async pollForFiles(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const files = fs.readdirSync(this.watchFolder)
        .filter(f => f.endsWith('.json'))
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
    } catch (err) {
      // Watch folder not readable — silently skip
    }

    this.processing = false;
  }

  // ========== Core Import Logic ==========

  async importFile(filePath: string): Promise<string> {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const callRecord: TeamsCallRecord = JSON.parse(raw);

    this.log(`Importing Teams call: ${callRecord.id} (${callRecord.type || 'unknown'})`);

    const vcon = this.mapCallRecordToVcon(callRecord);

    // Submit via REST API to trigger all hooks
    const res = await fetch(`${this.apiBaseUrl}/vcons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vcon),
    });

    const data = await res.json() as any;
    if (!data.success) {
      throw new Error(`API error: ${data.message || JSON.stringify(data)}`);
    }

    this.log(`Created vCon ${data.uuid} from Teams call ${callRecord.id} (${data.duration_ms}ms)`);
    return data.uuid;
  }

  // ========== Teams → vCon Mapping ==========

  private mapCallRecordToVcon(record: TeamsCallRecord): Partial<VCon> {
    const startTime = record.startDateTime;
    const endTime = record.endDateTime;
    const durationSec = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000;

    // Map participants → parties
    const parties: Party[] = record.participants.map(p => {
      const user = p.user || p.phone;
      const party: Party = {
        name: user?.displayName || 'Unknown',
      };
      if (user?.userPrincipalName) party.mailto = user.userPrincipalName;
      if (user?.id) party.uuid = user.id;
      return party;
    });

    // Dialog — recording reference or text placeholder
    const dialog: Dialog[] = [];
    if (record._simulated?.recording_url) {
      dialog.push({
        type: 'recording',
        start: startTime,
        duration: durationSec > 0 ? durationSec : 300,
        parties: parties.map((_, i) => i),
        mediatype: 'audio/wav',
        url: record._simulated.recording_url,
      });
    } else {
      dialog.push({
        type: 'text',
        start: startTime,
        duration: durationSec > 0 ? durationSec : 300,
        parties: parties.map((_, i) => i),
        mediatype: 'text/plain',
      });
    }

    // Analysis entries
    const analysis: Analysis[] = [];

    // Transcript
    if (record._simulated?.transcript) {
      analysis.push({
        type: 'transcript',
        vendor: 'teams-adapter',
        body: record._simulated.transcript,
        encoding: 'none',
        dialog: 0,
      });
    }

    // Summary
    if (record._simulated?.summary) {
      analysis.push({
        type: 'summary',
        vendor: 'teams-adapter',
        body: record._simulated.summary,
        encoding: 'none',
      });
    }

    // Keyword-based sentiment + topics
    if (record._simulated?.transcript) {
      const lower = record._simulated.transcript.toLowerCase();

      // Sentiment
      const posWords = ['thank', 'great', 'appreciate', 'excellent', 'resolved', 'happy', 'easier', 'steady'];
      const negWords = ['frustrat', 'angry', 'terrible', 'worst', 'upset', 'complain', 'disconnect', 'impact', 'runaround'];
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
        { pattern: /bill|charg|refund|payment|invoice|subscript|credit/i, topic: 'Billing' },
        { pattern: /technical|vpn|error|bug|crash|slow|broken|update|version|config/i, topic: 'Technical Support' },
        { pattern: /escalat|manager|supervisor|complain|process/i, topic: 'Escalation' },
        { pattern: /cancel|close|terminat|switch/i, topic: 'Cancellation' },
        { pattern: /security|fraud|flag|detect|approval/i, topic: 'Security' },
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
    }

    // Build subject
    const subject = record._simulated?.subject
      || `Teams ${record.type === 'groupCall' ? 'Meeting' : 'Call'}: ${parties.map(p => p.name).join(', ')}`;

    // Teams-specific metadata as analysis
    analysis.push({
      type: 'source-metadata',
      vendor: 'teams-adapter',
      body: JSON.stringify({
        source: 'microsoft-teams',
        callRecordId: record.id,
        callType: record.type,
        modalities: record.modalities,
        joinWebUrl: record.joinWebUrl,
        organizerName: record.organizer?.user?.displayName,
        organizerEmail: record.organizer?.user?.userPrincipalName,
        sessionCount: record.sessions?.length || 0,
      }),
      encoding: 'json',
    });

    return {
      vcon: '0.3.0',
      created_at: new Date().toISOString(),
      subject,
      parties,
      dialog,
      analysis,
    };
  }

  // ========== MCP Tools ==========

  registerTools(): Tool[] {
    return [
      {
        name: 'teams_import_file',
        description: 'Import a Teams call record JSON file and create a vCon. File must follow MS Graph callRecord schema.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filePath: {
              type: 'string',
              description: 'Absolute path to Teams call record JSON file',
            },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'teams_import_folder',
        description: 'Import all Teams call record JSON files from a folder. Defaults to the sample-data directory.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            folderPath: {
              type: 'string',
              description: 'Path to folder containing Teams JSON files (default: sample-data)',
            },
          },
        },
      },
      {
        name: 'teams_status',
        description: 'Get Teams adapter status: watch folder, stats, connection info.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
    ];
  }

  async handleToolCall(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'teams_import_file': {
        const filePath = args.filePath;
        if (!filePath || !fs.existsSync(filePath)) {
          return { error: `File not found: ${filePath}` };
        }
        try {
          const uuid = await this.importFile(filePath);
          return { success: true, uuid, source: path.basename(filePath) };
        } catch (err: any) {
          return { error: err.message };
        }
      }

      case 'teams_import_folder': {
        const folderPath = args.folderPath
          || path.join(process.cwd(), 'hackathon', 'sample-data');
        if (!fs.existsSync(folderPath)) {
          return { error: `Folder not found: ${folderPath}` };
        }
        const files = fs.readdirSync(folderPath).filter(f => f.startsWith('teams-') && f.endsWith('.json'));
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

      case 'teams_status': {
        return {
          adapter: this.name,
          version: this.version,
          watchFolder: this.watchFolder,
          pollInterval: this.pollInterval,
          stats: this.stats,
          productionNotes: 'Replace file watcher with MS Graph API: GET /communications/callRecords + MSAL auth',
        };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }

  // ========== Utilities ==========

  private moveFile(src: string, destDir: string): void {
    try {
      const dest = path.join(destDir, path.basename(src));
      fs.renameSync(src, dest);
    } catch (err) {
      this.log(`Failed to move ${src}: ${err}`, true);
    }
  }

  private log(msg: string, isError = false): void {
    const prefix = `[TeamsAdapter]`;
    if (isError) {
      console.error(`${prefix} ${msg}`);
    } else if (this.verbose || process.env.TEAMS_VERBOSE === 'true') {
      console.log(`${prefix} ${msg}`);
    }
  }
}

// ============================================================================
// Default export for plugin loader
// ============================================================================
export default TeamsAdapterPlugin;
