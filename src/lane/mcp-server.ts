/**
 * The MCP server of one TENANT_MODE=lane request: five tools and nothing else.
 *
 * The server declares the tools capability only. resources/*, prompts/* and every other method answer
 * JSON-RPC "Method not found"; tools/list lists the five; tools/call for any other name is refused before
 * a handler runs, so no other tool, plugin tool or the batch writer can be reached.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { stripCategories, type ToolDefinition } from '../config/tools.js';
import { getPackageVersion } from '../server/setup.js';
import type { LaneRequestContext } from './context.js';
import { createHandlerRegistry } from '../tools/handlers/index.js';
import { allTools } from '../tools/vcon-crud.js';

/** The only tools a lane serves. The four reads the portal makes, and delete_vcon. */
export const LANE_TOOL_NAMES: readonly string[] = [
  'search_vcons',
  'search_vcons_content',
  'search_vcons_semantic',
  'get_vcon',
  'delete_vcon',
];

const LANE_TOOL_SET: ReadonlySet<string> = new Set(LANE_TOOL_NAMES);

/** The five tool definitions, as tools/list returns them. Throws at load if one has gone missing. */
const LANE_TOOLS = (() => {
  const defs = (allTools as ToolDefinition[]).filter((t) => LANE_TOOL_SET.has(t.name));
  const missing = LANE_TOOL_NAMES.filter((name) => !defs.some((t) => t.name === name));
  if (missing.length) throw new Error(`lane tool definitions missing: ${missing.join(', ')}`);
  return stripCategories(defs);
})();

/** The registered handlers for the five, resolved once. */
const LANE_HANDLERS = (() => {
  const registry = createHandlerRegistry();
  return new Map(LANE_TOOL_NAMES.map((name) => {
    const handler = registry.get(name);
    if (!handler) throw new Error(`lane tool handler missing: ${name}`);
    return [name, handler] as const;
  }));
})();

/**
 * The error a tool call gets when the store refused the request's token (HTTP 401: expired, bad
 * signature, no role). Callers match "unauthorized" or "401" to tell a refused credential from a
 * failed read. Fixed text: nothing from the store and never the token.
 */
export const STORE_REFUSED_TOKEN_MESSAGE = "Unauthorized: the store refused this request's token (HTTP 401)";

/** A fresh MCP server bound to one request's context. */
export function createLaneMcpServer(context: LaneRequestContext): Server {
  const instructions = process.env.MCP_SERVER_INSTRUCTIONS?.trim() || undefined;
  const server = new Server(
    { name: 'vcon-mcp-server', version: getPackageVersion() },
    { capabilities: { tools: {} }, ...(instructions ? { instructions } : {}) }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: LANE_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = LANE_HANDLERS.get(name);
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Tool '${name}' is not served in TENANT_MODE=lane`);
    }
    try {
      return (await handler.handle(args, context)) as any;
    } catch (error) {
      if (context.storeRefusedToken()) throw new McpError(ErrorCode.InternalError, STORE_REFUSED_TOKEN_MESSAGE);
      throw error;
    }
  });

  return server;
}
