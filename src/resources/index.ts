/**
 * vCon MCP Resources
 * 
 * Resources provide simple, discoverable access to vCon data.
 * For complex operations, use tools instead:
 * 
 * - Filter by tags: use 'search_by_tags' tool
 * - Complex searches: use 'search_vcons' tool
 * - Keyword search: use 'search_vcons_content' tool
 * - Semantic search: use 'search_vcons_semantic' tool
 * - Custom ordering/filtering: use tools with parameters
 * 
 * Resources are optimized for:
 * - Browsing recent conversations
 * - Fetching specific vCons by UUID
 * - Lightweight ID-only discovery
 */

import { IVConQueries } from '../db/interfaces.js';
import {
  extractTags,
  filterAnalysis,
  filterAttachments,
  getVConMetadata,
  toDiscoveryValues,
} from '../utils/read-surfaces.js';

export interface ResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export function getCoreResources(): ResourceDescriptor[] {
  return [
    // Collection resources
    { 
      uri: 'vcon://v1/vcons/recent', 
      name: 'Get recent vCons', 
      description: 'Retrieve the most recently created vCons with full data. Default limit is 10. For custom limit use "vcon://v1/vcons/recent/25" (max 100). For complex filtering use search_vcons or search_by_tags tools.',
      mimeType: 'application/json' 
    },
    { 
      uri: 'vcon://v1/vcons/recent/ids', 
      name: 'Get recent vCon IDs', 
      description: 'Retrieve just the UUIDs, timestamps, and subjects of recent vCons for efficient browsing. Default limit is 10. For custom limit use "vcon://v1/vcons/recent/ids/25" (max 100).',
      mimeType: 'application/json' 
    },
    { 
      uri: 'vcon://v1/vcons/ids', 
      name: 'List all vCon IDs', 
      description: 'Browse all vCon IDs with timestamps and subjects using cursor-based pagination. Default limit is 100. Use "vcon://v1/vcons/ids/500" for custom limit (max 1000). For next page use "vcon://v1/vcons/ids/100/after/{timestamp}" with next_cursor from response.',
      mimeType: 'application/json' 
    },
    
    // Entity core resource
    { 
      uri: 'vcon://v1/vcons/{uuid}', 
      name: 'Get vCon by UUID', 
      description: 'Retrieve a complete vCon object by UUID. Replace {uuid} with actual UUID. Access nested fields (parties, dialog, attachments, analysis) directly from the returned object.',
      mimeType: 'application/json' 
    },
    
    // Entity subresources
    { 
      uri: 'vcon://v1/vcons/{uuid}/metadata', 
      name: 'Get vCon metadata', 
      description: 'Retrieve only metadata fields (excludes parties, dialog, analysis, attachments arrays). Use when you only need basic vCon info without conversation content.',
      mimeType: 'application/json' 
    },
    { 
      uri: 'vcon://v1/vcons/{uuid}/parties', 
      name: 'Get vCon parties', 
      description: 'Retrieve only the parties array from a vCon. Returns the list of conversation participants.',
      mimeType: 'application/json' 
    },
    { 
      uri: 'vcon://v1/vcons/{uuid}/dialog', 
      name: 'Get vCon dialog', 
      description: 'Retrieve only the dialog array from a vCon. Returns all conversation exchanges and recordings.',
      mimeType: 'application/json' 
    },
    { 
      uri: 'vcon://v1/vcons/{uuid}/analysis', 
      name: 'Get vCon analysis', 
      description: 'Retrieve only the analysis array from a vCon. Returns all AI/ML analysis results.',
      mimeType: 'application/json' 
    },
    { 
      uri: 'vcon://v1/vcons/{uuid}/attachments', 
      name: 'Get vCon attachments', 
      description: 'Retrieve only the attachments array from a vCon. Returns all attached files and metadata.',
      mimeType: 'application/json' 
    },

    // Discovery resources
    {
      uri: 'vcon://v1/discovery/attachments/types',
      name: 'Discover legacy attachment types',
      description: 'List discovered legacy attachment type values across the database, with counts. Prefer attachment purposes for spec-compliant discovery; use types only for compatibility with older datasets.',
      mimeType: 'application/json'
    },
    {
      uri: 'vcon://v1/discovery/attachments/purposes',
      name: 'Discover attachment purposes',
      description: 'List discovered attachment purpose values across the database, with counts. This is the canonical spec-facing attachment classification surface; prefer it before tags or legacy attachment types.',
      mimeType: 'application/json'
    },
    {
      uri: 'vcon://v1/discovery/analysis/types',
      name: 'Discover analysis types',
      description: 'List discovered analysis type values across the database, with counts. Use this before reading a vCon by analysis type.',
      mimeType: 'application/json'
    },
    {
      uri: 'vcon://v1/graph/shape',
      name: 'vCon shape graph (OSS)',
      description:
        'Default corpus-level graph from vCon structure only: analysis types, attachment purposes, legacy attachment types without purpose, tag keys, and bounded co-occurrence edges (analysis type with attachment purpose). No business ontology. Prefer this resource after vcon_capabilities when teaching an LLM what evidence exists in the corpus.',
      mimeType: 'application/json'
    },

    // Generic filtered resources
    {
      uri: 'vcon://v1/vcons/{uuid}/attachments/type/{type}',
      name: 'Get attachments by legacy type',
      description: 'Retrieve attachments on a vCon filtered by legacy attachment type. Prefer the purpose-based resource for spec-compliant clients and use this type-based path only for compatibility with older data.',
      mimeType: 'application/json'
    },
    {
      uri: 'vcon://v1/vcons/{uuid}/attachments/purpose/{purpose}',
      name: 'Get attachments by purpose',
      description: 'Retrieve attachments on a vCon filtered by attachment purpose. This is the canonical spec-facing attachment read path; replace {purpose} with a discovered attachment purpose value.',
      mimeType: 'application/json'
    },
    {
      uri: 'vcon://v1/vcons/{uuid}/analysis/type/{type}',
      name: 'Get analysis by type',
      description: 'Retrieve analysis entries on a vCon filtered by analysis type. Replace {type} with a discovered analysis type value.',
      mimeType: 'application/json'
    },
    
    // Derived resources
    { 
      uri: 'vcon://v1/vcons/{uuid}/transcript', 
      name: 'Get vCon transcript', 
      description: 'Retrieve transcript analysis from a vCon. Filters analysis array for type="transcript" and returns matching entries.',
      mimeType: 'application/json' 
    },
    { 
      uri: 'vcon://v1/vcons/{uuid}/summary', 
      name: 'Get vCon summary', 
      description: 'Retrieve summary analysis from a vCon. Filters analysis array for type="summary" and returns matching entries.',
      mimeType: 'application/json' 
    },
    { 
      uri: 'vcon://v1/vcons/{uuid}/tags', 
      name: 'Get vCon tags', 
      description: 'Retrieve tags from a vCon. Filters attachments for type="tags", parses the body, and returns as a key-value object.',
      mimeType: 'application/json' 
    },
  ];
}

