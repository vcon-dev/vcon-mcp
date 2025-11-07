/**
 * Shared Validation Utilities for Tool Handlers
 * 
 * Provides standardized validation helpers for common patterns used across handlers.
 * This centralizes validation logic to ensure consistency and reduce duplication.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { 
  validateUUID, 
  validateVCon, 
  validateAnalysis, 
  validateDialog,
  validateParty,
  ValidationResult 
} from '../../utils/validation.js';
import { Attachment, Dialog, Analysis, Party } from '../../types/vcon.js';
import { isValidEncoding } from '../../types/vcon.js';

/**
 * Validate UUID and throw McpError if invalid
 * Use this helper to standardize UUID validation across handlers
 */
export function requireUUID(uuid: string | undefined | null, paramName: string = 'uuid'): string {
  const validation = validateUUID(uuid, paramName);
  if (!validation.valid) {
    throw new McpError(ErrorCode.InvalidParams, validation.errors.join(', '));
  }
  return uuid!;
}

/**
 * Validate vCon and throw McpError if invalid
 */
export function requireValidVCon(vcon: any): void {
  const validation = validateVCon(vcon);
  if (!validation.valid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `vCon validation failed: ${validation.errors.join(', ')}`
    );
  }
}

/**
 * Validate Analysis and throw McpError if invalid
 */
export function requireValidAnalysis(analysis: any): void {
  const validation = validateAnalysis(analysis);
  if (!validation.valid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Analysis validation failed: ${validation.errors.join(', ')}`
    );
  }
}

/**
 * Validate Dialog and throw McpError if invalid
 */
export function requireValidDialog(dialog: any): void {
  const validation = validateDialog(dialog);
  if (!validation.valid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Dialog validation failed: ${validation.errors.join(', ')}`
    );
  }
}

/**
 * Validate Attachment object
 * Per spec Section 4.4, attachments must have either (body + encoding) or (url + content_hash)
 */
export function validateAttachment(attachment: Attachment): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate encoding if present
  if (attachment.encoding && !isValidEncoding(attachment.encoding)) {
    errors.push(
      `Invalid encoding: ${attachment.encoding}. ` +
      `Must be one of: base64url, json, none`
    );
  }

  // Must have either (body + encoding) or (url + content_hash)
  const hasInline = attachment.body !== undefined && attachment.encoding !== undefined;
  const hasExternal = attachment.url !== undefined && attachment.content_hash !== undefined;
  
  if (!hasInline && !hasExternal) {
    errors.push(
      'Attachment must have either (body + encoding) or (url + content_hash)'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate Attachment and throw McpError if invalid
 */
export function requireValidAttachment(attachment: any): void {
  const validation = validateAttachment(attachment);
  if (!validation.valid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Attachment validation failed: ${validation.errors.join(', ')}`
    );
  }
}

/**
 * Validate Party and throw McpError if invalid
 */
export function requireValidParty(party: any): void {
  const validation = validateParty(party);
  if (!validation.valid) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Party validation failed: ${validation.errors.join(', ')}`
    );
  }
}

/**
 * Validate that a required parameter is present
 */
export function requireParam<T>(value: T | undefined | null, paramName: string): T {
  if (value === undefined || value === null) {
    throw new McpError(ErrorCode.InvalidParams, `${paramName} is required`);
  }
  return value;
}

/**
 * Validate that a parameter is a non-empty string
 */
export function requireNonEmptyString(value: any, paramName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new McpError(ErrorCode.InvalidParams, `${paramName} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Validate that a parameter is a positive integer
 */
export function requirePositiveInteger(value: any, paramName: string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (isNaN(num) || !Number.isInteger(num) || num <= 0) {
    throw new McpError(ErrorCode.InvalidParams, `${paramName} must be a positive integer`);
  }
  return num;
}

/**
 * Validate that a parameter is a number within a range
 */
export function requireNumberInRange(
  value: any, 
  paramName: string, 
  min: number, 
  max: number
): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (isNaN(num) || num < min || num > max) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${paramName} must be a number between ${min} and ${max}`
    );
  }
  return num;
}

/**
 * Validate that a parameter is one of the allowed values
 */
export function requireOneOf<T>(value: any, paramName: string, allowedValues: readonly T[]): T {
  if (!allowedValues.includes(value)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${paramName} must be one of: ${allowedValues.join(', ')}`
    );
  }
  return value;
}

/**
 * Validate that a parameter is a valid object
 */
export function requireObject(value: any, paramName: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpError(ErrorCode.InvalidParams, `${paramName} must be an object`);
  }
  return value;
}

/**
 * Validate that a parameter is a non-empty array
 */
export function requireNonEmptyArray<T>(value: any, paramName: string): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, `${paramName} must be a non-empty array`);
  }
  return value;
}

/**
 * Normalize and validate ISO 8601 date strings
 * Returns the normalized date string or throws McpError if invalid
 */
export function requireValidDate(dateStr: string | undefined | null, paramName: string): string | undefined {
  if (!dateStr) return undefined;
  
  const trimmed = dateStr.trim();
  if (!trimmed) return undefined;
  
  // Validate ISO 8601 format (supports Z, +/-HH:MM, +/-HHMM, and +/-HH)
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2}?)$/;
  if (!iso8601Regex.test(trimmed)) {
    // Try parsing as Date to provide better error message
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid ${paramName} format: "${dateStr}". Expected ISO 8601 format (e.g., "2025-01-15T14:30:00Z" or "2025-01-15T14:30:00-05:00")`
      );
    }
    // If it's a valid Date but not ISO format, convert it to ISO
    return parsed.toISOString();
  }
  
  return trimmed;
}

/**
 * Normalize date string (returns undefined if not provided, doesn't throw)
 * Use this for optional date parameters
 */
export function normalizeDateString(dateStr: string | undefined): string | undefined {
  if (!dateStr) return undefined;
  
  const trimmed = dateStr.trim();
  if (!trimmed) return undefined;
  
  // Validate ISO 8601 format
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2}?)$/;
  if (!iso8601Regex.test(trimmed)) {
    // Try parsing as Date
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      return undefined; // Invalid date, return undefined
    }
    // Convert to ISO format
    return parsed.toISOString();
  }
  
  return trimmed;
}

