/**
 * Base Handler Infrastructure for MCP Tools
 * 
 * Provides common interfaces and base classes for tool handlers
 */

import { randomUUID } from 'crypto';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { RequestContext } from '../../hooks/plugin-interface.js';
import type { ServerContext } from '../../server/setup.js';
import { withSpan, recordCounter, recordHistogram, logWithContext, attachErrorToSpan } from '../../observability/instrumentation.js';
import { ATTR_TOOL_NAME, ATTR_TOOL_SUCCESS } from '../../observability/attributes.js';
import { createTextResponse, createSuccessResponse } from '../../utils/responses.js';
import { extractErrorMessage, createMcpError } from '../../utils/errors.js';

/**
 * Context passed to tool handlers - subset of ServerContext
 * Excludes server/redis/handlerRegistry which handlers don't need
 */
export type ToolHandlerContext = Pick<
  ServerContext,
  'queries' | 'pluginManager' | 'dbInspector' | 'dbAnalytics' | 'dbSizeAnalyzer' | 'supabase' | 'vconService'
>;

/**
 * Tool response format
 */
export interface ToolResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}

/**
 * Tool handler interface
 * All tool handlers must implement this interface
 */
export interface ToolHandler {
  /**
   * Name of the tool this handler implements
   */
  readonly toolName: string;

  /**
   * Execute the tool handler
   * @param args - Tool arguments from the MCP request
   * @param context - Handler context with dependencies
   * @returns Tool response
   */
  handle(args: any, context: ToolHandlerContext): Promise<ToolResponse>;
}

/**
 * Base class for tool handlers
 * Provides common functionality: observability, error handling, validation
 */
export abstract class BaseToolHandler implements ToolHandler {
  abstract readonly toolName: string;

  /**
   * Execute the handler with observability and error handling
   */
  async handle(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const requestId = randomUUID();
    const startTime = Date.now();

    return withSpan(`mcp.tool.${this.toolName}`, async (span) => {
      span.setAttributes({
        [ATTR_TOOL_NAME]: this.toolName,
      });

      try {
        // Log incoming tool request
        logWithContext('info', 'MCP tool request received', {
          request_id: requestId,
          tool_name: this.toolName,
          has_arguments: !!args,
          argument_keys: args ? Object.keys(args).join(', ') : 'none',
        });

        // Execute the actual handler
        const result = await this.execute(args, context);

        // Record successful execution metrics
        const duration = Date.now() - startTime;
        recordHistogram('tool.execution.duration', duration, {
          [ATTR_TOOL_NAME]: this.toolName,
          [ATTR_TOOL_SUCCESS]: true,
        }, 'Tool execution duration in milliseconds');

        recordCounter('tool.execution.count', 1, {
          [ATTR_TOOL_NAME]: this.toolName,
          status: 'success',
        }, 'Tool execution count');

        span.setAttributes({
          [ATTR_TOOL_SUCCESS]: true,
        });

        // Log successful tool execution
        logWithContext('info', 'MCP tool execution completed', {
          request_id: requestId,
          tool_name: this.toolName,
          duration_ms: duration,
          status: 'success',
        });

        return result;
      } catch (error) {
        // Record failed execution metrics
        const duration = Date.now() - startTime;
        recordHistogram('tool.execution.duration', duration, {
          [ATTR_TOOL_NAME]: this.toolName,
          [ATTR_TOOL_SUCCESS]: false,
        }, 'Tool execution duration in milliseconds');

        recordCounter('tool.execution.count', 1, {
          [ATTR_TOOL_NAME]: this.toolName,
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

        // Extract meaningful error message
        const errorMessage = extractErrorMessage(error);

        logWithContext('error', 'MCP tool execution failed', {
          request_id: requestId,
          tool_name: this.toolName,
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
  }

  /**
   * Execute the actual tool logic
   * Subclasses must implement this method
   */
  protected abstract execute(args: any, context: ToolHandlerContext): Promise<ToolResponse>;

  /**
   * Create a request context from tool arguments
   */
  protected createRequestContext(args: any): RequestContext {
    return {
      timestamp: new Date(),
      userId: args?.user_id as string | undefined,
      purpose: args?.purpose as string | undefined,
    };
  }

  /**
   * Create a text response from JSON data
   */
  protected createTextResponse(data: any): ToolResponse {
    return createTextResponse(data);
  }

  /**
   * Create a success response
   */
  protected createSuccessResponse(data: any = {}): ToolResponse {
    return createSuccessResponse(data);
  }
}

