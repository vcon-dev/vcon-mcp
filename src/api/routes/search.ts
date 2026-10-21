/**
 * Search Routes
 *
 * Content (keyword), semantic, and hybrid search endpoints.
 * These routes must be registered BEFORE /vcons/:uuid to avoid
 * "search" being captured as a UUID parameter.
 */

import Router from '@koa/router';
import type { Context } from 'koa';
import { logWithContext, recordCounter } from '../../observability/instrumentation.js';
import { ATTR_SEARCH_TYPE } from '../../observability/attributes.js';
import { EmbeddingError, generateEmbedding } from '../../utils/embeddings.js';
import { RestApiContext } from '../context.js';
import { sendError, sendSuccess } from '../response.js';
import {
  normalizeDateString,
  parseJsonQueryParam,
  validateDateField,
  validateIntRange,
  validateNumberRange,
  validateNonEmptyString,
  validateResponseFormat,
} from '../validation.js';
import { extractErrorMessage } from '../../utils/errors.js';

export function createSearchRoutes(apiContext: RestApiContext): Router {
  const router = new Router();

  // ── GET /vcons/search/content — Keyword/full-text search ──────────────────
  router.get('/vcons/search/content', async (ctx: Context) => {
    const qCheck = validateNonEmptyString(ctx.query.q, 'q');
    if (!qCheck.valid) return sendError(ctx, 400, qCheck.errors[0]);

    const query = ctx.query.q as string;
    const { result: fmtResult, value: format } = validateResponseFormat(
      ctx.query.format, ['full', 'snippets', 'metadata', 'ids_only'], 'snippets'
    );
    if (!fmtResult.valid) return sendError(ctx, 400, fmtResult.errors[0]);

    const { result: limitResult, value: limit } = validateIntRange(ctx.query.limit, 'limit', 1, 1000, 50);
    if (!limitResult.valid) return sendError(ctx, 400, limitResult.errors[0]);
    const { result: tagsResult, value: tags } = parseJsonQueryParam(ctx.query.tags, 'tags');
    if (!tagsResult.valid) return sendError(ctx, 400, tagsResult.errors[0]);

    const { result: dateFieldResult, value: dateField } = validateDateField(ctx.query.date_field);
    if (!dateFieldResult.valid) return sendError(ctx, 400, dateFieldResult.errors[0]);

    const includeCount = ctx.query.include_count === 'true';

    // beforeSearch/afterSearch hooks run inside the service.
    const searchResult = await apiContext.vconService.keywordSearch({
      query,
      startDate: normalizeDateString(ctx.query.start_date as string | undefined),
      endDate: normalizeDateString(ctx.query.end_date as string | undefined),
      ...(dateField ? { dateField } : {}),
      tags,
      limit,
    }, { requestContext: { purpose: 'rest-api-search' } });
    const results = searchResult.hits;

    // Format results
    let formattedResults: any;
    if (format === 'ids_only') {
      formattedResults = results.map(r => r.vcon_id);
    } else if (format === 'metadata') {
      formattedResults = results.map(r => ({
        vcon_id: r.vcon_id,
        content_type: r.doc_type,
        relevance_score: r.rank,
      }));
    } else if (format === 'snippets') {
      const MAX_SNIPPET = 500;
      formattedResults = results.map(r => ({
        vcon_id: r.vcon_id,
        content_type: r.doc_type,
        content_index: r.ref_index,
        relevance_score: r.rank,
        snippet: r.snippet && r.snippet.length > MAX_SNIPPET
          ? r.snippet.slice(0, MAX_SNIPPET) + '…'
          : r.snippet,
      }));
    } else {
      // Full — load complete vCons
      const vconIds = [...new Set(results.map(r => r.vcon_id))];
      formattedResults = await apiContext.vconService.vconsForHits(searchResult, vconIds.slice(0, 20), {
        readHooks: true,
        requestContext: { purpose: 'rest-api-search' },
      });
    }

    let totalCount: number | undefined;
    if (includeCount) {
      try {
        // Aggregate count, no vCon content: no read hooks apply.
        totalCount = await apiContext.queries.keywordSearchCount({
          query,
          startDate: normalizeDateString(ctx.query.start_date as string | undefined),
          endDate: normalizeDateString(ctx.query.end_date as string | undefined),
          ...(dateField ? { dateField } : {}),
          tags,
        });
      } catch { /* best-effort */ }
    }

    recordCounter('vcon.search.count', 1, { [ATTR_SEARCH_TYPE]: 'keyword' }, 'vCon search count');

    const response: any = {
      count: results.length,
      response_format: format,
      results: formattedResults,
    };
    if (totalCount !== undefined) response.total_count = totalCount;

    sendSuccess(ctx, response);
  });

  // ── GET /vcons/search/semantic — Semantic/embedding search ────────────────
  router.get('/vcons/search/semantic', async (ctx: Context) => {
    const query = ctx.query.q as string | undefined;
    // Embedding can optionally be passed as JSON query param
    const { result: embeddingResult, value: embeddingRaw } = parseJsonQueryParam(ctx.query.embedding, 'embedding');
    if (!embeddingResult.valid) return sendError(ctx, 400, embeddingResult.errors[0]);

    const { result: limitResult, value: limit } = validateIntRange(ctx.query.limit, 'limit', 1, 1000, 50);
    if (!limitResult.valid) return sendError(ctx, 400, limitResult.errors[0]);
    const { result: thresholdResult, value: threshold } = validateNumberRange(ctx.query.threshold, 'threshold', 0, 1, 0.7);
    if (!thresholdResult.valid) return sendError(ctx, 400, thresholdResult.errors[0]);

    let embedding: number[] | undefined = embeddingRaw;

    if (!embedding && query) {
      try {
        embedding = await generateEmbedding(query);
      } catch (error) {
        if (error instanceof EmbeddingError) {
          return sendError(ctx, 422, error.message);
        }
        throw error;
      }
    }

    if (!embedding) {
      return sendError(ctx, 400, 'Either q (query) or embedding parameter is required');
    }
    if (embedding.length !== 384) {
      return sendError(ctx, 400, 'Embedding must be 384 dimensions');
    }

    const { result: tagsResult, value: tags } = parseJsonQueryParam(ctx.query.tags, 'tags');
    if (!tagsResult.valid) return sendError(ctx, 400, tagsResult.errors[0]);

    const { hits: results } = await apiContext.vconService.semanticSearch({
      embedding,
      tags,
      threshold,
      limit,
    }, { requestContext: { purpose: 'rest-api-search' } });

    recordCounter('vcon.search.count', 1, { [ATTR_SEARCH_TYPE]: 'semantic' }, 'vCon search count');

    sendSuccess(ctx, {
      count: results.length,
      results: results.map(r => ({
        vcon_id: r.vcon_id,
        content_type: r.content_type,
        content_reference: r.content_reference,
        content_text: r.content_text,
        similarity_score: r.similarity,
      })),
    });
  });

  // ── GET /vcons/search/hybrid — Combined keyword + semantic search ─────────
  router.get('/vcons/search/hybrid', async (ctx: Context) => {
    const qCheck = validateNonEmptyString(ctx.query.q, 'q');
    if (!qCheck.valid) return sendError(ctx, 400, qCheck.errors[0]);

    const query = ctx.query.q as string;
    const { result: limitResult, value: limit } = validateIntRange(ctx.query.limit, 'limit', 1, 1000, 50);
    if (!limitResult.valid) return sendError(ctx, 400, limitResult.errors[0]);
    const { result: weightResult, value: semanticWeight } = validateNumberRange(ctx.query.semantic_weight, 'semantic_weight', 0, 1, 0.6);
    if (!weightResult.valid) return sendError(ctx, 400, weightResult.errors[0]);
    const { result: tagsResult, value: tags } = parseJsonQueryParam(ctx.query.tags, 'tags');
    if (!tagsResult.valid) return sendError(ctx, 400, tagsResult.errors[0]);

    // Generate embedding from query
    let embedding: number[] | undefined;
    try {
      embedding = await generateEmbedding(query);
    } catch (error) {
      logWithContext('warn', 'Failed to generate embedding for hybrid search REST, falling back to keyword-only', {
        query,
        error: extractErrorMessage(error),
      });
    }

    const { hits: results } = await apiContext.vconService.hybridSearch({
      keywordQuery: query,
      embedding,
      tags,
      semanticWeight,
      limit,
    }, { requestContext: { purpose: 'rest-api-search' } });

    recordCounter('vcon.search.count', 1, { [ATTR_SEARCH_TYPE]: 'hybrid' }, 'vCon search count');

    sendSuccess(ctx, {
      count: results.length,
      results: results.map(r => ({
        vcon_id: r.vcon_id,
        combined_score: r.combined_score,
        semantic_score: r.semantic_score,
        keyword_score: r.keyword_score,
      })),
    });
  });

  return router;
}
