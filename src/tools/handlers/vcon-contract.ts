import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BaseToolHandler, ToolHandlerContext, ToolResponse } from './base.js';
import { VCon, Attachment, Analysis } from '../../types/vcon.js';
import { VCON_SHAPE_GRAPH_JSON_SCHEMA } from '../../types/vcon-shape-graph.js';
import { generateEmbedding } from '../../utils/embeddings.js';
import { normalizeDateString } from './validation.js';

const VALID_FETCH_INCLUDES = [
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

type FetchInclude = (typeof VALID_FETCH_INCLUDES)[number];

type SearchMode = 'metadata' | 'keyword' | 'semantic' | 'hybrid';

const DEFAULT_FETCH_INCLUDES: FetchInclude[] = ['core', 'parties', 'summary'];
const DEFAULT_SEARCH_INCLUDES: FetchInclude[] = ['core', 'summary'];
const DEFAULT_MAX_RESPONSE_BYTES = 250_000;
const MIN_MAX_RESPONSE_BYTES = 1024;
const SUPPORTED_SEARCH_MODES: SearchMode[] = ['metadata', 'keyword', 'semantic', 'hybrid'];
const TAG_SORTED_WINDOW = 100_000;

type CursorPayload = {
  offset: number;
};

type ShapeDescriptor = {
  tool_name: string;
  summary: string;
  response_schema: Record<string, unknown>;
  example: Record<string, unknown>;
  notes?: string[];
};

function normalizeIncludes(value: unknown): FetchInclude[] | { invalid: string[] } {
  if (value === undefined) return DEFAULT_FETCH_INCLUDES;
  if (!Array.isArray(value)) return { invalid: ['include must be an array of strings'] };

  const includes = value.map(String);
  const invalid = includes.filter((entry) => !VALID_FETCH_INCLUDES.includes(entry as FetchInclude));
  if (invalid.length > 0) return { invalid };

  if (includes.length === 0) return DEFAULT_FETCH_INCLUDES;
  return Array.from(new Set(includes)) as FetchInclude[];
}

function pickCore(vcon: VCon) {
  return {
    id: vcon.uuid,
    vcon_version: vcon.vcon ?? '0.4.0',
    created_at: vcon.created_at,
    updated_at: vcon.updated_at,
    subject: vcon.subject,
    extensions: vcon.extensions,
    critical: vcon.critical,
  };
}

function validateSearchMode(value: unknown): SearchMode {
  const mode = (value as string | undefined) || 'metadata';
  if (mode === 'metadata' || mode === 'keyword' || mode === 'semantic' || mode === 'hybrid') {
    return mode;
  }

  throw new McpError(ErrorCode.InvalidParams, `Unsupported search mode: ${mode}`);
}

function pickSummaryAnalysis(analysis: Analysis[] | undefined) {
  return (analysis || [])
    .filter((entry) => entry.type === 'summary')
    .map((entry) => ({
      type: entry.type,
      vendor: entry.vendor,
      product: entry.product,
      schema: entry.schema,
      encoding: entry.encoding,
      ...(typeof entry.body === 'string' && entry.body.trim().length > 0 ? { body: entry.body } : {}),
      dialog: entry.dialog,
    }));
}

function normalizeDealerTeam(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).length === 0) return null;
  return o;
}

function extractDealer(attachments: Attachment[] | undefined) {
  const dealerAttachment = (attachments || []).find((entry) => entry.type === 'strolid_dealer');
  if (!dealerAttachment) return null;

  let raw = dealerAttachment.body;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const dealer = raw as Record<string, unknown>;
  const idRaw = dealer.id;
  const idNormalized =
    idRaw === null || idRaw === undefined ? null : String(idRaw);

  return {
    id: idNormalized,
    name: dealer.name ?? null,
    outboundPhoneNumber: dealer.outboundPhoneNumber ?? null,
    team: normalizeDealerTeam(dealer.team),
  };
}

function estimateBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function parseMaxResponseBytes(value: unknown): number | { invalid: string } {
  if (value === undefined) return DEFAULT_MAX_RESPONSE_BYTES;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_MAX_RESPONSE_BYTES) {
    return {
      invalid: `max_response_bytes must be an integer >= ${MIN_MAX_RESPONSE_BYTES}`,
    };
  }

  return parsed;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): CursorPayload {
  if (!cursor) return { offset: 0 };

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
    if (typeof parsed.offset !== 'number' || !Number.isInteger(parsed.offset) || parsed.offset < 0) {
      throw new Error('offset must be a non-negative integer');
    }
    return parsed;
  } catch {
    throw new McpError(ErrorCode.InvalidParams, 'cursor is invalid or malformed');
  }
}

