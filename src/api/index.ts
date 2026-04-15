/**
 * REST API Module
 *
 * Exports Koa-based REST API components for vCon operations
 */

export {
  createAuthMiddleware,
  errorHandler,
  getAuthConfig,
  getTokenFromRequest,
  requestLogger,
  validateHttpRequestAuth,
} from './auth.js';
export type { AuthConfig, ValidateHttpAuthResult } from './auth.js';

export type { RestApiContext } from './context.js';

export { createRestApi, getRestApiConfig, isRestApiPath } from './rest-router.js';
export type { RestApiConfig } from './rest-router.js';
