/**
 * Analytics Routes
 *
 * Business intelligence endpoints: growth trends, content analytics,
 * tag analytics, attachment analytics.
 */

import Router from '@koa/router';
import type { Context } from 'koa';
import { RestApiContext } from '../context.js';
import { sendError, sendSuccess } from '../response.js';
import { validateDateField, validateIntRange } from '../validation.js';

function parseBoolParam(value: unknown, defaultValue: boolean = true): boolean {
  if (value === 'false' || value === '0') return false;
  if (value === 'true' || value === '1') return true;
  return defaultValue;
}

export function createAnalyticsRoutes(apiContext: RestApiContext): Router {
  const router = new Router();

  // ── GET /analytics — Full analytics dashboard ─────────────────────────────
  router.get('/analytics', async (ctx: Context) => {
    const { result: monthsBackResult, value: monthsBack } = validateIntRange(ctx.query.months_back, 'months_back', 1, 60, 12);
    if (!monthsBackResult.valid) return sendError(ctx, 400, monthsBackResult.errors[0]);
    const result = await apiContext.dbAnalytics.getDatabaseAnalytics({
      includeGrowthTrends: parseBoolParam(ctx.query.include_growth),
      includeContentAnalytics: parseBoolParam(ctx.query.include_content),
      includeAttachmentStats: parseBoolParam(ctx.query.include_attachments),
      includeTagAnalytics: parseBoolParam(ctx.query.include_tags),
      includeHealthMetrics: parseBoolParam(ctx.query.include_health),
      monthsBack,
    });
    sendSuccess(ctx, { data: result });
  });

  // ── GET /analytics/growth — Monthly growth trends ─────────────────────────
  router.get('/analytics/growth', async (ctx: Context) => {
    const { result: monthsBackResult, value: monthsBack } = validateIntRange(ctx.query.months_back, 'months_back', 1, 60, 12);
    if (!monthsBackResult.valid) return sendError(ctx, 400, monthsBackResult.errors[0]);
    const granularity = (['monthly', 'weekly', 'daily'].includes(ctx.query.granularity as string))
      ? ctx.query.granularity as 'monthly' | 'weekly' | 'daily'
      : 'monthly';

    const result = await apiContext.dbAnalytics.getMonthlyGrowthAnalytics({
      monthsBack,
      includeProjections: parseBoolParam(ctx.query.include_projections),
      granularity,
    });
    sendSuccess(ctx, { data: result });
  });

  // ── GET /analytics/content — Content analytics ────────────────────────────
  router.get('/analytics/content', async (ctx: Context) => {
    const { result: dateFieldResult, value: dateField } = validateDateField(ctx.query.date_field);
    if (!dateFieldResult.valid) return sendError(ctx, 400, dateFieldResult.errors[0]);

    const result = await apiContext.dbAnalytics.getContentAnalytics({
      includeDialogAnalysis: parseBoolParam(ctx.query.include_dialog),
      includeAnalysisBreakdown: parseBoolParam(ctx.query.include_analysis),
      includePartyPatterns: parseBoolParam(ctx.query.include_parties),
      includeConversationMetrics: parseBoolParam(ctx.query.include_metrics),
      includeTemporalContent: parseBoolParam(ctx.query.include_temporal, false),
      startDate: ctx.query.start_date as string | undefined,
      endDate: ctx.query.end_date as string | undefined,
      ...(dateField ? { dateField } : {}),
    });
    sendSuccess(ctx, { data: result });
  });

  // ── GET /analytics/tags — Tag analytics ───────────────────────────────────
  router.get('/analytics/tags', async (ctx: Context) => {
    const { result: topNKeysResult, value: topNKeys } = validateIntRange(ctx.query.top_n, 'top_n', 1, 100, 20);
    if (!topNKeysResult.valid) return sendError(ctx, 400, topNKeysResult.errors[0]);
    const { result: minUsageCountResult, value: minUsageCount } = validateIntRange(ctx.query.min_count, 'min_count', 1, 100000, 1);
    if (!minUsageCountResult.valid) return sendError(ctx, 400, minUsageCountResult.errors[0]);

    const result = await apiContext.dbAnalytics.getTagAnalytics({
      includeFrequencyAnalysis: parseBoolParam(ctx.query.include_frequency),
      includeValueDistribution: parseBoolParam(ctx.query.include_distribution),
      includeTemporalTrends: parseBoolParam(ctx.query.include_trends, false),
      topNKeys,
      minUsageCount,
    });
    sendSuccess(ctx, { data: result });
  });

  // ── GET /analytics/attachments — Attachment analytics ─────────────────────
  router.get('/analytics/attachments', async (ctx: Context) => {
    const { result: topNTypesResult, value: topNTypes } = validateIntRange(ctx.query.top_n, 'top_n', 1, 50, 10);
    if (!topNTypesResult.valid) return sendError(ctx, 400, topNTypesResult.errors[0]);

    const result = await apiContext.dbAnalytics.getAttachmentAnalytics({
      includeSizeDistribution: parseBoolParam(ctx.query.include_sizes),
      includeTypeBreakdown: parseBoolParam(ctx.query.include_types),
      includeTemporalPatterns: parseBoolParam(ctx.query.include_temporal, false),
      topNTypes,
    });
    sendSuccess(ctx, { data: result });
  });

  return router;
}