async function buildItem(
  context: ToolHandlerContext,
  vcon: VCon,
  include: FetchInclude[],
  extras?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const item: Record<string, unknown> = {
    ...pickCore(vcon),
  };

  if (include.includes('parties')) item.parties = vcon.parties || [];
  if (include.includes('summary')) item.summary = pickSummaryAnalysis(vcon.analysis);
  if (include.includes('dialog')) item.dialog = vcon.dialog || [];
  if (include.includes('analysis')) item.analysis = vcon.analysis || [];
  if (include.includes('attachments')) item.attachments = vcon.attachments || [];
  if (include.includes('dealer')) item.dealer = extractDealer(vcon.attachments);
  if (include.includes('counts')) {
    item.counts = {
      parties: vcon.parties?.length || 0,
      dialog: vcon.dialog?.length || 0,
      analysis: vcon.analysis?.length || 0,
      attachments: vcon.attachments?.length || 0,
    };
  }
  if (include.includes('tags')) {
    try {
      item.tags = await context.queries.getTags(vcon.uuid);
    } catch {
      item.tags = {};
    }
  }

  return {
    ...item,
    ...(extras || {}),
  };
}

function createTooLargeError(
  approximateBytes: number,
  maxResponseBytes: number,
  suggestions: string[],
) {
  return {
    code: 'RESPONSE_TOO_LARGE',
    message: `Response would be ${approximateBytes} bytes, exceeding the ${maxResponseBytes} byte budget.`,
    approximate_bytes: approximateBytes,
    max_response_bytes: maxResponseBytes,
    suggestions,
  };
}

