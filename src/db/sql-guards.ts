/**
 * Input guards for SQL built as strings and run through the exec_sql RPC.
 *
 * exec_sql does not bind arbitrary parameters (it only substitutes :vcon_id
 * and :limit), so any caller-supplied value that ends up in one of those
 * strings must be reduced to a canonical, known-safe form first.
 */

/** Raised when a value cannot be safely placed into a SQL string. Maps to HTTP 400. */
export class SqlInputError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'SqlInputError';
  }
}

/**
 * Parse a date or timestamp and return it as a canonical ISO 8601 UTC string.
 * The output only contains digits, '-', ':', '.', 'T' and 'Z', so it is safe
 * inside a single-quoted SQL literal.
 */
export function toSqlTimestamp(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SqlInputError(`${name} must be an ISO 8601 date string`);
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    throw new SqlInputError(`${name} is not a valid date: ${JSON.stringify(value)}`);
  }
  return parsed.toISOString();
}

/** Accept only a real integer within [min, max]; return it as a number. */
export function toSqlInt(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new SqlInputError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/** Accept only a plain lowercase Postgres identifier (no quoting needed). */
export function toSqlIdentifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !IDENTIFIER_RE.test(value)) {
    throw new SqlInputError(`${name} must match ^[a-z_][a-z0-9_]*$ (max 63 chars)`);
  }
  return value;
}
