/**
 * REST API Response Helpers
 *
 * Consistent JSON envelope for all REST responses.
 * Keeps route handlers clean and response format uniform.
 */

import type { Context } from 'koa';

export interface PaginationInfo {
  limit: number;
  offset: number;
  total?: number;
  has_more: boolean;
}

/**
 * Send a successful JSON response
 */
export function sendSuccess(ctx: Context, data: any, statusCode: number = 200): void {
  ctx.status = statusCode;
  ctx.body = {
    success: true,
    ...data,
  };
}

/**
 * Send a 201 Created response
 */
export function sendCreated(ctx: Context, data: any): void {
  sendSuccess(ctx, data, 201);
}

/**
 * Send a 204 No Content response
 */
export function sendNoContent(ctx: Context): void {
  ctx.status = 204;
  ctx.body = undefined;
}

/**
 * Send an error response
 */
export function sendError(ctx: Context, statusCode: number, message: string, details?: any): void {
  ctx.status = statusCode;
  ctx.body = {
    success: false,
    error: statusCode >= 500 ? 'Internal Server Error' : 'Error',
    message,
    ...(details ? { details } : {}),
  };
}

/**
 * Send a paginated collection response
 */
export function sendPaginated(
  ctx: Context,
  data: any[],
  pagination: PaginationInfo,
  extra?: Record<string, any>
): void {
  // Set pagination headers
  if (pagination.total !== undefined) {
    ctx.set('X-Total-Count', String(pagination.total));
  }

  ctx.status = 200;
  ctx.body = {
    success: true,
    data,
    pagination,
    ...(extra || {}),
  };
}
