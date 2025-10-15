/**
 * OpenTelemetry Semantic Attributes
 * 
 * Standard attribute keys following OpenTelemetry semantic conventions
 * for vCon MCP server observability
 */

import { SEMATTRS_DB_OPERATION, SEMATTRS_DB_SYSTEM } from '@opentelemetry/semantic-conventions';

/**
 * vCon-specific attributes
 */
export const ATTR_VCON_UUID = 'vcon.uuid';
export const ATTR_VCON_VERSION = 'vcon.version';
export const ATTR_VCON_SUBJECT = 'vcon.subject';
export const ATTR_VCON_PARTIES_COUNT = 'vcon.parties.count';

/**
 * MCP tool attributes
 */
export const ATTR_TOOL_NAME = 'mcp.tool.name';
export const ATTR_TOOL_SUCCESS = 'mcp.tool.success';
export const ATTR_TOOL_ERROR_TYPE = 'mcp.tool.error.type';

/**
 * Plugin attributes
 */
export const ATTR_PLUGIN_NAME = 'plugin.name';
export const ATTR_PLUGIN_VERSION = 'plugin.version';
export const ATTR_PLUGIN_HOOK = 'plugin.hook';

/**
 * Search attributes
 */
export const ATTR_SEARCH_TYPE = 'search.type';
export const ATTR_SEARCH_QUERY = 'search.query';
export const ATTR_SEARCH_RESULTS_COUNT = 'search.results.count';
export const ATTR_SEARCH_THRESHOLD = 'search.threshold';
export const ATTR_SEARCH_SEMANTIC_WEIGHT = 'search.semantic_weight';

/**
 * Cache attributes
 */
export const ATTR_CACHE_HIT = 'cache.hit';
export const ATTR_CACHE_KEY = 'cache.key';
export const ATTR_CACHE_TTL = 'cache.ttl';

/**
 * Database attributes (extending semantic conventions)
 */
export const ATTR_DB_OPERATION = SEMATTRS_DB_OPERATION;
export const ATTR_DB_SYSTEM = SEMATTRS_DB_SYSTEM;
export const ATTR_DB_TABLE = 'db.table';
export const ATTR_DB_QUERY_TYPE = 'db.query.type';

/**
 * Error attributes
 */
export const ATTR_ERROR_TYPE = 'error.type';
export const ATTR_ERROR_MESSAGE = 'error.message';
export const ATTR_ERROR_STACK = 'error.stack';

/**
 * Request context attributes
 */
export const ATTR_USER_ID = 'user.id';
export const ATTR_REQUEST_PURPOSE = 'request.purpose';

