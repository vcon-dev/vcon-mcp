/**
 * REST API Validation Helpers
 *
 * HTTP-friendly validation that returns structured results instead of throwing McpError.
 * Route handlers check the result and set appropriate HTTP status codes.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function fail(message: string): ValidationResult {
  return { valid: false, errors: [message] };
}

/**
 * Validate a UUID string
 */
export function validateUUID(value: unknown, fieldName: string = 'uuid'): ValidationResult {
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    return fail(`${fieldName} must be a valid UUID (got: ${typeof value === 'string' ? value : typeof value})`);
  }
  return ok();
}

/**
 * Validate a required non-empty string
 */
export function validateNonEmptyString(value: unknown, fieldName: string): ValidationResult {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(`${fieldName} is required and must be a non-empty string`);
  }
  return ok();
}

/**
 * Validate an optional ISO date string
 */
export function validateOptionalDate(value: unknown, fieldName: string): ValidationResult {
  if (value === undefined || value === null || value === '') return ok();
  if (typeof value !== 'string') return fail(`${fieldName} must be a string`);
  const d = new Date(value);
  if (isNaN(d.getTime())) return fail(`${fieldName} must be a valid ISO 8601 date string`);
  return ok();
}

/**
 * Validate an integer within a range
 */
export function validateIntRange(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
  defaultValue?: number
): { result: ValidationResult; value: number } {
  if (value === undefined || value === null || value === '') {
    return { result: ok(), value: defaultValue ?? min };
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    return {
      result: fail(`${fieldName} must be an integer between ${min} and ${max}`),
      value: defaultValue ?? min,
    };
  }
  return { result: ok(), value: num };
}

/**
 * Validate a response format enum value
 */
export function validateResponseFormat(
  value: unknown,
  allowed: string[],
  defaultValue: string
): { result: ValidationResult; value: string } {
  if (value === undefined || value === null || value === '') {
    return { result: ok(), value: defaultValue };
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return {
      result: fail(`format must be one of: ${allowed.join(', ')}`),
      value: defaultValue,
    };
  }
  return { result: ok(), value };
}

/**
 * Parse a JSON query parameter (e.g., ?tags={"key":"value"})
 */
export function parseJsonQueryParam(
  value: unknown,
  fieldName: string
): { result: ValidationResult; value: any } {
  if (value === undefined || value === null || value === '') {
    return { result: ok(), value: undefined };
  }
  if (typeof value !== 'string') {
    return { result: fail(`${fieldName} must be a JSON string`), value: undefined };
  }
  try {
    return { result: ok(), value: JSON.parse(value) };
  } catch {
    return { result: fail(`${fieldName} must be valid JSON`), value: undefined };
  }
}

/**
 * Normalize a date string — append T00:00:00Z if it looks like YYYY-MM-DD
 */
export function normalizeDateString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00Z`;
  return value;
}

/**
 * Collect multiple validation results into one
 */
export function combineValidations(...results: ValidationResult[]): ValidationResult {
  const errors = results.flatMap(r => r.errors);
  return { valid: errors.length === 0, errors };
}
