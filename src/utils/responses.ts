/**
 * Response Utilities
 * 
 * Standardizes response formatting for MCP tools
 */

import { ToolResponse } from '../tools/handlers/base.js';

export interface EnvelopePage {
  count: number;
  total?: number;
  next_cursor?: string | null;
}

export interface EnvelopeRate {
  remaining?: number;
  reset_at?: string;
  limit?: number;
}

export interface EnvelopeError {
  code: string;
  message: string;
  [key: string]: unknown;
}

/**
 * Create a text response from JSON data
 */
export function createTextResponse(data: any): ToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Create a success response with optional data
 */
export function createSuccessResponse(data: any = {}): ToolResponse {
  return createTextResponse({
    success: true,
    ...data,
  });
}

/**
 * Create an ok/item response for the redesigned vCon tools.
 */
export function createOkItemResponse(
  item: unknown,
  options?: {
    rate?: EnvelopeRate;
    [key: string]: unknown;
  }
): ToolResponse {
  return createTextResponse({
    ok: true,
    item,
    ...(options || {}),
  });
}

/**
 * Create an ok/items response for the redesigned vCon tools.
 */
export function createOkListResponse(
  items: unknown[],
  page?: EnvelopePage,
  options?: {
    rate?: EnvelopeRate;
    [key: string]: unknown;
  }
): ToolResponse {
  return createTextResponse({
    ok: true,
    items,
    ...(page ? { page } : {}),
    ...(options || {}),
  });
}

/**
 * Create an error response
 */
export function createErrorResponse(message: string, details?: any): ToolResponse {
  return createTextResponse({
    success: false,
    error: message,
    ...(details && { details }),
  });
}

/**
 * Create an ok:false envelope for redesigned tools.
 */
export function createErrorEnvelopeResponse(
  error: EnvelopeError,
  options?: {
    rate?: EnvelopeRate;
    [key: string]: unknown;
  }
): ToolResponse {
  return createTextResponse({
    ok: false,
    error,
    ...(options || {}),
  });
}

