/**
 * MCP Request Handlers
 * 
 * Registers all MCP request handlers (tools, resources, prompts)
 */

import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { logWithContext } from '../observability/instrumentation.js';
import { RequestContext } from '../hooks/plugin-interface.js';
import type { ToolHandlerContext } from '../tools/handlers/index.js';
import { allTools } from '../tools/vcon-crud.js';
import { createFromTemplateTool } from '../tools/templates.js';
import { getSchemaTool, getExamplesTool } from '../tools/schema-tools.js';
import { allDatabaseTools } from '../tools/database-tools.js';
import { allDatabaseAnalyticsTools } from '../tools/database-analytics.js';
import { allDatabaseSizeTools } from '../tools/database-size-tools.js';
import { allTagTools } from '../tools/tag-tools.js';
import { getCoreResources, resolveCoreResource } from '../resources/index.js';
import { allPrompts, generatePromptMessage } from '../prompts/index.js';
import type { ServerContext } from './setup.js';

/**
 * Register all MCP request handlers
 * 
 * @param context - Full server context (uses subset for tool handlers)
 */
export function registerHandlers(context: ServerContext): void {
  const { server, queries, pluginManager, handlerRegistry } = context;

  // Tool handler context - subset of ServerContext that handlers need
  const handlerContext: ToolHandlerContext = {
    queries: context.queries,
    pluginManager: context.pluginManager,
    dbInspector: context.dbInspector,
    dbAnalytics: context.dbAnalytics,
    dbSizeAnalyzer: context.dbSizeAnalyzer,
    supabase: context.supabase,
    vconService: context.vconService,
  };

  // List tools
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

    const tools = [
      ...coreTools,
      ...extras,
      ...allDatabaseTools,
      ...allDatabaseAnalyticsTools,
      ...allDatabaseSizeTools,
      ...allTagTools,
      ...pluginTools,
    ];

    logWithContext('debug', 'MCP tools listed', {
      request_id: requestId,
      transport: transportType,
      total_tools: tools.length,
      core_tools: coreTools.length,
      plugin_tools: pluginTools.length,
    });

    return { tools };
  });

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Try to get handler from registry
    const handler = handlerRegistry.get(name);

    if (handler) {
      // Use registered handler
      return handler.handle(args, handlerContext) as any;
    }

    // Check if this is a plugin tool
    const pluginTools = await pluginManager.getAdditionalTools();
    const pluginTool = pluginTools.find((t) => t.name === name);

    if (pluginTool) {
      // Delegate to plugin
      const context: RequestContext = {
        timestamp: new Date(),
        userId: args?.user_id as string | undefined,
        purpose: args?.purpose as string | undefined,
      };

      const pluginResult = await pluginManager.handlePluginToolCall(name, args, context);

      if (pluginResult) {
        return {
          content: [
            {
              type: 'text',
              text:
                typeof pluginResult === 'string'
                  ? pluginResult
                  : JSON.stringify(pluginResult, null, 2),
            },
          ],
        };
      }
    }

    // Tool not found
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  });

  // List resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const transportType = process.env.MCP_TRANSPORT || 'stdio';
    const requestId = randomUUID();

    logWithContext('info', 'MCP list resources request received', {
      request_id: requestId,
      transport: transportType,
    });

    const core = getCoreResources().map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
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

  // Read resource
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
        contents: [
          { uri, mimeType: core.mimeType, text: JSON.stringify(core.content, null, 2) },
        ],
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

  // List prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const transportType = process.env.MCP_TRANSPORT || 'stdio';
    const requestId = randomUUID();

    logWithContext('info', 'MCP list prompts request received', {
      request_id: requestId,
      transport: transportType,
    });

    const prompts = allPrompts.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments?.map((arg) => ({
        name: arg.name,
        description: arg.description,
        required: arg.required,
      })),
    }));

    logWithContext('debug', 'MCP prompts listed', {
      request_id: requestId,
      transport: transportType,
      total_prompts: prompts.length,
    });

    return { prompts };
  });

  // Get prompt
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

    const prompt = allPrompts.find((p) => p.name === name);
    if (!prompt) {
      logWithContext('warn', 'MCP prompt not found', {
        request_id: requestId,
        transport: transportType,
        prompt_name: name,
      });
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${name}`);
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
            text: message,
          },
        },
      ],
    };
  });
}

