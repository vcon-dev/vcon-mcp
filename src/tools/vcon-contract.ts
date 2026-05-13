import type { ToolCategory } from '../config/tools.js';

const fetchIncludeValues = [
  'core',
  'parties',
  'summary',
  'tags',
  'dealer',
  'counts',
  'dialog',
  'analysis',
  'attachments',
] as const;

export const vconFetchTool = {
  name: 'vcon_fetch',
  category: 'read' as ToolCategory,
  description:
    'Fetch a single vCon using the redesigned stable envelope: {ok, item}. ' +
    'Use the include array to request only the fields you need. Default include is ["core", "parties", "summary"]. ' +
    'Available include values: core, parties, summary, tags, dealer, counts, dialog, analysis, attachments. ' +
    'Use include=["core","summary","dealer"] for lightweight Strolid browsing without loading full transcript payloads. ' +
    'The primary identifier in the returned item is always "id". ' +
    'Use vcon_capabilities to inspect supported include values and byte-budget defaults before calling. ' +
    'If the response would exceed max_response_bytes, the tool returns {ok:false,error:{code:"RESPONSE_TOO_LARGE",...}} instead of truncating the payload.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: {
        type: 'string',
        description: 'UUID of the vCon to fetch',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      include: {
        type: 'array',
        description:
          'Explicit field groups to include. Default: ["core", "parties", "summary"]. ' +
          'Use "dealer" to return the parsed strolid_dealer attachment only, and "tags" for parsed tag key/value pairs.',
        items: {
          type: 'string',
          enum: [...fetchIncludeValues],
        }
      },
      max_response_bytes: {
        type: 'number',
        description: 'Maximum allowed serialized response size in bytes before the tool returns RESPONSE_TOO_LARGE. Default: 250000.',
        minimum: 1024,
        default: 250000
      }
    },
    required: ['id']
  }
};

export const vconTaxonomyTool = {
  name: 'vcon_taxonomy',
  category: 'read' as ToolCategory,
  description:
    'Return domain guidance for building vCon clients against this dataset. ' +
    'Includes the portal taxonomy, common tag keys, sparse versus preferred fields, and attachment types such as strolid_dealer. ' +
    'Read this before designing "bad call" or dealer-aware experiences.',
  inputSchema: {
    type: 'object' as const,
    properties: {}
  }
};

export const vconCapabilitiesTool = {
  name: 'vcon_capabilities',
  category: 'read' as ToolCategory,
  description:
    'Describe the redesigned vCon contract surface for client builders. ' +
    'Returns supported include groups, search modes, pagination semantics, byte-budget defaults, and migration hints from legacy tools. ' +
    'Call this before building against vcon_fetch or vcon_search if you need discoverable limits and defaults.',
  inputSchema: {
    type: 'object' as const,
    properties: {}
  }
};