const SHAPE_DESCRIPTORS: Record<string, ShapeDescriptor> = {
  vcon_fetch: {
    tool_name: 'vcon_fetch',
    summary: 'Stable single-item fetch with explicit include selectors and id-normalized payloads.',
    response_schema: {
      type: 'object',
      required: ['ok', 'item'],
      properties: {
        ok: { type: 'boolean', const: true },
        item: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            vcon_version: { type: 'string' },
            created_at: { type: 'string' },
            updated_at: { type: ['string', 'null'] },
            subject: { type: ['string', 'null'] },
            parties: { type: 'array' },
            summary: { type: 'array' },
            dealer: { type: ['object', 'null'] },
            tags: { type: 'object' },
          }
        },
        meta: {
          type: 'object',
          properties: {
            include: { type: 'array', items: { type: 'string' } },
            approximate_bytes: { type: 'number' }
          }
        }
      }
    },
    example: {
      ok: true,
      item: {
        id: '11111111-1111-1111-1111-111111111111',
        vcon_version: '0.4.0',
        created_at: '2026-05-11T14:00:00Z',
        subject: 'Upset customer call',
        parties: [{ name: 'Customer' }, { name: 'Agent' }],
        summary: [
          {
            type: 'summary',
            vendor: 'OpenAI',
            body: 'Customer reported a poor call experience and requested a follow-up.',
          }
        ],
        dealer: {
          id: 'dealer-42',
          name: 'Acme Motors',
          outboundPhoneNumber: '+15551234567',
          team: 'west'
        }
      },
      meta: {
        include: ['core', 'parties', 'summary', 'dealer'],
        approximate_bytes: 612
      }
    },
    notes: [
      'Use include=["core","summary","dealer"] to avoid loading full transcript attachments.',
      'The primary identifier is always item.id, not uuid or vcon_id.',
    ],
  },
  vcon_taxonomy: {
    tool_name: 'vcon_taxonomy',
    summary: 'Domain hints for portal categories, sparse tags, and preferred attachment sources.',
    response_schema: {
      type: 'object',
      required: ['ok', 'item'],
      properties: {
        ok: { type: 'boolean', const: true },
        item: {
          type: 'object',
          properties: {
            portal_values: { type: 'array' },
            common_tags: { type: 'array' },
            preferred_sources: { type: 'array' }
          }
        }
      }
    },
    example: {
      ok: true,
      item: {
        portal_values: [
          { value: 'negative_experience', description: 'Poor customer outcome or complaint.' },
          { value: 'dnc_request', description: 'Customer asked not to be contacted again.' },
          { value: 'bad_call_quality', description: 'Audio quality, latency, or connection issue.' }
        ],
        common_tags: [
          { key: 'portal', availability: 'preferred', description: 'Primary Strolid classification tag.' },
          { key: 'dealer_name', availability: 'sparse', description: 'Legacy dealer label. Prefer strolid_dealer attachment.' }
        ],
        preferred_sources: [
          { need: 'dealer info', source: 'attachment:strolid_dealer', fields: ['id', 'name', 'outboundPhoneNumber', 'team'] }
        ]
      }
    },
  },
  vcon_capabilities: {
    tool_name: 'vcon_capabilities',
    summary: 'Discoverable limits and supported options for the redesigned vCon tools.',
    response_schema: {
      type: 'object',
      required: ['ok', 'item'],
      properties: {
        ok: { type: 'boolean', const: true },
        item: {
          type: 'object',
          properties: {
            tools: { type: 'array' },
            shape_graph: { type: 'object' },
            response_budgeting: { type: 'object' },
            fetch: { type: 'object' },
            search: { type: 'object' },
            pagination: { type: 'object' },
          }
        }
      }
    },
    example: {
      ok: true,
      item: {
        tools: ['vcon_fetch', 'vcon_capabilities', 'vcon_graph_shape', 'vcon_search', 'vcon_taxonomy', 'vcon_aggregate', 'describe_response_shape'],
        shape_graph: {
          resource_uri: 'vcon://v1/graph/shape',
          tool: 'vcon_graph_shape',
          json_schema_id: 'https://vcon.dev/mcp/shape-graph/1-0-0',
          description:
            'Corpus-level shape graph (analysis types, attachment purposes, legacy types, tag keys). Prefer the MCP resource when available.',
        },
        response_budgeting: {
          default_max_response_bytes: 250000,
          minimum_max_response_bytes: 1024,
        },
        fetch: {
          default_include: ['core', 'parties', 'summary'],
          supported_include: ['core', 'parties', 'summary', 'tags', 'dealer', 'counts', 'dialog', 'analysis', 'attachments'],
        },
        search: {
          modes: ['metadata', 'keyword', 'semantic', 'hybrid'],
          default_include: ['core', 'summary'],
          max_limit: 100,
        },
        pagination: {
          strategy: 'opaque cursor',
          next_cursor_field: 'page.next_cursor',
        }
      }
    },
  },
  vcon_graph_shape: {
    tool_name: 'vcon_graph_shape',
    summary: 'OSS shape graph JSON: nodes for corpus structure and optional co-occurrence edges.',
    response_schema: {
      type: 'object',
      required: ['ok', 'item'],
      properties: {
        ok: { type: 'boolean', const: true },
        item: VCON_SHAPE_GRAPH_JSON_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    example: {
      ok: true,
      item: {
        schema_version: '1.0.0',
        generated_at: '2026-05-11T14:00:00Z',
        corpus: {
          vcons_with_tags_mv: 1200,
          notes: ['Co-occurrence edges capped for bounded responses.'],
        },
        nodes: [
          { id: 'analysis_type:summary', kind: 'analysis_type', label: 'summary', vcon_count: 800 },
          { id: 'attachment_purpose:dealer_info', kind: 'attachment_purpose', label: 'dealer_info', vcon_count: 400 },
          { id: 'tag_key:portal', kind: 'tag_key', label: 'portal', vcon_count: 900 },
        ],
        edges: [
          {
            id: 'analysis_type_with_attachment_purpose:summary|dealer_info',
            kind: 'analysis_type_with_attachment_purpose',
            source: 'analysis_type:summary',
            target: 'attachment_purpose:dealer_info',
            joint_vcon_count: 350,
          },
        ],
      },
    },
    notes: [
      'Same JSON as MCP resource vcon://v1/graph/shape.',
      'See item.corpus.notes for backend-specific counting semantics.',
    ],
  },
  vcon_search: {
    tool_name: 'vcon_search',
    summary: 'Unified search tool with stable ok/items/page envelope across metadata and ranked search modes.',
    response_schema: {
      type: 'object',
      required: ['ok', 'items', 'page'],
      properties: {
        ok: { type: 'boolean', const: true },
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
              subject: { type: ['string', 'null'] },
              summary: { type: 'array' },
              dealer: { type: ['object', 'null'] },
              search: { type: 'object' }
            }
          }
        },
        page: {
          type: 'object',
          required: ['count'],
          properties: {
            count: { type: 'number' },
            total: { type: 'number' },
            iterable_total: {
              type: 'number',
              description: 'When present, maximum number of rows reachable via cursor for tag-sorted metadata search (newest TAG_SORTED_WINDOW matches).',
            },
            next_cursor: { type: ['string', 'null'] },
          }
        }
      }
    },
    example: {
      ok: true,
      items: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          subject: 'Upset customer call',
          summary: [
            {
              type: 'summary',
              vendor: 'OpenAI',
              body: 'Customer reported a poor experience.',
            }
          ],
          dealer: {
            id: '42',
            name: 'Acme Motors',
            outboundPhoneNumber: '+15551234567',
            team: { id: 8, name: 'Purple Team' },
          },
          search: {
            mode: 'keyword',
            relevance_score: 0.91,
            snippet: '... poor experience ...'
          }
        }
      ],
      page: {
        count: 1,
        total: 187,
        next_cursor: 'eyJvZmZzZXQiOjI1fQ'
      }
    },
    notes: [
      'Cursor is opaque. Pass page.next_cursor back unchanged.',
      'For metadata search with tags, page.total is the full matching count while page.iterable_total may cap how far cursors can walk.',
      'When items.length < limit, meta.short_page_reason explains whether more pages exist.',
      'Semantic and hybrid modes omit page.total today.',
    ],
  },
  vcon_aggregate: {
    tool_name: 'vcon_aggregate',
    summary: 'Dealer-level rollups with optional tag numerator and baseline denominator for rate-style analytics.',
    response_schema: {
      type: 'object',
      required: ['ok', 'item'],
      properties: {
        ok: { type: 'boolean', const: true },
        item: {
          type: 'object',
          required: ['group_by', 'rows'],
          properties: {
            group_by: { type: 'string', const: 'dealer' },
            rows: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  dealer_id: { type: 'string' },
                  dealer_name: { type: ['string', 'null'] },
                  team_id: { type: ['integer', 'null'] },
                  team_name: { type: ['string', 'null'] },
                  filtered_count: { type: 'number' },
                  baseline_count: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    example: {
      ok: true,
      item: {
        group_by: 'dealer',
        rows: [
          {
            dealer_id: '1174',
            dealer_name: 'Example Motors',
            team_id: 8,
            team_name: 'Purple Team',
            filtered_count: 42,
            baseline_count: 600,
          },
        ],
      },
    },
  },
  describe_response_shape: {
    tool_name: 'describe_response_shape',
    summary: 'Schema discovery tool for new and legacy MCP responses.',
    response_schema: {
      type: 'object',
      required: ['ok', 'item'],
      properties: {
        ok: { type: 'boolean', const: true },
        item: {
          type: 'object',
          properties: {
            tool_name: { type: 'string' },
            response_schema: { type: 'object' },
            example: { type: 'object' }
          }
        }
      }
    },
    example: {
      ok: true,
      item: {
        tool_name: 'get_vcon',
        response_schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            vcon: { type: 'object' }
          }
        },
        example: {
          success: true,
          vcon: {
            uuid: '11111111-1111-1111-1111-111111111111'
          }
        }
      }
    },
  },
  get_vcon: {
    tool_name: 'get_vcon',
    summary: 'Legacy fetch tool with success/vcon envelope and response_format-dependent shape.',
    response_schema: {
      type: 'object',
      required: ['success', 'vcon'],
      properties: {
        success: { type: 'boolean', const: true },
        vcon: { type: 'object' }
      }
    },
    example: {
      success: true,
      vcon: {
        uuid: '11111111-1111-1111-1111-111111111111',
        subject: 'Support call'
      }
    },
    notes: ['response_format changes the content inside the vcon field.'],
  },
  search_vcons: {
    tool_name: 'search_vcons',
    summary: 'Legacy metadata search tool with success/results envelope.',
    response_schema: {
      type: 'object',
      required: ['success', 'count', 'results'],
      properties: {
        success: { type: 'boolean', const: true },
        count: { type: 'number' },
        total_count: { type: 'number' },
        results: { type: 'array' }
      }
    },
    example: {
      success: true,
      count: 2,
      total_count: 187,
      results: [
        {
          uuid: '11111111-1111-1111-1111-111111111111',
          subject: 'Support call'
        }
      ]
    },
  },
  search_by_tags: {
    tool_name: 'search_by_tags',
    summary: 'Legacy tag search tool with vcon_uuids and optional vcons payloads.',
    response_schema: {
      type: 'object',
      required: ['success', 'count', 'vcon_uuids'],
      properties: {
        success: { type: 'boolean', const: true },
        count: { type: 'number' },
        vcon_uuids: { type: 'array', items: { type: 'string' } },
        vcons: { type: 'array' }
      }
    },
    example: {
      success: true,
      count: 1,
      vcon_uuids: ['11111111-1111-1111-1111-111111111111']
    },
    notes: ['return_full_vcons can change the response body size and add a vcons field.'],
  },
  search_vcons_content: {
    tool_name: 'search_vcons_content',
    summary: 'Legacy keyword search with success/results and format-specific rows.',
    response_schema: {
      type: 'object',
      required: ['success', 'count', 'results'],
      properties: {
        success: { type: 'boolean', const: true },
        count: { type: 'number' },
        results: { type: 'array' }
      }
    },
    example: {
      success: true,
      count: 1,
      results: [
        {
          vcon_id: '11111111-1111-1111-1111-111111111111',
          content_type: 'dialog',
          relevance_score: 0.91,
          snippet: '... upset customer ...'
        }
      ]
    },
  },
  search_vcons_semantic: {
    tool_name: 'search_vcons_semantic',
    summary: 'Legacy semantic search with vcon_id-centered rows.',
    response_schema: {
      type: 'object',
      required: ['success', 'count', 'results'],
      properties: {
        success: { type: 'boolean', const: true },
        count: { type: 'number' },
        results: { type: 'array' }
      }
    },
    example: {
      success: true,
      count: 1,
      results: [
        {
          vcon_id: '11111111-1111-1111-1111-111111111111',
          similarity_score: 0.93
        }
      ]
    },
  },
  search_vcons_hybrid: {
    tool_name: 'search_vcons_hybrid',
    summary: 'Legacy hybrid search with vcon_id and score tuple rows.',
    response_schema: {
      type: 'object',
      required: ['success', 'count', 'results'],
      properties: {
        success: { type: 'boolean', const: true },
        count: { type: 'number' },
        results: { type: 'array' }
      }
    },
    example: {
      success: true,
      count: 1,
      results: [
        {
          vcon_id: '11111111-1111-1111-1111-111111111111',
          combined_score: 0.94,
          semantic_score: 0.91,
          keyword_score: 0.81
        }
      ]
    },
  },
};

export class VConFetchHandler extends BaseToolHandler {
  readonly toolName = 'vcon_fetch';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const id = args?.id as string | undefined;
    if (!id) {
      return this.createErrorEnvelopeResponse({
        code: 'INVALID_ARGUMENT',
        message: 'id is required',
      });
    }

    const maxResponseBytesResult = parseMaxResponseBytes(args?.max_response_bytes);
    if (typeof maxResponseBytesResult !== 'number') {
      return this.createErrorEnvelopeResponse({
        code: 'INVALID_ARGUMENT',
        message: maxResponseBytesResult.invalid,
      });
    }
    const maxResponseBytes = maxResponseBytesResult;

    const includeResult = normalizeIncludes(args?.include);
    if ('invalid' in includeResult) {
      return this.createErrorEnvelopeResponse({
        code: 'INVALID_ARGUMENT',
        message: 'include must only contain supported values',
        invalid_values: includeResult.invalid,
        valid_values: [...VALID_FETCH_INCLUDES],
      });
    }

    const include = includeResult;

    let vcon: VCon;
    try {
      vcon = await context.queries.getVCon(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('not found')) {
        return this.createErrorEnvelopeResponse({
          code: 'NOT_FOUND',
          message: `vCon not found: ${id}`,
        });
      }

      return this.createErrorEnvelopeResponse({
        code: 'FETCH_FAILED',
        message,
      });
    }

    const item = await buildItem(context, vcon, include);
    const approximateBytes = estimateBytes({
      ok: true,
      item,
      meta: {
        include,
        approximate_bytes: 0,
        max_response_bytes: maxResponseBytes,
      }
    });

    if (approximateBytes > maxResponseBytes) {
      return this.createErrorEnvelopeResponse(
        createTooLargeError(approximateBytes, maxResponseBytes, [
          'Reduce include to ["core","summary"] or ["core","summary","dealer"].',
          'Avoid dialog, analysis, and attachments unless the client truly needs full record content.',
          'Retry with a higher max_response_bytes only if the caller can safely handle larger payloads.',
        ]),
        {
          meta: {
            include,
          }
        }
      );
    }

    return this.createOkItemResponse(item, {
      meta: {
        include,
        approximate_bytes: approximateBytes,
        max_response_bytes: maxResponseBytes,
      }
    });
  }
}

