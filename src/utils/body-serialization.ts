/**
 * Body serialization utilities for vCon TEXT columns.
 *
 * Write: a string body is stored verbatim; any other non-null body (object,
 * array, number, boolean) is stored as its JSON text, whatever the
 * encoding. Whether the original was a string is recorded by the row builders
 * (see SHAPE_KEY in db/batch-writer.ts), since the TEXT column cannot say.
 *
 * Legacy read (rows without a shape hint):
 *   'none' or unset  – JSON.parse when the text parses, else the string.
 *   'json'           – returned as stored.
 *   'base64url'      – returned as stored.
 */

export function serializeBody(body: unknown): unknown {
  if (body === undefined || body === null || typeof body === 'string') return body;
  return JSON.stringify(body);
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
