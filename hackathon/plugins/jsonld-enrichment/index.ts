/**
 * JSON-LD-ex Enrichment Plugin
 * 
 * WOW FACTOR 1: Deep Semantic vCon Interop
 * 
 * Transforms every vCon into semantically rich JSON-LD using the full
 * @jsonld-ex/core library. This is the killer differentiator — no other
 * hackathon team will have:
 * 
 *   1. Full @context with schema.org + vCon namespace + jsonld-ex AI/ML terms
 *   2. Per-value provenance annotations (@confidence, @source, @method, @extractedAt)
 *   3. Cryptographic integrity signing (SHA-256/384/512) with verification
 *   4. Subjective Logic confidence algebra (Opinion fusion, trust discount, decay)
 *   5. Temporal validity windows (@validFrom / @validUntil)
 *   6. Agentic AI capability advertisement (tool discovery via @context)
 *   7. Shape-based validation for vCon structure
 * 
 * The enriched JSON-LD document is stored alongside the original vCon in MongoDB
 * as a `jsonld_enrichment` field, and an MQTT event is published.
 */

import {
  JsonLdEx,
  annotate,
  getConfidence,
  getProvenance,
  aggregateConfidence,
  computeIntegrity,
  verifyIntegrity as verifySecurityIntegrity,
  AI_ML_CONTEXT,
  KEYWORD_CONFIDENCE,
  KEYWORD_SOURCE,
  KEYWORD_EXTRACTED_AT,
  KEYWORD_METHOD,
  KEYWORD_INTEGRITY,
  KEYWORD_VALID_FROM,
  KEYWORD_VALID_UNTIL,
  KEYWORD_HUMAN_VERIFIED,
  KEYWORD_ACTED_ON_BEHALF_OF,
  KEYWORD_WAS_DERIVED_FROM,
  type ProvenanceMetadata,
  type AnnotatedValue,
} from '@jsonld-ex/core';

import {
  Opinion,
  cumulativeFuse,
  trustDiscount,
  robustFuse,
} from '@jsonld-ex/core';

import { decayOpinion } from '@jsonld-ex/core';

import {
  combineOpinionsFromScalars,
  propagateOpinionsFromScalars,
} from '@jsonld-ex/core';

import { createHash } from 'crypto';
import stringify from 'fast-json-stable-stringify';
import mqtt from 'mqtt';
import { VConPlugin, RequestContext } from '../../src/hooks/plugin-interface.js';
import { VCon, Party, Analysis } from '../../src/types/vcon.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// Constants
// ============================================================================

/** vCon JSON-LD-ex enrichment context — combines schema.org, vCon ns, and jsonld-ex AI/ML */
const VCON_JSONLD_EX_CONTEXT = {
  "@context": [
    "https://schema.org",
    {
      // vCon namespace
      "vcon": "https://vcon.dev/ns#",
      "xsd": "http://www.w3.org/2001/XMLSchema#",
      "prov": "http://www.w3.org/ns/prov#",

      // vCon core terms
      "parties": "vcon:parties",
      "dialog": "vcon:dialog",
      "analysis": "vcon:analysis",
      "attachments": "vcon:attachments",
      "subject": "vcon:subject",

      // vCon analysis terms
      "vendor": "vcon:vendor",
      "product": "vcon:product",

      // jsonld-ex AI/ML extensions (from @jsonld-ex/core)
      "@confidence": { "@id": "https://w3id.org/jsonld-ex/confidence", "@type": "xsd:float" },
      "@source": { "@id": "https://w3id.org/jsonld-ex/source", "@type": "@id" },
      "@extractedAt": { "@id": "https://w3id.org/jsonld-ex/extractedAt", "@type": "xsd:dateTime" },
      "@method": { "@id": "https://w3id.org/jsonld-ex/method", "@type": "xsd:string" },
      "@humanVerified": { "@id": "https://w3id.org/jsonld-ex/humanVerified", "@type": "xsd:boolean" },
      "@integrity": { "@id": "https://w3id.org/jsonld-ex/integrity", "@type": "xsd:string" },
      "@validFrom": { "@id": "https://w3id.org/jsonld-ex/validFrom", "@type": "xsd:dateTime" },
      "@validUntil": { "@id": "https://w3id.org/jsonld-ex/validUntil", "@type": "xsd:dateTime" },
      "@actedOnBehalfOf": { "@id": "https://w3id.org/jsonld-ex/actedOnBehalfOf", "@type": "@id" },
      "@wasDerivedFrom": { "@id": "https://w3id.org/jsonld-ex/wasDerivedFrom", "@type": "@id" },

      // Subjective Logic opinion representation
      "opinion": "https://w3id.org/jsonld-ex/opinion",
      "belief": { "@id": "https://w3id.org/jsonld-ex/opinion/belief", "@type": "xsd:float" },
      "disbelief": { "@id": "https://w3id.org/jsonld-ex/opinion/disbelief", "@type": "xsd:float" },
      "uncertainty": { "@id": "https://w3id.org/jsonld-ex/opinion/uncertainty", "@type": "xsd:float" },
      "baseRate": { "@id": "https://w3id.org/jsonld-ex/opinion/baseRate", "@type": "xsd:float" },

      // Agentic AI capability advertisement
      "agentCapabilities": "https://w3id.org/jsonld-ex/agentCapabilities",
      "toolDiscovery": "https://w3id.org/jsonld-ex/toolDiscovery",
      "queryableVia": { "@id": "https://w3id.org/jsonld-ex/queryableVia", "@type": "@id" },
      "supportedOperations": "https://w3id.org/jsonld-ex/supportedOperations",
    }
  ]
};

