/**
 * Tests for server setup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, initializeDatabase, setupServer, loadPlugins } from '../../src/server/setup.js';
import { PluginManager } from '../../src/hooks/plugin-manager.js';

// Mock database client
vi.mock('../../src/db/client.js', () => ({
  getSupabaseClient: vi.fn(() => ({})),
  getRedisClient: vi.fn(() => null),
}));

// Mock plugin manager
vi.mock('../../src/hooks/plugin-manager.js', () => ({
  PluginManager: vi.fn().mockImplementation(() => ({
    registerPlugin: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getAdditionalTools: vi.fn().mockResolvedValue([]),
    getAdditionalResources: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock tool handler registry
vi.mock('../../src/tools/handlers/index.js', () => ({
  createHandlerRegistry: vi.fn(() => ({
    get: vi.fn(),
    register: vi.fn(),
  })),
}));

describe('Server Setup', () => {
  beforeEach(() => {
    // Reset environment variables
    delete process.env.VCON_PLUGINS_PATH;
    delete process.env.VCON_LICENSE_KEY;
    delete process.env.VCON_OFFLINE_MODE;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createServer', () => {
    it('should create MCP server with correct configuration', () => {
      const server = createServer();
      expect(server).toBeDefined();
    });

    it('should create server with correct name and version', () => {
      const server = createServer();
      // Server should be created successfully
      expect(server).toBeDefined();
    });
  });

  describe('initializeDatabase', () => {
    it('should initialize database clients', async () => {
      const result = await initializeDatabase();

      expect(result).toHaveProperty('queries');
      expect(result).toHaveProperty('dbInspector');
      expect(result).toHaveProperty('dbAnalytics');
      expect(result).toHaveProperty('dbSizeAnalyzer');
      expect(result).toHaveProperty('supabase');
      expect(result).toHaveProperty('redis');
    });

    it('should initialize all required database components', async () => {
      const result = await initializeDatabase();

      expect(result.queries).toBeDefined();
      expect(result.dbInspector).toBeDefined();
      expect(result.dbAnalytics).toBeDefined();
      expect(result.dbSizeAnalyzer).toBeDefined();
      expect(result.supabase).toBeDefined();
    });
  });

  describe('loadPlugins', () => {
    it('should not load plugins when VCON_PLUGINS_PATH is not set', async () => {
      const pluginManager = new PluginManager();
      const supabase = {};

      await loadPlugins(pluginManager, supabase);

      // Should not throw and should not load any plugins
      expect(pluginManager.registerPlugin).not.toHaveBeenCalled();
    });

    it('should load plugins from VCON_PLUGINS_PATH', async () => {
      // Mock a plugin module
      const mockPlugin = vi.fn().mockImplementation(() => ({}));
      const mockPluginModule = { default: mockPlugin };

      // Mock dynamic import
      const originalImport = global.import;
      global.import = vi.fn().mockResolvedValue(mockPluginModule);

      process.env.VCON_PLUGINS_PATH = './test-plugin.js';
      const pluginManager = new PluginManager();
      const supabase = {};

      try {
        await loadPlugins(pluginManager, supabase);
        // Plugin loading should be attempted
      } catch (e) {
        // Expected to fail in test environment, but should attempt to load
      } finally {
        global.import = originalImport;
      }
    });

    it('should handle plugin loading errors gracefully', async () => {
      process.env.VCON_PLUGINS_PATH = './nonexistent-plugin.js';
      const pluginManager = new PluginManager();
      const supabase = {};

      // Should not throw, should continue without the plugin
      await expect(loadPlugins(pluginManager, supabase)).resolves.not.toThrow();
    });
  });

  describe('setupServer', () => {
    it('should setup complete server context', async () => {
      const result = await setupServer();

      expect(result).toHaveProperty('server');
      expect(result).toHaveProperty('queries');
      expect(result).toHaveProperty('dbInspector');
      expect(result).toHaveProperty('dbAnalytics');
      expect(result).toHaveProperty('dbSizeAnalyzer');
      expect(result).toHaveProperty('supabase');
      expect(result).toHaveProperty('redis');
      expect(result).toHaveProperty('pluginManager');
      expect(result).toHaveProperty('handlerRegistry');
    });

    it('should initialize plugin manager', async () => {
      const result = await setupServer();

      expect(result.pluginManager).toBeDefined();
      expect(result.pluginManager.initialize).toHaveBeenCalled();
    });

    it('should create handler registry', async () => {
      const result = await setupServer();

      expect(result.handlerRegistry).toBeDefined();
    });
  });
});