export class VConGraphShapeHandler extends BaseToolHandler {
  readonly toolName = 'vcon_graph_shape';

  protected async execute(_args: unknown, context: ToolHandlerContext): Promise<ToolResponse> {
    try {
      const graph = await context.queries.getVconShapeGraph();
      return this.createOkItemResponse(graph);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.createErrorEnvelopeResponse({
        code: 'SHAPE_GRAPH_FAILED',
        message,
      });
    }
  }
}

export class VConCapabilitiesHandler extends BaseToolHandler {
  readonly toolName = 'vcon_capabilities';

  protected async execute(_args: any, _context: ToolHandlerContext): Promise<ToolResponse> {
    return this.createOkItemResponse({
      tools: [
        'vcon_fetch',
        'vcon_capabilities',
        'vcon_graph_shape',
        'vcon_search',
        'vcon_taxonomy',
        'vcon_aggregate',
        'describe_response_shape',
      ],
      shape_graph: {
        resource_uri: 'vcon://v1/graph/shape',
        tool: 'vcon_graph_shape',
        json_schema_id: VCON_SHAPE_GRAPH_JSON_SCHEMA.$id,
        description:
          'Default corpus-level graph from vCon structure only (analysis types, attachment purposes, legacy attachment types without purpose, tag keys, bounded co-occurrence). No business ontology. Read this resource or call vcon_graph_shape after vcon_capabilities and before broad search when teaching an agent what evidence exists.',
      },
      response_budgeting: {
        default_max_response_bytes: DEFAULT_MAX_RESPONSE_BYTES,
        minimum_max_response_bytes: MIN_MAX_RESPONSE_BYTES,
        failure_code: 'RESPONSE_TOO_LARGE',
        notes: [
          'The tool returns a structured error instead of truncating oversized payloads.',
          'Successful responses include meta.approximate_bytes so callers can calibrate future requests.',
        ],
      },
      fetch: {
        identifier_field: 'id',
        default_include: DEFAULT_FETCH_INCLUDES,
        supported_include: VALID_FETCH_INCLUDES,
        recommended_lightweight_include: ['core', 'summary', 'dealer'],
      },
      search: {
        modes: SUPPORTED_SEARCH_MODES,
        default_mode: 'metadata',
        default_include: DEFAULT_SEARCH_INCLUDES,
        supported_include: VALID_FETCH_INCLUDES,
        default_limit: 25,
        max_limit: 100,
        recommended_patterns: [
          'Use tags.portal filters before semantic search for upset-customer and bad-call experiences.',
          'Use include=["core","summary","dealer"] for browse views that need dealer context.',
        ],
      },
      pagination: {
        strategy: 'opaque cursor',
        request_field: 'cursor',
        response_field: 'page.next_cursor',
        semantics:
          'Pass page.next_cursor back unchanged. Do not try to interpret or edit it client-side. ' +
          'For debugging only, cursors are currently base64url JSON with an offset field; production clients must still treat them as opaque.',
        total_semantics:
          'page.total is the database count for the same filter predicate as the search (including tags and dealer filters). ' +
          'For tag-sorted metadata search, at most the newest ' +
          String(TAG_SORTED_WINDOW) +
          ' matching vCons are reachable via cursor pagination; when the corpus exceeds that window, page.iterable_total duplicates that cap so clients know pagination cannot walk the full total.',
      },
      taxonomy_hints: {
        preferred_bad_call_signals: ['negative_experience', 'dnc_request', 'bad_call_quality'],
        preferred_dealer_source: 'attachment:strolid_dealer',
      },
      migration: {
        get_vcon: 'vcon_fetch',
        search_vcons: 'vcon_search(mode="metadata")',
        search_vcons_content: 'vcon_search(mode="keyword")',
        search_vcons_semantic: 'vcon_search(mode="semantic")',
        search_vcons_hybrid: 'vcon_search(mode="hybrid")',
      },
    });
  }
}

