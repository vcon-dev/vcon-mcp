/**
 * Response Utilities
 * 
 * Standardizes response formatting for MCP tools
 */

import { ToolResponse } from '../tools/handlers/base.js';

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
 * Create an error response
 */
export function createErrorResponse(message: string, details?: any): ToolResponse {
  return createTextResponse({
    success: false,
    error: message,
    ...(details && { details }),
  });
}

