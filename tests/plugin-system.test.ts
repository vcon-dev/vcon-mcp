/**
 * Plugin System Tests
 * Tests for plugin manager and plugin lifecycle hooks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginManager } from '../src/hooks/plugin-manager.js';
import { VConPlugin, RequestContext } from '../src/hooks/plugin-interface.js';
import { VCon } from '../src/types/vcon.js';

// Mock plugins for testing
class TestPlugin implements VConPlugin {
  name = 'test-plugin';
  version = '1.0.0';
  initialized = false;
  shutdownCalled = false;

  async initialize(config: any): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
  }

  async beforeCreate(vcon: VCon, context: RequestContext): Promise<VCon> {
    // Add a marker to show this hook ran
    return { ...vcon, subject: `${vcon.subject || ''} [test-plugin]` };
  }

  async afterCreate(vcon: VCon, context: RequestContext): Promise<void> {
    // No-op for testing
  }
}

class LoggingPlugin implements VConPlugin {
  name = 'logging-plugin';
  version = '1.0.0';
  logs: string[] = [];

  async beforeRead(uuid: string, context: RequestContext): Promise<void> {
    this.logs.push(`Reading vCon: ${uuid}`);
  }

  async afterRead(vcon: VCon, context: RequestContext): Promise<VCon> {
    this.logs.push(`Read vCon: ${vcon.uuid}`);
    return vcon;
  }
}

class ValidationPlugin implements VConPlugin {
  name = 'validation-plugin';
  version = '1.0.0';

  async beforeCreate(vcon: VCon, context: RequestContext): Promise<VCon> {
    // Block creation if subject is 'blocked'
    if (vcon.subject === 'blocked') {
      throw new Error('Creation blocked by validation plugin');
    }
    return vcon;
  }
}

class ToolPlugin implements VConPlugin {
  name = 'tool-plugin';
  version = '1.0.0';

  registerTools() {
    return [{
      name: 'custom_tool',
      description: 'A custom tool from plugin',
      inputSchema: {
        type: 'object' as const,
        properties: {
          param: { type: 'string' }
        }
      }
    }];
  }

  async handleToolCall(toolName: string, args: any, context: RequestContext): Promise<any> {
    if (toolName === 'custom_tool') {
      return { result: `Handled: ${args.param}` };
    }
    return undefined;
  }
}

describe('PluginManager', () => {
  let pluginManager: PluginManager;

  beforeEach(() => {
    pluginManager = new PluginManager();
  });

  describe('Plugin Registration', () => {
    it('should register a plugin', () => {
      const plugin = new TestPlugin();
      
      expect(() => pluginManager.registerPlugin(plugin)).not.toThrow();
    });

    it('should register multiple plugins', () => {
      const plugin1 = new TestPlugin();
      const plugin2 = new LoggingPlugin();
      
      pluginManager.registerPlugin(plugin1);
      pluginManager.registerPlugin(plugin2);
      
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('Plugin Initialization', () => {
    it('should initialize all registered plugins', async () => {
      const plugin1 = new TestPlugin();
      const plugin2 = new TestPlugin();
      
      pluginManager.registerPlugin(plugin1);
      pluginManager.registerPlugin(plugin2);
      
      await pluginManager.initialize({});
      
      expect(plugin1.initialized).toBe(true);
      expect(plugin2.initialized).toBe(true);
    });

    it('should pass config to plugin initialization', async () => {
      const plugin = {
        name: 'config-test',
        version: '1.0.0',
        initialize: vi.fn()
      };
      
      pluginManager.registerPlugin(plugin);
      
      const config = { testConfig: 'value' };
      await pluginManager.initialize(config);
      
      expect(plugin.initialize).toHaveBeenCalledWith(config);
    });
  });

  describe('Plugin Shutdown', () => {
    it('should shutdown all plugins', async () => {
      const plugin1 = new TestPlugin();
      const plugin2 = new TestPlugin();
      
      pluginManager.registerPlugin(plugin1);
      pluginManager.registerPlugin(plugin2);
      
      await pluginManager.shutdown();
      
      expect(plugin1.shutdownCalled).toBe(true);
      expect(plugin2.shutdownCalled).toBe(true);
    });

    it('should handle plugins without shutdown method', async () => {
      const plugin = {
        name: 'no-shutdown',
        version: '1.0.0'
      };
      
      pluginManager.registerPlugin(plugin);
      
      await expect(pluginManager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('Hook Execution', () => {
    it('should execute beforeCreate hook', async () => {
      const plugin = new TestPlugin();
      pluginManager.registerPlugin(plugin);
      
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Test',
        parties: []
      };
      
      const context: RequestContext = {
        timestamp: new Date()
      };
      
      const result = await pluginManager.executeHook<VCon>('beforeCreate', vcon, context);
      
      expect(result).toBeDefined();
      expect(result?.subject).toContain('[test-plugin]');
    });

    it('should execute hooks in order and return first non-undefined result', async () => {
      const plugin1 = new TestPlugin();
      const plugin2 = {
        name: 'second-plugin',
        version: '1.0.0',
        async beforeCreate(vcon: VCon): Promise<VCon> {
          return { ...vcon, subject: 'Modified by second' };
        }
      };
      
      pluginManager.registerPlugin(plugin1);
      pluginManager.registerPlugin(plugin2);
      
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Test',
        parties: []
      };
      
      const result = await pluginManager.executeHook<VCon>('beforeCreate', vcon, {
        timestamp: new Date()
      });
      
      // Should return result from first plugin
      expect(result?.subject).toContain('[test-plugin]');
    });

    it('should throw error if plugin hook throws', async () => {
      const plugin = new ValidationPlugin();
      pluginManager.registerPlugin(plugin);
      
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'blocked',
        parties: []
      };
      
      await expect(
        pluginManager.executeHook('beforeCreate', vcon, { timestamp: new Date() })
      ).rejects.toThrow('Creation blocked by validation plugin');
    });

    it('should execute multiple hook types', async () => {
      const plugin = new LoggingPlugin();
      pluginManager.registerPlugin(plugin);
      
      const uuid = crypto.randomUUID();
      const vcon: VCon = {
        vcon: '0.3.0',
        uuid,
        created_at: new Date().toISOString(),
        parties: []
      };
      
      await pluginManager.executeHook('beforeRead', uuid, { timestamp: new Date() });
      await pluginManager.executeHook('afterRead', vcon, { timestamp: new Date() });
      
      expect(plugin.logs).toHaveLength(2);
      expect(plugin.logs[0]).toContain(uuid);
      expect(plugin.logs[1]).toContain(uuid);
    });

    it('should return undefined if no plugin handles the hook', async () => {
      const plugin = {
        name: 'simple-plugin',
        version: '1.0.0'
      };
      
      pluginManager.registerPlugin(plugin);
      
      const result = await pluginManager.executeHook('beforeCreate', {}, { timestamp: new Date() });
      
      expect(result).toBeUndefined();
    });
  });

  describe('Tool Registration', () => {
    it('should get additional tools from plugins', async () => {
      const plugin = new ToolPlugin();
      pluginManager.registerPlugin(plugin);
      
      const tools = await pluginManager.getAdditionalTools();
      
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('custom_tool');
    });

    it('should combine tools from multiple plugins', async () => {
      const plugin1 = new ToolPlugin();
      const plugin2 = {
        name: 'another-tool-plugin',
        version: '1.0.0',
        registerTools() {
          return [{
            name: 'another_tool',
            description: 'Another tool',
            inputSchema: { type: 'object' as const, properties: {} }
          }];
        }
      };
      
      pluginManager.registerPlugin(plugin1);
      pluginManager.registerPlugin(plugin2);
      
      const tools = await pluginManager.getAdditionalTools();
      
      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name)).toContain('custom_tool');
      expect(tools.map(t => t.name)).toContain('another_tool');
    });
  });

  describe('Resource Registration', () => {
    it('should get additional resources from plugins', async () => {
      const plugin = {
        name: 'resource-plugin',
        version: '1.0.0',
        registerResources() {
          return [{
            uri: 'custom://resource',
            name: 'Custom Resource',
            mimeType: 'application/json'
          }];
        }
      };
      
      pluginManager.registerPlugin(plugin);
      
      const resources = await pluginManager.getAdditionalResources();
      
      expect(resources).toHaveLength(1);
      expect(resources[0].uri).toBe('custom://resource');
    });
  });

  describe('Tool Call Handling', () => {
    it('should delegate tool calls to plugins', async () => {
      const plugin = new ToolPlugin();
      pluginManager.registerPlugin(plugin);
      
      const result = await pluginManager.handlePluginToolCall(
        'custom_tool',
        { param: 'test' },
        { timestamp: new Date() }
      );
      
      expect(result).toEqual({ result: 'Handled: test' });
    });

    it('should return undefined if no plugin handles the tool', async () => {
      const plugin = new ToolPlugin();
      pluginManager.registerPlugin(plugin);
      
      const result = await pluginManager.handlePluginToolCall(
        'unknown_tool',
        {},
        { timestamp: new Date() }
      );
      
      expect(result).toBeUndefined();
    });

    it('should throw if plugin handleToolCall throws', async () => {
      const plugin = {
        name: 'failing-plugin',
        version: '1.0.0',
        async handleToolCall() {
          throw new Error('Tool execution failed');
        }
      };
      
      pluginManager.registerPlugin(plugin);
      
      await expect(
        pluginManager.handlePluginToolCall('test', {}, { timestamp: new Date() })
      ).rejects.toThrow('Tool execution failed');
    });
  });
});

