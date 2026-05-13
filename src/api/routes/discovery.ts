import Router from '@koa/router';
import type { Context } from 'koa';
import type { RestApiContext } from '../context.js';
import { sendError, sendSuccess } from '../response.js';
import { toDiscoveryValues } from '../../utils/read-surfaces.js';

function parseIncludeCounts(value: string | string[] | undefined): boolean {
  if (typeof value !== 'string') {
    return true;
  }
  return value !== 'false';
}

function parseMinCount(ctx: Context): number | undefined {
  const raw = ctx.query.min_count;
  if (raw === undefined) {
    return 1;
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
}

export function createDiscoveryRoutes(apiContext: RestApiContext): Router {
  const router = new Router();

  const handleDiscovery = async (
    ctx: Context,
    key: 'attachment_types' | 'attachment_purposes' | 'analysis_types',
    fetcher: (options: { includeCounts?: boolean; minCount?: number }) => Promise<{
      values: string[];
      countsPerValue?: Record<string, number>;
      totalVCons: number;
    }>,
  ) => {
    const minCount = parseMinCount(ctx);
    if (!minCount) {
      return sendError(ctx, 400, 'min_count must be an integer greater than or equal to 1');
    }

    const includeCounts = parseIncludeCounts(ctx.query.include_counts as string | string[] | undefined);
    const result = await fetcher({ includeCounts, minCount });
    sendSuccess(ctx, {
      count: result.values.length,
      total_vcons: result.totalVCons,
      [key]: toDiscoveryValues(result),
    });
  };

  router.get('/discovery/attachments/types', async (ctx: Context) => {
    // Legacy compatibility surface. Prefer attachment purposes for spec-facing clients.
    await handleDiscovery(
      ctx,
      'attachment_types',
      (options) => apiContext.queries.getUniqueAttachmentTypes(options),
    );
  });

  router.get('/discovery/attachments/purposes', async (ctx: Context) => {
    // Canonical spec-facing attachment discovery surface.
    await handleDiscovery(
      ctx,
      'attachment_purposes',
      (options) => apiContext.queries.getUniqueAttachmentPurposes(options),
    );
  });

  router.get('/discovery/analysis/types', async (ctx: Context) => {
    await handleDiscovery(
      ctx,
      'analysis_types',
      (options) => apiContext.queries.getUniqueAnalysisTypes(options),
    );
  });

  return router;
}
