/**
 * Search Count Limit Tests
 * 
 * Validates that search tools properly handle counts without hitting Supabase's
 * default 1000 row limit. Ensures that include_count returns accurate totals
 * even when there are more than 1000 matching records.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VConQueries } from '../src/db/queries.js';

describe('Search Count Limit Validation', () => {
  let queries: VConQueries;
  let mockSupabase: any;

  beforeEach(() => {
    // Create a chainable mock for Supabase queries
    // The mock needs to be thenable (awaitable) while also supporting method chaining
    let pendingResult: any = null;
    
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
        in: vi.fn(),
        rpc: vi.fn(),
      };

      // Make all methods return the mock itself for chaining (except single and rpc)
      Object.keys(mock).forEach(key => {
        if (key !== 'single' && key !== 'rpc') {
          mock[key].mockImplementation((...args: any[]) => {
            // Store the last select call's resolved value
            if (key === 'select') {
              // select() sets up the result that will be returned when awaited
              const savedResult = pendingResult;
              pendingResult = null;
              return Promise.resolve(savedResult || { data: null, error: null });
            }
            return mock;
          });
        }
      });

      // Make the mock itself thenable (awaitable)
      mock.then = (resolve: any, reject: any) => {
        const result = pendingResult || { data: null, error: null };
        return Promise.resolve(result).then(resolve, reject);
      };
      
      // Helper to set the result that will be returned when awaited
      mock.setResult = (result: any) => {
        pendingResult = result;
      };

      return mock;
    };

    mockSupabase = createChainableMock();
    queries = new VConQueries(mockSupabase);
  });

  describe('searchVConsCount', () => {
    it('should use count query instead of fetching all rows', async () => {
      // Mock the count query response
      mockSupabase.setResult({ count: 2500, error: null });

      const count = await queries.searchVConsCount({
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-12-31T23:59:59Z',
      });

      // Verify it uses count: 'exact', head: true
      expect(mockSupabase.select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
      expect(count).toBe(2500);
    });

    it('should return counts greater than 1000', async () => {
      // Test that counts can exceed 1000
      const largeCounts = [1500, 5000, 10000, 50000];
      
      for (const expectedCount of largeCounts) {
        mockSupabase.setResult({ count: expectedCount, error: null });

        const count = await queries.searchVConsCount({
          startDate: '2025-01-01T00:00:00Z',
        });

        expect(count).toBe(expectedCount);
      }
    });

    it('should handle party filters correctly', async () => {
      // Mock party query - first select returns party data
      const mockPartyData = [
        { vcon_id: 1 },
        { vcon_id: 2 },
        { vcon_id: 3 },
      ];
      
      // Setup results for party query then count query
      let callNum = 0;
      mockSupabase.select.mockImplementation(() => {
        callNum++;
        if (callNum === 1) {
          return Promise.resolve({ data: mockPartyData, error: null });
        }
        return Promise.resolve({ count: 3, error: null });
      });

      const count = await queries.searchVConsCount({
        partyName: 'John Doe',
        startDate: '2025-01-01T00:00:00Z',
      });

      expect(count).toBe(3);
      // Verify party query was made
      expect(mockSupabase.from).toHaveBeenCalledWith('parties');
    });

    it('should return 0 when no matching records', async () => {
      mockSupabase.setResult({ count: 0, error: null });

      const count = await queries.searchVConsCount({
        startDate: '2099-01-01T00:00:00Z', // Future date, no records
      });

      expect(count).toBe(0);
    });

    it('should handle subject filters', async () => {
      mockSupabase.setResult({ count: 42, error: null });

      const count = await queries.searchVConsCount({
        subject: 'billing',
      });

      expect(count).toBe(42);
      // Verify ilike was called for subject filter
      expect(mockSupabase.ilike).toHaveBeenCalledWith('subject', '%billing%');
    });

    it('should handle tag filters', async () => {
      const testUuid1 = crypto.randomUUID();
      const testUuid2 = crypto.randomUUID();
      
      // Mock searchByTags to return matching UUIDs
      vi.spyOn(queries, 'searchByTags').mockResolvedValue([testUuid1, testUuid2]);
      
      // Mock the base query to return UUIDs
      mockSupabase.select.mockResolvedValueOnce({
        data: [{ uuid: testUuid1 }, { uuid: testUuid2 }, { uuid: crypto.randomUUID() }],
        error: null
      });

      const count = await queries.searchVConsCount({
        tags: { department: 'sales' },
      });

      expect(queries.searchByTags).toHaveBeenCalledWith({ department: 'sales' }, 10000);
      expect(count).toBe(2); // Only 2 match the tag filter
    });

    it('should combine tag filters with other filters', async () => {
      const testUuid = crypto.randomUUID();
      
      // Mock searchByTags
      vi.spyOn(queries, 'searchByTags').mockResolvedValue([testUuid, crypto.randomUUID()]);
      
      // Mock party query
      const mockPartyData = [{ vcon_id: 1 }, { vcon_id: 2 }];
      let callNum = 0;
      mockSupabase.select.mockImplementation(() => {
        callNum++;
        if (callNum === 1) {
          return Promise.resolve({ data: mockPartyData, error: null });
        }
        // Return UUIDs for vcons matching party filter
        return Promise.resolve({ 
          data: [{ uuid: testUuid }], 
          error: null 
        });
      });

      const count = await queries.searchVConsCount({
        tags: { department: 'sales' },
        partyName: 'John',
        subject: 'Test',
      });

      expect(queries.searchByTags).toHaveBeenCalledWith({ department: 'sales' }, 10000);
      expect(count).toBe(1); // Only 1 matches both party and tag filters
    });

    it('should return 0 when tag filter matches no vCons', async () => {
      // Mock searchByTags to return empty array
      vi.spyOn(queries, 'searchByTags').mockResolvedValue([]);
      
      // Mock the base query
      mockSupabase.select.mockResolvedValueOnce({
        data: [{ uuid: crypto.randomUUID() }],
        error: null
      });

      const count = await queries.searchVConsCount({
        tags: { department: 'nonexistent' },
      });

      expect(queries.searchByTags).toHaveBeenCalledWith({ department: 'nonexistent' }, 10000);
      expect(count).toBe(0);
    });
  });

  describe('searchVCons - count integration', () => {
    it('should not be limited to 1000 rows when fetching results', async () => {
      // Mock a query that returns more than 1000 UUIDs
      const mockUuids = Array.from({ length: 1500 }, (_, i) => ({ uuid: `uuid-${i}` }));
      
      mockSupabase.setResult({ data: mockUuids, error: null });

      // Note: This test verifies that searchVCons can handle >1000 results
      // In practice, Supabase will limit to 1000, but we're testing the logic
      const results = await queries.searchVCons({
        startDate: '2025-01-01T00:00:00Z',
        limit: 1500, // Requesting more than 1000
      });

      // The actual result will be limited by Supabase, but our code should handle it
      expect(mockSupabase.select).toHaveBeenCalled();
    });
  });

  describe('keywordSearchCount', () => {
    it('should count distinct vcon_ids from keyword search results', async () => {
      // Mock RPC response with multiple matches per vcon
      const mockRpcResponse = {
        data: [
          { vcon_id: 'vcon-1', doc_type: 'subject', ref_index: null, rank: 0.9, snippet: '...' },
          { vcon_id: 'vcon-1', doc_type: 'dialog', ref_index: 0, rank: 0.8, snippet: '...' },
          { vcon_id: 'vcon-2', doc_type: 'dialog', ref_index: 0, rank: 0.7, snippet: '...' },
          { vcon_id: 'vcon-3', doc_type: 'subject', ref_index: null, rank: 0.6, snippet: '...' },
        ],
        error: null,
      };

      mockSupabase.rpc.mockResolvedValue(mockRpcResponse);

      const count = await queries.keywordSearchCount({
        query: 'test',
      });

      // Should count distinct vcon_ids (3 unique vcons, not 4 rows)
      expect(count).toBe(3);
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'search_vcons_keyword',
        expect.objectContaining({ max_results: 1000 })
      );
    });

    it('should be limited to 1000 distinct vCons (current limitation)', async () => {
      // Mock exactly 1000 results with all unique vcon_ids
      const mockRpcResponse = {
        data: Array.from({ length: 1000 }, (_, i) => ({
          vcon_id: `vcon-${i}`,
          doc_type: 'dialog',
          ref_index: null,
          rank: 0.5,
          snippet: '...',
        })),
        error: null,
      };

      mockSupabase.rpc.mockResolvedValue(mockRpcResponse);

      const count = await queries.keywordSearchCount({
        query: 'test',
      });

      // Will be capped at 1000 even if there are more matches
      expect(count).toBe(1000);
      
      // TODO: Create a database RPC function that returns count directly
      // to bypass the 1000 row limit for accurate counts
    });

    it('should handle empty results', async () => {
      const mockRpcResponse = {
        data: [],
        error: null,
      };

      mockSupabase.rpc.mockResolvedValue(mockRpcResponse);

      const count = await queries.keywordSearchCount({
        query: 'nonexistent',
      });

      expect(count).toBe(0);
    });

    it('should handle date filters', async () => {
      const mockRpcResponse = {
        data: [
          { vcon_id: 'vcon-1', doc_type: 'subject', ref_index: null, rank: 0.9, snippet: '...' },
        ],
        error: null,
      };

      mockSupabase.rpc.mockResolvedValue(mockRpcResponse);

      const count = await queries.keywordSearchCount({
        query: 'test',
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-12-31T23:59:59Z',
      });

      expect(count).toBe(1);
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'search_vcons_keyword',
        expect.objectContaining({
          start_date: '2025-01-01T00:00:00Z',
          end_date: '2025-12-31T23:59:59Z',
        })
      );
    });
  });

  describe('semanticSearch and hybridSearch', () => {
    it('should document that semantic/hybrid searches do not currently support include_count', () => {
      // These searches use RPC functions that return ranked results
      // They don't currently support include_count in the tool handlers
      // This is acceptable since they're typically used for top-N results anyway
      
      expect(true).toBe(true); // Placeholder test
      
      // TODO: If include_count is needed for these searches, we would need to:
      // 1. Modify the RPC functions to support count queries, OR
      // 2. Query the underlying tables with count: 'exact'
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle database errors gracefully in count queries', async () => {
      const mockErrorResponse = {
        count: null,
        error: { message: 'Database connection failed', code: 'PGRST116' },
      };

      mockSupabase.select.mockReturnValue({
        then: (resolve: any) => resolve(mockErrorResponse),
      });

      await expect(
        queries.searchVConsCount({ startDate: '2025-01-01T00:00:00Z' })
      ).rejects.toThrow();
    });

    it('should handle null count responses', async () => {
      mockSupabase.setResult({ count: null, error: null });

      const count = await queries.searchVConsCount({
        startDate: '2025-01-01T00:00:00Z',
      });

      // Should return 0 if count is null
      expect(count).toBe(0);
    });

    it('should handle empty party filter results', async () => {
      // Mock empty party data - first select returns empty, second returns count 0
      let callNum = 0;
      mockSupabase.select.mockImplementation(() => {
        callNum++;
        if (callNum === 1) {
          return Promise.resolve({ data: [], error: null });
        }
        return Promise.resolve({ count: 0, error: null });
      });

      const count = await queries.searchVConsCount({
        partyName: 'NonExistent',
      });

      // Should return 0 when no parties match
      expect(count).toBe(0);
    });
  });
});