export class VConSearchHandler extends BaseToolHandler {
  readonly toolName = 'vcon_search';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const mode = validateSearchMode(args?.mode);
    const limit = Math.min(Math.max(Number(args?.limit || 25), 1), 100);
    const cursor = decodeCursor(args?.cursor as string | undefined);
    const maxResponseBytesResult = parseMaxResponseBytes(args?.max_response_bytes);
    if (typeof maxResponseBytesResult !== 'number') {
      return this.createErrorEnvelopeResponse({
        code: 'INVALID_ARGUMENT',
        message: maxResponseBytesResult.invalid,
      });
    }
    const maxResponseBytes = maxResponseBytesResult;
    const includeResult = normalizeIncludes(args?.include ?? DEFAULT_SEARCH_INCLUDES);
    if ('invalid' in includeResult) {
      return this.createErrorEnvelopeResponse({
        code: 'INVALID_ARGUMENT',
        message: 'include must only contain supported values',
        invalid_values: includeResult.invalid,
        valid_values: [...VALID_FETCH_INCLUDES],
      });
    }

    const include = includeResult;
    const tags = args?.tags as Record<string, string> | undefined;
    const filters = {
      subject: args?.filters?.subject as string | undefined,
      partyName: args?.filters?.party_name as string | undefined,
      partyEmail: args?.filters?.party_email as string | undefined,
      partyTel: args?.filters?.party_tel as string | undefined,
      startDate: normalizeDateString(args?.filters?.start_date as string | undefined),
      endDate: normalizeDateString(args?.filters?.end_date as string | undefined),
      tags,
      dealerId: args?.filters?.dealer_id != null ? String(args.filters.dealer_id) : undefined,
      dealerName: args?.filters?.dealer_name as string | undefined,
    };
    const query = args?.query as string | undefined;
    const threshold = (args?.threshold as number | undefined) ?? 0.7;
    const semanticWeight = (args?.semantic_weight as number | undefined) ?? 0.6;
    const fetchLimit = cursor.offset + limit + 1;

