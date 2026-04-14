/**
 * Neo4j Consumer Plugin
 * 
 * BASE CHALLENGE 5: Relational Graph Mapping
 * 
 * Consumes vCon objects and builds a knowledge graph in Neo4j.
 * 
 * Graph Schema:
 *   (:Person {name, email, phone, role})
 *     -[:PARTICIPATED_IN]-> (:Conversation {uuid, subject, start, duration, sentiment})
 *   (:Conversation)-[:HAS_TOPIC]->(:Topic {name, confidence})
 *   (:Conversation)-[:ANALYZED_BY]->(:Analysis {type, vendor})
 *   (:Person)-[:CONTACTED]->(:Person)  // derived from shared conversations
 *   (:Person)-[:WORKS_AT]->(:Organization {name})
 * 
 * Derived Cypher Insights:
 *   - Repeat callers (persons with >N conversations)
 *   - Topic clusters (community detection on co-occurrence)
 *   - Escalation paths (conversation chains with declining sentiment)
 *   - Contact networks (who talks to whom)
 */

import neo4j, { Driver, Session, ManagedTransaction } from 'neo4j-driver';
import { VConPlugin, RequestContext } from '../../src/hooks/plugin-interface.js';
import { VCon, Party, Analysis } from '../../src/types/vcon.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

// ============================================================================
// Types
// ============================================================================

export interface Neo4jConsumerConfig {
  uri?: string;
  user?: string;
  password?: string;
  database?: string;
  verbose?: boolean;
}

interface PersonNode {
  name: string;
  email?: string;
  phone?: string;
  identifier: string; // Unique key: tel, mailto, or name
}

// ============================================================================
// Neo4j Consumer Plugin
// ============================================================================

export class Neo4jConsumerPlugin implements VConPlugin {
  name = 'neo4j-consumer';
  version = '1.0.0';

  private driver: Driver | null = null;
  private database: string = 'neo4j';
  private verbose: boolean = false;
  private nodeCount: number = 0;
  private relCount: number = 0;

  constructor(private config?: Neo4jConsumerConfig) {}

  // ========== Lifecycle ==========

