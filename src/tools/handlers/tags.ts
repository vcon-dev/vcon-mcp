/**
 * Tag Management Tool Handlers
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BaseToolHandler, ToolHandlerContext, ToolResponse } from './base.js';
import { recordCounter } from '../../observability/instrumentation.js';
import { ATTR_SEARCH_TYPE } from '../../observability/attributes.js';
import { requireUUID, requireNonEmptyString } from './validation.js';

/**
 * Handler for manage_tag tool
 */
export class ManageTagHandler extends BaseToolHandler {
  readonly toolName = 'manage_tag';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const vconUuid = requireUUID(args?.vcon_uuid as string, 'vcon_uuid');
    const action = requireNonEmptyString(args?.action as string, 'action');
    const key = requireNonEmptyString(args?.key as string, 'key');
    const value = args?.value;
    
    if (action === 'set') {
      if (value === undefined || value === null) {
        throw new McpError(ErrorCode.InvalidParams, 'value is required when action is "set"');
      }
      await context.queries.addTag(vconUuid, key, value as string | number | boolean, true);
      return this.createSuccessResponse({
        message: `Tag '${key}' set on vCon ${vconUuid}`,
        action: 'set',
        key: key,
        value: String(value)
      });
    } else if (action === 'remove') {
      await context.queries.removeTag(vconUuid, key);
      return this.createSuccessResponse({
        message: `Tag '${key}' removed from vCon ${vconUuid}`,
        action: 'remove',
        key: key
      });
    } else {
      throw new McpError(ErrorCode.InvalidParams, 'action must be "set" or "remove"');
    }
  }
}

/**
 * Handler for get_tags tool
 */
export class GetTagsHandler extends BaseToolHandler {
  readonly toolName = 'get_tags';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const vconUuid = requireUUID(args?.vcon_uuid as string, 'vcon_uuid');
    const key = args?.key as string | undefined;
    const defaultValue = args?.default_value;
    
    if (key) {
      // Get single tag
      const value = await context.queries.getTag(vconUuid, key, defaultValue);
      const exists = value !== defaultValue;
      return this.createSuccessResponse({
        key: key,
        value: value,
        exists: exists
      });
    } else {
      // Get all tags
      const tags = await context.queries.getTags(vconUuid);
      return this.createSuccessResponse({
        vcon_uuid: vconUuid,
        tags: tags,
        count: Object.keys(tags).length
      });
    }
  }
}

/**
 * Handler for remove_all_tags tool
 */
export class RemoveAllTagsHandler extends BaseToolHandler {
  readonly toolName = 'remove_all_tags';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const vconUuid = requireUUID(args?.vcon_uuid as string, 'vcon_uuid');

    await context.queries.removeAllTags(vconUuid);

    return this.createSuccessResponse({
      message: `All tags removed from vCon ${vconUuid}`
    });
  }
}

/**
 * Handler for search_by_tags tool
 */
export class SearchByTagsHandler extends BaseToolHandler {
  readonly toolName = 'search_by_tags';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    // Validate tags parameter with detailed error message
    const tagsValue = args?.tags;
    if (tagsValue === undefined || tagsValue === null) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'tags is required. Expected an object like {"key": "value"}. ' +
        `Received: ${tagsValue === undefined ? 'undefined' : 'null'}. ` +
        'Example: {"department": "sales", "priority": "high"}'
      );
    }
    
    const tags = tagsValue as Record<string, string>;
    const limit = (args?.limit as number | undefined) || 50;
    const returnFullVCons = args?.return_full_vcons as boolean | undefined;
    const maxFullVCons = (args?.max_full_vcons as number | undefined) || 20;

    if (typeof tags !== 'object' || Array.isArray(tags)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `tags must be an object, not ${Array.isArray(tags) ? 'an array' : typeof tags}. ` +
        'Example: {"department": "sales", "priority": "high"}'
      );
    }
    
    if (Object.keys(tags).length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'tags must have at least one key-value pair. Example: {"department": "sales"}'
      );
    }

    const vconUuids = await context.queries.searchByTags(tags, limit);

    // Determine if we should return full vCons
    const shouldReturnFull = returnFullVCons ?? (vconUuids.length <= 20);
    
    // Limit number of full vCons to prevent size issues
    const numFullVCons = shouldReturnFull 
      ? Math.min(vconUuids.length, maxFullVCons)
      : 0;

    let fullVCons: any[] = [];
    if (numFullVCons > 0) {
      fullVCons = await Promise.all(
        vconUuids.slice(0, numFullVCons).map(uuid => context.queries.getVCon(uuid))
      );
    }

    recordCounter('vcon.search.count', 1, {
      [ATTR_SEARCH_TYPE]: 'tags',
    }, 'vCon search count');
    
    const response: any = {
      success: true,
      count: vconUuids.length,
      tags_searched: tags,
      vcon_uuids: vconUuids,
    };

    if (numFullVCons > 0) {
      response.vcons = fullVCons;
      if (numFullVCons < vconUuids.length) {
        response.message = `Returned ${numFullVCons} full vCon objects (out of ${vconUuids.length} total matches). Use get_vcon to fetch individual vCons by UUID.`;
      }
    } else {
      response.message = `Found ${vconUuids.length} matching vCons. Use get_vcon to fetch individual vCons by UUID, or set return_full_vcons=true to get full objects (limited to ${maxFullVCons} for large result sets).`;
    }

    return this.createTextResponse(response);
  }
}

/**
 * Handler for get_unique_tags tool
 */
export class GetUniqueTagsHandler extends BaseToolHandler {
  readonly toolName = 'get_unique_tags';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const includeCounts = (args?.include_counts as boolean | undefined) ?? false;
    const keyFilter = args?.key_filter as string | undefined;
    const minCount = (args?.min_count as number | undefined) ?? 1;

    const uniqueTagsResult = await context.queries.getUniqueTags({
      includeCounts,
      keyFilter,
      minCount
    });

    return this.createSuccessResponse({
      unique_keys: uniqueTagsResult.keys,
      unique_key_count: uniqueTagsResult.keys.length,
      tags_by_key: uniqueTagsResult.tagsByKey,
      counts_per_value: uniqueTagsResult.countsPerValue,
      total_vcons_with_tags: uniqueTagsResult.totalVCons,
      summary: {
        total_unique_keys: uniqueTagsResult.keys.length,
        total_vcons: uniqueTagsResult.totalVCons,
        filter_applied: keyFilter ? true : false,
        min_count_filter: minCount
      }
    });
  }
}

