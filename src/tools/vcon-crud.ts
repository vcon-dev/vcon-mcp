/**
 * MCP Tool Definitions for vCon Operations
 * 
 * ⚠️ CRITICAL: All schemas use corrected field names
 * - analysis.schema (NOT schema_version)
 * - analysis.vendor (REQUIRED)
 * - analysis.body (string type)
 */

import { z } from 'zod';

// ============================================================================
// Zod Schemas with Corrections
// ============================================================================

/**
 * Analysis Schema
 * ✅ CRITICAL CORRECTIONS:
 * - Uses 'schema' field (NOT 'schema_version')
 * - 'vendor' is REQUIRED
 * - 'body' is string type
 */
export const AnalysisSchema = z.object({
  type: z.string().describe('Analysis type (e.g., summary, transcript, sentiment)'),
  dialog: z.union([z.number(), z.array(z.number())]).optional()
    .describe('Dialog index or array of indexes this analysis applies to'),
  mediatype: z.string().optional(),
  filename: z.string().optional(),
  vendor: z.string().describe('REQUIRED: Vendor who produced this analysis'),  // ✅ REQUIRED
  product: z.string().optional().describe('Product name or version'),
  schema: z.string().optional().describe('Schema identifier for this analysis'),  // ✅ CORRECT: 'schema'
  body: z.string().optional().describe('Analysis content as string (supports JSON, CSV, XML, etc.)'),  // ✅ String type
  encoding: z.enum(['base64url', 'json', 'none']).optional(),
  url: z.string().optional(),
  content_hash: z.union([z.string(), z.array(z.string())]).optional(),
});

/**
 * Dialog Schema
 * ✅ Includes new fields: session_id, application, message_id
 */
export const DialogSchema = z.object({
  type: z.enum(['recording', 'text', 'transfer', 'incomplete'])
    .describe('Type of dialog'),
  start: z.string().optional().describe('ISO 8601 datetime when dialog started'),
  duration: z.number().optional().describe('Duration in seconds'),
  parties: z.union([
    z.number(),
    z.array(z.number()),
    z.array(z.union([z.number(), z.array(z.number())]))
  ]).optional().describe('Party indexes involved'),
  originator: z.number().optional(),
  mediatype: z.string().optional(),
  filename: z.string().optional(),
  body: z.string().optional(),
  encoding: z.enum(['base64url', 'json', 'none']).optional(),
  url: z.string().optional(),
  content_hash: z.union([z.string(), z.array(z.string())]).optional(),
  disposition: z.enum(['no-answer', 'congestion', 'failed', 'busy', 'hung-up', 'voicemail-no-message']).optional(),
  session_id: z.string().optional().describe('Session identifier'),  // ✅ New field
  application: z.string().optional().describe('Application that created this dialog'),  // ✅ New field
  message_id: z.string().optional().describe('Message identifier'),  // ✅ New field
});

/**
 * Party Schema
 * ✅ Includes uuid field
 */
export const PartySchema = z.object({
  tel: z.string().optional(),
  sip: z.string().optional(),
  stir: z.string().optional(),
  mailto: z.string().optional(),
  name: z.string().optional(),
  did: z.string().optional(),
  uuid: z.string().uuid().optional().describe('Unique identifier for this party'),  // ✅ Added
  validation: z.string().optional(),
  timezone: z.string().optional(),
});

/**
 * Attachment Schema
 * ✅ Includes dialog reference
 */
export const AttachmentSchema = z.object({
  type: z.string().optional(),
  start: z.string().optional(),
  party: z.number().optional(),
  dialog: z.number().optional().describe('Dialog index this attachment relates to'),  // ✅ Added
  mediatype: z.string().optional(),
  filename: z.string().optional(),
  body: z.string().optional(),
  encoding: z.enum(['base64url', 'json', 'none']).optional(),
  url: z.string().optional(),
  content_hash: z.union([z.string(), z.array(z.string())]).optional(),
});

// ============================================================================
// MCP Tool Definitions
// ============================================================================

/**
 * Tool: Create vCon
 */
