/**
 * Search Tool Handlers
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BaseToolHandler, ToolHandlerContext, ToolResponse } from './base.js';
import { VCon } from '../../types/vcon.js';
import { recordCounter, logWithContext } from '../../observability/instrumentation.js';
import { ATTR_SEARCH_TYPE, ATTR_SEARCH_RESULTS_COUNT } from '../../observability/attributes.js';
import { normalizeDateString, requireNonEmptyString } from './validation.js';

/**
 * Handler for search_vcons tool
 */
export class SearchVConsHandler extends BaseToolHandler {
  readonly toolName = 'search_vcons';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const requestContext = this.createRequestContext(args);
    
    const responseFormat = (args?.response_format as string | undefined) || 'metadata';
    const includeCount = (args?.include_count as boolean | undefined) || false;
    
    let filters = {
      subject: args?.subject as string | undefined,
      partyName: args?.party_name as string | undefined,
      partyEmail: args?.party_email as string | undefined,
      partyTel: args?.party_tel as string | undefined,
      startDate: normalizeDateString(args?.start_date as string | undefined),
      endDate: normalizeDateString(args?.end_date as string | undefined),
      tags: args?.tags as Record<string, string> | undefined,
      limit: (args?.limit as number | undefined) || 10,
    };

    // Hook: beforeSearch (can modify search criteria)
    const modifiedFilters = await context.pluginManager.executeHook<typeof filters>('beforeSearch', filters, requestContext);
    if (modifiedFilters) filters = modifiedFilters;

    let results: VCon[];
    try {
      results = await context.queries.searchVCons(filters);
    } catch (dbError: any) {
      // Improve error messages for database connection issues
      if (dbError instanceof TypeError && dbError.message.includes('fetch failed')) {
        throw new McpError(
          ErrorCode.InternalError,
          `Database connection failed: Unable to reach Supabase database. ` +
          `Please check: 1) Network connectivity, 2) SUPABASE_URL is correct, 3) Supabase service is available. ` +
          `Details: ${dbError.message}`
        );
      }
      throw dbError;
    }
    
    // Hook: afterSearch (can filter or modify results)
    const filteredResults = await context.pluginManager.executeHook<VCon[]>('afterSearch', results, requestContext);
    if (filteredResults) results = filteredResults;
    
    // Format response based on requested format
    let formattedResults;
    if (responseFormat === 'ids_only') {
      formattedResults = results.map(vcon => vcon.uuid);
    } else if (responseFormat === 'metadata') {
      formattedResults = results.map(vcon => ({
        uuid: vcon.uuid,
        subject: vcon.subject,
        created_at: vcon.created_at,
        parties_count: vcon.parties?.length || 0,
        dialog_count: vcon.dialog?.length || 0,
        analysis_count: vcon.analysis?.length || 0,
        attachments_count: vcon.attachments?.length || 0
      }));
    } else {
      formattedResults = results;
    }

    // Get total count if requested
    let totalCount;
    if (includeCount) {
      try {
        totalCount = await context.queries.searchVConsCount({
          subject: filters.subject,
          partyName: filters.partyName,
          partyEmail: filters.partyEmail,
          partyTel: filters.partyTel,
          startDate: filters.startDate,
          endDate: filters.endDate,
          tags: filters.tags,
        });
      } catch (countError: any) {
        logWithContext('warn', 'Failed to get total count for search', {
          tool_name: this.toolName,
          error_message: countError instanceof Error ? countError.message : String(countError),
        });
      }
    }
    
    recordCounter('vcon.search.count', 1, {
      [ATTR_SEARCH_TYPE]: 'basic',
    }, 'vCon search count');
    
    const response: any = {
      success: true,
      count: results.length,
      response_format: responseFormat,
      results: formattedResults
    };
    
    if (totalCount !== undefined) {
      response.total_count = totalCount;
    }
    
    return this.createTextResponse(response);
  }
}

/**
 * Handler for search_vcons_content tool
 */
export class SearchVConsContentHandler extends BaseToolHandler {
  readonly toolName = 'search_vcons_content';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const query = requireNonEmptyString(args?.query as string, 'query');

    const responseFormat = (args?.response_format as string | undefined) || 'snippets';
    const includeCount = (args?.include_count as boolean | undefined) || false;

    const results = await context.queries.keywordSearch({
      query,
      startDate: normalizeDateString(args?.start_date as string | undefined),
      endDate: normalizeDateString(args?.end_date as string | undefined),
      tags: args?.tags as Record<string, string> | undefined,
      limit: (args?.limit as number | undefined) || 50,
    });

