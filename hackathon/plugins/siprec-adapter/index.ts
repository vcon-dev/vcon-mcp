/**
 * SIPREC Adapter Plugin
 * 
 * BASE CHALLENGE 1: Build the ingestion simulation folder drop
 * 
 * Watches a folder for SIPREC-style recording files and metadata,
 * parses them, and creates valid IETF vCon objects through VConService.
 * 
 * Supported file patterns:
 *   - {name}.xml  → SIPREC metadata (participants, timestamps, session info)
 *   - {name}.wav / .mp3 / .ogg  → Audio recording
 *   - {name}.txt  → Pre-existing transcript (optional)
 *   - {name}.json → Direct vCon JSON (bypass SIPREC parsing)
 * 
 * The adapter pairs .xml metadata with matching audio files by filename stem.
 * When a Whisper sidecar is available, audio is sent for transcription.
 * 
 * Drop folder default: ./hackathon/watch/siprec/
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

export interface SiprecAdapterConfig {
  /** Folder to watch for incoming files */
  watchFolder?: string;
  /** Poll interval in milliseconds (default: 3000) */
  pollInterval?: number;
  /** Whisper sidecar URL for transcription */
  whisperUrl?: string;
  /** Move processed files to this folder (default: ./hackathon/watch/processed/) */
  processedFolder?: string;
  /** Move failed files here (default: ./hackathon/watch/failed/) */
  failedFolder?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

interface SiprecMetadata {
  sessionId: string;
  startTime: string;
  endTime?: string;
  callerNumber?: string;
  callerName?: string;
  calleeNumber?: string;
  calleeName?: string;
  direction?: string;
  recordingFile?: string;
}

interface PendingFile {
  xmlPath?: string;
  audioPath?: string;
  transcriptPath?: string;
  jsonPath?: string;
  stem: string;
}

// ============================================================================
// SIPREC Adapter Plugin
// ============================================================================

export class SiprecAdapterPlugin implements VConPlugin {
  name = 'siprec-adapter';
  version = '1.0.0';

  private watchFolder: string = '';
  private processedFolder: string = '';
  private failedFolder: string = '';
  private pollInterval: number = 3000;
  private whisperUrl: string = '';
  private verbose: boolean = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private processing: boolean = false;
  private processedCount: number = 0;
  private vconService: any = null; // Set during initialize from config

  constructor(private config?: SiprecAdapterConfig) {}

  // ========== Lifecycle ==========

  async initialize(config?: any): Promise<void> {
    const merged = { ...this.config, ...config };

    this.watchFolder = merged?.watchFolder
      || process.env.SIPREC_WATCH_FOLDER
      || './hackathon/watch/siprec';
    this.processedFolder = merged?.processedFolder
      || process.env.SIPREC_PROCESSED_FOLDER
      || './hackathon/watch/processed';
    this.failedFolder = merged?.failedFolder
      || process.env.SIPREC_FAILED_FOLDER
      || './hackathon/watch/failed';
    this.pollInterval = merged?.pollInterval
      || parseInt(process.env.SIPREC_POLL_INTERVAL || '3000');
    this.whisperUrl = merged?.whisperUrl
      || process.env.WHISPER_SIDECAR_URL
      || 'http://localhost:8100';
    this.verbose = merged?.verbose
      || process.env.SIPREC_VERBOSE === 'true'
      || false;

    // Store vconService reference if passed via config
    // (Will be injected by a loader script or setup extension)
    this.vconService = merged?.vconService || null;

    // Ensure directories exist
    this.ensureDir(this.watchFolder);
    this.ensureDir(this.processedFolder);
    this.ensureDir(this.failedFolder);

    this.log('info', `Watching folder: ${path.resolve(this.watchFolder)}`);
    this.log('info', `Processed folder: ${path.resolve(this.processedFolder)}`);
    this.log('info', `Whisper sidecar: ${this.whisperUrl}`);

    // Start polling
    this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
    this.log('info', `Polling every ${this.pollInterval}ms`);
  }

  async shutdown(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.log('info', `SIPREC adapter shut down (${this.processedCount} files processed)`);
  }

  // ========== MCP Tools ==========