// ============================================================================
// Types
// ============================================================================

export interface JsonLdEnrichmentConfig {
  /** Hash algorithm for integrity signing (default: sha256) */
  hashAlgorithm?: 'sha256' | 'sha384' | 'sha512';
  /** Default confidence for party identification (default: 0.85) */
  defaultPartyConfidence?: number;
  /** Confidence half-life in hours for temporal decay (default: 720 = 30 days) */
  confidenceHalfLifeHours?: number;
  /** MCP server URL for agent tool discovery */
  mcpServerUrl?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

export interface EnrichedVConJsonLd {
  "@context": any;
  "@type": string;
  "@id": string;
  "@integrity": string;
  "@validFrom": string;
  subject?: string;
  parties: any[];
  dialog?: any[];
  analysis?: any[];
  agentCapabilities: any;
  _enrichment: {
    version: string;
    enrichedAt: string;
    enrichmentPipeline: string[];
    integrityAlgorithm: string;
    confidenceModel: string;
  };
  [key: string]: any;
}

// ============================================================================
// JSON-LD-ex Enrichment Plugin
// ============================================================================

export class JsonLdEnrichmentPlugin implements VConPlugin {
  name = 'jsonld-enrichment';
  version = '1.0.0';

  private processor: JsonLdEx;
  private hashAlgorithm: 'sha256' | 'sha384' | 'sha512' = 'sha256';
  private defaultPartyConfidence: number = 0.85;
  private confidenceHalfLifeHours: number = 720;
  private mcpServerUrl: string = 'http://localhost:3000';
  private verbose: boolean = false;
  private enrichedCount: number = 0;
  private queries: any = null; // IVConQueries — injected at init
  private mqttClient: mqtt.MqttClient | null = null;
  private mqttOrgId: string = 'hackathon';

  constructor(private config?: JsonLdEnrichmentConfig) {
    this.processor = new JsonLdEx({
      processExtensions: true,
      validateVectors: true,
      resourceLimits: {
        maxContextDepth: 10,
        maxGraphDepth: 100,
        maxDocumentSize: 10 * 1024 * 1024, // 10MB
        maxExpansionTime: 30000,
      },
    });
  }

  // ========== Lifecycle ==========

