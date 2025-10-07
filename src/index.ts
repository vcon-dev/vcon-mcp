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
import { PluginManager } from './hooks/plugin-manager.js';
import { RequestContext } from './hooks/plugin-interface.js';

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
    },
  }
);

// Initialize database
let queries: VConQueries;
let supabase: any;

try {
  supabase = getSupabaseClient();
  queries = new VConQueries(supabase);
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
  
  return {
    tools: [...coreTools, ...pluginTools],
  };
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

// ============================================================================
// Start Server
// ============================================================================

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('✅ vCon MCP Server running on stdio');
    console.error('📚 Tools available:', allTools.length);
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

