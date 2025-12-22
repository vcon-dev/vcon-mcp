/**
 * Server Setup
 *
 * Initializes database, plugins, and handler registry
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { getRedisClient, getSupabaseClient } from '../db/client.js';
import { DatabaseAnalytics } from '../db/database-analytics.js';
import { DatabaseInspector } from '../db/database-inspector.js';
import { DatabaseSizeAnalyzer } from '../db/database-size-analyzer.js';
import { VConQueries } from '../db/queries.js';
import { debugTenantVisibility, setTenantContext, verifyTenantContext } from '../db/tenant-context.js';
import { PluginManager } from '../hooks/plugin-manager.js';
import { createLogger } from '../observability/logger.js';
import { createHandlerRegistry, type ToolHandlerRegistry } from '../tools/handlers/index.js';

const logger = createLogger('server-setup');

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
export async function initializeDatabase(): Promise<{
  queries: VConQueries;
  dbInspector: DatabaseInspector;
  dbAnalytics: DatabaseAnalytics;
  dbSizeAnalyzer: DatabaseSizeAnalyzer;
  supabase: any;
  redis: any;
}> {
  const supabase = getSupabaseClient();
  const redis = getRedisClient(); // Optional - returns null if not configured
  const queries = new VConQueries(supabase, redis);
  const dbInspector = new DatabaseInspector(supabase);
  const dbAnalytics = new DatabaseAnalytics(supabase);
  const dbSizeAnalyzer = new DatabaseSizeAnalyzer(supabase);

  logger.info({
    has_redis: !!redis,
    cache_enabled: !!redis
  }, 'Database client initialized');

  // Set tenant context for RLS if enabled
  try {
    await setTenantContext(supabase);
    await verifyTenantContext(supabase);

    // Debug tenant visibility
    if (process.env.MCP_DEBUG === 'true' || process.env.RLS_DEBUG === 'true') {
      await debugTenantVisibility(supabase);
    }
  } catch (error) {
    logger.warn({
      err: error,
      error_message: error instanceof Error ? error.message : String(error)
    }, 'Failed to set tenant context');
    // Continue anyway - the server should still work for non-RLS scenarios
  }

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
      logger.info({ plugin_path: trimmedPath }, 'Loading plugin');

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
      logger.error({
        err: error,
        plugin_path: path,
        error_message: error instanceof Error ? error.message : String(error)
      }, 'Failed to load plugin');
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

  // Initialize database (now async due to tenant context setup)
  const {
    queries,
    dbInspector,
    dbAnalytics,
    dbSizeAnalyzer,
    supabase,
    redis,
  } = await initializeDatabase();

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
