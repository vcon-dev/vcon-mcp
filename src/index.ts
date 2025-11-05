#!/usr/bin/env node

/**
 * vCon MCP Server
 * 
 * Model Context Protocol server for IETF vCon operations
 * ✅ Fully compliant with draft-ietf-vcon-vcon-core-00
 * ✅ All 7 critical corrections implemented
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import http from 'http';
import { randomUUID } from 'crypto';
import { getSupabaseClient, getRedisClient, closeAllConnections } from './db/client.js';
import { VConQueries } from './db/queries.js';
import { validateVCon, validateAnalysis } from './utils/validation.js';
import {
  allTools,
  AnalysisSchema,
  DialogSchema,
  PartySchema,
  AttachmentSchema
} from './tools/vcon-crud.js';
import { VCon, Analysis, Dialog, Attachment } from './types/vcon.js';
import { createFromTemplateTool, buildTemplateVCon } from './tools/templates.js';
import { getSchemaTool, getExamplesTool } from './tools/schema-tools.js';
import { allDatabaseTools } from './tools/database-tools.js';
import { allDatabaseAnalyticsTools } from './tools/database-analytics.js';
import { allDatabaseSizeTools } from './tools/database-size-tools.js';
import { allTagTools } from './tools/tag-tools.js';
import { PluginManager } from './hooks/plugin-manager.js';
import { RequestContext } from './hooks/plugin-interface.js';
import { getCoreResources, resolveCoreResource } from './resources/index.js';
import { DatabaseInspector } from './db/database-inspector.js';
import { DatabaseAnalytics } from './db/database-analytics.js';
import { DatabaseSizeAnalyzer } from './db/database-size-analyzer.js';
import { allPrompts, generatePromptMessage } from './prompts/index.js';
import { initializeObservability, shutdownObservability } from './observability/config.js';
import { withSpan, recordCounter, recordHistogram, logWithContext, attachErrorToSpan } from './observability/instrumentation.js';
import { ATTR_TOOL_NAME, ATTR_TOOL_SUCCESS, ATTR_VCON_UUID, ATTR_SEARCH_TYPE, ATTR_SEARCH_RESULTS_COUNT } from './observability/attributes.js';

// Load environment variables
dotenv.config();

// Initialize observability
await initializeObservability();

// Initialize MCP server
const server = new Server(
  {
    name: 'vcon-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// Initialize database and cache
let queries: VConQueries;
let dbInspector: DatabaseInspector;
let dbAnalytics: DatabaseAnalytics;
let dbSizeAnalyzer: DatabaseSizeAnalyzer;
let supabase: any;
let redis: any;

try {
  supabase = getSupabaseClient();
  redis = getRedisClient(); // Optional - returns null if not configured
  queries = new VConQueries(supabase, redis);
  dbInspector = new DatabaseInspector(supabase);
  dbAnalytics = new DatabaseAnalytics(supabase);
  dbSizeAnalyzer = new DatabaseSizeAnalyzer(supabase);
  console.error('✅ Database client initialized');
} catch (error) {
  console.error('❌ Failed to initialize database:', error);
  process.exit(1);
}

// Initialize plugin manager
const pluginManager = new PluginManager();

// Load plugins from environment/config
if (process.env.VCON_PLUGINS_PATH) {
  const pluginPaths = process.env.VCON_PLUGINS_PATH.split(',');
  for (const path of pluginPaths) {
    try {
      const trimmedPath = path.trim();
      console.error(`🔌 Loading plugin from: ${trimmedPath}`);
      
      // Resolve plugin path - if it starts with ./ or ../, resolve relative to cwd
      let resolvedPath = trimmedPath;
      if (trimmedPath.startsWith('./') || trimmedPath.startsWith('../')) {
        // Use URL to properly resolve the path relative to cwd
        resolvedPath = new URL(trimmedPath, `file://${process.cwd()}/`).href;
      } else if (!trimmedPath.startsWith('@') && !trimmedPath.startsWith('file://')) {
        // Absolute paths or package names are used as-is
        resolvedPath = trimmedPath;
      }
      
      const pluginModule = await import(resolvedPath);
      const PluginClass = pluginModule.default;
      
      // Create plugin instance with config
      const pluginConfig = {
        licenseKey: process.env.VCON_LICENSE_KEY,
        supabase,
        offlineMode: process.env.VCON_OFFLINE_MODE === 'true'
      };
      
      const plugin = new PluginClass(pluginConfig);
      pluginManager.registerPlugin(plugin);
    } catch (error) {
      console.error(`❌ Failed to load plugin from ${path}:`, error);
      // Continue without the plugin
    }
  }
}

// Initialize plugins
await pluginManager.initialize({ supabase, queries });

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize and validate ISO 8601 date strings
 * Trims whitespace and validates the format
 * 
 * @param dateStr - Date string to normalize
 * @returns Normalized date string or undefined if invalid
 * @throws McpError if date format is invalid
 */
