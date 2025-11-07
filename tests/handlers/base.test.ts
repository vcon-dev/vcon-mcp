/**
 * Base Handler Infrastructure Tests
 * 
 * Tests for BaseToolHandler and ToolHandlerRegistry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BaseToolHandler, ToolHandlerContext, ToolResponse } from '../../src/tools/handlers/base.js';
import { ToolHandlerRegistry } from '../../src/tools/handlers/registry.js';
import { VConQueries } from '../../src/db/queries.js';
import { PluginManager } from '../../src/hooks/plugin-manager.js';
import { DatabaseInspector } from '../../src/db/database-inspector.js';
import { DatabaseAnalytics } from '../../src/db/database-analytics.js';
import { DatabaseSizeAnalyzer } from '../../src/db/database-size-analyzer.js';

// Mock observability functions
vi.mock('../../src/observability/instrumentation.js', () => ({
  withSpan: vi.fn((name, fn) => fn({ setAttributes: vi.fn(), setStatus: vi.fn() })),
  recordCounter: vi.fn(),
  recordHistogram: vi.fn(),
  logWithContext: vi.fn(),
  attachErrorToSpan: vi.fn(),
}));

// Mock attributes
vi.mock('../../src/observability/attributes.js', () => ({
  ATTR_TOOL_NAME: 'tool.name',
  ATTR_TOOL_SUCCESS: 'tool.success',
}));

describe('BaseToolHandler', () => {
  let mockContext: ToolHandlerContext;
  let testHandler: BaseToolHandler;

  beforeEach(() => {
    mockContext = {
      queries: {} as VConQueries,
      pluginManager: {} as PluginManager,
      dbInspector: {} as DatabaseInspector,
      dbAnalytics: {} as DatabaseAnalytics,
      dbSizeAnalyzer: {} as DatabaseSizeAnalyzer,
      supabase: {},
    };

    // Create a concrete implementation for testing
    class TestHandler extends BaseToolHandler {
      readonly toolName = 'test_tool';

      protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
        return this.createSuccessResponse({ result: 'test' });
      }
    }

    testHandler = new TestHandler();
  });

  describe('handle', () => {
    it('should execute handler and return success response', async () => {
      const result = await testHandler.handle({}, mockContext);

      expect(result).toEqual({
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, result: 'test' }, null, 2),
        }],
      });
    });

    it('should handle McpError and rethrow it', async () => {
      class ErrorHandler extends BaseToolHandler {
        readonly toolName = 'error_tool';

        protected async execute(): Promise<ToolResponse> {
          throw new McpError(ErrorCode.InvalidParams, 'Test error');
        }
      }

      const handler = new ErrorHandler();

      await expect(handler.handle({}, mockContext)).rejects.toThrow(McpError);
      await expect(handler.handle({}, mockContext)).rejects.toThrow('Test error');
    });

    it('should wrap non-McpError in McpError', async () => {
      class GenericErrorHandler extends BaseToolHandler {
        readonly toolName = 'generic_error_tool';

        protected async execute(): Promise<ToolResponse> {
          throw new Error('Generic error');
        }
      }

      const handler = new GenericErrorHandler();

      await expect(handler.handle({}, mockContext)).rejects.toThrow(McpError);
      await expect(handler.handle({}, mockContext)).rejects.toThrow('Tool execution failed: Generic error');
    });

    it('should handle error objects with message property', async () => {
      class ObjectErrorHandler extends BaseToolHandler {
        readonly toolName = 'object_error_tool';

        protected async execute(): Promise<ToolResponse> {
          throw { message: 'Object error' };
        }
      }

      const handler = new ObjectErrorHandler();

      await expect(handler.handle({}, mockContext)).rejects.toThrow('Tool execution failed: Object error');
    });

    it('should handle string errors', async () => {
      class StringErrorHandler extends BaseToolHandler {
        readonly toolName = 'string_error_tool';

        protected async execute(): Promise<ToolResponse> {
          throw 'String error';
        }
      }

      const handler = new StringErrorHandler();

      await expect(handler.handle({}, mockContext)).rejects.toThrow('Tool execution failed: String error');
    });
  });

  describe('createRequestContext', () => {
    it('should create request context from args', () => {
      class TestHandler extends BaseToolHandler {
        readonly toolName = 'test';
        protected async execute(): Promise<ToolResponse> {
          return this.createSuccessResponse({});
        }
        public testCreateRequestContext(args: any) {
          return this.createRequestContext(args);
        }
      }

      const handler = new TestHandler();
      const context = handler.testCreateRequestContext({
        user_id: 'user123',
        purpose: 'testing',
      });

      expect(context.userId).toBe('user123');
      expect(context.purpose).toBe('testing');
      expect(context.timestamp).toBeInstanceOf(Date);
    });

    it('should handle missing optional fields', () => {
      class TestHandler extends BaseToolHandler {
        readonly toolName = 'test';
        protected async execute(): Promise<ToolResponse> {
          return this.createSuccessResponse({});
        }
        public testCreateRequestContext(args: any) {
          return this.createRequestContext(args);
        }
      }

      const handler = new TestHandler();
      const context = handler.testCreateRequestContext({});

      expect(context.userId).toBeUndefined();
      expect(context.purpose).toBeUndefined();
      expect(context.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('createTextResponse', () => {
    it('should create text response from data', () => {
      class TestHandler extends BaseToolHandler {
        readonly toolName = 'test';
        protected async execute(): Promise<ToolResponse> {
          return this.createSuccessResponse({});
        }
        public testCreateTextResponse(data: any) {
          return this.createTextResponse(data);
        }
      }

      const handler = new TestHandler();
      const response = handler.testCreateTextResponse({ key: 'value' });

      expect(response).toEqual({
        content: [{
          type: 'text',
          text: JSON.stringify({ key: 'value' }, null, 2),
        }],
      });
    });
  });

  describe('createSuccessResponse', () => {
    it('should create success response with success flag', () => {
      class TestHandler extends BaseToolHandler {
        readonly toolName = 'test';
        protected async execute(): Promise<ToolResponse> {
          return this.createSuccessResponse({});
        }
        public testCreateSuccessResponse(data: any) {
          return this.createSuccessResponse(data);
        }
      }

      const handler = new TestHandler();
      const response = handler.testCreateSuccessResponse({ result: 'test' });

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.result).toBe('test');
    });
  });
});

describe('ToolHandlerRegistry', () => {
  let registry: ToolHandlerRegistry;
  let mockHandler1: BaseToolHandler;
  let mockHandler2: BaseToolHandler;

  beforeEach(() => {
    registry = new ToolHandlerRegistry();

    class Handler1 extends BaseToolHandler {
      readonly toolName = 'tool1';
      protected async execute(): Promise<ToolResponse> {
        return { content: [{ type: 'text', text: 'handler1' }] };
      }
    }

    class Handler2 extends BaseToolHandler {
      readonly toolName = 'tool2';
      protected async execute(): Promise<ToolResponse> {
        return { content: [{ type: 'text', text: 'handler2' }] };
      }
    }

    mockHandler1 = new Handler1();
    mockHandler2 = new Handler2();
  });

  describe('register', () => {
    it('should register a handler', () => {
      registry.register(mockHandler1);
      expect(registry.has('tool1')).toBe(true);
      expect(registry.size()).toBe(1);
    });

    it('should throw error when registering duplicate handler', () => {
      registry.register(mockHandler1);
      expect(() => registry.register(mockHandler1)).toThrow(
        "Handler for tool 'tool1' is already registered"
      );
    });

    it('should register multiple different handlers', () => {
      registry.register(mockHandler1);
      registry.register(mockHandler2);
      expect(registry.size()).toBe(2);
      expect(registry.has('tool1')).toBe(true);
      expect(registry.has('tool2')).toBe(true);
    });
  });

  describe('registerAll', () => {
    it('should register multiple handlers at once', () => {
      registry.registerAll([mockHandler1, mockHandler2]);
      expect(registry.size()).toBe(2);
      expect(registry.has('tool1')).toBe(true);
      expect(registry.has('tool2')).toBe(true);
    });

    it('should throw error if any handler is duplicate', () => {
      registry.register(mockHandler1);
      expect(() => registry.registerAll([mockHandler1, mockHandler2])).toThrow();
    });
  });

  describe('get', () => {
    it('should return handler if registered', () => {
      registry.register(mockHandler1);
      const handler = registry.get('tool1');
      expect(handler).toBe(mockHandler1);
    });

    it('should return undefined if not registered', () => {
      const handler = registry.get('nonexistent');
      expect(handler).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true if handler exists', () => {
      registry.register(mockHandler1);
      expect(registry.has('tool1')).toBe(true);
    });

    it('should return false if handler does not exist', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  describe('getToolNames', () => {
    it('should return empty array when no handlers registered', () => {
      expect(registry.getToolNames()).toEqual([]);
    });

    it('should return all registered tool names', () => {
      registry.register(mockHandler1);
      registry.register(mockHandler2);
      const names = registry.getToolNames();
      expect(names).toContain('tool1');
      expect(names).toContain('tool2');
      expect(names.length).toBe(2);
    });
  });

  describe('getOrThrow', () => {
    it('should return handler if exists', () => {
      registry.register(mockHandler1);
      const handler = registry.getOrThrow('tool1');
      expect(handler).toBe(mockHandler1);
    });

    it('should throw McpError if handler does not exist', () => {
      expect(() => registry.getOrThrow('nonexistent')).toThrow(McpError);
      expect(() => registry.getOrThrow('nonexistent')).toThrow('Unknown tool: nonexistent');
    });
  });

  describe('clear', () => {
    it('should remove all handlers', () => {
      registry.register(mockHandler1);
      registry.register(mockHandler2);
      expect(registry.size()).toBe(2);

      registry.clear();
      expect(registry.size()).toBe(0);
      expect(registry.has('tool1')).toBe(false);
      expect(registry.has('tool2')).toBe(false);
    });
  });

  describe('size', () => {
    it('should return 0 when empty', () => {
      expect(registry.size()).toBe(0);
    });

    it('should return correct count', () => {
      registry.register(mockHandler1);
      expect(registry.size()).toBe(1);
      registry.register(mockHandler2);
      expect(registry.size()).toBe(2);
    });
  });
});