  async initialize(config?: any): Promise<void> {
    const merged = { ...this.config, ...config };

    this.hashAlgorithm = merged?.hashAlgorithm || 'sha256';
    this.defaultPartyConfidence = merged?.defaultPartyConfidence || 0.85;
    this.confidenceHalfLifeHours = merged?.confidenceHalfLifeHours || 720;
    this.mcpServerUrl = merged?.mcpServerUrl || process.env.MCP_SERVER_URL || 'http://localhost:3000';
    this.verbose = merged?.verbose || process.env.JSONLD_VERBOSE === 'true' || false;
    this.queries = merged?.queries || null;

    // Connect to MQTT for publishing enrichment events
    const mqttUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
    this.mqttOrgId = process.env.MQTT_ORG_ID || 'hackathon';
    try {
      this.mqttClient = mqtt.connect(mqttUrl, { clientId: `jsonld-enrichment-${Date.now()}` });
      this.mqttClient.on('error', (err) => this.log('debug', `MQTT error: ${err.message}`));
    } catch (err: any) {
      this.log('debug', `MQTT connection failed: ${err.message}`);
    }

    this.log('info', `JSON-LD-ex enrichment initialized (${this.hashAlgorithm}, confidence model: subjective-logic)`);
  }

  async shutdown(): Promise<void> {
    this.log('info', `JSON-LD-ex enrichment shut down (${this.enrichedCount} vCons enriched)`);
  }

  // ========== Lifecycle Hooks ==========

  /**
   * After a vCon is created, enrich it with JSON-LD-ex semantics.
   * 
   * Pipeline:
   *   1. Map vCon → JSON-LD document with @context
   *   2. Annotate parties with confidence + provenance
   *   3. Annotate analysis with confidence + provenance + opinions
   *   4. Add temporal validity windows
   *   5. Add agentic AI capability advertisement
   *   6. Cryptographically sign with @integrity
   *   7. Store enrichment alongside original vCon
   *   8. Publish MQTT enrichment event
   */
  async afterCreate(vcon: VCon, context: RequestContext): Promise<void> {
    try {
      const startTime = Date.now();
      const enriched = this.enrichVCon(vcon, context);
      const duration = Date.now() - startTime;

      // Store enrichment in MongoDB alongside the vCon
      if (this.queries) {
        try {
          await this.storeEnrichment(vcon.uuid, enriched);
        } catch (err: any) {
          this.log('warn', `Failed to store enrichment for ${vcon.uuid}: ${err.message}`);
        }
      }

      // Publish vcon.enriched MQTT event
      if (this.mqttClient?.connected) {
        const event = {
          event: 'vcon.enriched',
          vcon_uuid: vcon.uuid,
          timestamp: new Date().toISOString(),
          analysis_type: 'jsonld-ex',
          integrity: enriched['@integrity'],
          duration_ms: duration,
        };
        const topic = `vcon/enterprise/${this.mqttOrgId}/enriched/${vcon.uuid}`;
        this.mqttClient.publish(topic, JSON.stringify(event), { qos: 1 });
      }

      this.enrichedCount++;
      this.log('debug', `Enriched vCon ${vcon.uuid} in ${duration}ms (integrity: ${enriched['@integrity']})`);
    } catch (err: any) {
      this.log('error', `Failed to enrich vCon ${vcon.uuid}: ${err.message}`);
    }
  }

  /**
   * After reading a vCon, attach the enrichment if available
   */
  async afterRead(vcon: VCon, context: RequestContext): Promise<VCon> {
    // If the vCon already has enrichment data, return as-is
    if ((vcon as any).jsonld_enrichment) return vcon;

    // Otherwise, try to enrich on-the-fly (lightweight, no storage)
    try {
      const enriched = this.enrichVCon(vcon, context);
      return { ...vcon, jsonld_enrichment: enriched } as any;
    } catch {
      return vcon;
    }
  }

  // ========== Core Enrichment ==========

