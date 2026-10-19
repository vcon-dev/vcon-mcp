import type { DistinctValuesResult } from '../db/interfaces.js';
import type { Analysis, Attachment, VCon } from '../types/vcon.js';

export interface DiscoveryValue {
  value: string;
  count?: number;
}

export function toDiscoveryValues(result: DistinctValuesResult): DiscoveryValue[] {
  return result.values.map((value) => ({
    value,
    ...(result.countsPerValue && result.countsPerValue[value] !== undefined
      ? { count: result.countsPerValue[value] }
      : {}),
  }));
}

export function getVConMetadata(vcon: VCon): Record<string, unknown> {
  const metadata = { ...(vcon as unknown as Record<string, unknown>) };
  delete (metadata as any).parties;
  delete (metadata as any).dialog;
  delete (metadata as any).analysis;
  delete (metadata as any).attachments;
  return metadata;
}

export function filterAttachments(
  vcon: VCon,
  filters: {
    type?: string;
    purpose?: string;
  } = {},
): Attachment[] {
  return (vcon.attachments || []).filter((attachment) => {
    if (filters.type && attachment.type !== filters.type) {
      return false;
    }
    if (filters.purpose && attachment.purpose !== filters.purpose) {
      return false;
    }
    return true;
  });
}

export function filterAnalysis(
  vcon: VCon,
  filters: {
    type?: string;
  } = {},
): Analysis[] {
  return (vcon.analysis || []).filter((analysis) => {
    if (filters.type && analysis.type !== filters.type) {
      return false;
    }
    return true;
  });
}

/**
 * Tags attachment predicate. vCon 0.4.0 classifies attachments with `purpose`;
 * older data (and this server's own legacy writes) used `type`. Either marks
 * the tags attachment.
 */
export function isTagsAttachment(attachment: Attachment): boolean {
  return attachment.type === 'tags' || attachment.purpose === 'tags';
}

/**
 * Parse a tags attachment body into a key/value object.
 *
 * Two shapes exist in the wild and both are accepted:
 *  - `["key:value", ...]` — what this server writes (CLAUDE.md "Tags Storage")
 *  - `{"key": "value", ...}` — a flat JSON object, produced by external
 *    ingest pipelines. Before this was handled, 10k+ such vCons read back as
 *    zero tags, silently.
 *
 * Non-string scalar values are stringified and nulls dropped, mirroring what
 * `jsonb_each_text` does for vcon_tags_mv, so SQL and TS agree.
 */
export function parseTagsBody(body: unknown): Record<string, string> {
  if (body === undefined || body === null || body === '') return {};

  let parsed: unknown;
  try {
    parsed = typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return {};
  }

  const tags: Record<string, string> = {};

  if (Array.isArray(parsed)) {
    for (const tag of parsed) {
      if (typeof tag !== 'string') continue;
      const colonIndex = tag.indexOf(':');
      if (colonIndex <= 0) continue;
      tags[tag.slice(0, colonIndex)] = tag.slice(colonIndex + 1);
    }
    return tags;
  }

  if (parsed !== null && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key || value === null || value === undefined) continue;
      tags[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
  }

  return tags;
}

export function extractTags(vcon: VCon): Record<string, string> {
  const tagsAttachment = (vcon.attachments || []).find(isTagsAttachment);
  return parseTagsBody(tagsAttachment?.body);
}

/** Starts before this are placeholders (1970 epoch defaults and the like), not conversation times. */
const PLAUSIBLE_START_MS = Date.parse('1990-01-01T00:00:00Z');

/** Earliest plausible start among `values`, returned as stored; undefined if none. */
function earliestStart(values: unknown[]): { value: string; ms: number } | undefined {
  let best: { value: string; ms: number } | undefined;
  for (const value of values) {
    if (typeof value !== 'string' || value === '') continue;
    const ms = Date.parse(value);
    if (Number.isNaN(ms) || ms < PLAUSIBLE_START_MS) continue;
    if (!best || ms < best.ms) best = { value, ms };
  }
  return best;
}

/**
 * When the conversation happened. Same rule as the vcons.conversation_start
 * column (migration 20261019171238), computed from the loaded vCon so it needs
 * no extra query and no migration:
 *
 *   1. earliest plausible dialog[].start, if any
 *   2. else earliest plausible attachments[].start, capped at created_at
 *      (some libraries stamp attachment start with the write time)
 *   3. else created_at
 *
 * Starts before 1990-01-01 and unparseable values are ignored. The winning
 * value is returned as stored.
 */
export function conversationStartOf(vcon: VCon): string | undefined {
  const dialog = earliestStart((vcon.dialog ?? []).map(d => d?.start));
  if (dialog) return dialog.value;
  const attachment = earliestStart((vcon.attachments ?? []).map(a => a?.start));
  if (!attachment) return vcon.created_at;
  const createdMs = vcon.created_at ? Date.parse(vcon.created_at) : NaN;
  if (!Number.isNaN(createdMs) && createdMs < attachment.ms) return vcon.created_at;
  return attachment.value;
}
