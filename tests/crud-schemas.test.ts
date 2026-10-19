/**
 * CRUD Schema Validation Tests
 * Tests for Zod schemas used in MCP tool definitions
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import {
  AnalysisSchema,
  DialogSchema,
  PartySchema,
  AttachmentSchema,
  addDialogTool,
  updateDialogTool,
  createVConTool,
} from '../src/tools/vcon-crud.js';

describe('CRUD Schema Validation', () => {
  describe('AnalysisSchema', () => {
    it('should validate a correct analysis object', () => {
      const analysis = {
        type: 'transcript',
        vendor: 'TestVendor',
        schema: 'v1.0',
        body: 'test content',
        encoding: 'none'
      };

      const result = AnalysisSchema.safeParse(analysis);
      
      expect(result.success).toBe(true);
    });

    it('should require vendor field', () => {
      const analysis = {
        type: 'transcript',
        // vendor missing
        body: 'test'
      };

      const result = AnalysisSchema.safeParse(analysis);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.path.includes('vendor'))).toBe(true);
      }
    });

    it('should accept schema field (not schema_version)', () => {
      const analysis = {
        type: 'transcript',
        vendor: 'TestVendor',
        schema: 'v1.0',  // ✅ Correct field name
        body: 'test'
      };

      const result = AnalysisSchema.safeParse(analysis);
      
      expect(result.success).toBe(true);
    });

    it('should accept body as string', () => {
      const analysis = {
        type: 'transcript',
        vendor: 'TestVendor',
        body: 'Plain text content',  // ✅ String type
        encoding: 'none'
      };

      const result = AnalysisSchema.safeParse(analysis);
      
      expect(result.success).toBe(true);
    });

    it('should accept JSON string in body', () => {
      const analysis = {
        type: 'sentiment',
        vendor: 'SentimentCo',
        body: JSON.stringify({ sentiment: 'positive', score: 0.8 }),
        encoding: 'json'
      };

      const result = AnalysisSchema.safeParse(analysis);
      
      expect(result.success).toBe(true);
    });

    it('should validate encoding values', () => {
      const validEncodings = ['base64url', 'json', 'none'];
      
      validEncodings.forEach(encoding => {
        const analysis = {
          type: 'test',
          vendor: 'TestVendor',
          body: 'test',
          encoding
        };

        const result = AnalysisSchema.safeParse(analysis);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid encoding values', () => {
      const analysis = {
        type: 'test',
        vendor: 'TestVendor',
        body: 'test',
        encoding: 'invalid'
      };

      const result = AnalysisSchema.safeParse(analysis);
      
      expect(result.success).toBe(false);
    });

    it('should accept dialog reference as number or array', () => {
      const analysis1 = {
        type: 'test',
        vendor: 'TestVendor',
        dialog: 0,  // Single index
        body: 'test'
      };

      const analysis2 = {
        type: 'test',
        vendor: 'TestVendor',
        dialog: [0, 1, 2],  // Multiple indexes
        body: 'test'
      };

      expect(AnalysisSchema.safeParse(analysis1).success).toBe(true);
      expect(AnalysisSchema.safeParse(analysis2).success).toBe(true);
    });
  });

  describe('DialogSchema', () => {
    it('should validate dialog types', () => {
      const validTypes = ['recording', 'text', 'transfer', 'incomplete'];
      
      validTypes.forEach(type => {
        const dialog = {
          type,
          body: 'test',
          encoding: 'none'
        };

        const result = DialogSchema.safeParse(dialog);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid dialog types', () => {
      const dialog = {
        type: 'invalid',
        body: 'test'
      };

      const result = DialogSchema.safeParse(dialog);
      
      expect(result.success).toBe(false);
    });

    // CON-1242: core-02 / 0.4.0 session_id is SessionId {local, remote} or an array of them.
    describe('session_id (CON-1242)', () => {
      const sid = { local: '0e4c6f9a9b2d4f1e8a3b5c7d9e1f2a3b', remote: '1f5d7a0b0c3e5a2f9b4c6d8e0f2a3b4c' };

      it('accepts a SessionId object unchanged', () => {
        const result = DialogSchema.safeParse({ type: 'text', body: 'x', encoding: 'none', session_id: sid });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.session_id).toEqual(sid);
      });

      it('accepts an array of SessionId objects', () => {
        const result = DialogSchema.safeParse({ type: 'text', session_id: [sid, sid] });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.session_id).toEqual([sid, sid]);
      });

      it('accepts a legacy string verbatim (not converted to an object)', () => {
        const result = DialogSchema.safeParse({ type: 'text', session_id: 'legacy-session' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.session_id).toBe('legacy-session');
      });

      it('rejects an object missing remote', () => {
        expect(DialogSchema.safeParse({ type: 'text', session_id: { local: 'a' } }).success).toBe(false);
      });

      it('rejects a number', () => {
        expect(DialogSchema.safeParse({ type: 'text', session_id: 42 }).success).toBe(false);
      });
    });

    it('should accept new fields (session_id, application, message_id)', () => {
      const dialog = {
        type: 'text',
        body: 'test',
        encoding: 'none',
        session_id: 'session-123',    // ✅ New field
        application: 'ChatApp v1.0',   // ✅ New field
        message_id: 'msg-456'          // ✅ New field
      };

      const result = DialogSchema.safeParse(dialog);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.session_id).toBe('session-123');
        expect(result.data.application).toBe('ChatApp v1.0');
        expect(result.data.message_id).toBe('msg-456');
      }
    });

    it('should accept any string for disposition (spec values and custom)', () => {
      const specDispositions = ['no-answer', 'congestion', 'failed', 'busy', 'hung-up', 'voicemail-no-message'];
      const customDispositions = ['Customer Hung Up', 'Abandoned', ''];

      [...specDispositions, ...customDispositions].forEach(disposition => {
        const dialog = {
          type: 'incomplete',
          disposition,
          encoding: 'none'
        };

        const result = DialogSchema.safeParse(dialog);
        expect(result.success).toBe(true);
      });
    });

    it('should accept parties as number, array, or nested array', () => {
      const dialog1 = {
        type: 'text',
        parties: 0,  // Single party
        body: 'test'
      };

      const dialog2 = {
        type: 'text',
        parties: [0, 1],  // Multiple parties
        body: 'test'
      };

      const dialog3 = {
        type: 'text',
        parties: [0, [1, 2]],  // Nested for complex scenarios
        body: 'test'
      };

      expect(DialogSchema.safeParse(dialog1).success).toBe(true);
      expect(DialogSchema.safeParse(dialog2).success).toBe(true);
      expect(DialogSchema.safeParse(dialog3).success).toBe(true);
    });

    it('should accept ISO 8601 datetime strings', () => {
      const dialog = {
        type: 'recording',
        start: new Date().toISOString(),
        duration: 120,
        url: 'https://example.com/recording.wav'
      };

      const result = DialogSchema.safeParse(dialog);
      
      expect(result.success).toBe(true);
    });
  });

  describe('PartySchema', () => {
    it('should validate party with tel', () => {
      const party = {
        tel: '+1234567890',
        name: 'Alice'
      };

      const result = PartySchema.safeParse(party);
      
      expect(result.success).toBe(true);
    });

    it('should validate party with mailto', () => {
      const party = {
        mailto: 'alice@example.com',
        name: 'Alice'
      };

      const result = PartySchema.safeParse(party);
      
      expect(result.success).toBe(true);
    });

    it('should validate party with uuid field', () => {
      const party = {
        name: 'Alice',
        uuid: randomUUID()  // ✅ UUID field
      };

      const result = PartySchema.safeParse(party);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.uuid).toBeDefined();
      }
    });

    it('should require valid UUID format', () => {
      const party = {
        name: 'Alice',
        uuid: 'invalid-uuid'
      };

      const result = PartySchema.safeParse(party);
      
      expect(result.success).toBe(false);
    });

    it('should accept did field', () => {
      const party = {
        name: 'Alice',
        did: 'did:example:123456'
      };

      const result = PartySchema.safeParse(party);
      
      expect(result.success).toBe(true);
    });

    it('should accept sip field', () => {
      const party = {
        name: 'Alice',
        sip: 'sip:alice@example.com'
      };

      const result = PartySchema.safeParse(party);
      
      expect(result.success).toBe(true);
    });

    it('should accept all optional fields', () => {
      const party = {
        tel: '+1234567890',
        sip: 'sip:alice@example.com',
        stir: 'A',
        mailto: 'alice@example.com',
        name: 'Alice',
        did: 'did:example:123456',
        uuid: randomUUID(),
        validation: 'verified',
        timezone: 'America/New_York'
      };

      const result = PartySchema.safeParse(party);
      
      expect(result.success).toBe(true);
    });
  });

  describe('AttachmentSchema', () => {
    it('should validate attachment with body', () => {
      const attachment = {
        type: 'document',
        body: 'attachment content',
        encoding: 'base64url'
      };

      const result = AttachmentSchema.safeParse(attachment);
      
      expect(result.success).toBe(true);
    });

    it('should validate attachment with URL', () => {
      const attachment = {
        type: 'image',
        url: 'https://example.com/image.jpg',
        content_hash: 'sha256:abcd1234'
      };

      const result = AttachmentSchema.safeParse(attachment);
      
      expect(result.success).toBe(true);
    });

    it('should accept dialog reference', () => {
      const attachment = {
        type: 'document',
        dialog: 0,  // ✅ Dialog reference
        body: 'content',
        encoding: 'none'
      };

      const result = AttachmentSchema.safeParse(attachment);
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dialog).toBe(0);
      }
    });

    it('should accept party reference', () => {
      const attachment = {
        type: 'document',
        party: 0,
        body: 'content',
        encoding: 'none'
      };

      const result = AttachmentSchema.safeParse(attachment);
      
      expect(result.success).toBe(true);
    });

    it('should accept content_hash as string or array', () => {
      const attachment1 = {
        type: 'document',
        url: 'https://example.com/doc.pdf',
        content_hash: 'sha256:abcd1234'
      };

      const attachment2 = {
        type: 'document',
        url: 'https://example.com/doc.pdf',
        content_hash: ['sha256:abcd1234', 'md5:efgh5678']
      };

      expect(AttachmentSchema.safeParse(attachment1).success).toBe(true);
      expect(AttachmentSchema.safeParse(attachment2).success).toBe(true);
    });
  });

  describe('Field Name Compliance', () => {
    it('should use "schema" not "schema_version" in Analysis', () => {
      // This is enforced by the type system and schema definition
      const analysis = {
        type: 'test',
        vendor: 'TestVendor',
        schema: 'v1.0',  // ✅ Correct
        body: 'test'
      };

      const result = AnalysisSchema.safeParse(analysis);
      expect(result.success).toBe(true);
      
      // Verify the field is accessible
      if (result.success) {
        expect(result.data.schema).toBe('v1.0');
      }
    });

    it('should require vendor in Analysis', () => {
      const withVendor = {
        type: 'test',
        vendor: 'TestVendor',
        body: 'test'
      };

      const withoutVendor = {
        type: 'test',
        body: 'test'
      };

      expect(AnalysisSchema.safeParse(withVendor).success).toBe(true);
      expect(AnalysisSchema.safeParse(withoutVendor).success).toBe(false);
    });

    it('should accept body as string in Analysis', () => {
      const stringBody = {
        type: 'test',
        vendor: 'TestVendor',
        body: 'This is a string'  // ✅ String type
      };

      const result = AnalysisSchema.safeParse(stringBody);
      expect(result.success).toBe(true);
      
      if (result.success) {
        expect(typeof result.data.body).toBe('string');
      }
    });
  });

  // CON-1242: the advertised JSON inputSchemas must accept the SessionId object too.
  describe('session_id in tool inputSchemas (CON-1242)', () => {
    const cases: Array<[string, any]> = [
      ['add_dialog', (addDialogTool.inputSchema.properties.dialog as any).properties.session_id],
      ['update_dialog', (updateDialogTool.inputSchema.properties.dialog as any).properties.session_id],
      ['create_vcon', (createVConTool.inputSchema.properties.dialog as any).items.properties.session_id],
    ];
    it.each(cases)('%s session_id allows object, array, and legacy string', (_name, prop) => {
      const types = prop.oneOf.map((s: any) => s.type);
      expect(types).toEqual(expect.arrayContaining(['object', 'array', 'string']));
      const obj = prop.oneOf.find((s: any) => s.type === 'object');
      expect(obj.required).toEqual(['local', 'remote']);
    });
  });
});