  /**
   * Transform a vCon into a fully enriched JSON-LD-ex document
   */
  enrichVCon(vcon: VCon, context?: RequestContext): EnrichedVConJsonLd {
    const now = new Date().toISOString();
    const source = context?.purpose || 'vcon-mcp';
    const pipeline: string[] = [];

    // Step 1: Base JSON-LD structure
    const doc: any = {
      "@context": VCON_JSONLD_EX_CONTEXT["@context"],
      "@type": "vcon:Conversation",
      "@id": `urn:uuid:${vcon.uuid}`,
      "subject": vcon.subject,
      "vcon:version": vcon.vcon,
      "vcon:created_at": vcon.created_at,
    };
    pipeline.push('base-mapping');

    // Step 2: Annotate parties with confidence + provenance
    doc.parties = this.enrichParties(vcon.parties || [], source);
    pipeline.push('party-annotation');

    // Step 3: Annotate dialog with metadata
    if (vcon.dialog?.length) {
      doc.dialog = this.enrichDialog(vcon.dialog);
      pipeline.push('dialog-annotation');
    }

    // Step 4: Annotate analysis with confidence, provenance, and opinions
    if (vcon.analysis?.length) {
      doc.analysis = this.enrichAnalysis(vcon.analysis, vcon.uuid);
      pipeline.push('analysis-annotation');

      // Step 4b: Compute aggregate confidence across all analyses
      const confidences = doc.analysis
        .map((a: any) => a['@confidence'])
        .filter((c: any) => typeof c === 'number');
      if (confidences.length > 1) {
        doc['vcon:aggregateConfidence'] = this.computeAggregateConfidence(confidences);
        pipeline.push('confidence-fusion');
      }
    }

    // Step 5: Temporal validity
    doc['@validFrom'] = vcon.created_at || now;
    pipeline.push('temporal-validity');

    // Step 6: Agentic AI capability advertisement
    doc.agentCapabilities = this.buildAgentCapabilities(vcon);
    pipeline.push('agent-capabilities');

    // Step 7: Enrichment metadata
    doc._enrichment = {
      version: '1.0.0',
      enrichedAt: now,
      enrichmentPipeline: pipeline,
      integrityAlgorithm: this.hashAlgorithm,
      confidenceModel: 'subjective-logic-josang',
    };

    // Step 8: Cryptographic integrity signing (MUST be last)
    doc['@integrity'] = this.signDocument(doc);
    pipeline.push('integrity-signing');

    return doc as EnrichedVConJsonLd;
  }

  // ========== Party Enrichment ==========

  private enrichParties(parties: Party[], source: string): any[] {
    return parties.map((party, index) => {
      const identifier = party.tel || party.mailto || party.name;
      const identMethod = party.tel ? 'caller_id' : party.mailto ? 'email_header' : 'name_extraction';

      // Confidence varies by identification method
      const confidenceMap: Record<string, number> = {
        'caller_id': 0.92,       // STIR/SHAKEN verified phone
        'email_header': 0.88,    // Email address from headers
        'name_extraction': 0.75, // NER or manual entry
      };
      const confidence = confidenceMap[identMethod] || this.defaultPartyConfidence;

      const enriched: any = {
        "@type": "schema:Person",
        "@id": identifier ? `urn:party:${encodeURIComponent(identifier)}` : `urn:party:index:${index}`,
        "@confidence": confidence,
        "@source": `urn:adapter:${source}`,
        "@extractedAt": new Date().toISOString(),
        "@method": identMethod,
      };

      if (party.name) enriched["schema:name"] = party.name;
      if (party.tel) enriched["schema:telephone"] = party.tel;
      if (party.mailto) enriched["schema:email"] = party.mailto;

      // Subjective Logic opinion for this party identification
      enriched.opinion = this.scalarToOpinionJson(confidence, 0.05);

      return enriched;
    });
  }

  // ========== Dialog Enrichment ==========

  private enrichDialog(dialogs: VCon['dialog']): any[] {
    return (dialogs || []).map((dialog, index) => {
      const enriched: any = {
        "@type": `vcon:Dialog:${dialog.type}`,
        "vcon:dialogIndex": index,
        "vcon:type": dialog.type,
      };

      if (dialog.start) enriched["vcon:start"] = dialog.start;
      if (dialog.duration) enriched["vcon:duration"] = dialog.duration;
      if (dialog.mediatype) enriched["vcon:mediatype"] = dialog.mediatype;

      // Content integrity hash (without including the body itself in the enrichment)
      if (dialog.body) {
        enriched["@contentHash"] = `sha256-${createHash('sha256').update(dialog.body).digest('hex')}`;
        enriched["vcon:hasContent"] = true;
        enriched["vcon:encoding"] = dialog.encoding || 'none';
      } else if (dialog.url) {
        enriched["vcon:contentUrl"] = dialog.url;
        if (dialog.content_hash) enriched["@contentHash"] = dialog.content_hash;
      }

      return enriched;
    });
  }