export const createVConTool = {
  name: 'create_vcon',
  description: 'Create a new vCon compliant with IETF draft-ietf-vcon-vcon-core-00. ' +
    'A vCon (virtual conversation) captures conversation data including parties, dialog, analysis, and attachments.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      subject: {
        type: 'string',
        description: 'Subject or title of the conversation'
      },
      parties: {
        type: 'array',
        description: 'Array of parties (participants) in the conversation. At least one party is required.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Display name of the party' },
            tel: { type: 'string', description: 'Telephone number' },
            mailto: { type: 'string', description: 'Email address' },
            sip: { type: 'string', description: 'SIP URI' },
            uuid: { type: 'string', description: 'UUID for cross-vCon party tracking' },
          }
        },
        minItems: 1
      },
      extensions: {
        type: 'array',
        description: 'Array of extension identifiers used in this vCon',
        items: { type: 'string' }
      },
      must_support: {
        type: 'array',
        description: 'Array of extensions that must be supported to process this vCon',
        items: { type: 'string' }
      }
    },
    required: ['parties']
  }
};

/**
 * Tool: Get vCon
 */
export const getVConTool = {
  name: 'get_vcon',
  description: 'Retrieve a complete vCon by its UUID. Returns the full vCon object with all parties, dialog, analysis, and attachments.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      uuid: {
        type: 'string',
        description: 'UUID of the vCon to retrieve',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      }
    },
    required: ['uuid']
  }
};

/**
 * Tool: Search vCons
 */
export const searchVConsTool = {
  name: 'search_vcons',
  description: 'Search for vCons using various criteria. Returns an array of matching vCons. ' +
    'For full-text or semantic search of conversation content, use search_vcons_content instead. ' +
    '⚠️ LARGE DATABASE WARNING: Use response_format="metadata" for large result sets to avoid memory issues.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      subject: {
        type: 'string',
        description: 'Search by subject (case-insensitive partial match)'
      },
      party_name: {
        type: 'string',
        description: 'Search by party name (case-insensitive partial match)'
      },
      party_email: {
        type: 'string',
        description: 'Search by party email address'
      },
      party_tel: {
        type: 'string',
        description: 'Search by party telephone number'
      },
      start_date: {
        type: 'string',
        description: 'Filter by vCons created on or after this date (ISO 8601 format)'
      },
      end_date: {
        type: 'string',
        description: 'Filter by vCons created on or before this date (ISO 8601 format)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 1000)',
        minimum: 1,
        maximum: 1000,
        default: 10
      },
      response_format: {
        type: 'string',
        enum: ['full', 'metadata', 'ids_only'],
        description: 'Response format: "full" (complete vCons), "metadata" (summary info), "ids_only" (just UUIDs)',
        default: 'metadata'
      },
      include_count: {
        type: 'boolean',
        description: 'Include total count of matching records (may be expensive for large datasets)',
        default: false
      }
    }
  }
};

/**
 * Tool: Search vCon Content (Keyword Search)
 * Searches through subject, dialog, analysis, and party information using full-text search
 */
export const searchVConsContentTool = {
  name: 'search_vcons_content',
  description: 'Full-text keyword search across vCon content including subject, dialog, analysis, and party info. ' +
    'Searches through conversation text, analysis bodies, and participant details. Returns ranked results with snippets. ' +
    '⚠️ LARGE DATABASE WARNING: Use response_format="snippets" for large result sets to avoid memory issues.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query text (supports partial matches and typos)'
      },
      start_date: {
        type: 'string',
        description: 'Filter by vCons created on or after this date (ISO 8601 format)'
      },
      end_date: {
        type: 'string',
        description: 'Filter by vCons created on or before this date (ISO 8601 format)'
      },
      tags: {
        type: 'object',
        description: 'Filter by tags (key-value pairs). Example: {"department": "sales", "priority": "high"}',
        additionalProperties: { type: 'string' }
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 50, max: 1000)',
        minimum: 1,
        maximum: 1000,
        default: 50
      },
      response_format: {
        type: 'string',
        enum: ['full', 'snippets', 'metadata', 'ids_only'],
        description: 'Response format: "full" (complete vCons), "snippets" (with search highlights), "metadata" (summary), "ids_only" (just UUIDs)',
        default: 'snippets'
      },
      include_count: {
        type: 'boolean',
        description: 'Include total count of matching records (may be expensive for large datasets)',
        default: false
      }
    },
    required: ['query']
  }
};

/**
 * Tool: Semantic Search vCons
 * Searches using AI embeddings for meaning-based similarity
 */