export const vconSearchTool = {
  name: 'vcon_search',
  category: 'read' as ToolCategory,
  description:
    'Search vCons through one stable list envelope: {ok, items, page}. ' +
    'Use mode="metadata" for filters-only browsing, mode="keyword" for full-text search, mode="semantic" for meaning-based search, and mode="hybrid" to combine keyword and semantic ranking. ' +
    'Default include is ["core", "summary"]. ' +
    'Use tags.portal with values like negative_experience, dnc_request, and bad_call_quality for upset-customer and bad-call views before falling back to semantic search. ' +
    'Use include=["core","summary","dealer"] to get summary text plus parsed strolid_dealer data without loading the full attachments payload. ' +
    'Use vcon_capabilities to inspect supported modes, includes, and byte budgets before calling. ' +
    'Pagination uses cursor, not offset. The cursor is opaque and should be passed back exactly as returned in page.next_cursor. ' +
    'If the response would exceed max_response_bytes, the tool returns RESPONSE_TOO_LARGE with narrowing suggestions.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      mode: {
        type: 'string',
        enum: ['metadata', 'keyword', 'semantic', 'hybrid'],
        description: 'Search behavior. Default: "metadata".',
        default: 'metadata'
      },
      query: {
        type: 'string',
        description: 'Free-text query for keyword, semantic, or hybrid search.'
      },
      embedding: {
        type: 'array',
        description: 'Optional precomputed embedding vector for semantic or hybrid search. Must be 384 dimensions when provided.',
        items: { type: 'number' }
      },
      tags: {
        type: 'object',
        description: 'Tag filters applied before ranking. Example: {"portal":"negative_experience"}.',
        additionalProperties: { type: 'string' }
      },
      filters: {
        type: 'object',
        description: 'Structured metadata filters for subject, dates, party fields, and strolid dealer attachment.',
        properties: {
          subject: { type: 'string' },
          start_date: { type: 'string' },
          end_date: { type: 'string' },
          party_name: { type: 'string' },
          party_email: { type: 'string' },
          party_tel: { type: 'string' },
          dealer_id: {
            type: 'string',
            description: 'Match strolid_dealer attachment id (use string form, for example "1174").',
          },
          dealer_name: {
            type: 'string',
            description: 'Case-insensitive substring match against strolid_dealer attachment name.',
          },
        }
      },
      include: {
        type: 'array',
        description: 'Field groups to include per result item. Default: ["core", "summary"].',
        items: {
          type: 'string',
          enum: [...fetchIncludeValues],
        }
      },
      limit: {
        type: 'number',
        description: 'Maximum number of items to return per page. Default: 25, max: 100.',
        minimum: 1,
        maximum: 100,
        default: 25
      },
      cursor: {
        type: 'string',
        description: 'Opaque cursor from a previous page.next_cursor value.'
      },
      max_response_bytes: {
        type: 'number',
        description: 'Maximum allowed serialized response size in bytes before the tool returns RESPONSE_TOO_LARGE. Default: 250000.',
        minimum: 1024,
        default: 250000
      },
      threshold: {
        type: 'number',
        description: 'Semantic similarity threshold for mode="semantic". Default: 0.7.',
        minimum: 0,
        maximum: 1,
        default: 0.7
      },
      semantic_weight: {
        type: 'number',
        description: 'Blend weight for semantic signals in mode="hybrid". Default: 0.6.',
        minimum: 0,
        maximum: 1,
        default: 0.6
      }
    }
  }
};

export const vconAggregateTool = {
  name: 'vcon_aggregate',
  category: 'read' as ToolCategory,
  description:
    'Server-side rollup for analyst questions such as top dealers by portal-tag rate. ' +
    'Groups vCons that carry a strolid_dealer attachment by dealer id, returning filtered_count (rows matching tags) and baseline_count (all rows in the group) so clients can divide for a rate in one round trip. ' +
    'Requires Postgres RPC aggregate_vcons_by_dealer_stats from the latest migration.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      group_by: {
        type: 'string',
        enum: ['dealer'],
        description: 'Only "dealer" is supported in this release.',
        default: 'dealer',
      },
      tags: {
        type: 'object',
        description: 'Tag filter for the numerator (same shape as vcon_search tags). Pass {} for baseline-only ranking.',
        additionalProperties: { type: 'string' },
      },
      filters: {
        type: 'object',
        description: 'Optional created_at window on vcons.created_at.',
        properties: {
          start_date: { type: 'string' },
          end_date: { type: 'string' },
        },
      },
      having: {
        type: 'object',
        description: 'Optional HAVING-style floor on baseline_count per dealer.',
        properties: {
          min_count: { type: 'number', minimum: 1, default: 1 },
        },
      },
      limit: {
        type: 'number',
        description: 'Maximum number of dealer rows to return. Default 20, max 500.',
        minimum: 1,
        maximum: 500,
        default: 20,
      },
    },
  },
};

export const describeResponseShapeTool = {
  name: 'describe_response_shape',
  category: 'read' as ToolCategory,
  description:
    'Describe the actual response shape for a tool as JSON Schema plus a concrete example. ' +
    'Use this before writing a client normalizer. Supports both redesigned tools and key legacy tools. ' +
    'If tool_name is omitted, returns the list of tools with published shape descriptors.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      tool_name: {
        type: 'string',
        description:
          'Tool name to describe. Supported values include vcon_fetch, vcon_capabilities, vcon_search, vcon_taxonomy, vcon_aggregate, describe_response_shape, get_vcon, search_vcons, search_by_tags, search_vcons_content, search_vcons_semantic, and search_vcons_hybrid.'
      },
      include_example: {
        type: 'boolean',
        description: 'Whether to include a concrete example payload in the response (default: true).',
        default: true
      }
    }
  }
};

export const allContractTools = [
  vconFetchTool,
  vconCapabilitiesTool,
  vconTaxonomyTool,
  vconSearchTool,
  vconAggregateTool,
  describeResponseShapeTool,
];