    // Format response based on requested format
    let formattedResults;
    if (responseFormat === 'ids_only') {
      formattedResults = results.map(r => r.vcon_id);
    } else if (responseFormat === 'metadata') {
      formattedResults = results.map(r => ({
        vcon_id: r.vcon_id,
        content_type: r.doc_type,
        relevance_score: r.rank
      }));
    } else if (responseFormat === 'snippets') {
      formattedResults = results.map(r => ({
        vcon_id: r.vcon_id,
        content_type: r.doc_type,
        content_index: r.ref_index,
        relevance_score: r.rank,
        snippet: r.snippet
      }));
    } else {
      // Full format - get complete vCons
      const vconIds = [...new Set(results.map(r => r.vcon_id))];
      const fullVCons = await Promise.all(
        vconIds.slice(0, 20).map(id => context.queries.getVCon(id)) // Limit to 20 for memory safety
      );
      formattedResults = fullVCons;
    }

    // Get total count if requested
    let totalCount;
    if (includeCount) {
      try {
        totalCount = await context.queries.keywordSearchCount({
          query,
          startDate: normalizeDateString(args?.start_date as string | undefined),
          endDate: normalizeDateString(args?.end_date as string | undefined),
          tags: args?.tags as Record<string, string> | undefined,
        });
      } catch (countError: any) {
        logWithContext('warn', 'Failed to get total count for keyword search', {
          tool_name: this.toolName,
          error_message: countError instanceof Error ? countError.message : String(countError),
        });
      }
    }

    recordCounter('vcon.search.count', 1, {
      [ATTR_SEARCH_TYPE]: 'keyword',
    }, 'vCon search count');
    
    const response: any = {
      success: true,
      count: results.length,
      response_format: responseFormat,
      results: formattedResults
    };
    
    if (totalCount !== undefined) {
      response.total_count = totalCount;
    }
    
    return this.createTextResponse(response);
  }
}

/**
 * Handler for search_vcons_semantic tool
 */
export class SearchVConsSemanticHandler extends BaseToolHandler {
  readonly toolName = 'search_vcons_semantic';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    let embedding = args?.embedding as number[] | undefined;
    const query = args?.query as string | undefined;

    // If no embedding provided but query is, generate embedding
    if (!embedding && query) {
      // For now, require pre-computed embeddings
      throw new McpError(
        ErrorCode.InvalidParams,
        'Embedding generation not yet implemented. Please provide a pre-computed embedding vector (384 dimensions) or use search_vcons_content for keyword search.'
      );
    }

    if (!embedding) {
      throw new McpError(ErrorCode.InvalidParams, 'Either embedding or query is required');
    }

    if (embedding.length !== 384) {
      throw new McpError(ErrorCode.InvalidParams, 'Embedding must be 384 dimensions');
    }

    const results = await context.queries.semanticSearch({
      embedding,
      tags: args?.tags as Record<string, string> | undefined,
      threshold: (args?.threshold as number | undefined) || 0.7,
      limit: (args?.limit as number | undefined) || 50,
    });

    recordCounter('vcon.search.count', 1, {
      [ATTR_SEARCH_TYPE]: 'semantic',
    }, 'vCon search count');

    return this.createSuccessResponse({
      count: results.length,
      results: results.map(r => ({
        vcon_id: r.vcon_id,
        content_type: r.content_type,
        content_reference: r.content_reference,
        content_text: r.content_text,
        similarity_score: r.similarity
      }))
    });
  }
}

/**
 * Handler for search_vcons_hybrid tool
 */
export class SearchVConsHybridHandler extends BaseToolHandler {
  readonly toolName = 'search_vcons_hybrid';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const query = args?.query as string;
    let embedding = args?.embedding as number[] | undefined;

    if (!query) {
      throw new McpError(ErrorCode.InvalidParams, 'query is required');
    }

    // If embedding provided but wrong size, reject
    if (embedding && embedding.length !== 384) {
      throw new McpError(ErrorCode.InvalidParams, 'Embedding must be 384 dimensions');
    }

    // If no embedding provided, use keyword-only search
    if (!embedding) {
      console.error('⚠️  No embedding provided for hybrid search, falling back to keyword-only');
    }

    const results = await context.queries.hybridSearch({
      keywordQuery: query,
      embedding: embedding,
      tags: args?.tags as Record<string, string> | undefined,
      semanticWeight: (args?.semantic_weight as number | undefined) || 0.6,
      limit: (args?.limit as number | undefined) || 50,
    });

    recordCounter('vcon.search.count', 1, {
      [ATTR_SEARCH_TYPE]: 'hybrid',
    }, 'vCon search count');

    return this.createSuccessResponse({
      count: results.length,
      results: results.map(r => ({
        vcon_id: r.vcon_id,
        combined_score: r.combined_score,
        semantic_score: r.semantic_score,
        keyword_score: r.keyword_score
      }))
    });
  }
}

