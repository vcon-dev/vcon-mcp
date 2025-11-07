/**
 * Tool Handler Registry
 * 
 * Manages registration and lookup of tool handlers
 */

import { ToolHandler } from './base.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * Registry for tool handlers
 */
export class ToolHandlerRegistry {
  private handlers = new Map<string, ToolHandler>();

  /**
   * Register a tool handler
   */
  register(handler: ToolHandler): void {
    if (this.handlers.has(handler.toolName)) {
      throw new Error(`Handler for tool '${handler.toolName}' is already registered`);
    }
    this.handlers.set(handler.toolName, handler);
  }

  /**
   * Register multiple handlers
   */
  registerAll(handlers: ToolHandler[]): void {
    for (const handler of handlers) {
      this.register(handler);
    }
  }

  /**
   * Get a handler by tool name
   */
  get(toolName: string): ToolHandler | undefined {
    return this.handlers.get(toolName);
  }

  /**
   * Check if a handler exists for a tool
   */
  has(toolName: string): boolean {
    return this.handlers.has(toolName);
  }

  /**
   * Get all registered tool names
   */
  getToolNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get handler or throw if not found
   */
  getOrThrow(toolName: string): ToolHandler {
    const handler = this.get(toolName);
    if (!handler) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${toolName}`
      );
    }
    return handler;
  }

  /**
   * Clear all handlers (useful for testing)
   */
  clear(): void {
    this.handlers.clear();
  }

  /**
   * Get the number of registered handlers
   */
  size(): number {
    return this.handlers.size;
  }
}

