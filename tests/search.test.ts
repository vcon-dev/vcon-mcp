import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VConQueries } from '../src/db/queries.js';

describe('Search RPC methods', () => {
  let queries: VConQueries;
  let mockSupabase: any;

  beforeEach(() => {
    const mock: any = {
      rpc: vi.fn(),
    };
    queries = new VConQueries(mock as any);
    mockSupabase = (queries as any).supabase = mock;
  });

  it('keywordSearch calls RPC with params and returns data', async () => {
    const rpcResult = { data: [{ vcon_id: 'id1', doc_type: 'subject', ref_index: null, rank: 0.5, snippet: '...' }], error: null };
    mockSupabase.rpc.mockResolvedValue(rpcResult);

    const res = await queries.keywordSearch({ query: 'billing', tags: { category: 'support' }, limit: 10 });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('search_vcons_keyword', expect.objectContaining({ query_text: 'billing', tag_filter: { category: 'support' }, max_results: 10 }));
    expect(res.length).toBe(1);
  });

  it('semanticSearch calls RPC with embedding and returns data', async () => {
    const rpcResult = { data: [{ vcon_id: 'id1', content_type: 'dialog', content_reference: '0', content_text: '...', similarity: 0.8 }], error: null };
    mockSupabase.rpc.mockResolvedValue(rpcResult);

    const res = await queries.semanticSearch({ embedding: new Array(1536).fill(0.01), threshold: 0.7, limit: 5 });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('search_vcons_semantic', expect.objectContaining({ match_threshold: 0.7, match_count: 5 }));
    expect(res[0].similarity).toBe(0.8);
  });

  it('hybridSearch calls RPC and returns data', async () => {
    const rpcResult = { data: [{ vcon_id: 'id1', combined_score: 0.7, semantic_score: 0.8, keyword_score: 0.5 }], error: null };
    mockSupabase.rpc.mockResolvedValue(rpcResult);

    const res = await queries.hybridSearch({ keywordQuery: 'refund', embedding: [0.1, 0.2], semanticWeight: 0.6, tags: { priority: 'high' } });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('search_vcons_hybrid', expect.objectContaining({ keyword_query: 'refund', semantic_weight: 0.6, tag_filter: { priority: 'high' } }));
    expect(res[0].combined_score).toBeCloseTo(0.7);
  });
});


