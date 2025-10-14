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

import { VConQueries } from '../db/queries.js';

export interface ResourceDescriptor {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export function getCoreResources(): ResourceDescriptor[] {
  return [
    { 
      uri: 'vcon://recent', 
      name: 'Get recent vCons', 
      description: 'Retrieve the most recently created vCons with full data. Default limit is 10. For custom limit use "vcon://recent/25" (max 100). For complex filtering use search_vcons or search_by_tags tools.',
      mimeType: 'application/json' 
    },
    { 
      uri: 'vcon://recent/ids', 
      name: 'Get recent vCon IDs', 
      description: 'Retrieve just the UUIDs, timestamps, and subjects of recent vCons for efficient browsing. Default limit is 10. For custom limit use "vcon://recent/ids/25" (max 100).',
      mimeType: 'application/json' 
    },
    { 
      uri: 'vcon://list/ids', 
      name: 'List all vCon IDs', 
      description: 'Browse all vCon IDs with timestamps and subjects using cursor-based pagination. Default limit is 100. Use "vcon://list/ids/500" for custom limit (max 1000). For next page use "vcon://list/ids/100/after/{timestamp}" with next_cursor from response.',
      mimeType: 'application/json' 
    },
    { 
      uri: 'vcon://uuid/{uuid}', 
      name: 'Get vCon by UUID', 
      description: 'Retrieve a complete vCon object by UUID. Replace {uuid} with actual UUID. Access nested fields (parties, dialog, attachments, analysis) directly from the returned object.',
      mimeType: 'application/json' 
    },
    { 
      uri: 'vcon://uuid/{uuid}/metadata', 
      name: 'Get vCon metadata', 
      description: 'Retrieve only metadata fields (excludes parties, dialog, analysis, attachments arrays). Use when you only need basic vCon info without conversation content.',
      mimeType: 'application/json' 
    },
  ];
}

export async function resolveCoreResource(queries: VConQueries, uri: string): Promise<{ mimeType: string; content: any } | undefined> {
  const json = (data: any) => ({ mimeType: 'application/json', content: data });

  // Handle recent vCons (full data)
  const matchRecent = uri.match(/^vcon:\/\/recent(?:\/(\d+))?$/);
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
  const matchRecentIds = uri.match(/^vcon:\/\/recent\/ids(?:\/(\d+))?$/);
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
  const matchListIds = uri.match(/^vcon:\/\/list\/ids(?:\/(\d+))?(?:\/after\/([^/]+))?$/);
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

  // Handle UUID-based resources (only full vCon and metadata)
  const matchUuid = uri.match(/^vcon:\/\/uuid\/([0-9a-f\-]{36})(.*)$/i);
  if (!matchUuid) return undefined;
  const uuid = matchUuid[1];
  const suffix = matchUuid[2] || '';

  const vcon = await queries.getVCon(uuid);

  if (suffix === '' || suffix === '/') {
    return json(vcon);
  }

  if (suffix === '/metadata') {
    const { parties, dialog, analysis, attachments, ...meta } = vcon as any;
    return json(meta);
  }

  // All other paths no longer supported
  return undefined;
}


