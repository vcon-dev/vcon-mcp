/**
 * Error Utilities
 * 
 * Provides error message extraction and formatting helpers
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/** Thrown when a vCon UUID does not match any row. REST routes map it to 404. */
export class VConNotFoundError extends Error {
  constructor(uuid: string) {
    super(`vCon with UUID ${uuid} not found`);
    this.name = 'VConNotFoundError';
  }
}

/**
 * Convert the PostgREST "no rows" error (PGRST116, from `.single()`) on a vcons
 * lookup into a VConNotFoundError. Any other error is returned untouched.
 */
export function vconLookupError(error: { code?: string }, uuid: string): unknown {
  return error?.code === 'PGRST116' ? new VConNotFoundError(uuid) : error;
}

/**
 * Extract meaningful error message from various error types
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    // Check for Supabase-style errors first (code + message)
    if ('code' in error && 'message' in error) {
      return `${error.code}: ${error.message}`;
    }

    // Try to extract message from error object
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }

    if ('error' in error && typeof error.error === 'string') {
      return error.error;
    }

    // Try to JSON stringify for more details
    try {
      const errorStr = JSON.stringify(error, null, 2);
      return errorStr.length > 500 ? errorStr.substring(0, 500) + '...' : errorStr;
    } catch {
      // If JSON.stringify fails, use object inspection
      return `Error object: ${Object.keys(error).join(', ')}`;
    }
  }

  return String(error);
}

/**
 * Create an MCP error from any error
 */
export function createMcpError(error: unknown, code: ErrorCode = ErrorCode.InternalError): McpError {
  const message = extractErrorMessage(error);
  return new McpError(code, message);
}

/**
 * Check if error is a database connection error
 */
export function isDatabaseConnectionError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes('fetch failed')) {
    return true;
  }
  return false;
}

/**
 * Create a user-friendly database connection error
 */
export function createDatabaseConnectionError(error: unknown): McpError {
  const message = extractErrorMessage(error);
  return new McpError(
    ErrorCode.InternalError,
    `Database connection failed: Unable to reach Supabase database. ` +
      `Please check: 1) Network connectivity, 2) SUPABASE_URL is correct, 3) Supabase service is available. ` +
      `Details: ${message}`
  );
}

