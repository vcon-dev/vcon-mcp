/**
 * Pagination Middleware
 *
 * Parses ?limit, ?offset from query params and attaches normalized
 * pagination state to ctx.state.pagination.
 */

import type { Context, Next } from 'koa';

export interface PaginationState {
  limit: number;
  offset: number;
  includeCount: boolean;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 1000;

/**
 * Koa middleware that parses pagination query params
 */
export function parsePagination() {
  return async (ctx: Context, next: Next) => {
    const rawLimit = ctx.query.limit;
    const rawOffset = ctx.query.offset;
    const rawIncludeCount = ctx.query.include_count;

    let limit = DEFAULT_LIMIT;
    if (rawLimit !== undefined && rawLimit !== '') {
      const parsed = Number(rawLimit);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT) {
        limit = parsed;
      } else {
        ctx.status = 400;
        ctx.body = {
          success: false,
          error: 'Error',
          message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
        };
        return;
      }
    }

    let offset = 0;
    if (rawOffset !== undefined && rawOffset !== '') {
      const parsed = Number(rawOffset);
      if (Number.isInteger(parsed) && parsed >= 0) {
        offset = parsed;
      } else {
        ctx.status = 400;
        ctx.body = {
          success: false,
          error: 'Error',
          message: 'offset must be a non-negative integer',
        };
        return;
      }
    }

    const includeCount = rawIncludeCount === 'true' || rawIncludeCount === '1';

    ctx.state.pagination = { limit, offset, includeCount } as PaginationState;
    await next();
  };
}