export const searchVConsSemanticTool = {
  name: 'search_vcons_semantic',
  description: 'Semantic search using AI embeddings to find conversations by meaning, not just keywords. ' +
    'Searches through subject, dialog, and analysis content. Returns similar conversations based on semantic similarity. ' +
    'Note: Requires embeddings to be generated for vCons (see embedding documentation). ' +
    '⚠️ LARGE DATABASE WARNING: Use response_format="metadata" for large result sets to avoid memory issues.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query describing what you are looking for'
      },
      embedding: {
        type: 'array',
        description: 'Pre-computed embedding vector (384 dimensions). If not provided, will be generated from query.',
        items: { type: 'number' }
      },
      tags: {
        type: 'object',
        description: 'Filter by tags (key-value pairs)',
        additionalProperties: { type: 'string' }
      },
      threshold: {
        type: 'number',
        description: 'Minimum similarity threshold (0-1, default: 0.7)',
        minimum: 0,
        maximum: 1,
        default: 0.7
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 50, max: 1000)',
        minimum: 1,
        maximum: 1000,
        default: 50
      },
      response_format: {
        type: 'string',
        enum: ['full', 'metadata', 'ids_only'],
        description: 'Response format: "full" (complete vCons), "metadata" (summary info), "ids_only" (just UUIDs)',
        default: 'metadata'
      },
      include_count: {
        type: 'boolean',
        description: 'Include total count of matching records (may be expensive for large datasets)',
        default: false
      }
    }
  }
};

/**
 * Tool: Hybrid Search vCons
 * Combines keyword and semantic search for best results
 */
export const searchVConsHybridTool = {
  name: 'search_vcons_hybrid',
  description: 'Hybrid search combining keyword and semantic search for comprehensive results. ' +
    'Uses both full-text matching and AI embeddings to find relevant conversations. ' +
    'Ideal for complex queries where you want both exact matches and conceptually similar content. ' +
    '⚠️ LARGE DATABASE WARNING: Use response_format="metadata" for large result sets to avoid memory issues.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query text'
      },
      embedding: {
        type: 'array',
        description: 'Pre-computed embedding vector (384 dimensions). If not provided, will be generated from query.',
        items: { type: 'number' }
      },
      tags: {
        type: 'object',
        description: 'Filter by tags (key-value pairs)',
        additionalProperties: { type: 'string' }
      },
      semantic_weight: {
        type: 'number',
        description: 'Weight for semantic vs keyword (0-1, default: 0.6). Higher values favor semantic matching.',
        minimum: 0,
        maximum: 1,
        default: 0.6
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 50, max: 1000)',
        minimum: 1,
        maximum: 1000,
        default: 50
      },
      response_format: {
        type: 'string',
        enum: ['full', 'metadata', 'ids_only'],
        description: 'Response format: "full" (complete vCons), "metadata" (summary info), "ids_only" (just UUIDs)',
        default: 'metadata'
      },
      include_count: {
        type: 'boolean',
        description: 'Include total count of matching records (may be expensive for large datasets)',
        default: false
      }
    },
    required: ['query']
  }
};

/**
 * Tool: Add Analysis
 * ✅ CRITICAL: Uses correct field names (schema, not schema_version)
 * ✅ CRITICAL: vendor is required
 */
export const addAnalysisTool = {
  name: 'add_analysis',
  description: 'Add analysis to an existing vCon. Analysis represents AI/ML processing results like transcripts, summaries, or sentiment. ' +
    'IMPORTANT: vendor field is REQUIRED per IETF spec.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to add analysis to',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      analysis: {
        type: 'object',
        description: 'Analysis object to add',
        properties: {
          type: {
            type: 'string',
            description: 'Type of analysis (e.g., summary, transcript, sentiment, translation)'
          },
          dialog: {
            oneOf: [
              { type: 'number' },
              { type: 'array', items: { type: 'number' } }
            ],
            description: 'Dialog index(es) this analysis applies to'
          },
          vendor: {
            type: 'string',
            description: 'REQUIRED: Vendor who produced this analysis (e.g., OpenAI, Google, IBM)'
          },
          product: {
            type: 'string',
            description: 'Product name or version (e.g., GPT-4, Whisper)'
          },
          schema: {  // ✅ CORRECT field name
            type: 'string',
            description: 'Schema identifier for this analysis format'
          },
          body: {  // ✅ String type
            type: 'string',
            description: 'Analysis content as string (can be JSON, CSV, XML, plain text, etc.)'
          },
          encoding: {
            type: 'string',
            enum: ['base64url', 'json', 'none'],
            description: 'Encoding of the body field'
          },
          url: {
            type: 'string',
            description: 'URL to external analysis content'
          }
        },
        required: ['type', 'vendor']  // ✅ vendor is required
      }
    },
    required: ['vcon_uuid', 'analysis']
  }
};

