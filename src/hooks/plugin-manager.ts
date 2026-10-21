import { Resource, ResourceTemplate, Tool } from '@modelcontextprotocol/sdk/types.js';
import { PluginResourceContent, RequestContext, VConPlugin } from './plugin-interface.js';

export class PluginManager {
  private plugins: VConPlugin[] = [];
  private initialized = false;

  /**
   * Register a plugin
   */
  registerPlugin(plugin: VConPlugin): void {
    console.error(`📦 Registering plugin: ${plugin.name} v${plugin.version}`);
    this.plugins.push(plugin);
  }

  /**
   * Initialize all plugins
   */
  async initialize(config: any): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.initialize) {
        await plugin.initialize(config);
      }
    }
    this.initialized = true;
    console.error(`✅ Initialized ${this.plugins.length} plugin(s)`);
  }

  /**
   * Shutdown all plugins
   */
  async shutdown(): Promise<void> {
    // Shut down all plugins concurrently — one slow plugin won't block others.
    await Promise.allSettled(
      this.plugins
        .filter((p) => p.shutdown)
        .map((p) => p.shutdown!())
    );
  }

  /**
   * True when at least one registered plugin implements `hookName`.
   * Lets callers skip work (e.g. hydrating vCons) that only a hook needs.
   */
  hasHook(hookName: keyof VConPlugin): boolean {
    return this.plugins.some((p) => typeof p[hookName] === 'function');
  }

  /**
   * Execute a hook across all plugins
   * Returns first non-undefined result or undefined
   */
  async executeHook<T>(
    hookName: keyof VConPlugin,
    ...args: any[]
  ): Promise<T | undefined> {
    for (const plugin of this.plugins) {
      const hook = plugin[hookName] as Function;
      if (hook) {
        try {
          const result = await hook.apply(plugin, args);
          if (result !== undefined) {
            return result;
          }
        } catch (error) {
          console.error(`❌ Plugin ${plugin.name} hook ${String(hookName)} failed:`, error);
          throw error; // Re-throw to block operation
        }
      }
    }
    return undefined;
  }

  /**
   * Get all additional tools from plugins
   */
  async getAdditionalTools(): Promise<Tool[]> {
    const tools: Tool[] = [];
    for (const plugin of this.plugins) {
      if (plugin.registerTools) {
        const pluginTools = plugin.registerTools();
        tools.push(...pluginTools);
      }
    }
    return tools;
  }

  /**
   * Get all additional resources from plugins
   */
  async getAdditionalResources(): Promise<Resource[]> {
    const resources: Resource[] = [];
    for (const plugin of this.plugins) {
      if (plugin.registerResources) {
        const pluginResources = plugin.registerResources();
        resources.push(...pluginResources);
      }
    }
    return resources;
  }

  /**
   * Get all additional resource templates from plugins
   */
  async getAdditionalResourceTemplates(): Promise<ResourceTemplate[]> {
    const templates: ResourceTemplate[] = [];
    for (const plugin of this.plugins) {
      if (plugin.registerResourceTemplates) {
        templates.push(...plugin.registerResourceTemplates());
      }
    }
    return templates;
  }

  /**
   * Read a plugin-provided resource. The first plugin returning a non-undefined
   * result owns the URI; undefined means no plugin serves it.
   */
  async readPluginResource(
    uri: string,
    context: RequestContext
  ): Promise<PluginResourceContent | undefined> {
    for (const plugin of this.plugins) {
      if (plugin.readResource) {
        try {
          const result = await plugin.readResource(uri, context);
          if (result !== undefined) {
            return result;
          }
        } catch (error) {
          console.error(`❌ Plugin ${plugin.name} failed to read resource ${uri}:`, error);
          throw error;
        }
      }
    }
    return undefined;
  }

  /**
   * Handle a tool call by delegating to the appropriate plugin
   */
  async handlePluginToolCall(toolName: string, args: any, context: RequestContext): Promise<any> {
    for (const plugin of this.plugins) {
      if (plugin.handleToolCall) {
        try {
          const result = await plugin.handleToolCall(toolName, args, context);
          if (result !== undefined) {
            return result;
          }
        } catch (error) {
          console.error(`❌ Plugin ${plugin.name} failed to handle tool ${toolName}:`, error);
          throw error;
        }
      }
    }
    return undefined;
  }
}
