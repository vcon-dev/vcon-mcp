/**
 * AI Analyzer Plugin
 * 
 * Calls the LLaMA sidecar (Groq) to add AI-powered sentiment analysis,
 * summaries, and topic extraction to every vCon on creation.
 * 
 * Flow:
 *   afterCreate hook → extract transcript text → POST /analyze to sidecar
 *   → store sentiment/summary/topics as analysis[] entries in MongoDB
 * 
 * The sidecar URL defaults to http://localhost:8200 (LLAMA_SIDECAR_URL env).
 * If the sidecar is unavailable, the plugin degrades gracefully (logs a warning).
 */

import { VConPlugin, RequestContext } from '../../src/hooks/plugin-interface.js';
import { VCon, Analysis } from '../../src/types/vcon.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// Types
// ============================================================================

interface AnalyzeResponse {
  sentiment: number;
  sentiment_label: string;
  summary: string;
  topics: string[];
  key_phrases: string[];
  processing_time_seconds: number;
}

// ============================================================================
// AI Analyzer Plugin
// ============================================================================

export class AiAnalyzerPlugin implements VConPlugin {
  name = 'ai-analyzer';
  version = '1.0.0';

  private llamaUrl: string = '';
  private verbose: boolean = false;
  private queries: any = null;
  private analysisCount: number = 0;
  private failCount: number = 0;
  private online: boolean = false;

  // ========== Lifecycle ==========

  async initialize(config?: any): Promise<void> {
    this.llamaUrl = config?.llamaUrl
      || process.env.LLAMA_SIDECAR_URL
      || 'http://localhost:8200';
    this.verbose = config?.verbose
      || process.env.AI_ANALYZER_VERBOSE === 'true'
      || false;
    this.queries = config?.queries || null;

    // Check sidecar health on startup
    await this.checkHealth();

    this.log('info', `LLaMA sidecar: ${this.llamaUrl} (${this.online ? 'ONLINE' : 'OFFLINE'})`);
  }

  async shutdown(): Promise<void> {
    this.log('info', `AI Analyzer shut down (${this.analysisCount} analyzed, ${this.failCount} failed)`);
  }

  // ========== Hooks ==========

  async afterCreate(vcon: VCon, context: RequestContext): Promise<void> {
    // Extract transcript text from the vCon
    const transcript = this.extractTranscript(vcon);

    if (!transcript) {
      this.log('debug', `No transcript found for ${vcon.uuid} — skipping analysis`);
      return;
    }

    // Call LLaMA sidecar
    try {
      const analysis = await this.analyze(transcript, vcon.uuid);
      if (!analysis) return;

      // Store analysis results back into the vCon in MongoDB
      await this.storeAnalysis(vcon.uuid, analysis);
      this.analysisCount++;

      this.log('info', `Analyzed ${vcon.uuid}: sentiment=${analysis.sentiment.toFixed(2)} (${analysis.sentiment_label}), ${analysis.topics.length} topics, ${analysis.processing_time_seconds}s`);
    } catch (err: any) {
      this.failCount++;
      this.log('warn', `Analysis failed for ${vcon.uuid}: ${err.message}`);
    }
  }

  // ========== MCP Tools ==========

