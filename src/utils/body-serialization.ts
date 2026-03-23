/**
 * Body serialization utilities for vCon TEXT columns.
 *
 * Encoding semantics:
 *   'none' or unset  – body is a native JS object/array; stringify on write, parse on read.
 *   'json'           – body is intentionally a JSON string; leave as-is.
 *   'base64url'      – body is a base64url string; leave as-is.
 */

export function serializeBody(body: unknown, encoding?: string): unknown {
  if ((!encoding || encoding === 'none') && typeof body !== 'string') {
    return JSON.stringify(body);
  }
  return body;
}

export function deserializeBody(body: string, encoding?: string): unknown {
  if (!encoding || encoding === 'none') {
    try {
      return JSON.parse(body);
    } catch {
      // Not valid JSON — return as-is
    }
  }
  return body;
}
