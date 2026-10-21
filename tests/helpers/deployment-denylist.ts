import { createHash } from 'crypto';

/**
 * SHA-256 digests of lowercase organisation names that must never appear in
 * public tool descriptions or default tool output. Stored as hashes so the guard
 * itself does not put the names back into the public repo.
 * Extra plain terms can be supplied at run time via VCON_TEST_DENYLIST (comma-separated).
 */
const DENYLIST_SHA256 = new Set([
  '828bd72b9b63f8421c18979b2725558e415612cec6dcbea526e211fa9239ea19',
  '3117827c4cabf166aa517d27d110547561ff486a1bc6df3071b79c0a8ec08b4d',
]);

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Return the tokens of `text` that match the denylist (hashed or env-supplied). */
export function findDeniedTerms(text: string): string[] {
  const extra = (process.env.VCON_TEST_DENYLIST || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const lower = text.toLowerCase();
  const tokens = new Set(lower.split(/[^a-z0-9]+/).filter(Boolean));
  const hits = [...tokens].filter((token) => DENYLIST_SHA256.has(sha256(token)));
  for (const term of extra) {
    if (lower.includes(term)) hits.push(term);
  }
  return hits;
}