function normalizeDateString(dateStr: string | undefined): string | undefined {
  if (!dateStr) return undefined;
  
  const trimmed = dateStr.trim();
  if (!trimmed) return undefined;
  
  // Validate ISO 8601 format (supports Z, +/-HH:MM, +/-HHMM, and +/-HH)
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2}?)$/;
  if (!iso8601Regex.test(trimmed)) {
    // Try parsing as Date to provide better error message
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid date format: "${dateStr}". Expected ISO 8601 format (e.g., "2025-01-15T14:30:00Z" or "2025-01-15T14:30:00-05:00")`
      );
    }
    // If it's a valid Date but not ISO format, convert it to ISO
    return parsed.toISOString();
  }
  
  return trimmed;
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const transportType = process.env.MCP_TRANSPORT || 'stdio';
  const requestId = randomUUID();
  
  logWithContext('info', 'MCP list tools request received', {
    request_id: requestId,
    transport: transportType,
  });
  
  const coreTools = allTools;
  const pluginTools = await pluginManager.getAdditionalTools();
  const extras = [createFromTemplateTool, getSchemaTool, getExamplesTool];
  
  const tools = [...coreTools, ...extras, ...allDatabaseTools, ...allDatabaseAnalyticsTools, ...allDatabaseSizeTools, ...allTagTools, ...pluginTools];
  
  logWithContext('debug', 'MCP tools listed', {
    request_id: requestId,
    transport: transportType,
    total_tools: tools.length,
    core_tools: coreTools.length,
    plugin_tools: pluginTools.length,
  });
  
  return {
    tools,
  };
});

/**
 * List available resources
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const transportType = process.env.MCP_TRANSPORT || 'stdio';
  const requestId = randomUUID();
  
  logWithContext('info', 'MCP list resources request received', {
    request_id: requestId,
    transport: transportType,
  });
  
  const core = getCoreResources().map(r => ({ 
    uri: r.uri, 
    name: r.name, 
    description: r.description,
    mimeType: r.mimeType 
  }));
  const pluginResources = await pluginManager.getAdditionalResources();
  
  logWithContext('debug', 'MCP resources listed', {
    request_id: requestId,
    transport: transportType,
    total_resources: core.length + pluginResources.length,
    core_resources: core.length,
    plugin_resources: pluginResources.length,
  });
  
  return { resources: [...core, ...pluginResources] };
});

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const requestId = randomUUID();
  const transportType = process.env.MCP_TRANSPORT || 'stdio';
  
  // Log incoming tool request (works for both HTTP and STDIO)
  logWithContext('info', 'MCP tool request received', {
    request_id: requestId,
    transport: transportType,
    tool_name: name,
    has_arguments: !!args,
    argument_keys: args ? Object.keys(args).join(', ') : 'none',
  });
  
  return withSpan(`mcp.tool.${name}`, async (span) => {
    const startTime = Date.now();
    
    span.setAttributes({
      [ATTR_TOOL_NAME]: name,
    });

    try {
      let result;
      
      switch (name) {
      // ========================================================================
      // Create vCon
      // ========================================================================
      case 'create_vcon': {
        const context: RequestContext = {
          timestamp: new Date(),
          userId: args?.user_id as string | undefined,
          purpose: args?.purpose as string | undefined,
        };
        
        let vcon: VCon = {
          vcon: '0.3.0',
          uuid: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          subject: args?.subject as string | undefined,
          parties: (args?.parties as any[]) || [],
          extensions: args?.extensions as string[] | undefined,
          must_support: args?.must_support as string[] | undefined,
        };

        // Hook: beforeCreate
        const modifiedVCon = await pluginManager.executeHook<VCon>('beforeCreate', vcon, context);
        if (modifiedVCon) vcon = modifiedVCon;

        // Validate before saving
        const validation = validateVCon(vcon);
        if (!validation.valid) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `vCon validation failed: ${validation.errors.join(', ')}`
          );
        }

        const createResult = await queries.createVCon(vcon);
        
        // Hook: afterCreate
        await pluginManager.executeHook('afterCreate', vcon, context);
        
        // Record vCon creation metric
        recordCounter('vcon.created.count', 1, {
          [ATTR_VCON_UUID]: createResult.uuid,
        }, 'vCon creation count');
        
        span.setAttributes({
          [ATTR_VCON_UUID]: createResult.uuid,
        });
        
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              uuid: createResult.uuid,
              message: `Created vCon with UUID: ${createResult.uuid}`,
              vcon: vcon
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Create vCon from Template
      // ========================================================================
      case 'create_vcon_from_template': {
        const template = args?.template_name as string;
        const parties = (args?.parties as any[]) || [];
        const subject = args?.subject as string | undefined;
        if (!template || !Array.isArray(parties) || parties.length === 0) {
          throw new McpError(ErrorCode.InvalidParams, 'template_name and parties are required');
        }

        let vcon = buildTemplateVCon(template, subject, parties);

        const context: RequestContext = {
          timestamp: new Date(),
          userId: args?.user_id as string | undefined,
          purpose: args?.purpose as string | undefined,
        };

        const modifiedVCon = await pluginManager.executeHook<VCon>('beforeCreate', vcon, context);
        if (modifiedVCon) vcon = modifiedVCon;

        const validation = validateVCon(vcon);
        if (!validation.valid) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `vCon validation failed: ${validation.errors.join(', ')}`
          );
        }

        const templateResult = await queries.createVCon(vcon);
        await pluginManager.executeHook('afterCreate', vcon, context);

        recordCounter('vcon.created.count', 1, {
          [ATTR_VCON_UUID]: templateResult.uuid,
        }, 'vCon creation count');
        
        span.setAttributes({
          [ATTR_VCON_UUID]: templateResult.uuid,
        });

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, uuid: templateResult.uuid, vcon }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Get vCon
      // ========================================================================
      case 'get_vcon': {
        const uuid = args?.uuid as string;
        const context: RequestContext = {
          timestamp: new Date(),
          userId: args?.user_id as string | undefined,
          purpose: args?.purpose as string | undefined,
        };
        
        if (!uuid) {
          throw new McpError(ErrorCode.InvalidParams, 'UUID is required');
        }

        // Hook: beforeRead (can throw to block access)
        await pluginManager.executeHook('beforeRead', uuid, context);

        let vcon = await queries.getVCon(uuid);
        
        // Hook: afterRead (can modify returned data)
        const filteredVCon = await pluginManager.executeHook<VCon>('afterRead', vcon, context);
        if (filteredVCon) vcon = filteredVCon;
        
        span.setAttributes({
          [ATTR_VCON_UUID]: uuid,
        });
        
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              vcon: vcon
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Search vCons
      // ========================================================================
      case 'search_vcons': {
        const context: RequestContext = {
          timestamp: new Date(),
          userId: args?.user_id as string | undefined,
          purpose: args?.purpose as string | undefined,
        };
        
        const responseFormat = (args?.response_format as string | undefined) || 'metadata';
        const includeCount = (args?.include_count as boolean | undefined) || false;
        
        let filters = {
          subject: args?.subject as string | undefined,
          partyName: args?.party_name as string | undefined,
          partyEmail: args?.party_email as string | undefined,
          partyTel: args?.party_tel as string | undefined,
          startDate: normalizeDateString(args?.start_date as string | undefined),
          endDate: normalizeDateString(args?.end_date as string | undefined),
          limit: (args?.limit as number | undefined) || 10,
        };

        // Hook: beforeSearch (can modify search criteria)
        const modifiedFilters = await pluginManager.executeHook<typeof filters>('beforeSearch', filters, context);
        if (modifiedFilters) filters = modifiedFilters;

        let results;
        try {
          results = await queries.searchVCons(filters);
        } catch (dbError: any) {
          // Improve error messages for database connection issues
          if (dbError instanceof TypeError && dbError.message.includes('fetch failed')) {
            throw new McpError(
              ErrorCode.InternalError,
              `Database connection failed: Unable to reach Supabase database. ` +
              `Please check: 1) Network connectivity, 2) SUPABASE_URL is correct, 3) Supabase service is available. ` +
              `Details: ${dbError.message}`
            );
          }
          // Re-throw other errors as-is (they'll be handled by the outer catch)
          throw dbError;
        }
        
        // Hook: afterSearch (can filter or modify results)
        const filteredResults = await pluginManager.executeHook<VCon[]>('afterSearch', results, context);
        if (filteredResults) results = filteredResults;
        
        // Format response based on requested format
        let formattedResults;
        if (responseFormat === 'ids_only') {
          formattedResults = results.map(vcon => vcon.uuid);
        } else if (responseFormat === 'metadata') {
          formattedResults = results.map(vcon => ({
            uuid: vcon.uuid,
            subject: vcon.subject,
            created_at: vcon.created_at,
            parties_count: vcon.parties?.length || 0,
            dialog_count: vcon.dialog?.length || 0,
            analysis_count: vcon.analysis?.length || 0,
            attachments_count: vcon.attachments?.length || 0
          }));
        } else {
          formattedResults = results;
        }

        // Get total count if requested (uses efficient count query, not limited by 1000 rows)
        let totalCount;
        if (includeCount) {
          try {
            // Use count query instead of fetching all results (bypasses Supabase 1000 limit)
            totalCount = await queries.searchVConsCount({
              subject: filters.subject,
              partyName: filters.partyName,
              partyEmail: filters.partyEmail,
              partyTel: filters.partyTel,
              startDate: filters.startDate,
              endDate: filters.endDate,
            });
          } catch (countError: any) {
            // Log count error but don't fail the entire request
            logWithContext('warn', 'Failed to get total count for search', {
              tool_name: name,
              error_message: countError instanceof Error ? countError.message : String(countError),
            });
            // Continue without total count
          }
        }
        
        recordCounter('vcon.search.count', 1, {
          [ATTR_SEARCH_TYPE]: 'basic',
        }, 'vCon search count');
        
        span.setAttributes({
          [ATTR_SEARCH_TYPE]: 'basic',
          [ATTR_SEARCH_RESULTS_COUNT]: results.length,
        });
        
        const response: any = {
          success: true,
          count: results.length,
          response_format: responseFormat,
          results: formattedResults
        };
        
        if (totalCount !== undefined) {
          response.total_count = totalCount;
        }
        
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify(response, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Search vCon Content (Keyword)
      // ========================================================================
      case 'search_vcons_content': {
        const query = args?.query as string;
        if (!query) {
          throw new McpError(ErrorCode.InvalidParams, 'query is required');
        }

        const responseFormat = (args?.response_format as string | undefined) || 'snippets';
        const includeCount = (args?.include_count as boolean | undefined) || false;

        const results = await queries.keywordSearch({
          query,
          startDate: normalizeDateString(args?.start_date as string | undefined),
          endDate: normalizeDateString(args?.end_date as string | undefined),
          tags: args?.tags as Record<string, string> | undefined,
          limit: (args?.limit as number | undefined) || 50,
        });

        // Format response based on requested format
        let formattedResults;
        if (responseFormat === 'ids_only') {
          formattedResults = results.map(r => r.vcon_id);
        } else if (responseFormat === 'metadata') {
          formattedResults = results.map(r => ({
            vcon_id: r.vcon_id,
            content_type: r.doc_type,
            relevance_score: r.rank
          }));
        } else if (responseFormat === 'snippets') {
          formattedResults = results.map(r => ({
            vcon_id: r.vcon_id,
            content_type: r.doc_type,
            content_index: r.ref_index,
            relevance_score: r.rank,
            snippet: r.snippet
          }));
        } else {
          // Full format - get complete vCons
          const vconIds = [...new Set(results.map(r => r.vcon_id))];
          const fullVCons = await Promise.all(
            vconIds.slice(0, 20).map(id => queries.getVCon(id)) // Limit to 20 for memory safety
          );
          formattedResults = fullVCons;
        }

        // Get total count if requested
        let totalCount;
        if (includeCount) {
          const countResults = await queries.keywordSearch({
            query,
            startDate: args?.start_date as string | undefined,
            endDate: args?.end_date as string | undefined,
            tags: args?.tags as Record<string, string> | undefined,
            limit: undefined,
          });
          totalCount = countResults.length;
        }

        recordCounter('vcon.search.count', 1, {
          [ATTR_SEARCH_TYPE]: 'keyword',
        }, 'vCon search count');
        
        span.setAttributes({
          [ATTR_SEARCH_TYPE]: 'keyword',
          [ATTR_SEARCH_RESULTS_COUNT]: results.length,
        });
        
        const response: any = {
          success: true,
          count: results.length,
          response_format: responseFormat,
          results: formattedResults
        };
        
        if (totalCount !== undefined) {
          response.total_count = totalCount;
        }
        
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify(response, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Search vCons Semantic
      // ========================================================================
      case 'search_vcons_semantic': {
        let embedding = args?.embedding as number[] | undefined;
        const query = args?.query as string | undefined;

        // If no embedding provided but query is, generate embedding
        if (!embedding && query) {
          // For now, require pre-computed embeddings
          throw new McpError(
            ErrorCode.InvalidParams,
            'Embedding generation not yet implemented. Please provide a pre-computed embedding vector (384 dimensions) or use search_vcons_content for keyword search.'
          );
        }

        if (!embedding) {
          throw new McpError(ErrorCode.InvalidParams, 'Either embedding or query is required');
        }

        if (embedding.length !== 384) {
          throw new McpError(ErrorCode.InvalidParams, 'Embedding must be 384 dimensions');
        }

        const results = await queries.semanticSearch({
          embedding,
          tags: args?.tags as Record<string, string> | undefined,
          threshold: (args?.threshold as number | undefined) || 0.7,
          limit: (args?.limit as number | undefined) || 50,
        });

        recordCounter('vcon.search.count', 1, {
          [ATTR_SEARCH_TYPE]: 'semantic',
        }, 'vCon search count');
        
        span.setAttributes({
          [ATTR_SEARCH_TYPE]: 'semantic',
          [ATTR_SEARCH_RESULTS_COUNT]: results.length,
        });

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: results.length,
              results: results.map(r => ({
                vcon_id: r.vcon_id,
                content_type: r.content_type,
                content_reference: r.content_reference,
                content_text: r.content_text,
                similarity_score: r.similarity
              }))
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Search vCons Hybrid
      // ========================================================================
      case 'search_vcons_hybrid': {
        const query = args?.query as string;
        let embedding = args?.embedding as number[] | undefined;

        if (!query) {
          throw new McpError(ErrorCode.InvalidParams, 'query is required');
        }

        // If embedding provided but wrong size, reject
        if (embedding && embedding.length !== 384) {
          throw new McpError(ErrorCode.InvalidParams, 'Embedding must be 384 dimensions');
        }

        // If no embedding provided, use keyword-only search
        if (!embedding) {
          console.error('⚠️  No embedding provided for hybrid search, falling back to keyword-only');
        }

        const results = await queries.hybridSearch({
          keywordQuery: query,
          embedding: embedding,
          tags: args?.tags as Record<string, string> | undefined,
          semanticWeight: (args?.semantic_weight as number | undefined) || 0.6,
          limit: (args?.limit as number | undefined) || 50,
        });

        recordCounter('vcon.search.count', 1, {
          [ATTR_SEARCH_TYPE]: 'hybrid',
        }, 'vCon search count');
        
        span.setAttributes({
          [ATTR_SEARCH_TYPE]: 'hybrid',
          [ATTR_SEARCH_RESULTS_COUNT]: results.length,
        });

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: results.length,
              results: results.map(r => ({
                vcon_id: r.vcon_id,
                combined_score: r.combined_score,
                semantic_score: r.semantic_score,
                keyword_score: r.keyword_score
              }))
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Add Analysis
      // ✅ CRITICAL: Enforces vendor requirement and correct field names
      // ========================================================================
      case 'add_analysis': {
        const vconUuid = args?.vcon_uuid as string;
        const analysisData = args?.analysis;

        if (!vconUuid) {
          throw new McpError(ErrorCode.InvalidParams, 'vcon_uuid is required');
        }

        if (!analysisData) {
          throw new McpError(ErrorCode.InvalidParams, 'analysis is required');
        }

        // ✅ CRITICAL: Validate that vendor is provided
        if (!analysisData || !(analysisData as any).vendor) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Analysis vendor is REQUIRED per IETF spec Section 4.5.5'
          );
        }

        // Parse and validate with Zod
        const analysis = AnalysisSchema.parse(analysisData) as Analysis;

        // Additional validation
        const validation = validateAnalysis(analysis);
        if (!validation.valid) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Analysis validation failed: ${validation.errors.join(', ')}`
          );
        }

        await queries.addAnalysis(vconUuid, analysis);
        
        span.setAttributes({
          [ATTR_VCON_UUID]: vconUuid,
        });
        
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Added ${analysis.type} analysis from ${analysis.vendor} to vCon ${vconUuid}`,
              analysis: analysis
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Add Dialog
      // ✅ Includes new fields: session_id, application, message_id
      // ========================================================================
      case 'add_dialog': {
        const vconUuid = args?.vcon_uuid as string;
        const dialogData = args?.dialog;

        if (!vconUuid) {
          throw new McpError(ErrorCode.InvalidParams, 'vcon_uuid is required');
        }

        if (!dialogData) {
          throw new McpError(ErrorCode.InvalidParams, 'dialog is required');
        }

        // Parse and validate
        const dialog = DialogSchema.parse(dialogData) as Dialog;

        await queries.addDialog(vconUuid, dialog);
        
        span.setAttributes({
          [ATTR_VCON_UUID]: vconUuid,
        });
        
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Added ${dialog.type} dialog to vCon ${vconUuid}`,
              dialog: dialog
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Add Attachment
      // ✅ Includes dialog reference
      // ========================================================================
      case 'add_attachment': {
        const vconUuid = args?.vcon_uuid as string;
        const attachmentData = args?.attachment;

        if (!vconUuid) {
          throw new McpError(ErrorCode.InvalidParams, 'vcon_uuid is required');
        }

        if (!attachmentData) {
          throw new McpError(ErrorCode.InvalidParams, 'attachment is required');
        }

        // Parse and validate
        const attachment = AttachmentSchema.parse(attachmentData) as Attachment;

        await queries.addAttachment(vconUuid, attachment);
        
        span.setAttributes({
          [ATTR_VCON_UUID]: vconUuid,
        });
        
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Added attachment to vCon ${vconUuid}`,
              attachment: attachment
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Delete vCon
      // ========================================================================
      case 'delete_vcon': {
        const uuid = args?.uuid as string;
        const context: RequestContext = {
          timestamp: new Date(),
          userId: args?.user_id as string | undefined,
          purpose: args?.purpose as string | undefined,
        };
        
        if (!uuid) {
          throw new McpError(ErrorCode.InvalidParams, 'UUID is required');
        }

        // Hook: beforeDelete (can throw to prevent deletion)
        await pluginManager.executeHook('beforeDelete', uuid, context);

        await queries.deleteVCon(uuid);
        
        // Hook: afterDelete
        await pluginManager.executeHook('afterDelete', uuid, context);
        
        recordCounter('vcon.deleted.count', 1, {
          [ATTR_VCON_UUID]: uuid,
        }, 'vCon deletion count');
        
        span.setAttributes({
          [ATTR_VCON_UUID]: uuid,
        });
        
        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Deleted vCon ${uuid}`
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Update vCon (metadata)
      // ========================================================================
      case 'update_vcon': {
        const uuid = args?.uuid as string;
        const updates = args?.updates as Partial<VCon> | undefined;
        const returnUpdated = (args?.return_updated as boolean | undefined) ?? true;

        if (!uuid) {
          throw new McpError(ErrorCode.InvalidParams, 'UUID is required');
        }
        if (!updates || typeof updates !== 'object') {
          throw new McpError(ErrorCode.InvalidParams, 'updates object is required');
        }

        // Whitelist fields
        const allowed: Partial<VCon> = {} as Partial<VCon>;
        if (Object.prototype.hasOwnProperty.call(updates, 'subject')) {
          allowed.subject = updates.subject;
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'extensions')) {
          allowed.extensions = updates.extensions;
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'must_support')) {
          allowed.must_support = updates.must_support as string[] | undefined;
        }

        const context: RequestContext = {
          timestamp: new Date(),
          userId: args?.user_id as string | undefined,
          purpose: args?.purpose as string | undefined,
        };

        // Hook: beforeUpdate
        await pluginManager.executeHook('beforeUpdate', uuid, allowed, context);

        await queries.updateVCon(uuid, allowed);

        // Hook: afterUpdate
        span.setAttributes({
          [ATTR_VCON_UUID]: uuid,
        });
        
        if (returnUpdated) {
          let updated = await queries.getVCon(uuid);
          const modified = await pluginManager.executeHook<VCon>('afterUpdate', updated, context);
          if (modified) updated = modified;
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, vcon: updated }, null, 2),
            }],
          };
        } else {
          await pluginManager.executeHook('afterUpdate', await queries.getVCon(uuid), context);
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `Updated vCon ${uuid}` }, null, 2),
            }],
          };
        }
        break;
      }

      // ========================================================================
      // Get Database Shape
      // ========================================================================
      case 'get_database_shape': {
        const includeCounts = (args?.include_counts as boolean | undefined) ?? true;
        const includeSizes = (args?.include_sizes as boolean | undefined) ?? true;
        const includeIndexes = (args?.include_indexes as boolean | undefined) ?? true;
        const includeColumns = (args?.include_columns as boolean | undefined) ?? false;

        const shape = await dbInspector.getDatabaseShape({
          includeCounts,
          includeSizes,
          includeIndexes,
          includeColumns,
        });

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              database_shape: shape
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Get Database Stats
      // ========================================================================
      case 'get_database_stats': {
        const includeQueryStats = (args?.include_query_stats as boolean | undefined) ?? true;
        const includeIndexUsage = (args?.include_index_usage as boolean | undefined) ?? true;
        const includeCacheStats = (args?.include_cache_stats as boolean | undefined) ?? true;
        const tableName = args?.table_name as string | undefined;

        const stats = await dbInspector.getDatabaseStats({
          includeQueryStats,
          includeIndexUsage,
          includeCacheStats,
          tableName,
        });

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              database_stats: stats
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Analyze Query
      // ========================================================================
      case 'analyze_query': {
        const query = args?.query as string;
        const analyzeMode = (args?.analyze_mode as 'explain' | 'explain_analyze' | undefined) || 'explain';

        if (!query) {
          throw new McpError(ErrorCode.InvalidParams, 'query is required');
        }

        const analysis = await dbInspector.analyzeQuery(query, analyzeMode);

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              query_analysis: analysis
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Get Database Analytics
      // ========================================================================
      case 'get_database_analytics': {
        const options = {
          includeGrowthTrends: args?.include_growth_trends as boolean | undefined,
          includeContentAnalytics: args?.include_content_analytics as boolean | undefined,
          includeAttachmentStats: args?.include_attachment_stats as boolean | undefined,
          includeTagAnalytics: args?.include_tag_analytics as boolean | undefined,
          includeHealthMetrics: args?.include_health_metrics as boolean | undefined,
          monthsBack: args?.months_back as number | undefined,
        };

        const analytics = await dbAnalytics.getDatabaseAnalytics(options);

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              database_analytics: analytics
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Get Monthly Growth Analytics
      // ========================================================================
      case 'get_monthly_growth_analytics': {
        const options = {
          monthsBack: args?.months_back as number | undefined,
          includeProjections: args?.include_projections as boolean | undefined,
          granularity: args?.granularity as 'monthly' | 'weekly' | 'daily' | undefined,
        };

        const growth = await dbAnalytics.getMonthlyGrowthAnalytics(options);

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              monthly_growth_analytics: growth
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Get Attachment Analytics
      // ========================================================================
      case 'get_attachment_analytics': {
        const options = {
          includeSizeDistribution: args?.include_size_distribution as boolean | undefined,
          includeTypeBreakdown: args?.include_type_breakdown as boolean | undefined,
          includeTemporalPatterns: args?.include_temporal_patterns as boolean | undefined,
          topNTypes: args?.top_n_types as number | undefined,
        };

        const analytics = await dbAnalytics.getAttachmentAnalytics(options);

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              attachment_analytics: analytics
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Get Tag Analytics
      // ========================================================================
      case 'get_tag_analytics': {
        const options = {
          includeFrequencyAnalysis: args?.include_frequency_analysis as boolean | undefined,
          includeValueDistribution: args?.include_value_distribution as boolean | undefined,
          includeTemporalTrends: args?.include_temporal_trends as boolean | undefined,
          topNKeys: args?.top_n_keys as number | undefined,
          minUsageCount: args?.min_usage_count as number | undefined,
        };

        const analytics = await dbAnalytics.getTagAnalytics(options);

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              tag_analytics: analytics
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Get Content Analytics
      // ========================================================================
      case 'get_content_analytics': {
        const options = {
          includeDialogAnalysis: args?.include_dialog_analysis as boolean | undefined,
          includeAnalysisBreakdown: args?.include_analysis_breakdown as boolean | undefined,
          includePartyPatterns: args?.include_party_patterns as boolean | undefined,
          includeConversationMetrics: args?.include_conversation_metrics as boolean | undefined,
          includeTemporalContent: args?.include_temporal_content as boolean | undefined,
        };

        const analytics = await dbAnalytics.getContentAnalytics(options);

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              content_analytics: analytics
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Get Database Health Metrics
      // ========================================================================
      case 'get_database_health_metrics': {
        const options = {
          includePerformanceMetrics: args?.include_performance_metrics as boolean | undefined,
          includeStorageEfficiency: args?.include_storage_efficiency as boolean | undefined,
          includeIndexHealth: args?.include_index_health as boolean | undefined,
          includeConnectionMetrics: args?.include_connection_metrics as boolean | undefined,
          includeRecommendations: args?.include_recommendations as boolean | undefined,
        };

        const health = await dbAnalytics.getDatabaseHealthMetrics(options);

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              database_health_metrics: health
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Get Database Size Info
      // ========================================================================
      case 'get_database_size_info': {
        const includeRecommendations = (args?.include_recommendations as boolean | undefined) ?? true;

        const sizeInfo = await dbSizeAnalyzer.getDatabaseSizeInfo(includeRecommendations);

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              database_size_info: sizeInfo
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Get Smart Search Limits
      // ========================================================================
      case 'get_smart_search_limits': {
        const queryType = args?.query_type as string;
        const estimatedResultSize = (args?.estimated_result_size as string | undefined) || 'unknown';

        if (!queryType) {
          throw new McpError(ErrorCode.InvalidParams, 'query_type is required');
        }

        const smartLimits = await dbSizeAnalyzer.getSmartSearchLimits(queryType, estimatedResultSize);

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              smart_limits: smartLimits
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Manage Tag (consolidated: add, update, remove)
      // ========================================================================
      case 'manage_tag': {
        const vconUuid = args?.vcon_uuid as string;
        const action = args?.action as string;
        const key = args?.key as string;
        const value = args?.value;

        if (!vconUuid || !action || !key) {
          throw new McpError(ErrorCode.InvalidParams, 'vcon_uuid, action, and key are required');
        }

        span.setAttributes({
          [ATTR_VCON_UUID]: vconUuid,
        });
        
        if (action === 'set') {
          if (value === undefined || value === null) {
            throw new McpError(ErrorCode.InvalidParams, 'value is required when action is "set"');
          }
          await queries.addTag(vconUuid, key, value as string | number | boolean, true);
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Tag '${key}' set on vCon ${vconUuid}`,
                action: 'set',
                key: key,
                value: String(value)
              }, null, 2),
            }],
          };
        } else if (action === 'remove') {
          await queries.removeTag(vconUuid, key);
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Tag '${key}' removed from vCon ${vconUuid}`,
                action: 'remove',
                key: key
              }, null, 2),
            }],
          };
        } else {
          throw new McpError(ErrorCode.InvalidParams, 'action must be "set" or "remove"');
        }
        break;
      }

      // ========================================================================
      // Get Tags (consolidated: get one or all)
      // ========================================================================
      case 'get_tags': {
        const vconUuid = args?.vcon_uuid as string;
        const key = args?.key as string | undefined;
        const defaultValue = args?.default_value;

        if (!vconUuid) {
          throw new McpError(ErrorCode.InvalidParams, 'vcon_uuid is required');
        }

        span.setAttributes({
          [ATTR_VCON_UUID]: vconUuid,
        });
        
        if (key) {
          // Get single tag
          const value = await queries.getTag(vconUuid, key, defaultValue);
          const exists = value !== defaultValue;
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                key: key,
                value: value,
                exists: exists
              }, null, 2),
            }],
          };
        } else {
          // Get all tags
          const tags = await queries.getTags(vconUuid);
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                vcon_uuid: vconUuid,
                tags: tags,
                count: Object.keys(tags).length
              }, null, 2),
            }],
          };
        }
        break;
      }

      // ========================================================================
      // Remove All Tags
      // ========================================================================
      case 'remove_all_tags': {
        const vconUuid = args?.vcon_uuid as string;

        if (!vconUuid) {
          throw new McpError(ErrorCode.InvalidParams, 'vcon_uuid is required');
        }

        await queries.removeAllTags(vconUuid);

        span.setAttributes({
          [ATTR_VCON_UUID]: vconUuid,
        });

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `All tags removed from vCon ${vconUuid}`
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Search by Tags
      // ========================================================================
      case 'search_by_tags': {
        const tags = args?.tags as Record<string, string>;
        const limit = (args?.limit as number | undefined) || 50;
        const returnFullVCons = args?.return_full_vcons as boolean | undefined;
        const maxFullVCons = (args?.max_full_vcons as number | undefined) || 20;

        if (!tags || typeof tags !== 'object' || Object.keys(tags).length === 0) {
          throw new McpError(ErrorCode.InvalidParams, 'tags object with at least one key-value pair is required');
        }

        const vconUuids = await queries.searchByTags(tags, limit);

        // Determine if we should return full vCons
        // Default behavior: return full vCons for small result sets (<= 20), only UUIDs for larger sets
        const shouldReturnFull = returnFullVCons ?? (vconUuids.length <= 20);
        
        // Limit number of full vCons to prevent size issues
        const numFullVCons = shouldReturnFull 
          ? Math.min(vconUuids.length, maxFullVCons)
          : 0;

        let fullVCons: any[] = [];
        if (numFullVCons > 0) {
          fullVCons = await Promise.all(
            vconUuids.slice(0, numFullVCons).map(uuid => queries.getVCon(uuid))
          );
        }

        recordCounter('vcon.search.count', 1, {
          [ATTR_SEARCH_TYPE]: 'tags',
        }, 'vCon search count');
        
        span.setAttributes({
          [ATTR_SEARCH_TYPE]: 'tags',
          [ATTR_SEARCH_RESULTS_COUNT]: vconUuids.length,
        });

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

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify(response, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // Get Unique Tags
      // ========================================================================
      case 'get_unique_tags': {
        const includeCounts = (args?.include_counts as boolean | undefined) ?? false;
        const keyFilter = args?.key_filter as string | undefined;
        const minCount = (args?.min_count as number | undefined) ?? 1;

        const uniqueTagsResult = await queries.getUniqueTags({
          includeCounts,
          keyFilter,
          minCount
        });

        result = {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
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
            }, null, 2),
          }],
        };
        break;
      }

      // ========================================================================
      // get_schema
      // ========================================================================
      case 'get_schema': {
        const format = (args?.format as string | undefined) ?? 'json_schema';
        if (format === 'json_schema') {
          // Avoid adding dependency at runtime: provide a minimal hand-authored schema envelope if needed later
          // For now, return a simple note since generating from zod is out-of-scope without new deps during runtime
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                note: 'JSON Schema export requires zod-to-json-schema. Add dependency and implement conversion.',
              }, null, 2)
            }]
          };
        } else if (format === 'typescript') {
          // Return informative pointer to types
          result = {
            content: [{
              type: 'text',
              text: 'See src/types/vcon.ts for TypeScript interfaces.'
            }]
          };
        } else {
          throw new McpError(ErrorCode.InvalidParams, `Unsupported schema format: ${format}`);
        }
        break;
      }

      // ========================================================================
      // get_examples
      // ========================================================================
      case 'get_examples': {
        const exampleType = args?.example_type as string;
        const format = (args?.format as string | undefined) ?? 'json';
        const examples: Record<string, any> = {
          minimal: { vcon: '0.3.0', uuid: crypto.randomUUID(), created_at: new Date().toISOString(), parties: [{ name: 'Agent' }] },
          phone_call: { vcon: '0.3.0', uuid: crypto.randomUUID(), created_at: new Date().toISOString(), subject: 'Phone Call', parties: [{ name: 'Caller' }, { name: 'Agent' }], dialog: [] },
          chat: { vcon: '0.3.0', uuid: crypto.randomUUID(), created_at: new Date().toISOString(), subject: 'Chat', parties: [{ name: 'User' }, { name: 'Support' }], dialog: [] },
          email: { vcon: '0.3.0', uuid: crypto.randomUUID(), created_at: new Date().toISOString(), subject: 'Email Thread', parties: [{ mailto: 'a@example.com' }, { mailto: 'b@example.com' }], attachments: [] },
          video: { vcon: '0.3.0', uuid: crypto.randomUUID(), created_at: new Date().toISOString(), subject: 'Video Meeting', parties: [{ name: 'Host' }], dialog: [] },
          full_featured: {
            vcon: '0.3.0', uuid: crypto.randomUUID(), created_at: new Date().toISOString(), subject: 'Full Example',
            parties: [{ name: 'Alice' }, { name: 'Bob' }], dialog: [], analysis: [], attachments: []
          }
        };
        const data = examples[exampleType];
        if (!data) {
          throw new McpError(ErrorCode.InvalidParams, `Unknown example_type: ${exampleType}`);
        }
        if (format === 'json') {
          result = { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        } else if (format === 'yaml') {
          // naive YAML export without extra deps
          const yaml = `vcon: ${data.vcon}\nuuid: ${data.uuid}\ncreated_at: ${data.created_at}`;
          result = { content: [{ type: 'text', text: yaml }] };
        } else {
          throw new McpError(ErrorCode.InvalidParams, `Unsupported format: ${format}`);
        }
        break;
      }

      // ========================================================================
      // Plugin tools - delegate to plugins
      // ========================================================================
      default:
        // Check if this is a plugin tool
        const pluginTools = await pluginManager.getAdditionalTools();
        const pluginTool = pluginTools.find(t => t.name === name);
        
        if (pluginTool) {
          // Delegate to plugin
          const context: RequestContext = {
            timestamp: new Date(),
            userId: args?.user_id as string | undefined,
            purpose: args?.purpose as string | undefined,
          };
          
          const pluginResult = await pluginManager.handlePluginToolCall(name, args, context);
          
          if (pluginResult) {
            result = {
              content: [{
                type: 'text',
                text: typeof pluginResult === 'string' ? pluginResult : JSON.stringify(pluginResult, null, 2),
              }],
            };
            break;
          }
        }
        
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
      }
      
      // Record successful execution metrics
      const duration = Date.now() - startTime;
      recordHistogram('tool.execution.duration', duration, {
        [ATTR_TOOL_NAME]: name,
        [ATTR_TOOL_SUCCESS]: true,
      }, 'Tool execution duration in milliseconds');
      
      recordCounter('tool.execution.count', 1, {
        [ATTR_TOOL_NAME]: name,
        status: 'success',
      }, 'Tool execution count');
      
      span.setAttributes({
        [ATTR_TOOL_SUCCESS]: true,
      });
      
      // Log successful tool execution (for both HTTP and STDIO)
      logWithContext('info', 'MCP tool execution completed', {
        request_id: requestId,
        transport: transportType,
        tool_name: name,
        duration_ms: duration,
        status: 'success',
      });
      
      return result;
      
    } catch (error) {
      // Record failed execution metrics
      const duration = Date.now() - startTime;
      recordHistogram('tool.execution.duration', duration, {
        [ATTR_TOOL_NAME]: name,
        [ATTR_TOOL_SUCCESS]: false,
      }, 'Tool execution duration in milliseconds');
      
      recordCounter('tool.execution.count', 1, {
        [ATTR_TOOL_NAME]: name,
        status: 'error',
      }, 'Tool execution count');
      
      span.setAttributes({
        [ATTR_TOOL_SUCCESS]: false,
      });
      
      // Handle errors
      if (error instanceof McpError) {
        attachErrorToSpan(span, error);
        throw error;
      }

      // Database or other errors - extract meaningful error message
      let errorMessage: string;
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (error && typeof error === 'object') {
        // Try to extract message from error object
        if ('message' in error && typeof error.message === 'string') {
          errorMessage = error.message;
        } else if ('error' in error && typeof error.error === 'string') {
          errorMessage = error.error;
        } else if ('code' in error && 'message' in error) {
          // Supabase-style errors with code and message
          errorMessage = `${error.code}: ${error.message}`;
        } else {
          // Try to JSON stringify for more details
          try {
            const errorStr = JSON.stringify(error, null, 2);
            errorMessage = errorStr.length > 500 ? errorStr.substring(0, 500) + '...' : errorStr;
          } catch {
            // If JSON.stringify fails, use object inspection
            errorMessage = `Error object: ${Object.keys(error).join(', ')}`;
          }
        }
      } else {
        errorMessage = String(error);
      }
      
      logWithContext('error', 'MCP tool execution failed', {
        request_id: requestId,
        transport: transportType,
        tool_name: name,
        duration_ms: duration,
        status: 'error',
        error_message: errorMessage,
      });
      
      attachErrorToSpan(span, error);
      
      throw new McpError(
        ErrorCode.InternalError,
        `Tool execution failed: ${errorMessage}`
      );
    }
  });
});

