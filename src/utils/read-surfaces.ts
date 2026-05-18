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

export function extractTags(vcon: VCon): Record<string, string> {
  const tagsAttachment = filterAttachments(vcon, { type: 'tags' })[0];
  if (!tagsAttachment || tagsAttachment.body === undefined || tagsAttachment.body === null) {
    return {};
  }

  try {
    const parsed =
      typeof tagsAttachment.body === 'string'
        ? JSON.parse(tagsAttachment.body)
        : tagsAttachment.body;
    const tagsArray = Array.isArray(parsed) ? parsed : [];
    const tagsObject: Record<string, string> = {};

    for (const tag of tagsArray) {
      if (typeof tag !== 'string') continue;
      const colonIndex = tag.indexOf(':');
      if (colonIndex <= 0) continue;
      tagsObject[tag.slice(0, colonIndex)] = tag.slice(colonIndex + 1);
    }

    return tagsObject;
  } catch {
    return {};
  }
}
