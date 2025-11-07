/**
 * Server Setup
 * 
 * Initializes database, plugins, and handler registry
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { VConQueries } from '../db/queries.js';
import { DatabaseInspector } from '../db/database-inspector.js';
import { DatabaseAnalytics } from '../db/database-analytics.js';
import { DatabaseSizeAnalyzer } from '../db/database-size-analyzer.js';
import { PluginManager } from '../hooks/plugin-manager.js';
import { getSupabaseClient, getRedisClient } from '../db/client.js';
import { createHandlerRegistry, type ToolHandlerRegistry } from '../tools/handlers/index.js';

export interface ServerContext {
  server: Server;
  queries: VConQueries;
  dbInspector: DatabaseInspector;
  dbAnalytics: DatabaseAnalytics;
  dbSizeAnalyzer: DatabaseSizeAnalyzer;
  supabase: any;
  redis: any;
  pluginManager: PluginManager;
  handlerRegistry: ToolHandlerRegistry;
}

/**
 * Initialize MCP server
 */
export function createServer(): Server {
  return new Server(
    {
      name: 'vcon-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );
}

/**
 * Initialize database and cache clients
 */
export function initializeDatabase(): {
  queries: VConQueries;
  dbInspector: DatabaseInspector;
  dbAnalytics: DatabaseAnalytics;
  dbSizeAnalyzer: DatabaseSizeAnalyzer;
  supabase: any;
  redis: any;
} {
  const supabase = getSupabaseClient();
  const redis = getRedisClient(); // Optional - returns null if not configured
  const queries = new VConQueries(supabase, redis);
  const dbInspector = new DatabaseInspector(supabase);
  const dbAnalytics = new DatabaseAnalytics(supabase);
  const dbSizeAnalyzer = new DatabaseSizeAnalyzer(supabase);

  console.error('✅ Database client initialized');

  return {
    queries,
    dbInspector,
    dbAnalytics,
    dbSizeAnalyzer,
    supabase,
    redis,
  };
}

/**
 * Load plugins from environment configuration
 */
export async function loadPlugins(
  pluginManager: PluginManager,
  supabase: any
): Promise<void> {
  if (!process.env.VCON_PLUGINS_PATH) {
    return;
  }

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
        offlineMode: process.env.VCON_OFFLINE_MODE === 'true',
      };

      const plugin = new PluginClass(pluginConfig);
      pluginManager.registerPlugin(plugin);
    } catch (error) {
      console.error(`❌ Failed to load plugin from ${path}:`, error);
      // Continue without the plugin
    }
  }
}

/**
 * Setup complete server context
 */
export async function setupServer(): Promise<ServerContext> {
  // Initialize server
  const server = createServer();

  // Initialize database
  const {
    queries,
    dbInspector,
    dbAnalytics,
    dbSizeAnalyzer,
    supabase,
    redis,
  } = initializeDatabase();

  // Initialize plugin manager
  const pluginManager = new PluginManager();

  // Load plugins
  await loadPlugins(pluginManager, supabase);

  // Initialize plugins
  await pluginManager.initialize({ supabase, queries });

  // Initialize tool handler registry
  const handlerRegistry = createHandlerRegistry();

  return {
    server,
    queries,
    dbInspector,
    dbAnalytics,
    dbSizeAnalyzer,
    supabase,
    redis,
    pluginManager,
    handlerRegistry,
  };
}

