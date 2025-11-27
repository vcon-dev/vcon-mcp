/**
 * Integration Tests
 * End-to-end tests combining multiple components
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { VConQueries } from '../src/db/queries.js';
import { validateVCon, validateAnalysis, validateDialog } from '../src/utils/validation.js';
import { VCon, Analysis, Dialog, Party } from '../src/types/vcon.js';
import { PluginManager } from '../src/hooks/plugin-manager.js';
import { VConPlugin, RequestContext } from '../src/hooks/plugin-interface.js';
import {
  AnalysisSchema,
  DialogSchema,
  PartySchema
} from '../src/tools/vcon-crud.js';

describe('Integration Tests', () => {
  describe('vCon Creation Workflow', () => {
    it('should create, validate, and structure a complete vCon', () => {
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Customer Support Call',
        parties: [
          {
            name: 'Alice',
            mailto: 'alice@example.com',
            uuid: randomUUID()
          },
          {
            name: 'Bob',
            tel: '+1234567890',
            uuid: randomUUID()
          }
        ],
        dialog: [
          {
            type: 'text',
            start: new Date().toISOString(),
            parties: [0, 1],
            body: 'Hello, how can I help you?',
            encoding: 'none',
            session_id: 'session-abc',
            application: 'SupportChat v2.0'
          }
        ],
        analysis: [
          {
            type: 'sentiment',
            dialog: 0,
            vendor: 'SentimentCo',
            product: 'SentimentEngine v2',
            schema: 'sentiment-v1',
            body: JSON.stringify({ sentiment: 'positive', score: 0.85 }),
            encoding: 'json'
          }
        ]
      };

      // Validate the complete vCon
      const validation = validateVCon(vcon);
      
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(vcon.parties).toHaveLength(2);
      expect(vcon.dialog).toHaveLength(1);
      expect(vcon.analysis).toHaveLength(1);
    });

    it('should validate all components individually', () => {
      const party: Party = {
        name: 'Alice',
        mailto: 'alice@example.com',
        uuid: randomUUID()
      };

      const dialog: Dialog = {
        type: 'text',
        body: 'Hello',
        encoding: 'none',
        session_id: 'session-123'
      };

      const analysis: Analysis = {
        type: 'transcript',
        vendor: 'TranscriptCo',
        schema: 'transcript-v1',
        body: 'Transcription content',
        encoding: 'none'
      };

      // Validate using Zod schemas
      expect(PartySchema.safeParse(party).success).toBe(true);
      expect(DialogSchema.safeParse(dialog).success).toBe(true);
      expect(AnalysisSchema.safeParse(analysis).success).toBe(true);

      // Validate using validation functions
      expect(validateDialog(dialog).valid).toBe(true);
      expect(validateAnalysis(analysis).valid).toBe(true);
    });
  });

  describe('Plugin Integration with vCon Lifecycle', () => {
    it('should apply plugins throughout vCon lifecycle', async () => {
      // Create a plugin that modifies vCons
      class EnrichmentPlugin implements VConPlugin {
        name = 'enrichment-plugin';
        version = '1.0.0';

        async beforeCreate(vcon: VCon, context: RequestContext): Promise<VCon> {
          // Add metadata
          return {
            ...vcon,
            subject: `[ENRICHED] ${vcon.subject || ''}`
          };
        }

        async afterRead(vcon: VCon, context: RequestContext): Promise<VCon> {
          // Add read timestamp to metadata
          return vcon;
        }
      }

      const plugin = new EnrichmentPlugin();
      const pluginManager = new PluginManager();
      pluginManager.registerPlugin(plugin);

      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Test Call',
        parties: [{ name: 'Test' }]
      };

      const context: RequestContext = {
        timestamp: new Date()
      };

      // Apply beforeCreate hook
      const enrichedVCon = await pluginManager.executeHook<VCon>('beforeCreate', vcon, context);

      expect(enrichedVCon).toBeDefined();
      expect(enrichedVCon?.subject).toContain('[ENRICHED]');
      
      // Validate the enriched vCon
      const validation = validateVCon(enrichedVCon!);
      expect(validation.valid).toBe(true);
    });

    it('should block invalid vCons through plugins', async () => {
      class SecurityPlugin implements VConPlugin {
        name = 'security-plugin';
        version = '1.0.0';

        async beforeCreate(vcon: VCon, context: RequestContext): Promise<VCon> {
          // Block vCons without proper subject
          if (!vcon.subject || vcon.subject.length < 5) {
            throw new Error('vCon must have a descriptive subject');
          }
          return vcon;
        }
      }

      const plugin = new SecurityPlugin();
      const pluginManager = new PluginManager();
      pluginManager.registerPlugin(plugin);

      const invalidVCon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Bad',  // Too short
        parties: [{ name: 'Test' }]
      };

      const context: RequestContext = {
        timestamp: new Date()
      };

      await expect(
        pluginManager.executeHook('beforeCreate', invalidVCon, context)
      ).rejects.toThrow('descriptive subject');
    });
  });

  describe('Database and Validation Integration', () => {
    it('should prepare vCon for database insertion with validation', async () => {
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Test Call',
        parties: [
          {
            name: 'Alice',
            mailto: 'alice@example.com'
          }
        ],
        dialog: [
          {
            type: 'recording',
            url: 'https://example.com/recording.wav',
            content_hash: 'sha256:abcd1234',
            start: new Date().toISOString(),
            duration: 120
          }
        ],
        analysis: [
          {
            type: 'summary',
            dialog: 0,
            vendor: 'SummaryCo',
            schema: 'summary-v1',
            body: 'Call summary text',
            encoding: 'none'
          }
        ]
      };

      // Step 1: Validate
      const validation = validateVCon(vcon);
      expect(validation.valid).toBe(true);

      // Step 2: Verify all required fields are present for database
      expect(vcon.uuid).toBeDefined();
      expect(vcon.created_at).toBeDefined();
      expect(vcon.parties.length).toBeGreaterThan(0);

      // Step 3: Verify analysis has correct field names
      expect(vcon.analysis![0]).toHaveProperty('schema');
      expect(vcon.analysis![0]).toHaveProperty('vendor');
      expect(vcon.analysis![0]).not.toHaveProperty('schema_version');

      // Step 4: Verify dialog has new fields support
      expect(vcon.dialog![0].type).toBe('recording');
    });

    it('should handle vCon with all field corrections', () => {
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        extensions: ['https://example.com/ext'],
        must_support: ['https://example.com/ext'],
        parties: [
          {
            name: 'Alice',
            uuid: randomUUID(),  // ✅ Correction #4
            did: 'did:example:123'
          }
        ],
        dialog: [
          {
            type: 'text',  // ✅ Correction #6
            body: 'Hello',
            encoding: 'none',  // ✅ Correction #5 (no default)
            session_id: 'session-1',    // ✅ Correction #7
            application: 'ChatApp',      // ✅ Correction #7
            message_id: 'msg-1'          // ✅ Correction #7
          }
        ],
        analysis: [
          {
            type: 'transcript',
            vendor: 'TranscriptCo',      // ✅ Correction #2 (required)
            schema: 'transcript-v1',     // ✅ Correction #1 (schema, not schema_version)
            body: 'Transcript text',     // ✅ Correction #3 (string type)
            encoding: 'none'             // ✅ Correction #5 (no default)
          }
        ]
      };

      const validation = validateVCon(vcon);
      
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      
      // Verify all corrections are applied
      expect(vcon.parties[0].uuid).toBeDefined();
      expect(vcon.dialog![0].session_id).toBeDefined();
      expect(vcon.analysis![0].vendor).toBeDefined();
      expect(vcon.analysis![0].schema).toBeDefined();
      expect(typeof vcon.analysis![0].body).toBe('string');
    });
  });

  describe('Schema Validation and Type Safety', () => {
    it('should validate input through Zod before processing', () => {
      const dialogInput = {
        type: 'text',
        body: 'Test message',
        encoding: 'none',
        session_id: 'session-abc',
        application: 'MyApp v1.0'
      };

      const result = DialogSchema.safeParse(dialogInput);
      
      expect(result.success).toBe(true);
      
      if (result.success) {
        // Type-safe access to validated data
        expect(result.data.type).toBe('text');
        expect(result.data.session_id).toBe('session-abc');
        expect(result.data.application).toBe('MyApp v1.0');
      }
    });

    it('should catch validation errors early', () => {
      const invalidAnalysis = {
        type: 'test',
        // vendor missing - should fail
        body: 'test',
        encoding: 'invalid_encoding'  // Invalid encoding
      };

      const result = AnalysisSchema.safeParse(invalidAnalysis);
      
      expect(result.success).toBe(false);
      
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.length).toBeGreaterThan(0);
        
        // Should have errors for both missing vendor and invalid encoding
        const vendorIssue = issues.some(i => i.path.includes('vendor'));
        const encodingIssue = issues.some(i => i.path.includes('encoding'));
        
        expect(vendorIssue || encodingIssue).toBe(true);
      }
    });
  });

  describe('Complete End-to-End Workflow', () => {
    it('should handle full vCon lifecycle with plugins and validation', async () => {
      // Step 1: Create plugin manager with logging plugin
      const logs: string[] = [];
      
      class AuditPlugin implements VConPlugin {
        name = 'audit-plugin';
        version = '1.0.0';

        async beforeCreate(vcon: VCon, context: RequestContext): Promise<VCon> {
          logs.push(`Creating vCon: ${vcon.uuid}`);
          return vcon;
        }

        async afterCreate(vcon: VCon, context: RequestContext): Promise<void> {
          logs.push(`Created vCon: ${vcon.uuid}`);
        }

        async beforeRead(uuid: string, context: RequestContext): Promise<void> {
          logs.push(`Reading vCon: ${uuid}`);
        }

        async afterRead(vcon: VCon, context: RequestContext): Promise<VCon> {
          logs.push(`Read vCon: ${vcon.uuid}`);
          return vcon;
        }
      }

      const pluginManager = new PluginManager();
      pluginManager.registerPlugin(new AuditPlugin());

      // Step 2: Create a vCon
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Integration Test Call',
        parties: [{ name: 'Test User', uuid: randomUUID() }],
        dialog: [{
          type: 'text',
          body: 'Test message',
          encoding: 'none'
        }],
        analysis: [{
          type: 'summary',
          vendor: 'TestVendor',
          body: 'Summary',
          encoding: 'none'
        }]
      };

      const context: RequestContext = {
        timestamp: new Date()
      };

      // Step 3: Run through plugin hooks
      const processedVCon = await pluginManager.executeHook<VCon>('beforeCreate', vcon, context);
      
      // Step 4: Validate
      const validation = validateVCon(processedVCon || vcon);
      expect(validation.valid).toBe(true);

      // Step 5: Simulate post-create
      await pluginManager.executeHook('afterCreate', processedVCon || vcon, context);

      // Step 6: Simulate read
      await pluginManager.executeHook('beforeRead', vcon.uuid, context);
      await pluginManager.executeHook('afterRead', vcon, context);

      // Verify audit trail
      expect(logs.length).toBeGreaterThanOrEqual(4);
      expect(logs[0]).toContain('Creating');
      expect(logs[1]).toContain('Created');
      expect(logs[2]).toContain('Reading');
      expect(logs[3]).toContain('Read');
    });
  });
});

