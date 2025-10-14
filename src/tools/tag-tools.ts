/**
 * Tag Management Tools for vCons
 * 
 * Tags in vCon are key-value pairs stored as a special attachment:
 * - type: "tags"
 * - encoding: "json"
 * - body: ["key:value", "key2:value2", ...]
 * 
 * Tags provide simple, flexible metadata for categorization, filtering, and organization.
 */

/**
 * Tool: Add or Update Tag
 */
export const addTagTool = {
  name: 'add_tag',
  description: 'Add or update a tag on a vCon. Tags are key-value pairs for categorization and filtering. ' +
    'If the tag key already exists, it will be updated unless overwrite is set to false.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to add/update tag on',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      key: {
        type: 'string',
        description: 'Tag key/name (e.g., "department", "priority", "customer_id")'
      },
      value: {
        type: ['string', 'number', 'boolean'],
        description: 'Tag value (will be converted to string)'
      },
      overwrite: {
        type: 'boolean',
        description: 'Whether to overwrite existing tag with same key (default: true)',
        default: true
      }
    },
    required: ['vcon_uuid', 'key', 'value']
  }
};

/**
 * Tool: Get Tag Value
 */
export const getTagTool = {
  name: 'get_tag',
  description: 'Retrieve the value of a specific tag from a vCon.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to retrieve tag from',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      key: {
        type: 'string',
        description: 'Tag key to retrieve'
      },
      default_value: {
        type: ['string', 'number', 'boolean', 'null'],
        description: 'Value to return if tag does not exist (default: null)'
      }
    },
    required: ['vcon_uuid', 'key']
  }
};

/**
 * Tool: Get All Tags
 */
export const getAllTagsTool = {
  name: 'get_all_tags',
  description: 'Retrieve all tags from a vCon as a key-value object.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to retrieve tags from',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      }
    },
    required: ['vcon_uuid']
  }
};

/**
 * Tool: Remove Tag
 */
export const removeTagTool = {
  name: 'remove_tag',
  description: 'Remove a specific tag from a vCon.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to remove tag from',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      key: {
        type: 'string',
        description: 'Tag key to remove'
      }
    },
    required: ['vcon_uuid', 'key']
  }
};

/**
 * Tool: Update Multiple Tags
 */
export const updateTagsTool = {
  name: 'update_tags',
  description: 'Update multiple tags on a vCon at once. Can add new tags and update existing ones.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to update tags on',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      tags: {
        type: 'object',
        description: 'Object with tag key-value pairs. Example: {"department": "sales", "priority": "high"}',
        additionalProperties: {
          type: ['string', 'number', 'boolean']
        }
      },
      merge: {
        type: 'boolean',
        description: 'If true, merge with existing tags. If false, replace all tags (default: true)',
        default: true
      }
    },
    required: ['vcon_uuid', 'tags']
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
        description: 'Maximum number of results to return (default: 50)',
        minimum: 1,
        maximum: 100
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

// Export all tag tools as an array
export const allTagTools = [
  addTagTool,
  getTagTool,
  getAllTagsTool,
  removeTagTool,
  updateTagsTool,
  removeAllTagsTool,
  searchByTagsTool,
  getUniqueTagsTool
];

