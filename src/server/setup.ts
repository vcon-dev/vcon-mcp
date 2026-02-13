/**
 * Server Setup
 *
 * Initializes database, plugins, and handler registry
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { getRedisClient, getSupabaseClient } from '../db/client.js';
// Supabase implementations
import { SupabaseDatabaseAnalytics } from '../db/database-analytics.js';
import { SupabaseDatabaseInspector } from '../db/database-inspector.js';
import { SupabaseDatabaseSizeAnalyzer } from '../db/database-size-analyzer.js';
import { SupabaseVConQueries } from '../db/queries.js';
// Interfaces
import { IVConQueries } from '../db/interfaces.js';
import {
  IDatabaseInspector,
  IDatabaseAnalytics,
  IDatabaseSizeAnalyzer
} from '../db/types.js'; // Updated import path
// Mongo implementations (dynamic import or static if we convert to ESM fully)
// We will use dynamic imports for Mongo to avoid hard dependency if not needed, or stick to static if preferred.
// verification script uses static import.
import { debugTenantVisibility, setTenantContext, verifyTenantContext } from '../db/tenant-context.js';
import { PluginManager } from '../hooks/plugin-manager.js';
import { createLogger } from '../observability/logger.js';
import { VConService } from '../services/vcon-service.js';
import { createHandlerRegistry, type ToolHandlerRegistry } from '../tools/handlers/index.js';

const logger = createLogger('server-setup');

export interface ServerContext {
  server: Server;
  queries: IVConQueries;
  dbInspector: IDatabaseInspector;
  dbAnalytics: IDatabaseAnalytics;
  dbSizeAnalyzer: IDatabaseSizeAnalyzer;
  supabase: any;
  redis: any;
  pluginManager: PluginManager;
  handlerRegistry: ToolHandlerRegistry;
  vconService: VConService;
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
  queries: IVConQueries;
  dbInspector: IDatabaseInspector;
  dbAnalytics: IDatabaseAnalytics;
  dbSizeAnalyzer: IDatabaseSizeAnalyzer;
  supabase: any;
  redis: any;
  mongoClient?: { client: any; db: any };
}> {
  const dbType = process.env.DB_TYPE || 'supabase';

  let queries: IVConQueries;
  let dbInspector: IDatabaseInspector;
  let dbAnalytics: IDatabaseAnalytics;
  let dbSizeAnalyzer: IDatabaseSizeAnalyzer;

  let supabase: any = null;
  let redis: any = null;
  let mongoClient: any = null;

  if (dbType === 'mongodb') {
    // Dynamic imports for Mongo modules
    const { getMongoClient } = await import('../db/mongo-client.js');
    const { MongoVConQueries } = await import('../db/mongo-queries.js');
    const { MongoDatabaseInspector } = await import('../db/mongo-inspector.js');
    const { MongoDatabaseAnalytics } = await import('../db/mongo-analytics.js');
    const { MongoDatabaseSizeAnalyzer } = await import('../db/mongo-size-analyzer.js');

    mongoClient = await getMongoClient();
    const db = mongoClient.db;

    queries = new MongoVConQueries(db);
    dbInspector = new MongoDatabaseInspector(db);
    dbAnalytics = new MongoDatabaseAnalytics(db);
    dbSizeAnalyzer = new MongoDatabaseSizeAnalyzer(db);

    logger.info({ db_type: 'mongodb' }, 'Initialized MongoDB backend');
  } else {
    // Default to Supabase
    supabase = getSupabaseClient();
    redis = getRedisClient(); // Optional
    queries = new SupabaseVConQueries(supabase, redis);
    dbInspector = new SupabaseDatabaseInspector(supabase);
    dbAnalytics = new SupabaseDatabaseAnalytics(supabase);
    dbSizeAnalyzer = new SupabaseDatabaseSizeAnalyzer(supabase);

    logger.info({
      db_type: 'supabase',
      has_redis: !!redis
    }, 'Initialized Supabase backend');
  }

  // To avoid breaking existing code that expects Supabase to exist (e.g. some plugins might need it?):
  if (!supabase && process.env.SUPABASE_URL && dbType === 'mongodb') {
    try {
      // Optional: Initialize Supabase client even in Mongo mode if creds exist, 
      // but don't use it for core queries.
      supabase = getSupabaseClient();
    } catch (e) {
      // Ignore
    }
  }

  // Set tenant context for RLS if enabled (Supabase only)
  if (supabase) {
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
    }
  }

  return {
    queries,
    dbInspector,
    dbAnalytics,
    dbSizeAnalyzer,
    supabase,
    redis,
    mongoClient
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

  // Initialize vCon service (single source of truth for vCon lifecycle)
  const vconService = new VConService({
    queries,
    pluginManager,
  });

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
    vconService,
  };
}