  registerTools(): Tool[] {
    return [
      {
        name: 'siprec_ingest_file',
        description: 'Manually trigger ingestion of a SIPREC XML or JSON file from the watch folder. Useful for testing or re-processing.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filename: {
              type: 'string',
              description: 'Filename (not full path) in the watch folder to process',
            },
          },
          required: ['filename'],
        },
      },
      {
        name: 'siprec_status',
        description: 'Get SIPREC adapter status: watch folder path, pending files, processed count.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
    ];
  }

  async handleToolCall(toolName: string, args: any, context: RequestContext): Promise<any> {
    if (toolName === 'siprec_status') {
      return this.getStatus();
    }
    if (toolName === 'siprec_ingest_file') {
      return this.manualIngest(args.filename);
    }
    return null;
  }

  // ========== Polling ==========

  private async poll(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const files = this.scanWatchFolder();
      if (files.length === 0) return;

      this.log('debug', `Found ${files.length} file group(s) to process`);

      for (const group of files) {
        try {
          await this.processFileGroup(group);
          this.moveToProcessed(group);
          this.processedCount++;
        } catch (err: any) {
          this.log('error', `Failed to process ${group.stem}: ${err.message}`);
          this.moveToFailed(group);
        }
      }
    } catch (err: any) {
      this.log('error', `Poll error: ${err.message}`);
    } finally {
      this.processing = false;
    }
  }

  // ========== File Scanning ==========

  private scanWatchFolder(): PendingFile[] {
    if (!fs.existsSync(this.watchFolder)) return [];

    const entries = fs.readdirSync(this.watchFolder);
    const groups = new Map<string, PendingFile>();

    for (const entry of entries) {
      const fullPath = path.join(this.watchFolder, entry);
      if (!fs.statSync(fullPath).isFile()) continue;

      const ext = path.extname(entry).toLowerCase();
      const stem = path.basename(entry, ext);

      if (!groups.has(stem)) {
        groups.set(stem, { stem });
      }
      const group = groups.get(stem)!;

      if (ext === '.xml') group.xmlPath = fullPath;
      else if (['.wav', '.mp3', '.ogg', '.webm', '.m4a'].includes(ext)) group.audioPath = fullPath;
      else if (ext === '.txt') group.transcriptPath = fullPath;
      else if (ext === '.json') group.jsonPath = fullPath;
    }

    // Only return groups that have at least an XML or JSON file
    return Array.from(groups.values()).filter(g => g.xmlPath || g.jsonPath);
  }

  // ========== Processing ==========

  private async processFileGroup(group: PendingFile): Promise<void> {
    this.log('info', `Processing: ${group.stem}`);

    // Path 1: Direct JSON vCon
    if (group.jsonPath) {
      const raw = fs.readFileSync(group.jsonPath, 'utf-8');
      const vconData = JSON.parse(raw);
      await this.createVCon(vconData, 'json-drop');
      return;
    }

    // Path 2: SIPREC XML + optional audio
    if (group.xmlPath) {
      const xmlContent = fs.readFileSync(group.xmlPath, 'utf-8');
      const metadata = this.parseSiprecXml(xmlContent);

      // Build parties
      const parties: Party[] = [];
      if (metadata.callerNumber || metadata.callerName) {
        parties.push({
          tel: metadata.callerNumber,
          name: metadata.callerName || metadata.callerNumber,
        });
      }
      if (metadata.calleeNumber || metadata.calleeName) {
        parties.push({
          tel: metadata.calleeNumber,
          name: metadata.calleeName || metadata.calleeNumber,
        });
      }

      // Build dialog
      const dialogs: Dialog[] = [];

      if (group.audioPath) {
        // Read audio file for hash and optional inline
        const audioBuffer = fs.readFileSync(group.audioPath);
        const hash = createHash('sha512').update(audioBuffer).digest('hex');
        const ext = path.extname(group.audioPath).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.wav': 'audio/x-wav',
          '.mp3': 'audio/mpeg',
          '.ogg': 'audio/ogg',
          '.webm': 'audio/webm',
          '.m4a': 'audio/mp4',
        };

        // For hackathon: inline base64 for small files (<1MB), external ref otherwise
        if (audioBuffer.length < 1_000_000) {
          dialogs.push({
            type: 'recording',
            start: metadata.startTime || new Date().toISOString(),
            duration: this.estimateDuration(metadata),
            parties: parties.length >= 2 ? [0, 1] : [0],
            mediatype: mimeMap[ext] || 'audio/x-wav',
            body: audioBuffer.toString('base64url'),
            encoding: 'base64url',
          });
        } else {
          dialogs.push({
            type: 'recording',
            start: metadata.startTime || new Date().toISOString(),
            duration: this.estimateDuration(metadata),
            parties: parties.length >= 2 ? [0, 1] : [0],
            mediatype: mimeMap[ext] || 'audio/x-wav',
            url: `file://${path.resolve(group.audioPath)}`,
            content_hash: `sha512-${hash}`,
          });
        }
      }

      // Build analysis (transcript)
      const analyses: Analysis[] = [];

      // Check for pre-existing transcript
      if (group.transcriptPath) {
        const transcript = fs.readFileSync(group.transcriptPath, 'utf-8');
        analyses.push({
          type: 'transcript',
          vendor: 'pre-existing',
          body: transcript,
          encoding: 'none',
        });
      } else if (group.audioPath) {
        // Try Whisper sidecar for transcription
        const transcript = await this.transcribeAudio(group.audioPath);
        if (transcript) {
          analyses.push({
            type: 'transcript',
            vendor: 'openai-whisper',
            product: 'whisper-large-v3',
            body: transcript,
            encoding: 'none',
          });
        }
      }

      // Create the vCon
      const vconData: Partial<VCon> = {
        subject: metadata.sessionId ? `SIPREC Session ${metadata.sessionId}` : `SIPREC Call ${group.stem}`,
        parties,
        dialog: dialogs.length > 0 ? dialogs : undefined,
        analysis: analyses.length > 0 ? analyses : undefined,
      };

      await this.createVCon(vconData, 'siprec');
    }
  }

  // ========== SIPREC XML Parsing ==========

  /**
   * Parse SIPREC metadata XML.
   * Supports a simplified SIPREC-like format for hackathon demo.
   * 
   * Expected XML structure:
   * <recording>
   *   <session id="...">
   *     <start-time>2026-03-07T10:30:00Z</start-time>
   *     <end-time>2026-03-07T10:35:42Z</end-time>
   *   </session>
   *   <caller>
   *     <number>+15551234567</number>
   *     <name>John Doe</name>
   *   </caller>
   *   <callee>
   *     <number>+15559876543</number>
   *     <name>Support Agent</name>
   *   </callee>
   *   <direction>inbound</direction>
   * </recording>
   */
  private parseSiprecXml(xml: string): SiprecMetadata {
    const result: SiprecMetadata = {
      sessionId: '',
      startTime: new Date().toISOString(),
    };

    // Simple regex-based XML extraction (no heavy XML lib needed for hackathon)
    result.sessionId = this.extractXmlAttr(xml, 'session', 'id')
      || this.extractXmlValue(xml, 'session-id')
      || `siprec-${Date.now()}`;
    result.startTime = this.extractXmlValue(xml, 'start-time')
      || this.extractXmlValue(xml, 'startTime')
      || new Date().toISOString();
    result.endTime = this.extractXmlValue(xml, 'end-time')
      || this.extractXmlValue(xml, 'endTime');
    result.callerNumber = this.extractNestedXmlValue(xml, 'caller', 'number')
      || this.extractXmlValue(xml, 'caller-number');
    result.callerName = this.extractNestedXmlValue(xml, 'caller', 'name')
      || this.extractNestedXmlValue(xml, 'caller', 'n')
      || this.extractXmlValue(xml, 'caller-name');
    result.calleeNumber = this.extractNestedXmlValue(xml, 'callee', 'number')
      || this.extractXmlValue(xml, 'callee-number');
    result.calleeName = this.extractNestedXmlValue(xml, 'callee', 'name')
      || this.extractNestedXmlValue(xml, 'callee', 'n')
      || this.extractXmlValue(xml, 'callee-name');
    result.direction = this.extractXmlValue(xml, 'direction');

    return result;
  }

  private extractXmlValue(xml: string, tag: string): string | undefined {
    const regex = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i');
    const match = xml.match(regex);
    return match?.[1]?.trim();
  }

  private extractXmlAttr(xml: string, tag: string, attr: string): string | undefined {
    const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]+)"`, 'i');
    const match = xml.match(regex);
    return match?.[1]?.trim();
  }

  private extractNestedXmlValue(xml: string, parent: string, child: string): string | undefined {
    const parentRegex = new RegExp(`<${parent}[^>]*>([\\s\\S]*?)</${parent}>`, 'i');
    const parentMatch = xml.match(parentRegex);
    if (!parentMatch) return undefined;
    return this.extractXmlValue(parentMatch[1], child);
  }

  // ========== Whisper Sidecar ==========

  private async transcribeAudio(audioPath: string): Promise<string | null> {
    try {
      const audioBuffer = fs.readFileSync(audioPath);
      const ext = path.extname(audioPath).toLowerCase().replace('.', '');

      const formData = new FormData();
      formData.append('file', new Blob([audioBuffer]), path.basename(audioPath));
      formData.append('model', 'large-v3');

      const response = await fetch(`${this.whisperUrl}/transcribe`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(60000), // 60s timeout
      });

      if (!response.ok) {
        this.log('warn', `Whisper sidecar returned ${response.status} — skipping transcription`);
        return null;
      }

      const result = await response.json() as any;
      return result.text || result.transcript || null;
    } catch (err: any) {
      this.log('debug', `Whisper sidecar unavailable: ${err.message} — skipping transcription`);
      return null;
    }
  }

  // ========== vCon Creation ==========

  private async createVCon(vconData: Partial<VCon>, source: string): Promise<void> {
    if (this.vconService) {
      // Use VConService (triggers all hooks: MQTT, Neo4j, etc.)
      const result = await this.vconService.create(vconData, {
        requestContext: { purpose: `siprec-adapter:${source}` },
        source: `siprec-${source}`,
      });
      this.log('info', `Created vCon ${result.uuid} via VConService (source: ${source})`);
    } else {
      // Fallback: POST to REST API
      const response = await fetch('http://localhost:3000/api/v1/vcons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vconData),
      });
      const result = await response.json() as any;
      if (result.success) {
        this.log('info', `Created vCon ${result.uuid} via REST API (source: ${source})`);
      } else {
        throw new Error(`REST API error: ${JSON.stringify(result)}`);
      }
    }
  }

  // ========== File Management ==========

  private moveToProcessed(group: PendingFile): void {
    this.moveFiles(group, this.processedFolder);
  }

  private moveToFailed(group: PendingFile): void {
    this.moveFiles(group, this.failedFolder);
  }

  private moveFiles(group: PendingFile, destFolder: string): void {
    const paths = [group.xmlPath, group.audioPath, group.transcriptPath, group.jsonPath];
    for (const p of paths) {
      if (p && fs.existsSync(p)) {
        const dest = path.join(destFolder, path.basename(p));
        try {
          fs.renameSync(p, dest);
        } catch {
          // Cross-device move fallback
          fs.copyFileSync(p, dest);
          fs.unlinkSync(p);
        }
      }
    }
  }

  // ========== Helpers ==========

  private estimateDuration(metadata: SiprecMetadata): number {
    if (metadata.startTime && metadata.endTime) {
      const start = new Date(metadata.startTime).getTime();
      const end = new Date(metadata.endTime).getTime();
      return Math.max(0, (end - start) / 1000);
    }
    return 0;
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private getStatus(): any {
    const pending = fs.existsSync(this.watchFolder)
      ? fs.readdirSync(this.watchFolder).length
      : 0;
    return {
      watchFolder: path.resolve(this.watchFolder),
      processedFolder: path.resolve(this.processedFolder),
      pendingFiles: pending,
      processedCount: this.processedCount,
      whisperUrl: this.whisperUrl,
      polling: this.pollTimer !== null,
      pollInterval: this.pollInterval,
    };
  }

  private async manualIngest(filename: string): Promise<any> {
    const fullPath = path.join(this.watchFolder, filename);
    if (!fs.existsSync(fullPath)) {
      return { error: `File not found: ${fullPath}` };
    }
    const ext = path.extname(filename).toLowerCase();
    const stem = path.basename(filename, ext);
    const group: PendingFile = { stem };
    if (ext === '.xml') group.xmlPath = fullPath;
    else if (ext === '.json') group.jsonPath = fullPath;
    else return { error: 'Only .xml and .json files can be manually ingested' };

    // Check for companion files
    const audioExts = ['.wav', '.mp3', '.ogg', '.webm', '.m4a'];
    for (const aExt of audioExts) {
      const audioPath = path.join(this.watchFolder, stem + aExt);
      if (fs.existsSync(audioPath)) { group.audioPath = audioPath; break; }
    }
    const txtPath = path.join(this.watchFolder, stem + '.txt');
    if (fs.existsSync(txtPath)) group.transcriptPath = txtPath;

    await this.processFileGroup(group);
    this.moveToProcessed(group);
    this.processedCount++;
    return { success: true, stem, processed: true };
  }

  private log(level: string, message: string): void {
    const prefix = '[siprec-adapter]';
    if (level === 'error') console.error(`${prefix} ${message}`);
    else if (level === 'warn') console.warn(`${prefix} ${message}`);
    else if (level === 'debug' && this.verbose) console.log(`${prefix} ${message}`);
    else if (level === 'info') console.log(`${prefix} ${message}`);
  }
}

export default SiprecAdapterPlugin;
