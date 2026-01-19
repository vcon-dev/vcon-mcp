/**
 * REST API Router using Koa
 * 
 * Clean, declarative REST API for vCon operations.
 * Uses VConService for consistent lifecycle handling.
 */

import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import type { Context } from 'koa';
import { VConQueries } from '../db/queries.js';
import { PluginManager } from '../hooks/plugin-manager.js';
import { logWithContext, recordCounter } from '../observability/instrumentation.js';
import { VConService, VConValidationError } from '../services/vcon-service.js';
import { VCon } from '../types/vcon.js';
import { getVersionInfo } from '../version.js';
import { createAuthMiddleware, errorHandler, getAuthConfig, requestLogger } from './auth.js';

// ============================================================================
// Types
// ============================================================================

export interface RestApiContext {
  queries: VConQueries;
  pluginManager: PluginManager;
  supabase: any;
  vconService: VConService;
}

export interface RestApiConfig {
  /** Base path for REST API (default: /api/v1) */
  basePath: string;
  /** Enable REST API (default: true when HTTP enabled) */
  enabled: boolean;
  /** CORS origin (default: *) */
  corsOrigin: string;
}

// ============================================================================
// Configuration
// ============================================================================

export function getRestApiConfig(): RestApiConfig {
  return {
    basePath: process.env.REST_API_BASE_PATH || '/api/v1',
    enabled: process.env.REST_API_ENABLED !== 'false',
    corsOrigin: process.env.CORS_ORIGIN || '*',
  };
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * POST /vcons - Create/Ingest a single vCon
 */
async function createVCon(ctx: Context, apiContext: RestApiContext) {
  const startTime = Date.now();
  
  // Body should be the vCon object directly
  const body = ctx.request.body as any;
  const vconData: Partial<VCon> = body;

  try {
    // Use VConService for consistent lifecycle handling
    const result = await apiContext.vconService.create(vconData, {
      requestContext: { purpose: 'rest-api-ingest' },
      source: 'rest-api',
    });

    const duration = Date.now() - startTime;
    logWithContext('info', 'vCon created via REST API', {
      uuid: result.uuid,
      duration_ms: duration,
      parties_count: result.vcon.parties?.length || 0,
      dialog_count: result.vcon.dialog?.length || 0,
      analysis_count: result.vcon.analysis?.length || 0,
    });

    ctx.status = 201;
    ctx.body = {
      success: true,
      uuid: result.uuid,
      id: result.id,
      message: 'vCon created successfully',
      duration_ms: duration,
    };
  } catch (error) {
    if (error instanceof VConValidationError) {
      ctx.status = 400;
      ctx.body = {
        error: 'Validation Error',
        message: error.errors.join('; '),
      };
      return;
    }
    throw error;
  }
}

/**
 * POST /vcons/batch - Batch ingest multiple vCons
 */
async function batchCreateVCons(ctx: Context, apiContext: RestApiContext) {
  const startTime = Date.now();
  
  // Body should be an array of vCon objects directly
  const body = ctx.request.body as any;
  const vcons: Partial<VCon>[] = body;

  if (!Array.isArray(vcons)) {
    ctx.status = 400;
    ctx.body = {
      error: 'Validation Error',
      message: 'Request body must be an array of vCons',
    };
    return;
  }

  if (vcons.length === 0) {
    ctx.status = 400;
    ctx.body = { error: 'Validation Error', message: 'Empty vCons array' };
    return;
  }

  if (vcons.length > 100) {
    ctx.status = 400;
    ctx.body = { error: 'Validation Error', message: 'Maximum 100 vCons per batch' };
    return;
  }

  // Use VConService batch create for consistent lifecycle handling
  const batchResult = await apiContext.vconService.createBatch(vcons, {
    requestContext: { purpose: 'rest-api-batch-ingest' },
    source: 'rest-api-batch',
  });

  const duration = Date.now() - startTime;
  
  logWithContext('info', 'Batch vCon creation completed', {
    total: batchResult.total,
    success: batchResult.created,
    errors: batchResult.failed,
    duration_ms: duration,
  });

  ctx.status = batchResult.failed === 0 ? 201 : 207; // 207 Multi-Status if partial success
  ctx.body = {
    success: batchResult.failed === 0,
    total: batchResult.total,
    created: batchResult.created,
    failed: batchResult.failed,
    results: batchResult.results,
    duration_ms: duration,
  };
}

/**
 * GET /vcons/:uuid - Get a vCon by UUID
 */
async function getVCon(ctx: Context, apiContext: RestApiContext) {
  const uuid = ctx.params.uuid;

  try {
    // Use VConService for consistent lifecycle handling
    const vcon = await apiContext.vconService.get(uuid, {
      requestContext: { purpose: 'rest-api-read' },
    });

    ctx.body = {
      success: true,
      vcon,
    };
  } catch (error) {
    // VConService throws if not found
    if (error instanceof Error && error.message.includes('not found')) {
      ctx.status = 404;
      ctx.body = { error: 'Not Found', message: `vCon with UUID ${uuid} not found` };
      return;
    }
    throw error;
  }
}

/**
 * GET /vcons - List recent vCons
 */
async function listVCons(ctx: Context, apiContext: RestApiContext) {
  const limit = Math.min(100, parseInt(ctx.query.limit as string) || 10);

  // Use VConService for consistent lifecycle handling (beforeSearch/afterSearch hooks)
  const vcons = await apiContext.vconService.search(
    { limit },
    { requestContext: { purpose: 'rest-api-list' } }
  );

  ctx.body = {
    success: true,
    count: vcons.length,
    limit,
    vcons,
  };
}

/**
 * DELETE /vcons/:uuid - Delete a vCon
 */
async function deleteVCon(ctx: Context, apiContext: RestApiContext) {
  const uuid = ctx.params.uuid;

  // Use VConService for consistent lifecycle handling
  const deleted = await apiContext.vconService.delete(uuid, {
    requestContext: { purpose: 'rest-api-delete' },
    source: 'rest-api',
  });

  if (!deleted) {
    ctx.status = 404;
    ctx.body = { error: 'Not Found', message: `vCon with UUID ${uuid} not found` };
    return;
  }

  ctx.body = {
    success: true,
    message: `vCon ${uuid} deleted successfully`,
  };
}

/**
 * GET /health - Health check endpoint
 */
async function healthCheck(ctx: Context, apiContext: RestApiContext) {
  const versionInfo = getVersionInfo();
  
  try {
    // Quick DB check
    const { error } = await apiContext.supabase
      .from('vcons')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    if (error) throw error;

    ctx.body = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      version: versionInfo.version,
      gitCommit: versionInfo.gitCommit,
      buildTime: versionInfo.buildTime,
    };
  } catch (error) {
    ctx.status = 503;
    ctx.body = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      version: versionInfo.version,
      gitCommit: versionInfo.gitCommit,
      buildTime: versionInfo.buildTime,
    };
  }
}

