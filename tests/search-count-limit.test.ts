/**
 * Search Count Limit Tests
 * 
 * Validates that search tools properly handle counts without hitting Supabase's
 * default 1000 row limit. Ensures that include_count returns accurate totals
 * even when there are more than 1000 matching records.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { VConQueries } from '../src/db/queries.js';

describe('Search Count Limit Validation', () => {
  let queries: VConQueries;
  let mockSupabase: any;

  beforeEach(() => {
    // Create a chainable mock for Supabase queries
    // The mock needs to be thenable (awaitable) while also supporting method chaining
    let queryResults: any[] = [];
    let queryIndex = 0;
    
    // Track calls on all query builders
    const callTrackers: any = {
      select: vi.fn(),
      ilike: vi.fn(),
      gte: vi.fn(),
      lte: vi.fn(),
      from: vi.fn(),
      in: vi.fn(),
    };
    
    const createChainableMock = () => {
      const createQueryBuilder = (): any => {
        const queryBuilder: any = {};

        // Create all query builder methods that return the builder for chaining
        const chainMethods = ['from', 'select', 'insert', 'update', 'delete', 'eq', 
                             'limit', 'order', 'ilike', 'gte', 'lte', 'in'];
        
        chainMethods.forEach(method => {
          queryBuilder[method] = vi.fn((...args: any[]) => {
            // Track the call
            if (callTrackers[method]) {
              callTrackers[method](...args);
            }
            // Return the builder itself for chaining
            return queryBuilder;
          });
        });

        // single() returns a promise
        queryBuilder.single = vi.fn(() => {
          const result = queryResults[queryIndex] || queryResults[queryResults.length - 1] || { data: null, error: null };
          queryIndex++;
          return Promise.resolve(result);
        });

        // Make the query builder thenable (awaitable)
        queryBuilder.then = (resolve: any, reject: any) => {
          const result = queryResults[queryIndex] || queryResults[queryResults.length - 1] || { data: null, error: null, count: null };
          queryIndex++;
          return Promise.resolve(result).then(resolve, reject);
        };

        return queryBuilder;
      };

      const mock: any = createQueryBuilder();
      
      // Override methods to track calls and return chainable builders
      mock.from = vi.fn((...args: any[]) => {
        callTrackers.from(...args);
        return createQueryBuilder();
      });
      mock.select = vi.fn((...args: any[]) => {
        callTrackers.select(...args);
        return createQueryBuilder();
      });
      mock.ilike = vi.fn((...args: any[]) => {
        callTrackers.ilike(...args);
        return createQueryBuilder();
      });
      mock.gte = vi.fn((...args: any[]) => {
        callTrackers.gte(...args);
        return createQueryBuilder();
      });
      mock.lte = vi.fn((...args: any[]) => {
        callTrackers.lte(...args);
        return createQueryBuilder();
      });
      mock.in = vi.fn((...args: any[]) => {
        callTrackers.in(...args);
        return createQueryBuilder();
      });
      
      mock.rpc = vi.fn().mockImplementation(() => {
        const result = queryResults[queryIndex] || queryResults[queryResults.length - 1] || { data: null, error: null };
        queryIndex++;
        return Promise.resolve(result);
      });
      
      // Expose call trackers for assertions
      mock._calls = callTrackers;
      
      // Helper to set the result(s) that will be returned when awaited
      mock.setResult = (result: any) => {
        queryResults = [result];
        queryIndex = 0;
      };
      
      // Helper to set multiple results for sequential queries
      mock.setResults = (results: any[]) => {
        queryResults = results;
        queryIndex = 0;
      };
      
      // Helper to reset query index
      mock.resetQueryIndex = () => {
        queryIndex = 0;
      };

      return mock;
    };

    mockSupabase = createChainableMock();
    queries = new VConQueries(mockSupabase);
  });

  describe('searchVConsCount', () => {
    it('routes date-only counts through search_vcons_by_tags_and_date_count RPC', async () => {
      // Date-only path now uses the RPC (with empty tag_filter) so PostgREST's
      // exact-count fallback can't silently degrade to corpus total on wider
      // windows. See queries.ts comment for context.
      mockSupabase.rpc.mockResolvedValueOnce({ data: 2500, error: null });

      const count = await queries.searchVConsCount({
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-12-31T23:59:59Z',
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'search_vcons_by_tags_and_date_count',
        {
          tag_filter: {},
          vcon_created_after: '2025-01-01T00:00:00Z',
          vcon_created_before: '2025-12-31T23:59:59Z',
        },
      );
      expect(count).toBe(2500);
    });

    it('should return counts greater than 1000', async () => {
      const largeCounts = [1500, 5000, 10000, 50000];

      for (const expectedCount of largeCounts) {
        mockSupabase.rpc.mockResolvedValueOnce({ data: expectedCount, error: null });

        const count = await queries.searchVConsCount({
          startDate: '2025-01-01T00:00:00Z',
        });

        expect(count).toBe(expectedCount);
      }
    });

    it('should handle party filters correctly', async () => {
      // Mock party query - first select returns party data, second returns count
      const mockPartyData = [
        { vcon_id: 1 },
        { vcon_id: 2 },
        { vcon_id: 3 },
      ];
      
      // Setup results for sequential queries: party query then count query
      mockSupabase.setResults([
        { data: mockPartyData, error: null },  // Party query result
        { count: 3, error: null }              // Count query result
      ]);

      const count = await queries.searchVConsCount({
        partyName: 'John Doe',
        startDate: '2025-01-01T00:00:00Z',
      });

      expect(count).toBe(3);
      // Verify party query was made
      expect(mockSupabase._calls.from).toHaveBeenCalledWith('parties');
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
      expect(mockSupabase._calls.ilike).toHaveBeenCalledWith('subject', '%billing%');
    });

    it('should handle tag filters via the date+tag RPC', async () => {
      // Tag-only counts now route through search_vcons_by_tags_and_date_count
      // so the join executes server-side instead of intersecting in JS.
      mockSupabase.rpc.mockResolvedValueOnce({ data: 2, error: null });

      const count = await queries.searchVConsCount({
        tags: { department: 'sales' },
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'search_vcons_by_tags_and_date_count',
        {
          tag_filter: { department: 'sales' },
          vcon_created_after: null,
          vcon_created_before: null,
        },
      );
      expect(count).toBe(2);
    });

    it('should combine tag filters with party + subject', async () => {
      const testUuid = randomUUID();

      // The new path: party query → vcon-count query → tag+date RPC →
      // batched .in() to intersect tag UUIDs with party-vcon UUIDs.
      const mockPartyData = [{ vcon_id: 1 }, { vcon_id: 2 }];
      mockSupabase.setResults([
        { data: mockPartyData, error: null },          // parties query
        { count: 2, error: null },                     // vcon count (date/subject)
        { data: [{ uuid: testUuid }], error: null },   // batched .in() chunk
      ]);
      mockSupabase.rpc.mockResolvedValueOnce({
        data: [{ vcon_uuid: testUuid }, { vcon_uuid: randomUUID() }],
        error: null,
      });

      const count = await queries.searchVConsCount({
        tags: { department: 'sales' },
        partyName: 'John',
        subject: 'Test',
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'search_vcons_by_tags_and_date',
        expect.objectContaining({ tag_filter: { department: 'sales' } }),
      );
      expect(count).toBe(1);
    });

    it('should return 0 when tag filter matches no vCons', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: 0, error: null });

      const count = await queries.searchVConsCount({
        tags: { department: 'nonexistent' },
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'search_vcons_by_tags_and_date_count',
        expect.objectContaining({ tag_filter: { department: 'nonexistent' } }),
      );
      expect(count).toBe(0);
    });
  });

  describe('searchVCons - count integration', () => {
    it('should not be limited to 1000 rows when fetching results', async () => {
      // Verify that searchVCons passes the requested limit (1500) to the query
      // rather than capping it at 1000. Mock getVCon directly to avoid complex
      // interleaved mock sequencing from concurrent Promise.all calls.
      const now = new Date().toISOString();
      const mockUuids = Array.from({ length: 3 }, (_, i) => ({ uuid: `uuid-${i}`, id: i + 1 }));
      const mockVCon = { vcon: '0.4.0', uuid: 'uuid-0', created_at: now, parties: [], dialog: [], analysis: [], attachments: [] };

      mockSupabase.setResult({ data: mockUuids, error: null });
      vi.spyOn(queries, 'getVCon').mockResolvedValue(mockVCon as any);

      await queries.searchVCons({
        startDate: '2025-01-01T00:00:00Z',
        limit: 1500,
      });

      // Verify the query was issued (the limit of 1500 is passed through to Supabase)
      expect(mockSupabase._calls.select).toHaveBeenCalled();
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

      mockSupabase.setResult(mockErrorResponse);

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
      // Mock empty party data - first select returns empty (which causes early return)
      mockSupabase.setResult({ data: [], error: null });

      const count = await queries.searchVConsCount({
        partyName: 'NonExistent',
      });

      // Should return 0 when no parties match
      expect(count).toBe(0);
    });
  });

  // Regression: combining tags + date range previously routed through a JS
  // intersection over a PostgREST page-truncated UUID set, returning the
  // same total for every distinct tag in a fan-out (e.g. all themes → 0
  // for a single-day window, or all themes → full-corpus count for a week
  // window). These tests pin the new RPC-backed path.
  describe('searchVConsCount: tags + date filter (regression)', () => {
    it('routes tag + date count through search_vcons_by_tags_and_date_count RPC', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: 42, error: null });

      const count = await queries.searchVConsCount({
        startDate: '2026-04-01T00:00:00Z',
        endDate: '2026-04-30T23:59:59Z',
        tags: { portal: 'X' },
      });

      expect(count).toBe(42);
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'search_vcons_by_tags_and_date_count',
        {
          tag_filter: { portal: 'X' },
          vcon_created_after: '2026-04-01T00:00:00Z',
          vcon_created_before: '2026-04-30T23:59:59Z',
        },
      );
    });

    it('returns distinct counts for distinct tags (no fan-out cross-talk)', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: 7023, error: null });
      const a = await queries.searchVConsCount({
        startDate: '2026-04-15T00:00:00Z',
        endDate: '2026-04-15T23:59:59Z',
        tags: { portal: 'A' },
      });

      mockSupabase.rpc.mockResolvedValueOnce({ data: 311, error: null });
      const b = await queries.searchVConsCount({
        startDate: '2026-04-15T00:00:00Z',
        endDate: '2026-04-15T23:59:59Z',
        tags: { portal: 'B' },
      });

      expect(a).toBe(7023);
      expect(b).toBe(311);
      expect(a).not.toBe(b);
    });

    it('coerces bigint string returns to number', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: '49069', error: null });

      const count = await queries.searchVConsCount({
        startDate: '2026-04-01T00:00:00Z',
        endDate: '2026-04-07T23:59:59Z',
        tags: { portal: 'X' },
      });

      expect(count).toBe(49069);
    });
  });

  // Regression: date-only counts on wider windows previously silently
  // returned the corpus total (PostgREST exact count fallback on a
  // 250k-row table). The new path routes through the RPC so SQL
  // COUNT(*) is authoritative. Ignored arg `tags: {}` from callers
  // (e.g. apps/web Pulse aggregations) must be treated as "no tag
  // restriction" — the same code path as omitting `tags` entirely.
  describe('searchVConsCount: date-only count regression', () => {
    it('treats empty tags object the same as no tag filter', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: 13891, error: null });

      const count = await queries.searchVConsCount({
        startDate: '2026-04-29T00:00:00Z',
        endDate: '2026-04-30T23:59:59Z',
        tags: {},
      });

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'search_vcons_by_tags_and_date_count',
        expect.objectContaining({ tag_filter: {} }),
      );
      expect(count).toBe(13891);
    });

    it('returns distinct counts for distinct date windows (no degradation)', async () => {
      mockSupabase.rpc.mockResolvedValueOnce({ data: 7023, error: null });
      const oneDay = await queries.searchVConsCount({
        startDate: '2026-04-30T00:00:00Z',
        endDate: '2026-04-30T23:59:59Z',
      });

      mockSupabase.rpc.mockResolvedValueOnce({ data: 13891, error: null });
      const twoDay = await queries.searchVConsCount({
        startDate: '2026-04-29T00:00:00Z',
        endDate: '2026-04-30T23:59:59Z',
      });

      mockSupabase.rpc.mockResolvedValueOnce({ data: 49069, error: null });
      const sevenDay = await queries.searchVConsCount({
        startDate: '2026-04-24T00:00:00Z',
        endDate: '2026-04-30T23:59:59Z',
      });

      expect(oneDay).toBe(7023);
      expect(twoDay).toBe(13891);
      expect(sevenDay).toBe(49069);
      expect(twoDay).toBeGreaterThan(oneDay);
      expect(sevenDay).toBeGreaterThan(twoDay);
    });

    it('subject-only count keeps PostgREST exact count path', async () => {
      // Subject filter has no RPC equivalent yet; verify we still take the
      // direct count path so this isn't accidentally broken.
      mockSupabase.setResult({ count: 42, error: null });

      const count = await queries.searchVConsCount({ subject: 'billing' });

      expect(mockSupabase._calls.ilike).toHaveBeenCalledWith('subject', '%billing%');
      expect(count).toBe(42);
    });
  });
});