  registerTools(): Tool[] {
    return [
      {
        name: 'ai_analyze_vcon',
        description: 'Run AI analysis (sentiment, summary, topics) on a specific vCon by UUID. Useful for re-analyzing or analyzing vCons that were created before the AI sidecar was available.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            uuid: {
              type: 'string',
              description: 'vCon UUID to analyze',
            },
          },
          required: ['uuid'],
        },
      },
      {
        name: 'ai_analyzer_status',
        description: 'Get AI analyzer status: sidecar connection, analysis count, model info.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
      },
      {
        name: 'ai_query',
        description: 'Ask a natural language question about conversations. Provide context chunks from vCon transcripts for RAG-style Q&A.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            question: {
              type: 'string',
              description: 'Natural language question about conversations',
            },
            context_chunks: {
              type: 'array',
              description: 'Context chunks with text, vcon_uuid, and source fields',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  vcon_uuid: { type: 'string' },
                  source: { type: 'string' },
                },
              },
            },
          },
          required: ['question'],
        },
      },
    ];
  }

  async handleToolCall(toolName: string, args: any, context: RequestContext): Promise<any> {
    if (toolName === 'ai_analyzer_status') {
      return this.getStatus();
    }

    if (toolName === 'ai_analyze_vcon') {
      return this.analyzeByUuid(args.uuid);
    }

    if (toolName === 'ai_query') {
      return this.queryRag(args.question, args.context_chunks);
    }

    return null;
  }

  // ========== Core Logic ==========

  /**
   * Extract transcript text from vCon analysis entries.
   * Looks for analysis entries of type 'transcript'.
   * Falls back to dialog text content if no transcript analysis exists.
   */
  private extractTranscript(vcon: VCon): string | null {
    // Check analysis[] for transcripts
    if (vcon.analysis && vcon.analysis.length > 0) {
      const transcripts = vcon.analysis
        .filter(a => a.type === 'transcript' && a.body)
        .map(a => typeof a.body === 'string' ? a.body : JSON.stringify(a.body));

      if (transcripts.length > 0) {
        return transcripts.join('\n\n');
      }
    }

    // Check dialog[] for text content
    if (vcon.dialog && vcon.dialog.length > 0) {
      const textDialogs = vcon.dialog
        .filter(d => d.type === 'text' && d.body)
        .map(d => typeof d.body === 'string' ? d.body : JSON.stringify(d.body));

      if (textDialogs.length > 0) {
        return textDialogs.join('\n\n');
      }
    }

    return null;
  }

  /**
   * Call the LLaMA sidecar /analyze endpoint.
   */
  private async analyze(text: string, vconUuid?: string): Promise<AnalyzeResponse | null> {
    try {
      const response = await fetch(`${this.llamaUrl}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          vcon_uuid: vconUuid,
        }),
        signal: AbortSignal.timeout(30000), // 30s timeout
      });

      if (!response.ok) {
        this.log('warn', `LLaMA sidecar returned ${response.status}`);
        return null;
      }

      this.online = true;
      return await response.json() as AnalyzeResponse;
    } catch (err: any) {
      this.online = false;
      this.log('debug', `LLaMA sidecar unavailable: ${err.message}`);
      return null;
    }
  }

  /**
   * Store AI analysis results into the vCon document in MongoDB.
   * Adds three analysis entries: sentiment, summary, topics.
   */
  private async storeAnalysis(uuid: string, result: AnalyzeResponse): Promise<void> {
    if (!this.queries) return;

    const now = new Date().toISOString();

    // Build analysis entries to append
    const newAnalyses: Analysis[] = [
      {
        type: 'sentiment',
        vendor: 'groq',
        product: 'llama-3.1-8b-instant',
        body: {
          score: result.sentiment,
          label: result.sentiment_label,
        },
        encoding: 'none',
      },
      {
        type: 'summary',
        vendor: 'groq',
        product: 'llama-3.1-8b-instant',
        body: result.summary,
        encoding: 'none',
      },
      {
        type: 'topic-extraction',
        vendor: 'groq',
        product: 'llama-3.1-8b-instant',
        body: {
          topics: result.topics,
          key_phrases: result.key_phrases,
        },
        encoding: 'none',
      },
    ];

    try {
      const db = (this.queries as any).db;
      if (db) {
        // Append new analysis entries to existing analysis array
        await db.collection('vcons').updateOne(
          { uuid },
          {
            $push: {
              analysis: { $each: newAnalyses },
            },
            $set: {
              ai_analyzed_at: now,
              updated_at: now,
            },
          }
        );
      }
    } catch (err: any) {
      this.log('warn', `Could not store analysis for ${uuid}: ${err.message}`);
    }
  }

  // ========== Tool Handlers ==========

  private async analyzeByUuid(uuid: string): Promise<any> {
    if (!this.queries) return { error: 'Database not available' };

    try {
      const vcon = await this.queries.getVCon(uuid);
      const transcript = this.extractTranscript(vcon);

      if (!transcript) {
        return { error: 'No transcript found in this vCon' };
      }

      const result = await this.analyze(transcript, uuid);
      if (!result) {
        return { error: 'LLaMA sidecar unavailable' };
      }

      await this.storeAnalysis(uuid, result);
      this.analysisCount++;

      return {
        success: true,
        uuid,
        sentiment: result.sentiment,
        sentiment_label: result.sentiment_label,
        summary: result.summary,
        topics: result.topics,
        key_phrases: result.key_phrases,
        processing_time_seconds: result.processing_time_seconds,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  private async queryRag(question: string, contextChunks?: any[]): Promise<any> {
    // If no context chunks provided, gather from all vCons
    let chunks = contextChunks;

    if (!chunks || chunks.length === 0) {
      chunks = await this.gatherContextFromAllVcons(question);
    }

    if (!chunks || chunks.length === 0) {
      return { error: 'No conversation context available for answering' };
    }

    try {
      const response = await fetch(`${this.llamaUrl}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          context_chunks: chunks,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        return { error: `LLaMA sidecar returned ${response.status}` };
      }

      return await response.json();
    } catch (err: any) {
      return { error: `Query failed: ${err.message}` };
    }
  }

  /**
   * Gather transcript chunks from all vCons in MongoDB for RAG context.
   * Simple approach: pull all vCons, extract transcripts, return as chunks.
   * (A proper RAG system would use ChromaDB vector search — that's the next step.)
   */
  private async gatherContextFromAllVcons(question: string): Promise<any[]> {
    if (!this.queries) return [];

    try {
      const db = (this.queries as any).db;
      if (!db) return [];

      // Get all vCons that have transcripts
      const vcons = await db.collection('vcons')
        .find({ 'analysis.type': 'transcript' })
        .project({ uuid: 1, subject: 1, analysis: 1, parties: 1 })
        .limit(20)
        .toArray();

      const chunks: any[] = [];
      for (const vcon of vcons) {
        const transcripts = (vcon.analysis || [])
          .filter((a: any) => a.type === 'transcript' && a.body)
          .map((a: any) => typeof a.body === 'string' ? a.body : JSON.stringify(a.body));

        if (transcripts.length > 0) {
          const partyNames = (vcon.parties || [])
            .map((p: any) => p.name)
            .filter(Boolean)
            .join(', ');

          chunks.push({
            text: `Subject: ${vcon.subject || 'Unknown'}\nParticipants: ${partyNames}\n\n${transcripts.join('\n')}`,
            vcon_uuid: vcon.uuid,
            source: vcon.subject || 'conversation',
          });
        }
      }

      return chunks;
    } catch (err: any) {
      this.log('warn', `Failed to gather context: ${err.message}`);
      return [];
    }
  }

  // ========== Health & Status ==========

  private async checkHealth(): Promise<void> {
    try {
      const response = await fetch(`${this.llamaUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        this.online = true;
      }
    } catch {
      this.online = false;
    }
  }

  private async getStatus(): Promise<any> {
    await this.checkHealth();

    let healthInfo = null;
    if (this.online) {
      try {
        const resp = await fetch(`${this.llamaUrl}/health`);
        healthInfo = await resp.json();
      } catch { /* ignore */ }
    }

    return {
      sidecar_url: this.llamaUrl,
      online: this.online,
      analysis_count: this.analysisCount,
      fail_count: this.failCount,
      sidecar_info: healthInfo,
    };
  }

  // ========== Helpers ==========

  private log(level: string, message: string): void {
    const prefix = '[ai-analyzer]';
    if (level === 'error') console.error(`${prefix} ${message}`);
    else if (level === 'warn') console.warn(`${prefix} ${message}`);
    else if (level === 'debug' && this.verbose) console.log(`${prefix} ${message}`);
    else if (level === 'info') console.log(`${prefix} ${message}`);
  }
}

export default AiAnalyzerPlugin;
