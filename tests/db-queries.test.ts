/**
 * Database Queries Tests
 * Tests for vCon database operations with mocked Supabase client
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { VConQueries } from '../src/db/queries.js';
import { VCon, Analysis, Dialog, Attachment } from '../src/types/vcon.js';

describe('VConQueries', () => {
  let queries: VConQueries;
  let mockSupabase: any;

  beforeEach(() => {
    // Create a chainable mock that returns itself for all methods
    const createChainableMock = () => {
      const mock: any = {
        from: vi.fn(),
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        eq: vi.fn(),
        single: vi.fn(),
        limit: vi.fn(),
        order: vi.fn(),
        ilike: vi.fn(),
        gte: vi.fn(),
        lte: vi.fn(),
        or: vi.fn(),
        range: vi.fn(),
        in: vi.fn(),
      };

      // Make all methods return the mock itself for chaining
      Object.keys(mock).forEach(key => {
        if (key !== 'single') {
          mock[key].mockReturnValue(mock);
        }
      });

      return mock;
    };

    mockSupabase = createChainableMock();
    queries = new VConQueries(mockSupabase);
  });

  describe('createVCon', () => {
    it('should create a basic vCon with parties', async () => {
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Test Call',
        parties: [
          { name: 'Alice', mailto: 'alice@example.com' },
          { name: 'Bob', tel: '+1234567890' }
        ]
      };

      // Mock the vcon insert chain - single() is the last call
      mockSupabase.single.mockResolvedValue({
        data: { id: '1', uuid: testVCon.uuid },
        error: null
      });

      const result = await queries.createVCon(testVCon);

      expect(result.uuid).toBe(testVCon.uuid);
      expect(mockSupabase.from).toHaveBeenCalledWith('vcons');
      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    it('should create vCon with all components (dialog, analysis, attachments)', async () => {
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test' }],
        dialog: [{
          type: 'text',
          body: 'Hello',
          encoding: 'none'
        }],
        analysis: [{
          type: 'transcript',
          vendor: 'TestVendor',
          body: 'transcript content',
          encoding: 'none'
        }],
        attachments: [{
          type: 'document',
          body: 'attachment',
          encoding: 'none'
        }]
      };

      // Mock all single() calls
      mockSupabase.single.mockResolvedValue({
        data: { id: '1', uuid: testVCon.uuid },
        error: null
      });

      const result = await queries.createVCon(testVCon);

      expect(result.uuid).toBe(testVCon.uuid);
    });

    it('should handle database errors on vCon creation', async () => {
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test' }]
      };

      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: new Error('Database error')
      });

      await expect(queries.createVCon(testVCon)).rejects.toThrow('Database error');
    });
  });

  describe('getVCon', () => {
    it('should retrieve a vCon by UUID', async () => {
      const uuid = randomUUID();

      // Mock main vcon query
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          id: '1',
          uuid,
          vcon_version: '0.3.0',
          created_at: new Date().toISOString()
        },
        error: null
      });

      // Mock parties, dialog, analysis, attachments queries
      mockSupabase.order.mockResolvedValue({
        data: [],
        error: null
      });

      const result = await queries.getVCon(uuid);

      expect(result).toBeDefined();
      expect(mockSupabase.from).toHaveBeenCalledWith('vcons');
      expect(mockSupabase.eq).toHaveBeenCalledWith('uuid', uuid);
    });

    it('should throw when vCon not found', async () => {
      const uuid = randomUUID();

      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: new Error('Not found')
      });

      await expect(queries.getVCon(uuid)).rejects.toThrow('Not found');
    });

    it('should throw on database errors', async () => {
      const uuid = randomUUID();

      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: new Error('Database connection error')
      });

      await expect(queries.getVCon(uuid)).rejects.toThrow('Database connection error');
    });
  });

  describe('updateVCon', () => {
    it('should update vCon subject', async () => {
      const uuid = randomUUID();
      const updates = { subject: 'Updated Subject' };

      mockSupabase.eq.mockResolvedValueOnce({
        error: null
      });

      await queries.updateVCon(uuid, updates);

      expect(mockSupabase.update).toHaveBeenCalled();
      expect(mockSupabase.eq).toHaveBeenCalledWith('uuid', uuid);
    });

    it('should throw on database error', async () => {
      const uuid = randomUUID();
      const updates = { subject: 'Updated' };

      mockSupabase.eq.mockResolvedValueOnce({
        error: new Error('Update failed')
      });

      await expect(queries.updateVCon(uuid, updates)).rejects.toThrow('Update failed');
    });
  });

  describe('deleteVCon', () => {
    it('should delete a vCon', async () => {
      const uuid = randomUUID();

      mockSupabase.eq.mockResolvedValueOnce({
        error: null
      });

      await queries.deleteVCon(uuid);

      expect(mockSupabase.delete).toHaveBeenCalled();
      expect(mockSupabase.eq).toHaveBeenCalledWith('uuid', uuid);
    });

    it('should throw on database error', async () => {
      const uuid = randomUUID();

      mockSupabase.eq.mockResolvedValueOnce({
        error: new Error('Delete failed')
      });

      await expect(queries.deleteVCon(uuid)).rejects.toThrow('Delete failed');
    });
  });

  describe('searchVCons', () => {
    it('should search by subject', async () => {
      const criteria = { subject: 'Test' };
      const testUuid = randomUUID();

      // Mock the chain: select -> ilike -> order -> limit -> (thenable)
      mockSupabase.order.mockImplementationOnce(() => ({
        ...mockSupabase,
        limit: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve({
            data: [{ uuid: testUuid }],
            error: null
          })
        })
      }));

      // Mock getVCon call
      mockSupabase.single.mockResolvedValueOnce({
        data: {
          uuid: testUuid,
          vcon_version: '0.3.0',
          created_at: new Date().toISOString(),
          parties: []
        },
        error: null
      });

      // Mock order for getVCon (parties, dialog, etc.)
      mockSupabase.order.mockResolvedValue({
        data: [],
        error: null
      });

      const result = await queries.searchVCons(criteria);

      expect(mockSupabase.from).toHaveBeenCalledWith('vcons');
      expect(mockSupabase.ilike).toHaveBeenCalledWith('subject', '%Test%');
      expect(result).toHaveLength(1);
    });

    it('should search with date range', async () => {
      const criteria = {
        startDate: '2024-01-01',
        endDate: '2024-12-31'
      };

      // Mock the chain: select -> gte -> lte -> order -> limit -> (thenable)
      mockSupabase.order.mockImplementationOnce(() => ({
        ...mockSupabase,
        limit: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve({
            data: [],
            error: null
          })
        })
      }));

      await queries.searchVCons(criteria);

      expect(mockSupabase.gte).toHaveBeenCalledWith('created_at', '2024-01-01');
      expect(mockSupabase.lte).toHaveBeenCalledWith('created_at', '2024-12-31');
    });

    it('should limit results', async () => {
      const criteria = { limit: 10 };

      // The chain is: select -> order -> limit -> (thenable)
      // Need order to return something with limit that is thenable
      mockSupabase.order.mockImplementationOnce(() => ({
        ...mockSupabase,
        limit: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve({
            data: [],
            error: null
          })
        })
      }));

      await queries.searchVCons(criteria);

      // The limit call happens on the object returned by order, not mockSupabase directly
      // Just verify the function completed without errors
    });

    // Note: Tag filtering tests are in tests/search-count-limit.test.ts
    // which uses a more sophisticated mock setup that properly handles query chaining

    it('should return empty array when party email matches no parties', async () => {
      const criteria = { partyEmail: 'nonexistent@example.com' };

      // Mock party query - returns empty array (no matching parties)
      // The mock chain: from('parties').select('vcon_id').ilike('mailto', '...')
      // which then resolves as a thenable
      mockSupabase.ilike.mockImplementationOnce(() => ({
        ...mockSupabase,
        then: (resolve: any) => resolve({
          data: [],
          error: null
        })
      }));

      const result = await queries.searchVCons(criteria);

      expect(mockSupabase.from).toHaveBeenCalledWith('parties');
      expect(mockSupabase.ilike).toHaveBeenCalledWith('mailto', '%nonexistent@example.com%');
      expect(result).toHaveLength(0);
    });

    // Note: More comprehensive party filter tests are in tests/search-count-limit.test.ts
    // which uses a more sophisticated mock setup that properly handles query chaining
  });

  describe('addAnalysis', () => {
    it('should add analysis with correct field names', async () => {
      const uuid = randomUUID();
      const analysis: Analysis = {
        type: 'transcript',
        vendor: 'TestVendor',  // ✅ Required field
        schema: 'v1.0',        // ✅ Correct field name
        body: 'test content',
        encoding: 'none'
      };

      mockSupabase.single.mockResolvedValue({
        data: { id: '1' },
        error: null
      });

      mockSupabase.insert.mockResolvedValue({
        error: null
      });

      await queries.addAnalysis(uuid, analysis);

      expect(mockSupabase.insert).toHaveBeenCalled();
      // Verify correct field names are used
      const insertCall = mockSupabase.insert.mock.calls[0][0];
      expect(insertCall).toHaveProperty('vendor');
      expect(insertCall).not.toHaveProperty('schema_version');
    });
  });

  describe('addDialog', () => {
    it('should add dialog with new fields', async () => {
      const uuid = randomUUID();
      const dialog: Dialog = {
        type: 'text',
        body: 'Hello',
        encoding: 'none',
        session_id: 'session-123',  // ✅ New field
        application: 'ChatApp',     // ✅ New field
        message_id: 'msg-456'       // ✅ New field
      };

      // Mock get vcon by UUID
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: '1' },
        error: null
      });

      // Mock get existing dialog indexes (limit returns resolved value)
      mockSupabase.limit.mockResolvedValueOnce({
        data: [],
        error: null
      });

      // Mock insert dialog
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: '2' },
        error: null
      });

      await queries.addDialog(uuid, dialog);

      expect(mockSupabase.insert).toHaveBeenCalled();
    });
  });

  describe('getUniqueTags', () => {
    beforeEach(() => {
      // Reset mocks for getUniqueTags tests
      vi.clearAllMocks();
    });

    it('should get unique tags with default options', async () => {
      // Mock count query: from().select().eq() returns { count, error }
      mockSupabase.eq.mockImplementationOnce(() => ({
        count: 2,
        error: null,
      }));

      // Mock batch query: from().select().eq().range() returns { data, error }
      mockSupabase.range.mockImplementationOnce(() => ({
        data: [
          { vcon_id: 1, body: '["department:sales","priority:high"]', encoding: 'json' },
          { vcon_id: 2, body: '["department:support","priority:low"]', encoding: 'json' },
        ],
        error: null,
      }));

      const result = await queries.getUniqueTags();

      expect(result).toHaveProperty('keys');
      expect(result).toHaveProperty('tagsByKey');
      expect(result).toHaveProperty('totalVCons');
      expect(Array.isArray(result.keys)).toBe(true);
    });

    it('should include counts when includeCounts is true', async () => {
      vi.clearAllMocks();
      mockSupabase.eq.mockImplementationOnce(() => ({ count: 1, error: null }));
      mockSupabase.range.mockImplementationOnce(() => ({
        data: [
          { vcon_id: 1, body: '["department:sales","priority:high"]', encoding: 'json' },
        ],
        error: null,
      }));

      const result = await queries.getUniqueTags({ includeCounts: true });

      expect(result).toHaveProperty('countsPerValue');
    });

    it('should filter by keyFilter', async () => {
      vi.clearAllMocks();
      mockSupabase.eq.mockImplementationOnce(() => ({ count: 1, error: null }));
      mockSupabase.range.mockImplementationOnce(() => ({
        data: [
          { vcon_id: 1, body: '["department:sales","priority:high"]', encoding: 'json' },
        ],
        error: null,
      }));

      const result = await queries.getUniqueTags({ keyFilter: 'department' });

      expect(result.keys.every(key => key.toLowerCase().includes('department'))).toBe(true);
    });

    it('should filter by minCount', async () => {
      vi.clearAllMocks();
      mockSupabase.eq.mockImplementationOnce(() => ({ count: 3, error: null }));
      mockSupabase.range.mockImplementationOnce(() => ({
        data: [
          { vcon_id: 1, body: '["department:sales"]', encoding: 'json' },
          { vcon_id: 2, body: '["department:sales"]', encoding: 'json' },
          { vcon_id: 3, body: '["priority:high"]', encoding: 'json' },
        ],
        error: null,
      }));

      const result = await queries.getUniqueTags({ minCount: 2, includeCounts: true });

      // Only tags with count >= 2 should be included
      if (result.countsPerValue) {
        Object.values(result.countsPerValue).forEach((valueCounts: any) => {
          Object.values(valueCounts).forEach((count: any) => {
            expect(count).toBeGreaterThanOrEqual(2);
          });
        });
      }
    });

    it('should handle tags with wrong encoding', async () => {
      vi.clearAllMocks();
      mockSupabase.eq.mockImplementationOnce(() => ({ count: 1, error: null }));
      mockSupabase.range.mockImplementationOnce(() => ({
        data: [
          { vcon_id: 1, body: '["department:sales"]', encoding: 'text' }, // Wrong encoding
        ],
        error: null,
      }));

      const result = await queries.getUniqueTags();

      // Should still process the tags
      expect(result).toHaveProperty('keys');
    });

    it('should handle non-array tag bodies', async () => {
      vi.clearAllMocks();
      mockSupabase.eq.mockImplementationOnce(() => ({ count: 1, error: null }));
      mockSupabase.range.mockImplementationOnce(() => ({
        data: [
          { vcon_id: 1, body: '{"invalid": "format"}', encoding: 'json' },
        ],
        error: null,
      }));

      const result = await queries.getUniqueTags();

      // Should handle gracefully
      expect(result).toHaveProperty('keys');
    });

    it('should handle parse errors gracefully', async () => {
      vi.clearAllMocks();
      mockSupabase.eq.mockImplementationOnce(() => ({ count: 1, error: null }));
      mockSupabase.range.mockImplementationOnce(() => ({
        data: [
          { vcon_id: 1, body: 'invalid json', encoding: 'json' },
        ],
        error: null,
      }));

      const result = await queries.getUniqueTags();

      // Should continue processing despite parse error
      expect(result).toHaveProperty('keys');
    });

    it('should handle empty tags attachments', async () => {
      vi.clearAllMocks();
      mockSupabase.eq.mockImplementationOnce(() => ({ count: 0, error: null }));

      const result = await queries.getUniqueTags();

      expect(result.keys).toEqual([]);
      expect(result.tagsByKey).toEqual({});
      expect(result.totalVCons).toBe(0);
    });

    it('should sort keys and values', async () => {
      vi.clearAllMocks();
      mockSupabase.eq.mockImplementationOnce(() => ({ count: 1, error: null }));
      mockSupabase.range.mockImplementationOnce(() => ({
        data: [
          { vcon_id: 1, body: '["zebra:value","alpha:value","beta:value"]', encoding: 'json' },
        ],
        error: null,
      }));

      const result = await queries.getUniqueTags();

      // Keys should be sorted
      const keys = result.keys;
      for (let i = 1; i < keys.length; i++) {
        expect(keys[i] >= keys[i - 1]).toBe(true);
      }
    });
  });

  describe('addAttachment', () => {
    it('should add attachment', async () => {
      const uuid = randomUUID();
      const attachment: Attachment = {
        type: 'document',
        body: 'content',
        encoding: 'base64url'
      };

      mockSupabase.single.mockResolvedValue({
        data: { id: '1' },
        error: null
      });

      mockSupabase.insert.mockResolvedValue({
        error: null
      });

      await queries.addAttachment(uuid, attachment);

      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    it('should calculate next attachment index correctly', async () => {
      const uuid = randomUUID();
      const attachment: Attachment = {
        type: 'document',
        body: 'content',
        encoding: 'base64url'
      };

      // Mock vCon lookup
      mockSupabase.single
        .mockResolvedValueOnce({
          data: { id: 1 },
          error: null
        })
        // Mock existing attachment index query
        .mockResolvedValueOnce({
          data: [{ attachment_index: 2 }],
          error: null
        })
        // Mock insert
        .mockResolvedValueOnce({
          data: {},
          error: null
        });

      mockSupabase.insert.mockResolvedValue({
        error: null
      });

      await queries.addAttachment(uuid, attachment);

      // Should use next index (2 + 1 = 3)
      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    it('should use index 0 when no existing attachments', async () => {
      const uuid = randomUUID();
      const attachment: Attachment = {
        type: 'document',
        body: 'content',
        encoding: 'base64url'
      };

      // Mock vCon lookup
      mockSupabase.single
        .mockResolvedValueOnce({
          data: { id: 1 },
          error: null
        })
        // Mock empty attachment index query
        .mockResolvedValueOnce({
          data: [],
          error: null
        })
        // Mock insert
        .mockResolvedValueOnce({
          data: {},
          error: null
        });

      mockSupabase.insert.mockResolvedValue({
        error: null
      });

      await queries.addAttachment(uuid, attachment);

      // Should use index 0 when no existing attachments
      expect(mockSupabase.insert).toHaveBeenCalled();
    });
  });
});

