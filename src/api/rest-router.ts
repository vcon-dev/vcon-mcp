/**
 * REST API Router — Thin Assembler
 *
 * Creates the Koa app, registers global middleware, then mounts
 * sub-routers from the routes/ directory. Individual route handlers
 * live in their own modules mirroring the MCP tool organization.
 */

import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import type { Context } from 'koa';
import { getVersionInfo } from '../version.js';
import { createAuthMiddleware, errorHandler, getAuthConfig, requestLogger } from './auth.js';
import type { RestApiContext } from './context.js';
import { createAnalyticsRoutes } from './routes/analytics.js';
import { createDatabaseRoutes } from './routes/database.js';
import { createSchemaRoutes } from './routes/schema.js';
import { createSearchRoutes } from './routes/search.js';
import { createTagRoutes } from './routes/tags.js';
import { createVConRoutes } from './routes/vcons.js';

// Re-export RestApiContext from the canonical location
export type { RestApiContext } from './context.js';

// ============================================================================
// Configuration
// ============================================================================

export interface RestApiConfig {
  /** Base path for REST API (default: /api/v1) */
  basePath: string;
  /** Enable REST API (default: true when HTTP enabled) */
  enabled: boolean;
  /** CORS origin (default: *) */
  corsOrigin: string;
}

export function getRestApiConfig(): RestApiConfig {
  return {
    basePath: process.env.REST_API_BASE_PATH || '/api/v1',
    enabled: process.env.REST_API_ENABLED !== 'false',
    corsOrigin: process.env.CORS_ORIGIN || '*',
  };
}

// ============================================================================
// Koa App Factory
// ============================================================================

/**
 * Create Koa app with all REST API routes
 */
export function createRestApi(apiContext: RestApiContext, config?: Partial<RestApiConfig>): Koa {
  const restConfig: RestApiConfig = { ...getRestApiConfig(), ...config };
  const authConfig = getAuthConfig();

  const app = new Koa();
  const router = new Router({ prefix: restConfig.basePath });

  // ========== Global Middleware ==========

  // Error handling (must be first)
  app.use(errorHandler());

  // Version headers
  const versionInfo = getVersionInfo();
  app.use(async (ctx: Context, next: () => Promise<void>) => {
    ctx.set('X-Version', versionInfo.version);
    ctx.set('X-Git-Commit', versionInfo.gitCommit);
    ctx.set('X-Build-Time', versionInfo.buildTime);
    await next();
  });

  // Request logging
  app.use(requestLogger());

  // CORS (added PATCH to allowed methods)
  app.use(cors({
    origin: restConfig.corsOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
    exposeHeaders: ['X-Version', 'X-Git-Commit', 'X-Build-Time', 'X-Total-Count'],
  }));

  // Body parser (50MB limit for batch operations)
  app.use(bodyParser({
    jsonLimit: '50mb',
    enableTypes: ['json'],
  }));

  // Authentication (skip for health, version, schema, and examples)
  const noAuthPaths = new Set([
    `${restConfig.basePath}/health`,
    `${restConfig.basePath}/version`,
    `${restConfig.basePath}/schema`,
  ]);
  app.use(async (ctx: Context, next: () => Promise<void>) => {
    if (noAuthPaths.has(ctx.path) || ctx.path.startsWith(`${restConfig.basePath}/examples/`)) {
      await next();
      return;
    }
    const authMiddleware = createAuthMiddleware(authConfig);
    await authMiddleware(ctx, next);
  });

  // ========== Mount Sub-Routers ==========

  // Infrastructure routes (health, version, schema, examples) — some skip auth
  const schemaRouter = createSchemaRoutes(apiContext);
  router.use(schemaRouter.routes());

  // Search routes — MUST be before /vcons/:uuid to avoid "search" matching as UUID
  const searchRouter = createSearchRoutes(apiContext);
  router.use(searchRouter.routes());

  // Tag collection routes (/tags, /tags/search)
  const tagRouter = createTagRoutes(apiContext);
  router.use(tagRouter.routes());

  // vCon CRUD and sub-resource routes
  const vconRouter = createVConRoutes(apiContext);
  router.use(vconRouter.routes());

  // Database operational routes
  const dbRouter = createDatabaseRoutes(apiContext);
  router.use('/database', dbRouter.routes());

  // Analytics routes
  const analyticsRouter = createAnalyticsRoutes(apiContext);
  router.use('/analytics', analyticsRouter.routes());

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
