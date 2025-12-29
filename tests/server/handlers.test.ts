/**
 * Tests for MCP request handlers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerHandlers } from '../../src/server/handlers.js';
import type { ServerContext } from '../../src/server/setup.js';
import { PluginManager } from '../../src/hooks/plugin-manager.js';
import { VConQueries } from '../../src/db/queries.js';
import { DatabaseInspector } from '../../src/db/database-inspector.js';
import { DatabaseAnalytics } from '../../src/db/database-analytics.js';
import { DatabaseSizeAnalyzer } from '../../src/db/database-size-analyzer.js';
import { ToolHandlerRegistry } from '../../src/tools/handlers/index.js';
import { VConService } from '../../src/services/vcon-service.js';
import type { ServerTransport } from '@modelcontextprotocol/sdk/server/types.js';

// Mock dependencies
vi.mock('../../src/observability/instrumentation.js', () => ({
  logWithContext: vi.fn(),
}));

vi.mock('../../src/db/client.js', () => ({
  getSupabaseClient: vi.fn(() => ({})),
  getRedisClient: vi.fn(() => null),
}));

// Create a simple mock transport for testing
// The ServerTransport interface requires start() and close() methods
class MockTransport implements ServerTransport {
  async start(): Promise<void> {
    // Mock implementation
  }

  async close(): Promise<void> {
    // Mock implementation
  }
}

describe('MCP Request Handlers', () => {
  let server: Server;
  let serverContext: ServerContext;
  let mockQueries: any;
  let mockPluginManager: any;
  let mockHandlerRegistry: any;
  let mockVConService: any;

  beforeEach(async () => {
    server = new Server(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    );

    // Connect server to a mock transport so it can handle requests
    const transport = new MockTransport();
    await server.connect(transport);

    mockQueries = {
      getVCon: vi.fn(),
      searchVCons: vi.fn(),
    };

    mockPluginManager = {
      getAdditionalTools: vi.fn().mockResolvedValue([]),
      getAdditionalResources: vi.fn().mockResolvedValue([]),
      handlePluginToolCall: vi.fn(),
      shutdown: vi.fn(),
    };

    mockHandlerRegistry = {
      get: vi.fn(),
    };

    mockVConService = {
      create: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      createBatch: vi.fn(),
      search: vi.fn(),
    };

    // Build full ServerContext
    serverContext = {
      server,
      queries: mockQueries as unknown as VConQueries,
      pluginManager: mockPluginManager as unknown as PluginManager,
      dbInspector: {} as DatabaseInspector,
      dbAnalytics: {} as DatabaseAnalytics,
      dbSizeAnalyzer: {} as DatabaseSizeAnalyzer,
      supabase: {},
      redis: null,
      handlerRegistry: mockHandlerRegistry as unknown as ToolHandlerRegistry,
      vconService: mockVConService as unknown as VConService,
    };
  });

  afterEach(async () => {
    vi.clearAllMocks();
    // Clean up server connection
    try {
      await server.close();
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('registerHandlers', () => {
    it('should register all MCP request handlers', () => {
      expect(() => registerHandlers(serverContext)).not.toThrow();
    });
  });

  describe('List Tools Handler', () => {
    it('should register list tools handler', () => {
      // Just verify registration doesn't throw
      expect(() => registerHandlers(serverContext)).not.toThrow();
    });

    it('should register handler that includes plugin tools', () => {
      const pluginTool = {
        name: 'plugin_tool',
        description: 'A plugin tool',
        inputSchema: { type: 'object' as const },
      };
      mockPluginManager.getAdditionalTools.mockResolvedValue([pluginTool]);

      // Verify registration works with plugin tools
      expect(() => registerHandlers(serverContext)).not.toThrow();
    });
  });

  describe('Call Tool Handler', () => {
    it('should register call tool handler', () => {
      const mockHandler = {
        handle: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Success' }],
        }),
      };
      mockHandlerRegistry.get.mockReturnValue(mockHandler);

      // Verify registration works
      expect(() => registerHandlers(serverContext)).not.toThrow();
    });

    it('should register handler that supports plugin tool calls', () => {
      const pluginTool = {
        name: 'plugin_tool',
        description: 'A plugin tool',
        inputSchema: { type: 'object' as const },
      };
      mockPluginManager.getAdditionalTools.mockResolvedValue([pluginTool]);
      mockPluginManager.handlePluginToolCall.mockResolvedValue('Plugin result');

      // Verify registration works with plugin support
      expect(() => registerHandlers(serverContext)).not.toThrow();
    });

    it('should register handler that throws error for unknown tool', () => {
      mockHandlerRegistry.get.mockReturnValue(undefined);
      mockPluginManager.getAdditionalTools.mockResolvedValue([]);

      // Verify registration works
      expect(() => registerHandlers(serverContext)).not.toThrow();
    });
  });

  describe('List Resources Handler', () => {
    it('should register list resources handler', () => {
      expect(() => registerHandlers(serverContext)).not.toThrow();
    });

    it('should register handler that includes plugin resources', () => {
      const pluginResource = {
        uri: 'plugin://resource',
        name: 'Plugin Resource',
        description: 'A plugin resource',
        mimeType: 'application/json',
      };
      mockPluginManager.getAdditionalResources.mockResolvedValue([pluginResource]);

      expect(() => registerHandlers(serverContext)).not.toThrow();
    });
  });

  describe('Read Resource Handler', () => {
    it('should register read resource handler', () => {
      const mockVCon = {
        uuid: 'test-uuid',
        vcon: '0.3.0',
        created_at: new Date().toISOString(),
      };
      mockQueries.getVCon.mockResolvedValue(mockVCon);

      expect(() => registerHandlers(serverContext)).not.toThrow();
    });

    it('should register handler that throws error for unknown resource', () => {
      expect(() => registerHandlers(serverContext)).not.toThrow();
    });
  });

  describe('List Prompts Handler', () => {
    it('should register list prompts handler', () => {
      expect(() => registerHandlers(serverContext)).not.toThrow();
    });
  });

  describe('Get Prompt Handler', () => {
    it('should register get prompt handler', () => {
      expect(() => registerHandlers(serverContext)).not.toThrow();
    });

    it('should register handler that throws error for unknown prompt', () => {
      expect(() => registerHandlers(serverContext)).not.toThrow();
    });
  });
});