/**
 * Tool: Add Dialog
 * ✅ Includes new fields
 */
export const addDialogTool = {
  name: 'add_dialog',
  description: 'Add a dialog (conversation segment) to an existing vCon. Dialog can be a recording, text, transfer, or incomplete.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to add dialog to',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      dialog: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['recording', 'text', 'transfer', 'incomplete'],
            description: 'Type of dialog'
          },
          start: {
            type: 'string',
            description: 'Start time (ISO 8601 datetime)'
          },
          duration: {
            type: 'number',
            description: 'Duration in seconds'
          },
          parties: {
            oneOf: [
              { type: 'number' },
              { type: 'array', items: { type: 'number' } }
            ],
            description: 'Party indexes involved in this dialog'
          },
          body: {
            type: 'string',
            description: 'Dialog content (text, transcript, or recording)'
          },
          encoding: {
            type: 'string',
            enum: ['base64url', 'json', 'none']
          },
          mediatype: {
            type: 'string',
            description: 'MIME type of the content'
          },
          session_id: {
            type: 'string',
            description: 'Session identifier for this dialog'
          },
          application: {
            type: 'string',
            description: 'Application that created this dialog'
          },
          message_id: {
            type: 'string',
            description: 'Message identifier'
          }
        },
        required: ['type']
      }
    },
    required: ['vcon_uuid', 'dialog']
  }
};

/**
 * Tool: Add Attachment
 */
export const addAttachmentTool = {
  name: 'add_attachment',
  description: 'Add an attachment to an existing vCon. Attachments can be files, documents, or other data related to the conversation.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      vcon_uuid: {
        type: 'string',
        description: 'UUID of the vCon to add attachment to',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      attachment: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          party: {
            type: 'number',
            description: 'Party index this attachment relates to'
          },
          dialog: {
            type: 'number',
            description: 'Dialog index this attachment relates to'
          },
          mediatype: { type: 'string' },
          filename: { type: 'string' },
          body: {
            type: 'string',
            description: 'Attachment content'
          },
          encoding: {
            type: 'string',
            enum: ['base64url', 'json', 'none']
          },
          url: { type: 'string' }
        }
      }
    },
    required: ['vcon_uuid', 'attachment']
  }
};

/**
 * Tool: Delete vCon
 */
export const deleteVConTool = {
  name: 'delete_vcon',
  description: 'Delete a vCon and all its related data (parties, dialog, analysis, attachments). This operation cannot be undone.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      uuid: {
        type: 'string',
        description: 'UUID of the vCon to delete',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      }
    },
    required: ['uuid']
  }
};

/**
 * Tool: Update vCon (metadata-only)
 * Updates limited top-level fields. Use specific tools for arrays/components.
 */
export const updateVConTool = {
  name: 'update_vcon',
  description: 'Update top-level vCon metadata (subject, extensions, must_support). For dialog, analysis, attachments use their specific tools.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      uuid: {
        type: 'string',
        description: 'UUID of the vCon to update',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      },
      updates: {
        type: 'object',
        description: 'Allowed fields to update',
        properties: {
          subject: { type: 'string' },
          extensions: { type: 'array', items: { type: 'string' } },
          must_support: { type: 'array', items: { type: 'string' } }
        }
      },
      return_updated: {
        type: 'boolean',
        description: 'Return the updated vCon',
        default: true
      }
    },
    required: ['uuid', 'updates']
  }
};

// Export all tools as an array
export const allTools = [
  createVConTool,
  getVConTool,
  searchVConsTool,
  searchVConsContentTool,
  searchVConsSemanticTool,
  searchVConsHybridTool,
  addAnalysisTool,
  addDialogTool,
  addAttachmentTool,
  deleteVConTool,
  updateVConTool,
];

