/**
 * Tag Management Tools for vCons (Streamlined)
 * 
 * Tags in vCon are key-value pairs stored as a special attachment:
 * - type: "tags"
 * - encoding: "json"
 * - body: ["key:value", "key2:value2", ...]
 * 
 * Tags provide simple, flexible metadata for categorization, filtering, and organization.
 * 
 * Consolidated from 8 tools to 5 tools for simpler API.
 */

/**
 * Tool: Manage Tag (replaces add_tag, update_tags, remove_tag)
 */
export const manageTagTool = {
  name: 'manage_tag',
  description: 'Add, update, or remove a single tag on a vCon. Tags are key-value pairs for categorization and filtering. ' +
    'Use action "set" to add/update a tag, or "remove" to delete it.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      action: {
        type: 'string',
        description: 'Action to perform: "set" to add/update tag, "remove" to delete tag',
        enum: ['set', 'remove']
      },
      key: {
        type: 'string',
        description: 'Tag key/name (e.g., "department", "priority", "customer_id")'
      },
      value: {
        oneOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' }
        ],
        description: 'Tag value (required when action is "set", will be converted to string)'
      }
    },
    required: ['vcon_uuid', 'action', 'key']
  }
};

/**
 * Tool: Get Tags (replaces get_tag, get_all_tags)
 */
export const getTagsTool = {
  name: 'get_tags',
  description: 'Retrieve tags from a vCon. Provide a specific key to get one tag value, or omit key to get all tags as an object.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to retrieve tags from',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      key: {
        type: 'string',
        description: 'Specific tag key to retrieve. Omit this parameter to get all tags as an object.'
      },
      default_value: {
        oneOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' }
        ],
        description: 'Value to return if the specified tag key does not exist (only used when key is provided, default: null)',
        default: null
      }
    },
    required: ['vcon_uuid']
  }
};

/**
 * Tool: Remove All Tags
 */
export const removeAllTagsTool = {
  name: 'remove_all_tags',
  description: 'Remove all tags from a vCon.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to remove all tags from',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      }
    },
    required: ['vcon_uuid']
  }
};

/**
 * Tool: Search by Tags
 */
export const searchByTagsTool = {
  name: 'search_by_tags',
  description: 'Search for vCons that have specific tag values. All specified tags must match (AND logic).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      tags: {
        type: 'object',
        description: 'Tag key-value pairs to search for. Example: {"department": "sales", "priority": "high"}',
        additionalProperties: { type: 'string' }
      },
      limit: {
        type: 'number',
        description: 'Maximum number of UUIDs to return (default: 50)',
        minimum: 1,
        maximum: 100,
        default: 50
      },
      return_full_vcons: {
        type: 'boolean',
        description: 'If true, return full vCon objects. For large result sets, only first 20 full vCons are returned to prevent size limits. Default: false for result sets > 20, true for smaller sets.',
        default: false
      },
      max_full_vcons: {
        type: 'number',
        description: 'Maximum number of full vCon objects to return when return_full_vcons is true (default: 20). Prevents response size issues.',
        minimum: 1,
        maximum: 50,
        default: 20
      }
    },
    required: ['tags']
  }
};

/**
 * Tool: Get Unique Tags
 */
export const getUniqueTagsTool = {
  name: 'get_unique_tags',
  description: 'Get a list of all unique tag keys and their possible values across all vCons. ' +
    'Useful for discovering available tags, building tag selection UIs, and analytics.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      include_counts: {
        type: 'boolean',
        description: 'Include count of vCons for each tag value (default: false)',
        default: false
      },
      key_filter: {
        type: 'string',
        description: 'Only return tags with keys matching this pattern (case-insensitive substring match)'
      },
      min_count: {
        type: 'number',
        description: 'Only return tag values that appear at least this many times (default: 1)',
        minimum: 1,
        default: 1
      }
    }
  }
};

// Export all tag tools as an array (consolidated from 8 to 5)
export const allTagTools = [
  manageTagTool,
  getTagsTool,
  removeAllTagsTool,
  searchByTagsTool,
  getUniqueTagsTool
];