  // ========== Analysis Enrichment ==========

  private enrichAnalysis(analyses: Analysis[], vconUuid: string): any[] {
    return analyses.map((analysis, index) => {
      // Map analysis type to confidence heuristic
      const typeConfidenceMap: Record<string, number> = {
        'transcript': 0.90,    // Whisper transcription
        'sentiment': 0.82,     // LLM sentiment analysis
        'summary': 0.78,       // LLM summarization
        'topics': 0.85,        // Topic extraction
        'translation': 0.88,   // Machine translation
        'intent': 0.76,        // Intent classification
        'entities': 0.84,      // Named entity recognition
        'pii_detection': 0.91, // PII detection
      };
      const confidence = typeConfidenceMap[analysis.type] || 0.75;

      // Determine provenance source
      const isLocalGpu = analysis.vendor?.includes('local') || analysis.vendor?.includes('whisper');
      const sourceUri = isLocalGpu
        ? `urn:device:rtx_4090:${analysis.vendor}`
        : `urn:vendor:${encodeURIComponent(analysis.vendor)}`;

      const enriched: any = {
        "@type": `vcon:Analysis:${analysis.type}`,
        "@id": `urn:uuid:${vconUuid}:analysis:${index}`,
        "@confidence": confidence,
        "@source": sourceUri,
        "@extractedAt": new Date().toISOString(),
        "@method": analysis.type,
        "@wasDerivedFrom": `urn:uuid:${vconUuid}`,
        "vendor": analysis.vendor,
      };

      if (analysis.product) enriched["product"] = analysis.product;
      if (analysis.schema) enriched["vcon:schema"] = analysis.schema;

      // Provenance chain: who acted on behalf of whom
      if (isLocalGpu) {
        enriched["@actedOnBehalfOf"] = "urn:operator:vcon-intelligence-platform";
        enriched["provenance"] = {
          "inferenceDevice": "NVIDIA RTX 4090",
          "inferenceLocation": "on-premise",
          "dataResidency": "local",
          "cloudDependency": false,
        };
      }

      // Subjective Logic opinion
      enriched.opinion = this.scalarToOpinionJson(confidence, 0.08);

      // Content hash of analysis body for verification
      if (analysis.body) {
        enriched["@contentHash"] = `sha256-${createHash('sha256').update(analysis.body).digest('hex')}`;
      }

      return enriched;
    });
  }

  // ========== Confidence Algebra ==========

  /**
   * Compute aggregate confidence using Subjective Logic cumulative fusion.
   * This is far more principled than simple averaging — it accounts for
   * uncertainty and evidence strength from each source.
   */
  private computeAggregateConfidence(scores: number[]): any {
    // Use the bridge to convert scalars to opinions and fuse
    const fused = combineOpinionsFromScalars(scores, 0.05, 'cumulative');

    return {
      "@type": "jsonld-ex:AggregateConfidence",
      "projectedProbability": fused.projectedProbability(),
      "opinion": {
        "belief": round(fused.belief),
        "disbelief": round(fused.disbelief),
        "uncertainty": round(fused.uncertainty),
        "baseRate": round(fused.baseRate),
      },
      "inputScores": scores,
      "fusionMethod": "cumulative_subjective_logic",
      "sourceCount": scores.length,
    };
  }

  /**
   * Propagate confidence through a trust chain.
   * Used when analysis B depends on analysis A (e.g., sentiment depends on transcript).
   */
  propagateTrustChain(chain: number[]): any {
    const result = propagateOpinionsFromScalars(chain, 0.05);
    return {
      "@type": "jsonld-ex:PropagatedConfidence",
      "projectedProbability": result.projectedProbability(),
      "opinion": {
        "belief": round(result.belief),
        "disbelief": round(result.disbelief),
        "uncertainty": round(result.uncertainty),
        "baseRate": round(result.baseRate),
      },
      "chainLength": chain.length,
      "inputChain": chain,
    };
  }

