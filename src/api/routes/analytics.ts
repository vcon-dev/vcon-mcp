/**
 * Analytics Routes
 *
 * Business intelligence endpoints: growth trends, content analytics,
 * tag analytics, attachment analytics.
 */

import Router from '@koa/router';
import type { Context } from 'koa';
import { RestApiContext } from '../context.js';
import { sendSuccess } from '../response.js';
import { validateIntRange } from '../validation.js';

function parseBoolParam(value: unknown, defaultValue: boolean = true): boolean {
  if (value === 'false' || value === '0') return false;
  if (value === 'true' || value === '1') return true;
  return defaultValue;
}

export function createAnalyticsRoutes(apiContext: RestApiContext): Router {
  const router = new Router();

  // ── GET /analytics — Full analytics dashboard ─────────────────────────────
  router.get('/analytics', async (ctx: Context) => {
    const { value: monthsBack } = validateIntRange(ctx.query.months_back, 'months_back', 1, 60, 12);
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
    const { value: monthsBack } = validateIntRange(ctx.query.months_back, 'months_back', 1, 60, 12);
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
    const result = await apiContext.dbAnalytics.getContentAnalytics({
      includeDialogAnalysis: parseBoolParam(ctx.query.include_dialog),
      includeAnalysisBreakdown: parseBoolParam(ctx.query.include_analysis),
      includePartyPatterns: parseBoolParam(ctx.query.include_parties),
      includeConversationMetrics: parseBoolParam(ctx.query.include_metrics),
      includeTemporalContent: parseBoolParam(ctx.query.include_temporal, false),
      startDate: ctx.query.start_date as string | undefined,
      endDate: ctx.query.end_date as string | undefined,
    });
    sendSuccess(ctx, { data: result });
  });

  // ── GET /analytics/tags — Tag analytics ───────────────────────────────────
  router.get('/analytics/tags', async (ctx: Context) => {
    const { value: topNKeys } = validateIntRange(ctx.query.top_n, 'top_n', 1, 100, 20);
    const { value: minUsageCount } = validateIntRange(ctx.query.min_count, 'min_count', 1, 100000, 1);

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
    const { value: topNTypes } = validateIntRange(ctx.query.top_n, 'top_n', 1, 50, 10);

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
