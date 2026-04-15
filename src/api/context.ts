/**
 * REST API Context
 *
 * Extended context that provides all dependencies needed by REST route handlers.
 * Shared between the Koa REST router and all sub-route modules.
 */

import { IVConQueries } from '../db/interfaces.js';
import { IDatabaseAnalytics, IDatabaseInspector, IDatabaseSizeAnalyzer } from '../db/types.js';
import { PluginManager } from '../hooks/plugin-manager.js';
import { VConService } from '../services/vcon-service.js';

export interface RestApiContext {
  queries: IVConQueries;
  pluginManager: PluginManager;
  supabase: any;
  vconService: VConService;
  dbInspector: IDatabaseInspector;
  dbAnalytics: IDatabaseAnalytics;
  dbSizeAnalyzer: IDatabaseSizeAnalyzer;
}
