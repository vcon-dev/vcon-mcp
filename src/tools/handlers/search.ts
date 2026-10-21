/**
 * Search Tool Handlers
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { ATTR_SEARCH_TYPE } from '../../observability/attributes.js';
import { logWithContext, recordCounter } from '../../observability/instrumentation.js';
import { RequestContext } from '../../hooks/plugin-interface.js';
import { VCon } from '../../types/vcon.js';
import { EmbeddingError, generateEmbedding } from '../../utils/embeddings.js';
import { BaseToolHandler, ToolHandlerContext, ToolResponse } from './base.js';
import { normalizeDateString, parseDateField, requireNonEmptyString } from './validation.js';
import { extractErrorMessage } from '../../utils/errors.js';
import { conversationStartOf } from '../../utils/read-surfaces.js';

/**
 * Handler for search_vcons tool
 */
export class SearchVConsHandler extends BaseToolHandler {
  readonly toolName = 'search_vcons';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const requestContext = this.createRequestContext(args);

    const responseFormat = (args?.response_format as string | undefined) || 'metadata';
    const includeCount = (args?.include_count as boolean | undefined) || false;
    const dateField = parseDateField(args?.date_field);

    const filters = {
      subject: args?.subject as string | undefined,
      partyName: args?.party_name as string | undefined,
      partyEmail: args?.party_email as string | undefined,
      partyTel: args?.party_tel as string | undefined,
      startDate: normalizeDateString(args?.start_date as string | undefined),
      endDate: normalizeDateString(args?.end_date as string | undefined),
      ...(dateField ? { dateField } : {}),
      tags: args?.tags as Record<string, string> | undefined,
      limit: (args?.limit as number | undefined) || 10,
    };

