/**
 * Database Queries Tests
 * Tests for vCon database operations with mocked Supabase client
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
        uuid: crypto.randomUUID(),
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
        uuid: crypto.randomUUID(),
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
        uuid: crypto.randomUUID(),
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
      const uuid = crypto.randomUUID();

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
      const uuid = crypto.randomUUID();

      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: new Error('Not found')
      });

      await expect(queries.getVCon(uuid)).rejects.toThrow('Not found');
    });

    it('should throw on database errors', async () => {
      const uuid = crypto.randomUUID();

      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: new Error('Database connection error')
      });

      await expect(queries.getVCon(uuid)).rejects.toThrow('Database connection error');
    });
  });

  describe('updateVCon', () => {
    it('should update vCon subject', async () => {
      const uuid = crypto.randomUUID();
      const updates = { subject: 'Updated Subject' };

      mockSupabase.eq.mockResolvedValueOnce({
        error: null
      });

      await queries.updateVCon(uuid, updates);

      expect(mockSupabase.update).toHaveBeenCalled();
      expect(mockSupabase.eq).toHaveBeenCalledWith('uuid', uuid);
    });

    it('should throw on database error', async () => {
      const uuid = crypto.randomUUID();
      const updates = { subject: 'Updated' };

      mockSupabase.eq.mockResolvedValueOnce({
        error: new Error('Update failed')
      });

      await expect(queries.updateVCon(uuid, updates)).rejects.toThrow('Update failed');
    });
  });

  describe('deleteVCon', () => {
    it('should delete a vCon', async () => {
      const uuid = crypto.randomUUID();

      mockSupabase.eq.mockResolvedValueOnce({
        error: null
      });

      await queries.deleteVCon(uuid);

      expect(mockSupabase.delete).toHaveBeenCalled();
      expect(mockSupabase.eq).toHaveBeenCalledWith('uuid', uuid);
    });

    it('should throw on database error', async () => {
      const uuid = crypto.randomUUID();

      mockSupabase.eq.mockResolvedValueOnce({
        error: new Error('Delete failed')
      });

      await expect(queries.deleteVCon(uuid)).rejects.toThrow('Delete failed');
    });
  });

  describe('searchVCons', () => {
    it('should search by subject', async () => {
      const criteria = { subject: 'Test' };
      const testUuid = crypto.randomUUID();

      // Mock the initial query (returns promise-like with data/error)
      mockSupabase.order.mockResolvedValueOnce({
        data: [{ uuid: testUuid }],
        error: null
      });

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

      mockSupabase.order.mockResolvedValueOnce({
        data: [],
        error: null
      });

      await queries.searchVCons(criteria);

      expect(mockSupabase.gte).toHaveBeenCalledWith('created_at', '2024-01-01');
      expect(mockSupabase.lte).toHaveBeenCalledWith('created_at', '2024-12-31');
    });

    it('should limit results', async () => {
      const criteria = { limit: 10 };

      mockSupabase.order.mockResolvedValueOnce({
        data: [],
        error: null
      });

      await queries.searchVCons(criteria);

      expect(mockSupabase.limit).toHaveBeenCalledWith(10);
    });
  });

  describe('addAnalysis', () => {
    it('should add analysis with correct field names', async () => {
      const uuid = crypto.randomUUID();
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
      const uuid = crypto.randomUUID();
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

  describe('addAttachment', () => {
    it('should add attachment', async () => {
      const uuid = crypto.randomUUID();
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
  });
});