  async initialize(config?: any): Promise<void> {
    const merged = { ...this.config, ...config };

    const uri = merged?.uri || process.env.NEO4J_URI || 'bolt://localhost:7687';
    const user = merged?.user || process.env.NEO4J_USER || 'neo4j';
    const password = merged?.password || process.env.NEO4J_PASSWORD || 'vcon2026';
    this.database = merged?.database || process.env.NEO4J_DATABASE || 'neo4j';
    this.verbose = merged?.verbose || process.env.NEO4J_VERBOSE === 'true' || false;

    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
      
      // Verify connectivity
      await this.driver.verifyConnectivity();
      this.log('info', `Connected to Neo4j at ${uri}`);

      // Create constraints and indexes
      await this.setupSchema();
    } catch (err: any) {
      this.log('warn', `Neo4j connection failed: ${err.message} — continuing without graph`);
      this.driver = null;
    }
  }

  async shutdown(): Promise<void> {
    if (this.driver) {
      this.log('info', `Shutting down Neo4j consumer (${this.nodeCount} nodes, ${this.relCount} rels created)`);
      await this.driver.close();
      this.driver = null;
    }
  }

  // ========== Schema Setup ==========

  private async setupSchema(): Promise<void> {
    const session = this.getSession();
    if (!session) return;

    try {
      // Constraints (uniqueness)
      const constraints = [
        'CREATE CONSTRAINT person_identifier IF NOT EXISTS FOR (p:Person) REQUIRE p.identifier IS UNIQUE',
        'CREATE CONSTRAINT conversation_uuid IF NOT EXISTS FOR (c:Conversation) REQUIRE c.uuid IS UNIQUE',
        'CREATE CONSTRAINT topic_name IF NOT EXISTS FOR (t:Topic) REQUIRE t.name IS UNIQUE',
        'CREATE CONSTRAINT organization_name IF NOT EXISTS FOR (o:Organization) REQUIRE o.name IS UNIQUE',
      ];

      for (const constraint of constraints) {
        try {
          await session.run(constraint);
        } catch (e: any) {
          // Ignore if constraint already exists or syntax not supported
          if (!e.message.includes('already exists')) {
            this.log('debug', `Constraint note: ${e.message}`);
          }
        }
      }

      // Indexes for fast lookups
      const indexes = [
        'CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)',
        'CREATE INDEX conversation_start IF NOT EXISTS FOR (c:Conversation) ON (c.start)',
        'CREATE INDEX conversation_sentiment IF NOT EXISTS FOR (c:Conversation) ON (c.sentiment)',
      ];

      for (const index of indexes) {
        try {
          await session.run(index);
        } catch (e: any) {
          if (!e.message.includes('already exists')) {
            this.log('debug', `Index note: ${e.message}`);
          }
        }
      }

      this.log('info', 'Neo4j schema initialized (constraints + indexes)');
    } finally {
      await session.close();
    }
  }

  // ========== Lifecycle Hooks ==========

  /**
   * After a vCon is created, map it into the Neo4j graph
   */
  async afterCreate(vcon: VCon, context: RequestContext): Promise<void> {
    if (!this.driver) return;

    const session = this.getSession();
    if (!session) return;

    try {
      await session.executeWrite(async (tx: ManagedTransaction) => {
        // 1. Create Conversation node
        await this.createConversationNode(tx, vcon);

        // 2. Create Person nodes + PARTICIPATED_IN relationships
        const personIds = await this.createPartyNodes(tx, vcon);

        // 3. Create CONTACTED relationships between all participants
        await this.createContactedRelationships(tx, personIds, vcon.uuid);

        // 4. Extract and create Topic nodes from analysis
        await this.createTopicNodes(tx, vcon);

        // 5. Create Analysis nodes
        await this.createAnalysisNodes(tx, vcon);
      });

      this.log('debug', `Mapped vCon ${vcon.uuid} to graph`);
    } catch (err: any) {
      this.log('error', `Failed to map vCon ${vcon.uuid} to graph: ${err.message}`);
    } finally {
      await session.close();
    }
  }

  /**
   * After a vCon is deleted, remove it from the graph
   */
  async afterDelete(uuid: string, context: RequestContext): Promise<void> {
    if (!this.driver) return;

    const session = this.getSession();
    if (!session) return;

    try {
      await session.executeWrite(async (tx: ManagedTransaction) => {
        // Detach delete the conversation and its exclusive relationships
        await tx.run(
          `MATCH (c:Conversation {uuid: $uuid})
           DETACH DELETE c`,
          { uuid }
        );
      });
      this.log('debug', `Removed vCon ${uuid} from graph`);
    } finally {
      await session.close();
    }
  }

  // ========== Graph Construction ==========

  private async createConversationNode(tx: ManagedTransaction, vcon: VCon): Promise<void> {
    // Calculate total duration
    const totalDuration = vcon.dialog?.reduce((sum, d) => sum + (d.duration || 0), 0) || 0;

    // Extract sentiment from analysis if present
    const sentimentAnalysis = vcon.analysis?.find(a => a.type === 'sentiment');
    let sentiment: number | null = null;
    if (sentimentAnalysis?.body) {
      try {
        const parsed = JSON.parse(sentimentAnalysis.body);
        sentiment = parsed.overall ?? parsed.score ?? null;
      } catch { /* not JSON or no score */ }
    }

    await tx.run(
      `MERGE (c:Conversation {uuid: $uuid})
       SET c.subject = $subject,
           c.start = $start,
           c.duration = $duration,
           c.sentiment = $sentiment,
           c.party_count = $partyCount,
           c.dialog_count = $dialogCount,
           c.analysis_count = $analysisCount,
           c.created_at = $createdAt,
           c.source = $source`,
      {
        uuid: vcon.uuid,
        subject: vcon.subject || null,
        start: vcon.created_at,
        duration: totalDuration,
        sentiment,
        partyCount: vcon.parties?.length || 0,
        dialogCount: vcon.dialog?.length || 0,
        analysisCount: vcon.analysis?.length || 0,
        createdAt: vcon.created_at,
        source: 'vcon-mcp',
      }
    );
    this.nodeCount++;
  }

  private async createPartyNodes(tx: ManagedTransaction, vcon: VCon): Promise<string[]> {
    const personIds: string[] = [];

    for (const party of (vcon.parties || [])) {
      const person = this.partyToPerson(party);
      if (!person.identifier) continue;

      await tx.run(
        `MERGE (p:Person {identifier: $identifier})
         SET p.name = COALESCE($name, p.name),
             p.email = COALESCE($email, p.email),
             p.phone = COALESCE($phone, p.phone)
         WITH p
         MATCH (c:Conversation {uuid: $uuid})
         MERGE (p)-[r:PARTICIPATED_IN]->(c)
         SET r.timestamp = $timestamp`,
        {
          identifier: person.identifier,
          name: person.name || null,
          email: person.email || null,
          phone: person.phone || null,
          uuid: vcon.uuid,
          timestamp: vcon.created_at,
        }
      );

      personIds.push(person.identifier);
      this.nodeCount++;
      this.relCount++;
    }

    return personIds;
  }

  private async createContactedRelationships(
    tx: ManagedTransaction, 
    personIds: string[], 
    conversationUuid: string
  ): Promise<void> {
    // Create CONTACTED edges between all pairs of participants.
    // Uses canonical ordering (smaller ID -> larger ID) with a DIRECTED
    // relationship to avoid duplicate edges and self-loops from
    // Neo4j's undirected MERGE behavior.
    if (personIds.length < 2) return;

    // Deduplicate identifiers to prevent self-loops
    const uniqueIds = [...new Set(personIds)];
    if (uniqueIds.length < 2) return;

    for (let i = 0; i < uniqueIds.length; i++) {
      for (let j = i + 1; j < uniqueIds.length; j++) {
        // Canonical ordering: always smaller -> larger
        const [idFrom, idTo] = uniqueIds[i] < uniqueIds[j]
          ? [uniqueIds[i], uniqueIds[j]]
          : [uniqueIds[j], uniqueIds[i]];

        await tx.run(
          `MATCH (a:Person {identifier: $idFrom}), (b:Person {identifier: $idTo})
           MERGE (a)-[r:CONTACTED]->(b)
           SET r.last_conversation = $uuid,
               r.contact_count = COALESCE(r.contact_count, 0) + 1`,
          {
            idFrom,
            idTo,
            uuid: conversationUuid,
          }
        );
        this.relCount++;
      }
    }
  }

  private async createTopicNodes(tx: ManagedTransaction, vcon: VCon): Promise<void> {
    // Extract topics from analysis summaries or subject
    const topics: { name: string; confidence: number }[] = [];

    // Check analysis for topic extraction
    for (const analysis of (vcon.analysis || [])) {
      if (analysis.type === 'topics' && analysis.body) {
        try {
          const parsed = JSON.parse(analysis.body);
          if (Array.isArray(parsed)) {
            for (const t of parsed) {
              topics.push({
                name: (typeof t === 'string' ? t : t.name || t.topic).toLowerCase(),
                confidence: typeof t === 'object' ? (t.confidence || 0.8) : 0.8,
              });
            }
          }
        } catch { /* not parseable */ }
      }
    }

    // Fallback: use subject as a topic if no topics extracted
    if (topics.length === 0 && vcon.subject) {
      topics.push({ name: vcon.subject.toLowerCase(), confidence: 0.5 });
    }

    for (const topic of topics) {
      await tx.run(
        `MERGE (t:Topic {name: $name})
         WITH t
         MATCH (c:Conversation {uuid: $uuid})
         MERGE (c)-[r:HAS_TOPIC]->(t)
         SET r.confidence = $confidence`,
        {
          name: topic.name,
          uuid: vcon.uuid,
          confidence: topic.confidence,
        }
      );
      this.nodeCount++;
      this.relCount++;
    }
  }

  private async createAnalysisNodes(tx: ManagedTransaction, vcon: VCon): Promise<void> {
    for (const analysis of (vcon.analysis || [])) {
      const analysisId = `${vcon.uuid}:${analysis.type}:${analysis.vendor}`;

      await tx.run(
        `MERGE (a:Analysis {id: $id})
         SET a.type = $type,
             a.vendor = $vendor,
             a.product = $product
         WITH a
         MATCH (c:Conversation {uuid: $uuid})
         MERGE (c)-[:ANALYZED_BY]->(a)`,
        {
          id: analysisId,
          type: analysis.type,
          vendor: analysis.vendor,
          product: analysis.product || null,
          uuid: vcon.uuid,
        }
      );
      this.nodeCount++;
      this.relCount++;
    }
  }

  // ========== MCP Tools ==========

  registerTools(): Tool[] {
    return [
      {
        name: 'neo4j_query',
        description: 'Run a read-only Cypher query against the vCon knowledge graph. Use for finding repeat callers, topic clusters, contact networks, and escalation patterns.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'Cypher query to execute (read-only). Example: MATCH (p:Person)-[r:PARTICIPATED_IN]->(c:Conversation) RETURN p.name, count(c) as calls ORDER BY calls DESC LIMIT 10',
            },
            params: {
              type: 'object',
              description: 'Optional query parameters',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'neo4j_insights',
        description: 'Get pre-built graph insights: repeat_callers, topic_clusters, escalation_paths, contact_network, or graph_stats.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            insight: {
              type: 'string',
              enum: ['repeat_callers', 'topic_clusters', 'escalation_paths', 'contact_network', 'graph_stats'],
              description: 'Which insight to retrieve',
            },
            limit: {
              type: 'number',
              description: 'Max results to return (default: 20)',
            },
          },
          required: ['insight'],
        },
      },
    ];
  }

  async handleToolCall(toolName: string, args: any, context: RequestContext): Promise<any> {
    if (toolName === 'neo4j_query') {
      return this.executeQuery(args.query, args.params);
    }
    if (toolName === 'neo4j_insights') {
      return this.getInsight(args.insight, args.limit || 20);
    }
    return null;
  }

  // ========== Query Execution ==========

  private async executeQuery(query: string, params?: Record<string, any>): Promise<any> {
    if (!this.driver) {
      return { error: 'Neo4j not connected' };
    }

    // Safety: only allow read queries
    const normalized = query.trim().toUpperCase();
    if (normalized.startsWith('CREATE') || normalized.startsWith('DELETE') || 
        normalized.startsWith('DROP') || normalized.startsWith('MERGE') ||
        normalized.startsWith('SET') || normalized.startsWith('REMOVE')) {
      return { error: 'Only read queries are allowed through this tool' };
    }

    const session = this.getSession();
    if (!session) return { error: 'Failed to create session' };

    try {
      const result = await session.executeRead(async (tx) => {
        return tx.run(query, params || {});
      });

      return {
        records: result.records.map(r => r.toObject()),
        summary: {
          resultCount: result.records.length,
          queryType: result.summary.queryType,
        },
      };
    } catch (err: any) {
      return { error: err.message };
    } finally {
      await session.close();
    }
  }

  private async getInsight(insight: string, limit: number): Promise<any> {
    const queries: Record<string, string> = {
      repeat_callers: `
        MATCH (p:Person)-[r:PARTICIPATED_IN]->(c:Conversation)
        WITH p, count(c) as calls, collect(c.subject) as subjects,
             avg(c.sentiment) as avgSentiment
        WHERE calls > 1
        RETURN p.name as name, p.identifier as id, calls,
               subjects[0..5] as recentSubjects, avgSentiment
        ORDER BY calls DESC LIMIT $limit`,

      topic_clusters: `
        MATCH (c:Conversation)-[:HAS_TOPIC]->(t:Topic)
        WITH t, count(c) as conversations, avg(c.sentiment) as avgSentiment
        RETURN t.name as topic, conversations, avgSentiment
        ORDER BY conversations DESC LIMIT $limit`,

      escalation_paths: `
        MATCH (p:Person)-[:PARTICIPATED_IN]->(c:Conversation)
        WHERE c.sentiment IS NOT NULL AND c.sentiment < 0.4
        WITH p, c ORDER BY c.start
        RETURN p.name as person, p.identifier as id,
               collect({subject: c.subject, sentiment: c.sentiment, date: c.start}) as negativeConversations,
               count(c) as escalationCount
        ORDER BY escalationCount DESC LIMIT $limit`,

      contact_network: `
        MATCH (a:Person)-[r:CONTACTED]->(b:Person)
        RETURN a.name as person1, b.name as person2,
               r.contact_count as interactions, r.last_conversation as lastConversation
        ORDER BY r.contact_count DESC LIMIT $limit`,

      graph_stats: `
        CALL {
          MATCH (p:Person) RETURN 'Person' as label, count(p) as count
          UNION ALL
          MATCH (c:Conversation) RETURN 'Conversation' as label, count(c) as count
          UNION ALL
          MATCH (t:Topic) RETURN 'Topic' as label, count(t) as count
          UNION ALL
          MATCH (a:Analysis) RETURN 'Analysis' as label, count(a) as count
          UNION ALL
          MATCH ()-[r:PARTICIPATED_IN]->() RETURN 'PARTICIPATED_IN' as label, count(r) as count
          UNION ALL
          MATCH ()-[r:CONTACTED]->() RETURN 'CONTACTED' as label, count(r) as count
          UNION ALL
          MATCH ()-[r:HAS_TOPIC]->() RETURN 'HAS_TOPIC' as label, count(r) as count
        }
        RETURN label, count`,
    };

    const query = queries[insight];
    if (!query) {
      return { error: `Unknown insight: ${insight}. Valid: ${Object.keys(queries).join(', ')}` };
    }

    return this.executeQuery(query, { limit: neo4j.int(limit) });
  }

  // ========== Helpers ==========

  private partyToPerson(party: Party): PersonNode {
    // Priority for identifier: tel > mailto > name
    const identifier = party.tel || party.mailto || party.name || '';
    return {
      name: party.name || party.tel || party.mailto || 'Unknown',
      email: party.mailto,
      phone: party.tel,
      identifier,
    };
  }

  private getSession(): Session | null {
    if (!this.driver) return null;
    return this.driver.session({ database: this.database });
  }

  private log(level: string, message: string): void {
    const prefix = '[neo4j-consumer]';
    if (level === 'error') console.error(`${prefix} ${message}`);
    else if (level === 'warn') console.warn(`${prefix} ${message}`);
    else if (level === 'debug' && this.verbose) console.log(`${prefix} ${message}`);
    else if (level === 'info') console.log(`${prefix} ${message}`);
  }
}

export default Neo4jConsumerPlugin;
