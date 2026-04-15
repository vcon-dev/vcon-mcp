/**
 * Database Operational Routes
 *
 * Schema inspection, stats, size info, health metrics, and query analysis.
 */

import Router from '@koa/router';
import type { Context } from 'koa';
import { RestApiContext } from '../context.js';
import { sendError, sendSuccess } from '../response.js';

function parseBoolParam(value: unknown, defaultValue: boolean = true): boolean {
  if (value === 'false' || value === '0') return false;
  if (value === 'true' || value === '1') return true;
  return defaultValue;
}

export function createDatabaseRoutes(apiContext: RestApiContext): Router {
  const router = new Router();

  // ── GET /database/shape ───────────────────────────────────────────────────
  router.get('/database/shape', async (ctx: Context) => {
    const result = await apiContext.dbInspector.getDatabaseShape({
      includeCounts: parseBoolParam(ctx.query.include_counts),
      includeSizes: parseBoolParam(ctx.query.include_sizes),
      includeIndexes: parseBoolParam(ctx.query.include_indexes),
      includeColumns: parseBoolParam(ctx.query.include_columns, false),
    });
    sendSuccess(ctx, { data: result });
  });

  // ── GET /database/stats ───────────────────────────────────────────────────
  // ── GET /database/stats ───────────────────────────────────────────────────
  router.get('/database/stats', async (ctx: Context) => {
    const result = await apiContext.dbInspector.getDatabaseStats({
      includeQueryStats: parseBoolParam(ctx.query.include_query_stats),
      includeIndexUsage: parseBoolParam(ctx.query.include_index_usage),
      includeCacheStats: parseBoolParam(ctx.query.include_cache_stats),
      tableName: ctx.query.table as string | undefined,
    });
    sendSuccess(ctx, { data: result });
  });

  // ── GET /database/size ────────────────────────────────────────────────────
  router.get('/database/size', async (ctx: Context) => {
    const result = await apiContext.dbSizeAnalyzer.getDatabaseSizeInfo(
      parseBoolParam(ctx.query.include_recommendations)
    );
    sendSuccess(ctx, { data: result });
  });

  // ── GET /database/health ──────────────────────────────────────────────────
  router.get('/database/health', async (ctx: Context) => {
    const result = await apiContext.dbAnalytics.getDatabaseHealthMetrics({
      includePerformanceMetrics: parseBoolParam(ctx.query.include_performance),
      includeStorageEfficiency: parseBoolParam(ctx.query.include_storage),
      includeIndexHealth: parseBoolParam(ctx.query.include_index_health),
      includeConnectionMetrics: parseBoolParam(ctx.query.include_connections),
      includeRecommendations: parseBoolParam(ctx.query.include_recommendations),
    });
    sendSuccess(ctx, { data: result });
  });

  // ── POST /database/analyze — Analyze a SQL query plan ─────────────────────
  router.post('/database/analyze', async (ctx: Context) => {
    const body = ctx.request.body as any;
    if (!body?.query || typeof body.query !== 'string') {
      return sendError(ctx, 400, 'Request body must contain a "query" string field');
    }

    const mode = body.mode === 'explain_analyze' ? 'explain_analyze' : 'explain';
    const result = await apiContext.dbInspector.analyzeQuery(body.query, mode);
    sendSuccess(ctx, { data: result });
  });

  return router;
}