    try {
      let items: Record<string, unknown>[] = [];
      let total: number | undefined;
      let hasNextPage = false;

      if (mode === 'metadata') {
        const results = await context.queries.searchVCons({
          ...filters,
          limit: fetchLimit,
        });
        const pageResults = results.slice(cursor.offset, cursor.offset + limit);
        total = await context.queries.searchVConsCount(filters);
        const effectiveUpper =
          tags && total !== undefined
            ? Math.min(total, TAG_SORTED_WINDOW)
            : total ?? 0;
        hasNextPage = total !== undefined && effectiveUpper > cursor.offset + pageResults.length;
        items = await Promise.all(pageResults.map((vcon) => buildItem(context, vcon, include, {
          search: { mode: 'metadata' },
        })));
      } else if (mode === 'keyword') {
        if (!query) {
          return this.createErrorEnvelopeResponse({
            code: 'INVALID_ARGUMENT',
            message: 'query is required for keyword mode',
          });
        }

        const results = await context.queries.keywordSearch({
          query,
          startDate: filters.startDate,
          endDate: filters.endDate,
          tags,
          limit: fetchLimit,
        });
        total = await context.queries.keywordSearchCount({
          query,
          startDate: filters.startDate,
          endDate: filters.endDate,
          tags,
        });

        const deduped = new Map<string, { vcon_id: string; doc_type: string; ref_index: number | null; rank: number; snippet: string | null }>();
        for (const result of results) {
          const existing = deduped.get(result.vcon_id);
          if (!existing || result.rank > existing.rank) {
            deduped.set(result.vcon_id, result);
          }
        }
        const distinctResults = Array.from(deduped.values());
        const pageResults = distinctResults.slice(cursor.offset, cursor.offset + limit);
        hasNextPage = total > cursor.offset + pageResults.length;
        items = await Promise.all(pageResults.map(async (result) => {
          const vcon = await context.queries.getVCon(result.vcon_id);
          return buildItem(context, vcon, include, {
            search: {
              mode: 'keyword',
              content_type: result.doc_type,
              content_index: result.ref_index,
              relevance_score: result.rank,
              snippet: result.snippet,
            }
          });
        }));
      } else if (mode === 'semantic') {
        let embedding = args?.embedding as number[] | undefined;
        if (embedding && embedding.length !== 384) {
          return this.createErrorEnvelopeResponse({
            code: 'INVALID_ARGUMENT',
            message: 'embedding must be 384 dimensions for semantic mode',
          });
        }
        if (!embedding && query) {
          embedding = await generateEmbedding(query);
        }
        if (!embedding) {
          return this.createErrorEnvelopeResponse({
            code: 'INVALID_ARGUMENT',
            message: 'query or embedding is required for semantic mode',
          });
        }

        const results = await context.queries.semanticSearch({
          embedding,
          tags,
          threshold,
          limit: fetchLimit,
        });
        const pageResults = results.slice(cursor.offset, cursor.offset + limit);
        hasNextPage = results.length > cursor.offset + limit;
        items = await Promise.all(pageResults.map(async (result) => {
          const vcon = await context.queries.getVCon(result.vcon_id);
          return buildItem(context, vcon, include, {
            search: {
              mode: 'semantic',
              content_type: result.content_type,
              content_reference: result.content_reference,
              similarity_score: result.similarity,
              content_text: result.content_text,
            }
          });
        }));
      } else {
        if (!query) {
          return this.createErrorEnvelopeResponse({
            code: 'INVALID_ARGUMENT',
            message: 'query is required for hybrid mode',
          });
        }

        let embedding = args?.embedding as number[] | undefined;
        if (embedding && embedding.length !== 384) {
          return this.createErrorEnvelopeResponse({
            code: 'INVALID_ARGUMENT',
            message: 'embedding must be 384 dimensions for hybrid mode',
          });
        }
        if (!embedding) {
          try {
            embedding = await generateEmbedding(query);
          } catch {
            embedding = undefined;
          }
        }

        const results = await context.queries.hybridSearch({
          keywordQuery: query,
          embedding,
          tags,
          semanticWeight,
          limit: fetchLimit,
        });
        const pageResults = results.slice(cursor.offset, cursor.offset + limit);
        hasNextPage = results.length > cursor.offset + limit;
        items = await Promise.all(pageResults.map(async (result) => {
          const vcon = await context.queries.getVCon(result.vcon_id);
          return buildItem(context, vcon, include, {
            search: {
              mode: 'hybrid',
              combined_score: result.combined_score,
              semantic_score: result.semantic_score,
              keyword_score: result.keyword_score,
            }
          });
        }));
      }

      const page: Record<string, unknown> = {
        count: items.length,
        ...(total !== undefined ? { total } : {}),
        ...(mode === 'metadata' && tags && total !== undefined && total > TAG_SORTED_WINDOW
          ? { iterable_total: TAG_SORTED_WINDOW }
          : {}),
        next_cursor: hasNextPage ? encodeCursor({ offset: cursor.offset + limit }) : null,
      };

      let shortPageReason: string | undefined;
      if (items.length < limit) {
        if (mode === 'keyword' && hasNextPage) {
          shortPageReason = 'keyword_dedup_or_rank_window';
        } else {
          shortPageReason = hasNextPage ? 'below_limit_more_results_exist' : 'end_of_searchable_results';
        }
      }

      const approximateBytes = estimateBytes({
        ok: true,
        items,
        page,
        meta: {
          mode,
          include,
          approximate_bytes: 0,
          max_response_bytes: maxResponseBytes,
          ...(shortPageReason ? { short_page_reason: shortPageReason } : {}),
        }
      });

      if (approximateBytes > maxResponseBytes) {
        return this.createErrorEnvelopeResponse(
          createTooLargeError(approximateBytes, maxResponseBytes, [
            'Lower limit to return fewer items per page.',
            'Narrow include to ["core","summary"] or add tighter tag/date filters.',
            'Avoid attachments, dialog, and full analysis bodies in search results.',
          ]),
          {
            meta: {
              mode,
              include,
              limit,
            }
          }
        );
      }

      return this.createOkListResponse(items, page as any, {
        meta: {
          mode,
          include,
          approximate_bytes: approximateBytes,
          max_response_bytes: maxResponseBytes,
          ...(shortPageReason ? { short_page_reason: shortPageReason } : {}),
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.createErrorEnvelopeResponse({
        code: 'SEARCH_FAILED',
        message,
      }, {
        meta: {
          mode,
          include,
        }
      });
    }
  }
}

export class VConTaxonomyHandler extends BaseToolHandler {
  readonly toolName = 'vcon_taxonomy';

  protected async execute(_args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    let coverage: Record<string, unknown> = { note: 'coverage unavailable' };
    try {
      const snap = await context.queries.getTaxonomyCoverageSnapshot();
      if (snap.vcons_total != null) {
        coverage = {
          vcons_total: snap.vcons_total,
          strolid_dealer_attachment: {
            availability: 'preferred',
            coverage_pct: snap.with_strolid_dealer_attachment_pct,
            note: 'Percentage uses strolid_dealer attachment rows over total vCons (approximate if duplicates exist).',
          },
          dealer_name_tag: {
            availability: 'sparse',
            coverage_pct: snap.with_dealer_name_tag_pct,
            note: 'Share of vCons whose tag materialized view exposes a dealer_name key.',
          },
        };
      }
    } catch {
      /* keep static guidance when counts fail */
    }

    return this.createOkItemResponse({
      dataset: 'strolid',
      portal_values: [
        {
          value: 'negative_experience',
          description: 'Primary signal for a poor customer experience or complaint.',
          recommended_use: 'Use this first for upset-customer views before semantic search.'
        },
        {
          value: 'dnc_request',
          description: 'Customer requested do-not-contact handling.',
          recommended_use: 'Use for compliance and suppression workflows.'
        },
        {
          value: 'bad_call_quality',
          description: 'Call quality issue such as audio drop, latency, or poor connection.',
          recommended_use: 'Use for telecom-quality investigations.'
        },
      ],
      common_tags: [
        {
          key: 'portal',
          availability: 'preferred',
          description: 'Team-owned preclassification for common call categories.',
        },
        {
          key: 'dealer_name',
          availability: 'sparse',
          description: 'Legacy dealer tag. Prefer the strolid_dealer attachment instead.',
        },
      ],
      preferred_sources: [
        {
          need: 'dealer info',
          source: 'attachment:strolid_dealer',
          fields: ['id', 'name', 'outboundPhoneNumber', 'team'],
        },
        {
          need: 'summary text',
          source: 'analysis:type=summary',
          fields: ['body', 'vendor', 'product'],
        },
        {
          need: 'call went badly',
          source: 'tag:portal',
          fields: ['negative_experience', 'dnc_request', 'bad_call_quality'],
        },
      ],
      query_recipes: [
        {
          goal: 'Find upset customers',
          recommendation: 'Filter on portal tags first, then fetch include=["core","summary","dealer"].',
        },
        {
          goal: 'Build dealer-aware list views',
          recommendation: 'Use the dealer attachment, not dealer_name tag coverage.',
        },
        {
          goal: 'Top N dealers by portal tag rate',
          recommendation:
            'Call vcon_aggregate with group_by="dealer", the same tags filter as numerator, include_baseline true, and having.min_count for a sample floor.',
        },
      ],
      coverage,
    });
  }
}

export class VConAggregateHandler extends BaseToolHandler {
  readonly toolName = 'vcon_aggregate';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const groupBy = (args?.group_by as string | undefined) || 'dealer';
    if (groupBy !== 'dealer') {
      return this.createErrorEnvelopeResponse({
        code: 'INVALID_ARGUMENT',
        message: 'group_by must be "dealer" for this release.',
      });
    }

    const tags = (args?.tags as Record<string, string> | undefined) ?? {};
    const limit = Math.min(Math.max(Number(args?.limit ?? 20), 1), 500);
    const minBaseline = Math.max(
      1,
      Number((args?.having as { min_count?: number } | undefined)?.min_count ?? 1),
    );
    const startDate = normalizeDateString(args?.filters?.start_date as string | undefined);
    const endDate = normalizeDateString(args?.filters?.end_date as string | undefined);

    try {
      const rows = await context.queries.aggregateVconsByDealerStats({
        tagFilter: tags,
        startDate,
        endDate,
        minBaseline,
        limit,
      });
      return this.createOkItemResponse({
        group_by: 'dealer',
        rows,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.createErrorEnvelopeResponse({
        code: 'AGGREGATE_FAILED',
        message,
      });
    }
  }
}

export class DescribeResponseShapeHandler extends BaseToolHandler {
  readonly toolName = 'describe_response_shape';

  protected async execute(args: any, _context: ToolHandlerContext): Promise<ToolResponse> {
    const toolName = args?.tool_name as string | undefined;
    const includeExample = (args?.include_example as boolean | undefined) ?? true;

    if (!toolName) {
      const items = Object.values(SHAPE_DESCRIPTORS).map((descriptor) => ({
        tool_name: descriptor.tool_name,
        summary: descriptor.summary,
      }));
      return this.createOkListResponse(items, {
        count: items.length,
        total: items.length,
        next_cursor: null,
      });
    }

    const descriptor = SHAPE_DESCRIPTORS[toolName];
    if (!descriptor) {
      return this.createErrorEnvelopeResponse({
        code: 'UNKNOWN_TOOL',
        message: `No published response shape descriptor for tool: ${toolName}`,
        available_tools: Object.keys(SHAPE_DESCRIPTORS).sort(),
      });
    }

    return this.createOkItemResponse({
      tool_name: descriptor.tool_name,
      summary: descriptor.summary,
      response_schema: descriptor.response_schema,
      ...(includeExample ? { example: descriptor.example } : {}),
      ...(descriptor.notes ? { notes: descriptor.notes } : {}),
    });
  }
}