export async function resolveCoreResource(queries: IVConQueries, uri: string): Promise<{ mimeType: string; content: any } | undefined> {
  const json = (data: any) => ({ mimeType: 'application/json', content: data });

  if (uri === 'vcon://v1/discovery/attachments/types') {
    const result = await queries.getUniqueAttachmentTypes({ includeCounts: true });
    return json({
      count: result.values.length,
      attachment_types: toDiscoveryValues(result),
    });
  }

  if (uri === 'vcon://v1/discovery/attachments/purposes') {
    const result = await queries.getUniqueAttachmentPurposes({ includeCounts: true });
    return json({
      count: result.values.length,
      attachment_purposes: toDiscoveryValues(result),
    });
  }

  if (uri === 'vcon://v1/discovery/analysis/types') {
    const result = await queries.getUniqueAnalysisTypes({ includeCounts: true });
    return json({
      count: result.values.length,
      analysis_types: toDiscoveryValues(result),
    });
  }

  if (uri === 'vcon://v1/graph/shape') {
    const graph = await queries.getVconShapeGraph();
    return json(graph);
  }

  // Handle recent vCons (full data)
  const matchRecent = uri.match(/^vcon:\/\/v1\/vcons\/recent(?:\/(\d+))?$/);
  if (matchRecent) {
    const limit = matchRecent[1] ? Math.min(parseInt(matchRecent[1], 10), 100) : 10;
    const vcons = await queries.searchVCons({ limit });
    return json({ 
      count: vcons.length, 
      limit: limit,
      vcons: vcons 
    });
  }

  // Handle recent vCon IDs (lightweight)
  const matchRecentIds = uri.match(/^vcon:\/\/v1\/vcons\/recent\/ids(?:\/(\d+))?$/);
  if (matchRecentIds) {
    const limit = matchRecentIds[1] ? Math.min(parseInt(matchRecentIds[1], 10), 100) : 10;
    const vcons = await queries.searchVCons({ limit });
    const ids = vcons.map(v => ({ 
      uuid: v.uuid, 
      created_at: v.created_at,
      subject: v.subject 
    }));
    return json({ 
      count: ids.length, 
      limit: limit,
      vcons: ids 
    });
  }

  // Handle list all IDs with cursor-based pagination
  const matchListIds = uri.match(/^vcon:\/\/v1\/vcons\/ids(?:\/(\d+))?(?:\/after\/([^/]+))?$/);
  if (matchListIds) {
    const limit = matchListIds[1] ? Math.min(parseInt(matchListIds[1], 10), 1000) : 100;
    const afterTimestamp = matchListIds[2] ? decodeURIComponent(matchListIds[2]) : undefined;
    
    // Fetch one extra to determine if there are more results
    const fetchLimit = limit + 1;
    const vcons = await queries.searchVCons({ 
      limit: fetchLimit,
      startDate: afterTimestamp ? new Date(new Date(afterTimestamp).getTime() + 1).toISOString() : undefined
    });
    
    // Check if there are more results
    const hasMore = vcons.length > limit;
    const resultsToReturn = hasMore ? vcons.slice(0, limit) : vcons;
    
    const ids = resultsToReturn.map(v => ({ 
      uuid: v.uuid, 
      created_at: v.created_at,
      subject: v.subject 
    }));
    
    // Get the last timestamp for next cursor
    const nextCursor = resultsToReturn.length > 0 
      ? resultsToReturn[resultsToReturn.length - 1].created_at 
      : null;
    
    return json({ 
      count: ids.length, 
      limit: limit,
      has_more: hasMore,
      next_cursor: hasMore ? nextCursor : null,
      vcons: ids 
    });
  }

  // Handle UUID-based resources
  const matchUuid = uri.match(/^vcon:\/\/v1\/vcons\/([0-9a-f\-]{36})(.*)$/i);
  if (!matchUuid) return undefined;
  const uuid = matchUuid[1];
  const suffix = matchUuid[2] || '';

  const vcon = await queries.getVCon(uuid);

  // Full vCon
  if (suffix === '' || suffix === '/') {
    return json(vcon);
  }

  // Metadata (excludes arrays)
  if (suffix === '/metadata') {
    return json(getVConMetadata(vcon));
  }

  // Subresources - return specific arrays
  if (suffix === '/parties') {
    return json({ parties: vcon.parties || [] });
  }

  if (suffix === '/dialog') {
    return json({ dialog: vcon.dialog || [] });
  }

  if (suffix === '/analysis') {
    return json({ analysis: vcon.analysis || [] });
  }

  if (suffix === '/attachments') {
    return json({ attachments: vcon.attachments || [] });
  }

  const matchAttachmentType = suffix.match(/^\/attachments\/type\/(.+)$/);
  if (matchAttachmentType) {
    const type = decodeURIComponent(matchAttachmentType[1]);
    const attachments = filterAttachments(vcon, { type });
    return json({
      count: attachments.length,
      type,
      attachments,
    });
  }

  const matchAttachmentPurpose = suffix.match(/^\/attachments\/purpose\/(.+)$/);
  if (matchAttachmentPurpose) {
    const purpose = decodeURIComponent(matchAttachmentPurpose[1]);
    const attachments = filterAttachments(vcon, { purpose });
    return json({
      count: attachments.length,
      purpose,
      attachments,
    });
  }

  const matchAnalysisType = suffix.match(/^\/analysis\/type\/(.+)$/);
  if (matchAnalysisType) {
    const type = decodeURIComponent(matchAnalysisType[1]);
    const analysis = filterAnalysis(vcon, { type });
    return json({
      count: analysis.length,
      type,
      analysis,
    });
  }

  // Derived resources - filter by type
  if (suffix === '/transcript') {
    const transcripts = filterAnalysis(vcon, { type: 'transcript' });
    return json({ 
      count: transcripts.length,
      transcripts: transcripts 
    });
  }

  if (suffix === '/summary') {
    const summaries = filterAnalysis(vcon, { type: 'summary' });
    return json({ 
      count: summaries.length,
      summaries: summaries 
    });
  }

  if (suffix === '/tags') {
    return json({ tags: extractTags(vcon) });
  }

  // Unknown subresource
  return undefined;
}


