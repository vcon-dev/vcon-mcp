// Pure helper (no Deno-only imports) so vitest can import it.
// A failed lookup query must surface as an error, never as "nothing left to embed".

export interface LookupResult<T> {
  data: unknown;
  error: { message?: string } | null;
}

export class LookupError extends Error {
  constructor(public readonly messages: string[]) {
    super(`lookup query failed: ${messages.join("; ")}`);
    this.name = "LookupError";
  }
}

// Merge the lookup results. Throws LookupError if any query errored.
export function collectTextUnits<T>(results: LookupResult<T>[], limit: number): T[] {
  const messages = results
    .filter((r) => r.error)
    .map((r) => r.error?.message ?? "unknown error");
  if (messages.length > 0) throw new LookupError(messages);

  const units: T[] = [];
  for (const r of results) {
    if (Array.isArray(r.data)) units.push(...(r.data as T[]));
  }
  return units.slice(0, limit);
}