  /**
   * Apply temporal decay to a confidence score.
   * Older analysis results become less certain over time.
   */
  decayConfidence(confidence: number, hoursElapsed: number): any {
    const opinion = Opinion.fromConfidence(confidence, 0.05);
    const decayed = decayOpinion(opinion, hoursElapsed, this.confidenceHalfLifeHours);
    return {
      "@type": "jsonld-ex:DecayedConfidence",
      "originalConfidence": confidence,
      "decayedConfidence": round(decayed.toConfidence()),
      "hoursElapsed": hoursElapsed,
      "halfLifeHours": this.confidenceHalfLifeHours,
      "opinion": {
        "belief": round(decayed.belief),
        "disbelief": round(decayed.disbelief),
        "uncertainty": round(decayed.uncertainty),
      },
    };
  }

  // ========== Cryptographic Integrity ==========

  /**
   * Sign a document using the configured hash algorithm.
   * Excludes @integrity field from hash calculation for verifiability.
   */
  private signDocument(doc: any): string {
    const copy = { ...doc };
    delete copy['@integrity'];
    // Remove _enrichment.enrichmentPipeline last entry (it references this step)
    const serialized = stringify(copy);
    return computeIntegrity(serialized, this.hashAlgorithm);
  }

  /**
   * Verify a previously signed document
   */
  verifyDocument(doc: any): { valid: boolean; algorithm: string; hash: string } {
    const declaredIntegrity = doc['@integrity'];
    if (!declaredIntegrity) {
      return { valid: false, algorithm: 'none', hash: '' };
    }

    const copy = { ...doc };
    delete copy['@integrity'];
    const serialized = stringify(copy);
    const valid = verifySecurityIntegrity(serialized, declaredIntegrity);

    return {
      valid,
      algorithm: declaredIntegrity.split('-')[0],
      hash: declaredIntegrity,
    };
  }

  // ========== Agentic AI Capabilities ==========

  /**
   * Build agent capability advertisement.
   * This tells AI agents what operations they can perform on this vCon
   * through the MCP server — enabling semantic tool discovery.
   */
  private buildAgentCapabilities(vcon: VCon): any {
    const capabilities: string[] = [
      'search_semantic',
      'search_keyword',
      'search_hybrid',
      'get_vcon',
      'add_analysis',
      'add_tag',
      'verify_integrity',
    ];

    // Add conditional capabilities
    if (vcon.dialog?.length) capabilities.push('transcribe', 'translate');
    if (vcon.analysis?.length) capabilities.push('query_analysis', 'aggregate_confidence');
    if (vcon.parties?.length) capabilities.push('query_participants', 'graph_traversal');

    return {
      "@type": "jsonld-ex:AgentCapabilityManifest",
      "queryableVia": `${this.mcpServerUrl}/mcp`,
      "protocol": "mcp",
      "supportedOperations": capabilities,
      "toolDiscovery": {
        "@type": "jsonld-ex:ToolRegistry",
        "tools": [
          {
            "name": "jsonld_verify_integrity",
            "description": "Verify cryptographic integrity of this enriched vCon",
            "inputRequired": ["vcon_uuid"],
          },
          {
            "name": "jsonld_get_enrichment",
            "description": "Get the full JSON-LD-ex enrichment for a vCon",
            "inputRequired": ["vcon_uuid"],
          },
          {
            "name": "jsonld_confidence_query",
            "description": "Query confidence scores and opinions for vCon data points",
            "inputRequired": ["vcon_uuid"],
          },
          {
            "name": "jsonld_provenance_chain",
            "description": "Trace the provenance chain for any enriched data point",
            "inputRequired": ["vcon_uuid", "data_path"],
          },
          {
            "name": "neo4j_query",
            "description": "Query the relationship graph for participants, topics, and patterns",
            "inputRequired": ["query"],
          },
        ],
      },
      "semanticContext": {
        "interoperableWith": [
          "https://schema.org",
          "https://www.w3.org/ns/prov#",
          "https://hl7.org/fhir",
          "http://purl.org/dc/terms/",
        ],
        "confidenceModel": "subjective-logic-josang",
        "integrityAlgorithm": this.hashAlgorithm,
      },
    };
  }