    // beforeSearch/afterSearch hooks run inside the service.
    let results: VCon[];
    try {
      results = await context.vconService.search(filters, { requestContext });
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

    // Format response based on requested format
    let formattedResults;
    if (responseFormat === 'ids_only') {
      formattedResults = results.map(vcon => vcon.uuid);
    } else if (responseFormat === 'metadata') {
      formattedResults = results.map(vcon => ({
        uuid: vcon.uuid,
        subject: vcon.subject,
        created_at: vcon.created_at,
        conversation_start: conversationStartOf(vcon),
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
        // Aggregate count only, no vCon content: no read hooks (afterSearch cannot adjust a number).
        totalCount = await context.queries.searchVConsCount({
          subject: filters.subject,
          partyName: filters.partyName,
          partyEmail: filters.partyEmail,
          partyTel: filters.partyTel,
          startDate: filters.startDate,
          endDate: filters.endDate,
          ...(filters.dateField ? { dateField: filters.dateField } : {}),
          tags: filters.tags,
        });
      } catch (countError: any) {
        logWithContext('warn', 'Failed to get total count for search', {
          tool_name: this.toolName,
          error_message: extractErrorMessage(countError),
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
    const dateField = parseDateField(args?.date_field);

    // beforeSearch/afterSearch hooks run inside the service.
    const searchResult = await context.vconService.keywordSearch({
      query,
      startDate: normalizeDateString(args?.start_date as string | undefined),
      endDate: normalizeDateString(args?.end_date as string | undefined),
      ...(dateField ? { dateField } : {}),
      tags: args?.tags as Record<string, string> | undefined,
      limit: (args?.limit as number | undefined) || 50,
    }, { requestContext: this.createRequestContext(args) });
    const results = searchResult.hits;

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
      // Truncate snippets to 500 chars — ts_headline with HighlightAll=TRUE can return full
      // transcript bodies (up to 100KB each), pushing 50 results well over the 1MB MCP limit
      const MAX_SNIPPET = 500;
      formattedResults = results.map(r => ({
        vcon_id: r.vcon_id,
        content_type: r.doc_type,
        content_index: r.ref_index,
        relevance_score: r.rank,
        snippet: r.snippet && r.snippet.length > MAX_SNIPPET
          ? r.snippet.slice(0, MAX_SNIPPET) + '…'
          : r.snippet
      }));
    } else {
      // Full format - get complete vCons
      const vconIds = [...new Set(results.map(r => r.vcon_id))];
      // Limit to 20 for memory safety; hooked vCons come from the search result.
      formattedResults = await context.vconService.vconsForHits(searchResult, vconIds.slice(0, 20), {
        readHooks: true,
        requestContext: this.createRequestContext(args),
      });
    }

    // Get total count if requested
    let totalCount;
    if (includeCount) {
      try {
        // Aggregate count only, no vCon content: no read hooks (afterSearch cannot adjust a number).
        totalCount = await context.queries.keywordSearchCount({
          query,
          startDate: normalizeDateString(args?.start_date as string | undefined),
          endDate: normalizeDateString(args?.end_date as string | undefined),
          ...(dateField ? { dateField } : {}),
          tags: args?.tags as Record<string, string> | undefined,
        });
      } catch (countError: any) {
        logWithContext('warn', 'Failed to get total count for keyword search', {
          tool_name: this.toolName,
          error_message: extractErrorMessage(countError),
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
 * Shared response_format handling for hit-level search results (semantic, hybrid).
 * - "metadata" (default): one row per hit, as built by `toRow`
 * - "ids_only": unique vCon UUIDs in rank order
 * - "full": complete vCons for the unique matches (first 20, for memory safety)
 */
async function formatHitResults<T extends { vcon_id: string }>(
  result: { hits: T[]; vcons?: Map<string, VCon> },
  responseFormat: string,
  toRow: (hit: T) => unknown,
  context: ToolHandlerContext,
  requestContext: RequestContext
): Promise<unknown[]> {
  const hits = result.hits;
  if (responseFormat === 'ids_only') {
    return [...new Set(hits.map(h => h.vcon_id))];
  }
  if (responseFormat === 'full') {
    const ids = [...new Set(hits.map(h => h.vcon_id))].slice(0, 20);
    // The search already ran afterSearch on these vCons; beforeRead/afterRead then run
    // once on the same objects (CON-1240). Unreadable or blocked vCons are skipped.
    return context.vconService.vconsForHits(result, ids, { readHooks: true, requestContext });
  }
  return hits.map(toRow);
}

/**
 * Handler for search_vcons_semantic tool
 */
export class SearchVConsSemanticHandler extends BaseToolHandler {
  readonly toolName = 'search_vcons_semantic';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    let embedding = args?.embedding as number[] | undefined;
    const query = args?.query as string | undefined;

    // If no embedding provided but query is, generate embedding via OpenAI
    if (!embedding && query) {
      embedding = await generateEmbedding(query);
    }

    if (!embedding) {
      throw new McpError(ErrorCode.InvalidParams, 'Either embedding or query is required');
    }

    if (embedding.length !== 384) {
      throw new McpError(ErrorCode.InvalidParams, 'Embedding must be 384 dimensions');
    }

    const searchResult = await context.vconService.semanticSearch({
      embedding,
      tags: args?.tags as Record<string, string> | undefined,
      threshold: (args?.threshold as number | undefined) ?? 0.7,
      limit: (args?.limit as number | undefined) || 50,
    }, { requestContext: this.createRequestContext(args) });
    const results = searchResult.hits;

    recordCounter('vcon.search.count', 1, {
      [ATTR_SEARCH_TYPE]: 'semantic',
    }, 'vCon search count');

    const responseFormat = (args?.response_format as string | undefined) || 'metadata';
    const formatted = await formatHitResults(searchResult, responseFormat, r => ({
      vcon_id: r.vcon_id,
      content_type: r.content_type,
      content_reference: r.content_reference,
      content_text: r.content_text,
      similarity_score: r.similarity
    }), context, this.createRequestContext(args));

    return this.createSuccessResponse({
      count: results.length,
      response_format: responseFormat,
      results: formatted
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

    // If no embedding provided, generate one from the query
    if (!embedding) {
      try {
        embedding = await generateEmbedding(query);
      } catch (e) {
        logWithContext('warn', 'Failed to generate embedding for hybrid search, falling back to keyword-only', {
          tool_name: this.toolName,
          query,
          error: extractErrorMessage(e)
        });
      }
    }

    const searchResult = await context.vconService.hybridSearch({
      keywordQuery: query,
      embedding: embedding,
      tags: args?.tags as Record<string, string> | undefined,
      semanticWeight: (args?.semantic_weight as number | undefined) ?? 0.6,
      limit: (args?.limit as number | undefined) || 50,
    }, { requestContext: this.createRequestContext(args) });
    const results = searchResult.hits;

    recordCounter('vcon.search.count', 1, {
      [ATTR_SEARCH_TYPE]: 'hybrid',
    }, 'vCon search count');

    const responseFormat = (args?.response_format as string | undefined) || 'metadata';
    const formatted = await formatHitResults(searchResult, responseFormat, r => ({
      vcon_id: r.vcon_id,
      combined_score: r.combined_score,
      semantic_score: r.semantic_score,
      keyword_score: r.keyword_score
    }), context, this.createRequestContext(args));

    return this.createSuccessResponse({
      count: results.length,
      response_format: responseFormat,
      results: formatted
    });
  }
}
