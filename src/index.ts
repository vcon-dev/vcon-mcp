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
import { getSupabaseClient } from './db/client.js';
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
import { allTagTools } from './tools/tag-tools.js';
import { PluginManager } from './hooks/plugin-manager.js';
import { RequestContext } from './hooks/plugin-interface.js';
import { getCoreResources, resolveCoreResource } from './resources/index.js';
import { DatabaseInspector } from './db/database-inspector.js';
import { allPrompts, generatePromptMessage } from './prompts/index.js';

// Load environment variables
dotenv.config();

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

// Initialize database
let queries: VConQueries;
let dbInspector: DatabaseInspector;
let supabase: any;

try {
  supabase = getSupabaseClient();
  queries = new VConQueries(supabase);
  dbInspector = new DatabaseInspector(supabase);
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
// Tool Handlers
// ============================================================================

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const coreTools = allTools;
  const pluginTools = await pluginManager.getAdditionalTools();
  const extras = [createFromTemplateTool, getSchemaTool, getExamplesTool];
  
  return {
    tools: [...coreTools, ...extras, ...allDatabaseTools, ...allTagTools, ...pluginTools],
  };
});

/**
 * List available resources
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const core = getCoreResources().map(r => ({ 
    uri: r.uri, 
    name: r.name, 
    description: r.description,
    mimeType: r.mimeType 
  }));
  const pluginResources = await pluginManager.getAdditionalResources();
  return { resources: [...core, ...pluginResources] };
});

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
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

        const result = await queries.createVCon(vcon);
        
        // Hook: afterCreate
        await pluginManager.executeHook('afterCreate', vcon, context);
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              uuid: result.uuid,
              message: `Created vCon with UUID: ${result.uuid}`,
              vcon: vcon
            }, null, 2),
          }],
        };
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

        const result = await queries.createVCon(vcon);
        await pluginManager.executeHook('afterCreate', vcon, context);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, uuid: result.uuid, vcon }, null, 2),
          }],
        };
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
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              vcon: vcon
            }, null, 2),
          }],
        };
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
        
        let filters = {
          subject: args?.subject as string | undefined,
          partyName: args?.party_name as string | undefined,
          partyEmail: args?.party_email as string | undefined,
          partyTel: args?.party_tel as string | undefined,
          startDate: args?.start_date as string | undefined,
          endDate: args?.end_date as string | undefined,
          limit: (args?.limit as number | undefined) || 10,
        };

        // Hook: beforeSearch (can modify search criteria)
        const modifiedFilters = await pluginManager.executeHook<typeof filters>('beforeSearch', filters, context);
        if (modifiedFilters) filters = modifiedFilters;

        let results = await queries.searchVCons(filters);
        
        // Hook: afterSearch (can filter or modify results)
        const filteredResults = await pluginManager.executeHook<VCon[]>('afterSearch', results, context);
        if (filteredResults) results = filteredResults;
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: results.length,
              vcons: results
            }, null, 2),
          }],
        };
      }

      // ========================================================================
      // Search vCon Content (Keyword)
      // ========================================================================
      case 'search_vcons_content': {
        const query = args?.query as string;
        if (!query) {
          throw new McpError(ErrorCode.InvalidParams, 'query is required');
        }

        const results = await queries.keywordSearch({
          query,
          startDate: args?.start_date as string | undefined,
          endDate: args?.end_date as string | undefined,
          tags: args?.tags as Record<string, string> | undefined,
          limit: (args?.limit as number | undefined) || 50,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: results.length,
              results: results.map(r => ({
                vcon_id: r.vcon_id,
                content_type: r.doc_type,
                content_index: r.ref_index,
                relevance_score: r.rank,
                snippet: r.snippet
              }))
            }, null, 2),
          }],
        };
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

        return {
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

        return {
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
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Added ${analysis.type} analysis from ${analysis.vendor} to vCon ${vconUuid}`,
              analysis: analysis
            }, null, 2),
          }],
        };
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
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Added ${dialog.type} dialog to vCon ${vconUuid}`,
              dialog: dialog
            }, null, 2),
          }],
        };
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
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Added attachment to vCon ${vconUuid}`,
              attachment: attachment
            }, null, 2),
          }],
        };
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
        
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Deleted vCon ${uuid}`
            }, null, 2),
          }],
        };
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
        if (returnUpdated) {
          let updated = await queries.getVCon(uuid);
          const modified = await pluginManager.executeHook<VCon>('afterUpdate', updated, context);
          if (modified) updated = modified;
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, vcon: updated }, null, 2),
            }],
          };
        }

        await pluginManager.executeHook('afterUpdate', await queries.getVCon(uuid), context);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, message: `Updated vCon ${uuid}` }, null, 2),
          }],
        };
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

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              database_shape: shape
            }, null, 2),
          }],
        };
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

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              database_stats: stats
            }, null, 2),
          }],
        };
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

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              query_analysis: analysis
            }, null, 2),
          }],
        };
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

        if (action === 'set') {
          if (value === undefined || value === null) {
            throw new McpError(ErrorCode.InvalidParams, 'value is required when action is "set"');
          }
          await queries.addTag(vconUuid, key, value as string | number | boolean, true);
          return {
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
          return {
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

        if (key) {
          // Get single tag
          const value = await queries.getTag(vconUuid, key, defaultValue);
          const exists = value !== defaultValue;
          return {
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
          return {
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

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `All tags removed from vCon ${vconUuid}`
            }, null, 2),
          }],
        };
      }

      // ========================================================================
      // Search by Tags
      // ========================================================================
      case 'search_by_tags': {
        const tags = args?.tags as Record<string, string>;
        const limit = (args?.limit as number | undefined) || 50;

        if (!tags || typeof tags !== 'object' || Object.keys(tags).length === 0) {
          throw new McpError(ErrorCode.InvalidParams, 'tags object with at least one key-value pair is required');
        }

        const vconUuids = await queries.searchByTags(tags, limit);

        // Optionally fetch full vCons
        const fullVCons = await Promise.all(
          vconUuids.slice(0, limit).map(uuid => queries.getVCon(uuid))
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              count: vconUuids.length,
              tags_searched: tags,
              vcon_uuids: vconUuids,
              vcons: fullVCons
            }, null, 2),
          }],
        };
      }

      // ========================================================================
      // Get Unique Tags
      // ========================================================================
      case 'get_unique_tags': {
        const includeCounts = (args?.include_counts as boolean | undefined) ?? false;
        const keyFilter = args?.key_filter as string | undefined;
        const minCount = (args?.min_count as number | undefined) ?? 1;

        const result = await queries.getUniqueTags({
          includeCounts,
          keyFilter,
          minCount
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              unique_keys: result.keys,
              unique_key_count: result.keys.length,
              tags_by_key: result.tagsByKey,
              counts_per_value: result.countsPerValue,
              total_vcons_with_tags: result.totalVCons,
              summary: {
                total_unique_keys: result.keys.length,
                total_vcons: result.totalVCons,
                filter_applied: keyFilter ? true : false,
                min_count_filter: minCount
              }
            }, null, 2),
          }],
        };
      }

      // ========================================================================
      // get_schema
      // ========================================================================
      case 'get_schema': {
        const format = (args?.format as string | undefined) ?? 'json_schema';
        if (format === 'json_schema') {
          // Avoid adding dependency at runtime: provide a minimal hand-authored schema envelope if needed later
          // For now, return a simple note since generating from zod is out-of-scope without new deps during runtime
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                note: 'JSON Schema export requires zod-to-json-schema. Add dependency and implement conversion.',
              }, null, 2)
            }]
          };
        }
        if (format === 'typescript') {
          // Return informative pointer to types
          return {
            content: [{
              type: 'text',
              text: 'See src/types/vcon.ts for TypeScript interfaces.'
            }]
          };
        }
        throw new McpError(ErrorCode.InvalidParams, `Unsupported schema format: ${format}`);
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
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        if (format === 'yaml') {
          // naive YAML export without extra deps
          const yaml = `vcon: ${data.vcon}\nuuid: ${data.uuid}\ncreated_at: ${data.created_at}`;
          return { content: [{ type: 'text', text: yaml }] };
        }
        throw new McpError(ErrorCode.InvalidParams, `Unsupported format: ${format}`);
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
          
          const result = await pluginManager.handlePluginToolCall(name, args, context);
          
          if (result) {
            return {
              content: [{
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
              }],
            };
          }
        }
        
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    // Handle errors
    if (error instanceof McpError) {
      throw error;
    }

    // Database or other errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Tool execution error:', errorMessage);
    
    throw new McpError(
      ErrorCode.InternalError,
      `Tool execution failed: ${errorMessage}`
    );
  }
});

/**
 * Handle resource reads
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  // Try core resources first
  const core = await resolveCoreResource(queries, uri);
  if (core) {
    return {
      contents: [{ uri, mimeType: core.mimeType, text: JSON.stringify(core.content, null, 2) }]
    };
  }
  // Try plugin resources: plugins provide raw Resource metadata only; actual read is not delegated here in core
  throw new McpError(ErrorCode.InvalidParams, `Unknown or unsupported resource URI: ${uri}`);
});

// ============================================================================
// Prompt Handlers
// ============================================================================

/**
 * List available prompts
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: allPrompts.map(p => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments?.map(arg => ({
        name: arg.name,
        description: arg.description,
        required: arg.required
      }))
    }))
  };
});

/**
 * Get prompt with arguments filled in
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  const prompt = allPrompts.find(p => p.name === name);
  if (!prompt) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unknown prompt: ${name}`
    );
  }

  // Generate the prompt message with the provided arguments
  const message = generatePromptMessage(name, args || {});

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

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('✅ vCon MCP Server running on stdio');
    console.error('📚 Tools available:', allTools.length);
    console.error('💬 Prompts available:', allPrompts.length);
    console.error('🔗 Database: Connected');
    console.error('');
    console.error('Ready to accept requests...');
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.error('\n🛑 Shutting down gracefully...');
  await pluginManager.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('\n🛑 Shutting down gracefully...');
  await pluginManager.shutdown();
  process.exit(0);
});

// Start the server
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