/**
 * GET /version - Version information endpoint
 */
function versionEndpoint(ctx: Context) {
  const versionInfo = getVersionInfo();
  
  ctx.body = {
    version: versionInfo.version,
    gitCommit: versionInfo.gitCommit,
    buildTime: versionInfo.buildTime,
    isDev: versionInfo.isDev,
  };
}

// ============================================================================
// Koa App Factory
// ============================================================================

/**
 * Create Koa app with REST API routes
 */
export function createRestApi(apiContext: RestApiContext, config?: Partial<RestApiConfig>): Koa {
  const restConfig: RestApiConfig = { ...getRestApiConfig(), ...config };
  const authConfig = getAuthConfig();

  const app = new Koa();
  const router = new Router({ prefix: restConfig.basePath });

  // ========== Global Middleware ==========
  
  // Error handling (must be first)
  app.use(errorHandler());

  // Version headers (added to all responses for easy inspection)
  const versionInfo = getVersionInfo();
  app.use(async (ctx: Context, next: () => Promise<void>) => {
    ctx.set('X-Version', versionInfo.version);
    ctx.set('X-Git-Commit', versionInfo.gitCommit);
    ctx.set('X-Build-Time', versionInfo.buildTime);
    await next();
  });

  // Request logging
  app.use(requestLogger());

  // CORS
  app.use(cors({
    origin: restConfig.corsOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
    exposeHeaders: ['X-Version', 'X-Git-Commit', 'X-Build-Time'],
  }));

  // Body parser (50MB limit for batch operations)
  app.use(bodyParser({
    jsonLimit: '50mb',
    enableTypes: ['json'],
  }));

  // Authentication (skip for health and version endpoints)
  app.use(async (ctx: Context, next: () => Promise<void>) => {
    // Skip auth for health check and version
    if (ctx.path === `${restConfig.basePath}/health` || ctx.path === `${restConfig.basePath}/version`) {
      await next();
      return;
    }
    
    // Apply auth middleware
    const authMiddleware = createAuthMiddleware(authConfig);
    await authMiddleware(ctx, next);
  });

  // ========== Routes ==========

  // Health check and version (no auth required)
  router.get('/health', async (ctx: Context) => { await healthCheck(ctx, apiContext); });
  router.get('/version', (ctx: Context) => { versionEndpoint(ctx); });

  // vCon CRUD operations
  router.post('/vcons', async (ctx: Context) => { await createVCon(ctx, apiContext); });
  router.post('/vcons/batch', async (ctx: Context) => { await batchCreateVCons(ctx, apiContext); });
  router.get('/vcons', async (ctx: Context) => { await listVCons(ctx, apiContext); });
  router.get('/vcons/:uuid', async (ctx: Context) => { await getVCon(ctx, apiContext); });
  router.delete('/vcons/:uuid', async (ctx: Context) => { await deleteVCon(ctx, apiContext); });

  // Apply routes
  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}

/**
 * Check if request path is for REST API
 */
export function isRestApiPath(path: string, basePath: string = '/api/v1'): boolean {
  return path.startsWith(basePath);
}