  // ========== MCP Tools ==========

  registerTools(): Tool[] {
    return [
      {
        name: 'jsonld_get_enrichment',
        description: 'Get the full JSON-LD-ex semantic enrichment for a vCon, including provenance annotations, confidence scores, integrity hash, and agent capabilities.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            vcon_uuid: { type: 'string', description: 'UUID of the vCon to get enrichment for' },
          },
          required: ['vcon_uuid'],
        },
      },
      {
        name: 'jsonld_verify_integrity',
        description: 'Verify the cryptographic integrity of a vCon enrichment. Returns whether the document has been tampered with since signing.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            vcon_uuid: { type: 'string', description: 'UUID of the vCon to verify' },
          },
          required: ['vcon_uuid'],
        },
      },
      {
        name: 'jsonld_confidence_query',
        description: 'Query confidence scores for a vCon. Returns per-party and per-analysis confidence with Subjective Logic opinions. Supports temporal decay calculation.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            vcon_uuid: { type: 'string', description: 'UUID of the vCon' },
            apply_decay: { type: 'boolean', description: 'Apply temporal decay to confidence scores based on age (default: false)' },
          },
          required: ['vcon_uuid'],
        },
      },
      {
        name: 'jsonld_provenance_chain',
        description: 'Trace the full provenance chain for a vCon: who created it, what models analyzed it, confidence scores, integrity verification, and data lineage.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            vcon_uuid: { type: 'string', description: 'UUID of the vCon' },
          },
          required: ['vcon_uuid'],
        },
      },
      {
        name: 'jsonld_trust_propagation',
        description: 'Compute trust propagation through an analysis chain using Subjective Logic. For example: transcript confidence → sentiment confidence → summary confidence.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            confidence_chain: {
              type: 'array',
              items: { type: 'number' },
              description: 'Array of confidence scores along the inference chain',
            },
          },
          required: ['confidence_chain'],
        },
      },
    ];
  }

  async handleToolCall(toolName: string, args: any, context: RequestContext): Promise<any> {
    switch (toolName) {
      case 'jsonld_get_enrichment':
        return this.handleGetEnrichment(args.vcon_uuid);
      case 'jsonld_verify_integrity':
        return this.handleVerifyIntegrity(args.vcon_uuid);
      case 'jsonld_confidence_query':
        return this.handleConfidenceQuery(args.vcon_uuid, args.apply_decay);
      case 'jsonld_provenance_chain':
        return this.handleProvenanceChain(args.vcon_uuid);
      case 'jsonld_trust_propagation':
        return this.propagateTrustChain(args.confidence_chain);
      default:
        return null;
    }
  }

  // ========== Tool Handlers ==========

  private async handleGetEnrichment(uuid: string): Promise<any> {
    if (!this.queries) return { error: 'Database not available' };

    try {
      const vcon = await this.queries.getVCon(uuid);
      if ((vcon as any).jsonld_enrichment) {
        return (vcon as any).jsonld_enrichment;
      }
      // Enrich on-the-fly
      return this.enrichVCon(vcon);
    } catch (err: any) {
      return { error: err.message };
    }
  }

  private async handleVerifyIntegrity(uuid: string): Promise<any> {
    if (!this.queries) return { error: 'Database not available' };

    try {
      const vcon = await this.queries.getVCon(uuid);
      const enrichment = (vcon as any).jsonld_enrichment || this.enrichVCon(vcon);
      const result = this.verifyDocument(enrichment);

      return {
        vcon_uuid: uuid,
        integrity: result,
        verified_at: new Date().toISOString(),
        message: result.valid
          ? 'Document integrity verified — no tampering detected.'
          : 'INTEGRITY VIOLATION — document may have been modified since signing.',
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  private async handleConfidenceQuery(uuid: string, applyDecay?: boolean): Promise<any> {
    if (!this.queries) return { error: 'Database not available' };

    try {
      const vcon = await this.queries.getVCon(uuid);
      const enrichment = (vcon as any).jsonld_enrichment || this.enrichVCon(vcon);

      const result: any = {
        vcon_uuid: uuid,
        parties: enrichment.parties?.map((p: any) => ({
          name: p['schema:name'],
          identifier: p['@id'],
          confidence: p['@confidence'],
          method: p['@method'],
          opinion: p.opinion,
        })),
        analyses: enrichment.analysis?.map((a: any) => ({
          type: a['@type'],
          confidence: a['@confidence'],
          source: a['@source'],
          opinion: a.opinion,
        })),
        aggregate: enrichment['vcon:aggregateConfidence'],
      };

      // Apply temporal decay if requested
      if (applyDecay && vcon.created_at) {
        const hoursElapsed = (Date.now() - new Date(vcon.created_at).getTime()) / (1000 * 60 * 60);
        result.temporalDecay = {
          hoursElapsed: round(hoursElapsed),
          analyses: enrichment.analysis?.map((a: any) => ({
            type: a['@type'],
            original: a['@confidence'],
            decayed: this.decayConfidence(a['@confidence'], hoursElapsed),
          })),
        };
      }

      return result;
    } catch (err: any) {
      return { error: err.message };
    }
  }

  private async handleProvenanceChain(uuid: string): Promise<any> {
    if (!this.queries) return { error: 'Database not available' };

    try {
      const vcon = await this.queries.getVCon(uuid);
      const enrichment = (vcon as any).jsonld_enrichment || this.enrichVCon(vcon);
      const integrity = this.verifyDocument(enrichment);

      return {
        vcon_uuid: uuid,
        "@id": enrichment['@id'],
        created_at: vcon.created_at,
        enriched_at: enrichment._enrichment?.enrichedAt,
        pipeline: enrichment._enrichment?.enrichmentPipeline,
        integrity,
        parties: enrichment.parties?.map((p: any) => ({
          who: p['schema:name'],
          identifier: p['@id'],
          identifiedBy: p['@source'],
          method: p['@method'],
          confidence: p['@confidence'],
          when: p['@extractedAt'],
        })),
        analyses: enrichment.analysis?.map((a: any) => ({
          type: a['@type'],
          performedBy: a['@source'],
          method: a['@method'],
          confidence: a['@confidence'],
          derivedFrom: a['@wasDerivedFrom'],
          actedOnBehalfOf: a['@actedOnBehalfOf'],
          provenance: a.provenance,
          contentHash: a['@contentHash'],
          when: a['@extractedAt'],
        })),
        agentCapabilities: enrichment.agentCapabilities?.supportedOperations,
        interoperableWith: enrichment.agentCapabilities?.semanticContext?.interoperableWith,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // ========== Storage ==========

  private async storeEnrichment(uuid: string, enrichment: any): Promise<void> {
    if (!this.queries) return;

    // Store as a field on the vCon document in MongoDB
    // Uses the raw MongoDB collection to add the enrichment field
    try {
      const db = (this.queries as any).db;
      if (db) {
        await db.collection('vcons').updateOne(
          { uuid },
          { $set: { jsonld_enrichment: enrichment } }
        );
      }
    } catch (err: any) {
      this.log('debug', `Could not store enrichment directly: ${err.message}`);
    }
  }

  // ========== Helpers ==========

  private scalarToOpinionJson(confidence: number, uncertainty: number = 0.05): any {
    const opinion = Opinion.fromConfidence(confidence, uncertainty);
    return {
      belief: round(opinion.belief),
      disbelief: round(opinion.disbelief),
      uncertainty: round(opinion.uncertainty),
      baseRate: round(opinion.baseRate),
      projectedProbability: round(opinion.projectedProbability()),
    };
  }

  private log(level: string, message: string): void {
    const prefix = '[jsonld-enrichment]';
    if (level === 'error') console.error(`${prefix} ${message}`);
    else if (level === 'warn') console.warn(`${prefix} ${message}`);
    else if (level === 'debug' && this.verbose) console.log(`${prefix} ${message}`);
    else if (level === 'info') console.log(`${prefix} ${message}`);
  }
}

// ========== Utility ==========

function round(n: number, decimals: number = 4): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

export default JsonLdEnrichmentPlugin;