/**
 * Handle resource reads
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const transportType = process.env.MCP_TRANSPORT || 'stdio';
  const requestId = randomUUID();
  
  logWithContext('info', 'MCP read resource request received', {
    request_id: requestId,
    transport: transportType,
    resource_uri: uri,
  });
  
  // Try core resources first
  const core = await resolveCoreResource(queries, uri);
  if (core) {
    logWithContext('debug', 'MCP resource resolved', {
      request_id: requestId,
      transport: transportType,
      resource_uri: uri,
      mime_type: core.mimeType,
    });
    return {
      contents: [{ uri, mimeType: core.mimeType, text: JSON.stringify(core.content, null, 2) }]
    };
  }
  // Try plugin resources: plugins provide raw Resource metadata only; actual read is not delegated here in core
  logWithContext('warn', 'MCP resource not found', {
    request_id: requestId,
    transport: transportType,
    resource_uri: uri,
  });
  throw new McpError(ErrorCode.InvalidParams, `Unknown or unsupported resource URI: ${uri}`);
});

// ============================================================================
// Prompt Handlers
// ============================================================================

/**
 * List available prompts
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  const transportType = process.env.MCP_TRANSPORT || 'stdio';
  const requestId = randomUUID();
  
  logWithContext('info', 'MCP list prompts request received', {
    request_id: requestId,
    transport: transportType,
  });
  
  const prompts = allPrompts.map(p => ({
    name: p.name,
    description: p.description,
    arguments: p.arguments?.map(arg => ({
      name: arg.name,
      description: arg.description,
      required: arg.required
    }))
  }));
  
  logWithContext('debug', 'MCP prompts listed', {
    request_id: requestId,
    transport: transportType,
    total_prompts: prompts.length,
  });
  
  return { prompts };
});

/**
 * Get prompt with arguments filled in
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const transportType = process.env.MCP_TRANSPORT || 'stdio';
  const requestId = randomUUID();
  
  logWithContext('info', 'MCP get prompt request received', {
    request_id: requestId,
    transport: transportType,
    prompt_name: name,
    has_arguments: !!args,
    argument_keys: args ? Object.keys(args).join(', ') : 'none',
  });
  
  const prompt = allPrompts.find(p => p.name === name);
  if (!prompt) {
    logWithContext('warn', 'MCP prompt not found', {
      request_id: requestId,
      transport: transportType,
      prompt_name: name,
    });
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unknown prompt: ${name}`
    );
  }

  // Generate the prompt message with the provided arguments
  const message = generatePromptMessage(name, args || {});
  
  logWithContext('debug', 'MCP prompt generated', {
    request_id: requestId,
    transport: transportType,
    prompt_name: name,
    message_length: message.length,
  });

  return {
    description: prompt.description,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: message
        }
      }
    ]
  };
});

// ============================================================================
// Start Server
// ============================================================================

// Store HTTP server reference for graceful shutdown
let httpServerInstance: http.Server | null = null;

async function main() {
  try {
    const transportType = process.env.MCP_TRANSPORT || 'stdio';

    if (transportType === 'http') {
      // HTTP/Streamable HTTP transport
      const port = parseInt(process.env.MCP_HTTP_PORT || '3000');
      const host = process.env.MCP_HTTP_HOST || '127.0.0.1';

      // Configure session management
      const sessionIdGenerator = process.env.MCP_HTTP_STATELESS === 'true'
        ? undefined
        : () => randomUUID();

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator,
        enableJsonResponse: process.env.MCP_HTTP_JSON_ONLY === 'true',
        allowedHosts: process.env.MCP_HTTP_ALLOWED_HOSTS?.split(','),
        allowedOrigins: process.env.MCP_HTTP_ALLOWED_ORIGINS?.split(','),
        enableDnsRebindingProtection: process.env.MCP_HTTP_DNS_PROTECTION === 'true',
        onsessioninitialized: (sessionId) => {
          logWithContext('info', `HTTP session initialized: ${sessionId}`);
        },
        onsessionclosed: (sessionId) => {
          logWithContext('info', `HTTP session closed: ${sessionId}`);
        },
      });

      await server.connect(transport);

      // Create HTTP server with comprehensive logging
      const httpServer = http.createServer((req, res) => {
        const requestId = randomUUID();
        const startTime = Date.now();
        const remoteAddress = req.socket.remoteAddress || 'unknown';
        const remotePort = req.socket.remotePort || 0;
        
        // Capture request body for POST requests to see what method is being called
        let requestBodyPreview = '';
        if (req.method === 'POST' && req.headers['content-type']?.includes('json')) {
          // Note: We can't read the body here as it would consume the stream
          // But we can log that we'll try to capture it
        }
        
        // Log incoming request
        logWithContext('info', 'HTTP request received', {
          request_id: requestId,
          method: req.method,
          url: req.url,
          path: req.url?.split('?')[0],
          query: req.url?.includes('?') ? req.url.split('?')[1] : undefined,
          remote_address: remoteAddress,
          remote_port: remotePort,
          user_agent: req.headers['user-agent'],
          content_type: req.headers['content-type'],
          content_length: req.headers['content-length'],
          mcp_session_id: req.headers['mcp-session-id'] || req.headers['x-session-id'] || 'none',
          accept: req.headers['accept'],
          referer: req.headers['referer'],
          origin: req.headers['origin'],
          all_headers: Object.keys(req.headers).join(', '), // Debug: see all headers
        });

        // Track response end to log completion
        let responseSent = false;
        const originalEnd = res.end.bind(res);
        
        let statusCode = 200;
        const originalWriteHead = res.writeHead.bind(res);

        // Handle errors
        req.on('error', (error) => {
          const duration = Date.now() - startTime;
          logWithContext('error', 'HTTP request error', {
            request_id: requestId,
            method: req.method,
            url: req.url,
            error_message: error.message,
            error_stack: error.stack,
            duration_ms: duration,
            remote_address: remoteAddress,
          });
          
          recordCounter('http.request.error', 1, {
            method: req.method || 'unknown',
            error_type: error.constructor.name,
          }, 'HTTP request errors');
        });

        res.on('error', (error) => {
          const duration = Date.now() - startTime;
          logWithContext('error', 'HTTP response error', {
            request_id: requestId,
            method: req.method,
            url: req.url,
            status_code: statusCode,
            error_message: error.message,
            error_stack: error.stack,
            duration_ms: duration,
            remote_address: remoteAddress,
          });
          
          recordCounter('http.response.error', 1, {
            method: req.method || 'unknown',
            error_type: error.constructor.name,
          }, 'HTTP response errors');
        });

        // Handle OPTIONS requests (CORS preflight) - browsers send these for cross-origin requests
        if (req.method === 'OPTIONS') {
          logWithContext('debug', 'HTTP CORS preflight request', {
            request_id: requestId,
            method: req.method,
            url: req.url,
            origin: req.headers['origin'],
            cors_enabled: process.env.MCP_HTTP_CORS === 'true',
          });
          
          // Set CORS headers if enabled
          if (process.env.MCP_HTTP_CORS === 'true') {
            res.setHeader('Access-Control-Allow-Origin', process.env.MCP_HTTP_CORS_ORIGIN || '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-ID, Mcp-Session-Id');
            res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id'); // Critical: expose session ID to browser
            res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
          } else {
            // Even without explicit CORS, allow basic OPTIONS for localhost/same-origin scenarios
            // This helps with browser-based MCP clients like MCP Inspector
            const origin = req.headers['origin'];
            if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
              res.setHeader('Access-Control-Allow-Origin', origin);
              res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
              res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-ID, Mcp-Session-Id');
              res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id'); // Critical: expose session ID to browser
            }
          }
          
          res.writeHead(204);
          res.end();
          return;
        }
        
        // Set CORS headers for actual requests (before transport handles request)
        // Always set CORS headers for localhost origins to help browser clients
        const origin = req.headers['origin'];
        if (process.env.MCP_HTTP_CORS === 'true') {
          res.setHeader('Access-Control-Allow-Origin', process.env.MCP_HTTP_CORS_ORIGIN || '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-ID, Mcp-Session-Id');
          // Set expose headers upfront so it's there when transport adds session ID
          res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id'); // Critical: expose session ID to browser
        } else if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
          // Allow localhost even if CORS not explicitly enabled
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-ID, Mcp-Session-Id');
          // Set expose headers upfront so it's there when transport adds session ID
          res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id'); // Critical: expose session ID to browser
          
          // Log that we're enabling CORS for localhost
          logWithContext('debug', 'CORS enabled for localhost origin', {
            request_id: requestId,
            origin,
            exposed_headers: 'Mcp-Session-Id',
          });
        }

        // Override writeHead to track status codes (will be set before transport uses it)
        res.writeHead = function(code: number, ...args: any[]) {
          statusCode = code;
          return originalWriteHead(code, ...args);
        };
        
        // Intercept response data to capture error responses
        let responseBodyChunks: Buffer[] = [];
        const originalWrite = res.write.bind(res);
        res.write = function(chunk: any, ...args: any[]) {
          // Capture response body for error logging (limited size)
          if (statusCode >= 400 && responseBodyChunks.length < 10) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || '');
            responseBodyChunks.push(buffer);
          }
          return originalWrite(chunk, ...args);
        };
        
        // Intercept setHeader to capture response headers (especially Mcp-Session-Id)
        // and ensure CORS headers are properly set when session ID is added
        const responseHeaders: Record<string, string> = {};
        const originalSetHeader = res.setHeader.bind(res);
        res.setHeader = function(name: string, value: string | string[]) {
          const headerName = name.toLowerCase();
          const headerValue = Array.isArray(value) ? value.join(', ') : value;
          responseHeaders[headerName] = headerValue;
          
          // If transport is setting Mcp-Session-Id, ensure CORS expose headers is set
          if (headerName === 'mcp-session-id') {
            const exposedHeaders = responseHeaders['access-control-expose-headers'] || '';
            if (!exposedHeaders.includes('Mcp-Session-Id') && !exposedHeaders.includes('mcp-session-id')) {
              const newExposedHeaders = exposedHeaders 
                ? `${exposedHeaders}, Mcp-Session-Id`
                : 'Mcp-Session-Id';
              responseHeaders['access-control-expose-headers'] = newExposedHeaders;
              originalSetHeader('Access-Control-Expose-Headers', newExposedHeaders);
              
              // Log that we're exposing the session ID
              logWithContext('debug', 'Exposing Mcp-Session-Id header via CORS', {
                request_id: requestId,
                session_id: headerValue,
                exposed_headers: newExposedHeaders,
              });
            }
          }
          
          return originalSetHeader(name, value);
        };
        
        // Set up res.end to log completion and capture errors
        res.end = function(chunk?: any, ...args: any[]) {
          // Capture final chunk if error
          if (statusCode >= 400 && chunk && responseBodyChunks.length < 10) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || '');
            responseBodyChunks.push(buffer);
          }
          
          // Log error details if this is an error response
          if (statusCode >= 400 && !responseSent) {
            const errorBody = responseBodyChunks.length > 0 
              ? Buffer.concat(responseBodyChunks).toString('utf-8').substring(0, 1000)
              : undefined;
            
            logWithContext('warn', 'HTTP error response', {
              request_id: requestId,
              method: req.method,
              url: req.url,
              status_code: statusCode,
              request_mcp_session_id: req.headers['mcp-session-id'] || req.headers['x-session-id'] || 'missing',
              error_response_preview: errorBody,
              content_length: req.headers['content-length'],
            });
          }
          
          // Log response completion with session ID if present
          if (!responseSent) {
            responseSent = true;
            const duration = Date.now() - startTime;
            
            // Extract session ID from response headers
            const responseSessionId = responseHeaders['mcp-session-id'] || undefined;
            
            // Log response with all relevant headers
            const corsExposeHeaders = responseHeaders['access-control-expose-headers'];
            
            // Log response
            logWithContext(statusCode >= 400 ? 'warn' : 'info', 'HTTP response sent', {
              request_id: requestId,
              method: req.method,
              url: req.url,
              status_code: statusCode,
              duration_ms: duration,
              response_size: chunk ? Buffer.byteLength(chunk) : 0,
              remote_address: remoteAddress,
              request_mcp_session_id: req.headers['mcp-session-id'] || req.headers['x-session-id'] || 'missing',
              response_mcp_session_id: responseSessionId || 'none',
              cors_expose_headers: corsExposeHeaders || 'none',
              response_headers: Object.keys(responseHeaders).join(', '), // Debug: see all response headers
            });
            
            // Record metrics
            recordCounter('http.request.count', 1, {
              method: req.method || 'unknown',
              status_code: String(statusCode),
            }, 'HTTP request count');
            recordHistogram('http.request.duration', duration, {
              method: req.method || 'unknown',
              status_code: String(statusCode),
            }, 'HTTP request duration in milliseconds');
          }
          
          return originalEnd(chunk, ...args);
        };

        // Wrap transport.handleRequest to catch any unhandled errors
        try {
          transport.handleRequest(req, res);
        } catch (error) {
          const duration = Date.now() - startTime;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          
          logWithContext('error', 'HTTP request handling error', {
            request_id: requestId,
            method: req.method,
            url: req.url,
            error_message: errorMessage,
            error_stack: errorStack,
            duration_ms: duration,
            remote_address: remoteAddress,
          });
          
          recordCounter('http.request.error', 1, {
            method: req.method || 'unknown',
            error_type: error instanceof Error ? error.constructor.name : 'unknown',
          }, 'HTTP request handling errors');
          
          if (!responseSent) {
            try {
              res.writeHead(500);
              res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: {
                  code: -32603,
                  message: 'Internal error',
                  data: errorMessage
                }
              }));
            } catch (writeError) {
              // If we can't write the error response, log it
              logWithContext('error', 'Failed to write error response', {
                request_id: requestId,
                write_error: writeError instanceof Error ? writeError.message : String(writeError),
              });
            }
          }
        }
      });

      // Log connection events
      httpServer.on('connection', (socket) => {
        logWithContext('debug', 'HTTP client connected', {
          remote_address: socket.remoteAddress,
          remote_port: socket.remotePort,
          local_address: socket.localAddress,
          local_port: socket.localPort,
        });
      });

      httpServer.on('close', () => {
        logWithContext('info', 'HTTP server closed');
      });

      httpServer.on('error', (error) => {
        logWithContext('error', 'HTTP server error', {
          error_message: error.message,
          error_stack: error.stack,
          error_code: (error as any).code,
        });
      });

      httpServer.listen(port, host, () => {
        console.error('✅ vCon MCP Server running on HTTP');
        console.error(`🌐 Listening on: http://${host}:${port}`);
        console.error(`📡 Mode: ${sessionIdGenerator ? 'Stateful' : 'Stateless'}`);
        console.error(`📚 Tools available: ${allTools.length}`);
        console.error('💬 Prompts available:', allPrompts.length);
        console.error('🔗 Database: Connected');
        console.error('');
        console.error('Ready to accept HTTP requests...');
        
        logWithContext('info', 'HTTP server started', {
          host,
          port,
          transport: 'http',
          mode: sessionIdGenerator ? 'stateful' : 'stateless',
          tools_count: allTools.length,
          prompts_count: allPrompts.length,
          cors_enabled: process.env.MCP_HTTP_CORS === 'true',
          json_only: process.env.MCP_HTTP_JSON_ONLY === 'true',
          dns_protection: process.env.MCP_HTTP_DNS_PROTECTION === 'true',
        });
      });

      // Store httpServer reference for graceful shutdown
      (transport as any).httpServer = httpServer;
      httpServerInstance = httpServer;

    } else {
      // Default: stdio transport
      const transport = new StdioServerTransport();
      await server.connect(transport);
      
      console.error('✅ vCon MCP Server running on stdio');
      console.error('📚 Tools available:', allTools.length);
      console.error('💬 Prompts available:', allPrompts.length);
      console.error('🔗 Database: Connected');
      console.error('');
      console.error('Ready to accept requests...');
      
      logWithContext('info', 'STDIO server started', {
        transport: 'stdio',
        tools_count: allTools.length,
        prompts_count: allPrompts.length,
      });
      
      // Log stdin/stdout activity for debugging
      // Note: We can't intercept individual messages easily with StdioServerTransport
      // but we can log when the process receives data
      process.stdin.on('data', (chunk) => {
        // Only log if debug logging is enabled (to avoid flooding logs)
        if (process.env.MCP_DEBUG === 'true') {
          const preview = chunk.toString('utf-8').substring(0, 200);
          logWithContext('debug', 'STDIO input received', {
            size: chunk.length,
            preview: preview,
          });
        }
      });
      
      process.stdin.on('error', (error) => {
        logWithContext('error', 'STDIO input error', {
          error_message: error.message,
          error_stack: error.stack,
        });
      });
      
      process.stdout.on('error', (error) => {
        logWithContext('error', 'STDIO output error', {
          error_message: error.message,
          error_stack: error.stack,
        });
      });
    }
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
async function gracefulShutdown(signal: string) {
  logWithContext('info', `Shutting down gracefully (${signal})`, {
    signal,
  });
  
  // Close HTTP server if running
  if (httpServerInstance) {
    logWithContext('info', 'Closing HTTP server');
    return new Promise<void>((resolve) => {
      httpServerInstance!.close(() => {
        logWithContext('info', 'HTTP server closed');
        resolve();
      });
      
      // Force close after 10 seconds
      setTimeout(() => {
        logWithContext('warn', 'Force closing HTTP server after timeout');
        httpServerInstance!.close();
        resolve();
      }, 10000);
    }).then(async () => {
      await pluginManager.shutdown();
      await closeAllConnections();
      await shutdownObservability();
      process.exit(0);
    }).catch(async (error) => {
      logWithContext('error', 'Error during graceful shutdown', {
        error_message: error instanceof Error ? error.message : String(error),
        error_stack: error instanceof Error ? error.stack : undefined,
      });
      await pluginManager.shutdown();
      await closeAllConnections();
      await shutdownObservability();
      process.exit(1);
    });
  } else {
    // No HTTP server, just shutdown other components
    await pluginManager.shutdown();
    await closeAllConnections();
    await shutdownObservability();
    process.exit(0);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start the server
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

