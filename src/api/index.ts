/**
 * REST API Module
 * 
 * Exports Koa-based REST API components for vCon ingestion and operations
 */

export { createAuthMiddleware, errorHandler, getAuthConfig, requestLogger } from './auth.js';
export type { AuthConfig } from './auth.js';

export { createRestApi, getRestApiConfig, isRestApiPath } from './rest-router.js';
export type { RestApiConfig, RestApiContext } from './rest-router.js';
