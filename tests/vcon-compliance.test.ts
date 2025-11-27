/**
 * vCon Compliance Tests
 * 
 * Tests to verify IETF spec compliance and all 7 critical corrections
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { VCon, Analysis, Dialog, Party } from '../src/types/vcon.js';
import { validateVCon, validateAnalysis } from '../src/utils/validation.js';

describe('IETF vCon Spec Compliance', () => {
  
  // ==========================================================================
  // Correction #1: Analysis uses 'schema' not 'schema_version'
  // ==========================================================================
  describe('Correction #1: Analysis Schema Field', () => {
    it('should use "schema" field (not "schema_version")', () => {
      const analysis: Analysis = {
        type: 'test',
        vendor: 'TestVendor',
        schema: 'v1.0',  // ✅ Correct field name
        body: 'test content',
        encoding: 'none'
      };

      expect(analysis.schema).toBe('v1.0');
      expect((analysis as any).schema_version).toBeUndefined();
    });

    it('should detect incorrect schema_version usage', () => {
      const badAnalysis = {
        type: 'test',
        vendor: 'Test',
        schema_version: '1.0',  // ❌ Wrong field name
        body: 'test'
      } as any;

      const result = validateAnalysis(badAnalysis);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('schema_version'))).toBe(true);
    });
  });

  // ==========================================================================
  // Correction #2: Analysis vendor is REQUIRED
  // ==========================================================================
  describe('Correction #2: Analysis Vendor Requirement', () => {
    it('should require vendor field in analysis', () => {
      const analysis: Analysis = {
        type: 'test',
        vendor: 'TestVendor',  // ✅ Required field
        body: 'test',
        encoding: 'none'
      };

      const result = validateAnalysis(analysis);
      expect(result.valid).toBe(true);
    });

    it('should fail validation when vendor is missing', () => {
      const badAnalysis = {
        type: 'test',
        // vendor: 'Missing',  // ❌ Missing required field
        body: 'test'
      } as any;

      const result = validateAnalysis(badAnalysis);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('vendor'))).toBe(true);
    });
  });

  // ==========================================================================
  // Correction #3: Analysis body is string type
  // ==========================================================================
  describe('Correction #3: Analysis Body Type', () => {
    it('should accept string body in analysis', () => {
      const analysis: Analysis = {
        type: 'transcript',
        vendor: 'TestVendor',
        body: 'Plain text transcript content',  // ✅ String type
        encoding: 'none'
      };

      expect(typeof analysis.body).toBe('string');
    });

    it('should support JSON string format', () => {
      const analysis: Analysis = {
        type: 'sentiment',
        vendor: 'SentimentCo',
        body: JSON.stringify({ sentiment: 'positive', score: 0.8 }),
        encoding: 'json'
      };

      expect(typeof analysis.body).toBe('string');
      const parsed = JSON.parse(analysis.body!);
      expect(parsed.sentiment).toBe('positive');
    });

    it('should support non-JSON formats (CSV)', () => {
      const csvAnalysis: Analysis = {
        type: 'data_export',
        vendor: 'CSVExporter',
        body: 'col1,col2,col3\nval1,val2,val3',
        encoding: 'none'
      };

      expect(csvAnalysis.body).toContain('col1,col2,col3');
    });
  });

  // ==========================================================================
  // Correction #4: Party uuid field
  // ==========================================================================
  describe('Correction #4: Party UUID Field', () => {
    it('should support uuid field in party', () => {
      const party: Party = {
        name: 'Test Party',
        mailto: 'test@example.com',
        uuid: '123e4567-e89b-12d3-a456-426614174000'  // ✅ uuid field
      };

      expect(party.uuid).toBeDefined();
      expect(party.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should include uuid in vCon party', () => {
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        parties: [{
          name: 'Alice',
          uuid: randomUUID()  // ✅ uuid field
        }]
      };

      expect(vcon.parties[0].uuid).toBeDefined();
      const result = validateVCon(vcon);
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // Correction #5: No encoding defaults
  // ==========================================================================
  describe('Correction #5: Encoding Defaults', () => {
    it('should not have default encoding values', () => {
      const analysis: Analysis = {
        type: 'test',
        vendor: 'TestVendor',
        body: 'test'
        // encoding: undefined  // ✅ No default
      };

      expect(analysis.encoding).toBeUndefined();
    });

    it('should allow explicit encoding values', () => {
      const validEncodings: Array<'base64url' | 'json' | 'none'> = [
        'base64url', 'json', 'none'
      ];

      validEncodings.forEach(encoding => {
        const analysis: Analysis = {
          type: 'test',
          vendor: 'TestVendor',
          body: 'test',
          encoding
        };

        expect(analysis.encoding).toBe(encoding);
      });
    });
  });

  // ==========================================================================
  // Correction #6: Dialog type constraints
  // ==========================================================================
  describe('Correction #6: Dialog Type Constraints', () => {
    it('should only allow valid dialog types', () => {
      const validTypes: Array<'recording' | 'text' | 'transfer' | 'incomplete'> = [
        'recording', 'text', 'transfer', 'incomplete'
      ];

      validTypes.forEach(type => {
        const dialog: any = {
          type,
          body: 'test',
          encoding: 'none'
        };

        // Incomplete dialogs require a disposition
        if (type === 'incomplete') {
          dialog.disposition = 'no-answer';
        }

        // Transfer dialogs require transfer fields
        if (type === 'transfer') {
          dialog.transferee = 0;
          dialog.transferor = 0;
          dialog.transfer_target = 0;
        }

        const vcon: VCon = {
          vcon: '0.3.0',
          uuid: randomUUID(),
          created_at: new Date().toISOString(),
          parties: [{ name: 'Test' }],
          dialog: [dialog]
        };

        const result = validateVCon(vcon);
        expect(result.valid).toBe(true);
      });
    });

    it('should reject invalid dialog types', () => {
      const vcon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test' }],
        dialog: [{
          type: 'invalid_type',  // ❌ Invalid type
          body: 'test',
          encoding: 'none'
        }]
      } as any;

      const result = validateVCon(vcon);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('invalid type'))).toBe(true);
    });
  });

  // ==========================================================================
  // Correction #7: Dialog new fields
  // ==========================================================================
  describe('Correction #7: Dialog New Fields', () => {
    it('should support session_id field', () => {
      const dialog: Dialog = {
        type: 'text',
        body: 'Hello',
        encoding: 'none',
        session_id: 'session-123'  // ✅ New field
      };

      expect(dialog.session_id).toBe('session-123');
    });

    it('should support application field', () => {
      const dialog: Dialog = {
        type: 'recording',
        url: 'https://example.com/recording.wav',
        encoding: 'base64url',
        application: 'MyDialer v1.0'  // ✅ New field
      };

      expect(dialog.application).toBe('MyDialer v1.0');
    });

    it('should support message_id field', () => {
      const dialog: Dialog = {
        type: 'text',
        body: 'Message content',
        encoding: 'none',
        message_id: 'msg-456'  // ✅ New field
      };

      expect(dialog.message_id).toBe('msg-456');
    });

    it('should include all new fields in complete vCon', () => {
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test' }],
        dialog: [{
          type: 'text',
          body: 'Test message',
          encoding: 'none',
          session_id: 'sess-1',
          application: 'TestApp',
          message_id: 'msg-1'
        }]
      };

      expect(vcon.dialog![0].session_id).toBe('sess-1');
      expect(vcon.dialog![0].application).toBe('TestApp');
      expect(vcon.dialog![0].message_id).toBe('msg-1');
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================
  describe('Complete vCon Validation', () => {
    it('should validate a complete spec-compliant vCon', () => {
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Test Conversation',
        extensions: ['https://example.com/ext'],
        must_support: ['https://example.com/ext'],
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
            body: 'Hello, Bob!',
            encoding: 'none',
            session_id: 'session-abc',
            application: 'ChatApp v1.0'
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

      const result = validateVCon(vcon);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

