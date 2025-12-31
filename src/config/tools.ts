/**
 * Tool Configuration and Categories
 *
 * Provides category-based control for enabling/disabling groups of tools.
 * By default, all categories are enabled.
 *
 * Environment Variables:
 * - MCP_TOOLS_PROFILE: Use a preset profile (full, readonly, user, admin, minimal)
 * - MCP_ENABLED_CATEGORIES: Comma-separated list of categories to enable
 * - MCP_DISABLED_CATEGORIES: Comma-separated list of categories to disable
 * - MCP_DISABLED_TOOLS: Comma-separated list of individual tools to disable
 */

import { createLogger } from '../observability/logger.js';

const logger = createLogger('tools-config');

/**
 * Tool categories for enabling/disabling groups of tools
 */
export type ToolCategory = 'read' | 'write' | 'schema' | 'analytics' | 'infra';

/**
 * All available categories
 */
export const ALL_CATEGORIES: ToolCategory[] = ['read', 'write', 'schema', 'analytics', 'infra'];

/**
 * Tool definition with category metadata
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
  category: ToolCategory;
}

/**
 * Configuration for which tools/categories are enabled
 */
export interface ToolsConfig {
  // Category-level control
  enabledCategories: ToolCategory[];

  // Individual tool overrides (optional)
  disabledTools?: string[];
}

/**
 * Default configuration - all categories enabled
 */
export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
  enabledCategories: [...ALL_CATEGORIES],
};

/**
 * Preset deployment profiles
 */
export const DEPLOYMENT_PROFILES: Record<string, ToolsConfig> = {
  // Full access - all tools
  full: {
    enabledCategories: ['read', 'write', 'schema', 'analytics', 'infra'],
  },

  // Read-only - no mutations
  readonly: {
    enabledCategories: ['read', 'schema'],
  },

  // User-facing - CRUD but no infra/analytics
  user: {
    enabledCategories: ['read', 'write', 'schema'],
  },

  // Admin - monitoring and analytics
  admin: {
    enabledCategories: ['read', 'analytics', 'infra', 'schema'],
  },

  // Minimal - just basic CRUD
  minimal: {
    enabledCategories: ['read', 'write'],
  },
};

/**
 * Load tools configuration from environment variables
 */
export function loadToolsConfig(): ToolsConfig {
  // Check for deployment profile first
  const profile = process.env.MCP_TOOLS_PROFILE;
  if (profile && DEPLOYMENT_PROFILES[profile]) {
    logger.info({ profile }, 'Using tools profile');
    const config = { ...DEPLOYMENT_PROFILES[profile] };

    // Allow additional disabled tools even with profile
    const disabledToolsEnv = process.env.MCP_DISABLED_TOOLS;
    if (disabledToolsEnv) {
      config.disabledTools = disabledToolsEnv.split(',').map((t) => t.trim());
    }

    return config;
  }

  // Check for explicit category configuration
  const enabledCategoriesEnv = process.env.MCP_ENABLED_CATEGORIES;
  const disabledCategoriesEnv = process.env.MCP_DISABLED_CATEGORIES;

  let enabledCategories: ToolCategory[];

  if (enabledCategoriesEnv) {
    // Explicit list of enabled categories
    enabledCategories = enabledCategoriesEnv
      .split(',')
      .map((c) => c.trim())
      .filter((c) => ALL_CATEGORIES.includes(c as ToolCategory)) as ToolCategory[];
    logger.info({ enabledCategories }, 'Using explicit enabled categories');
  } else if (disabledCategoriesEnv) {
    // Start with all, remove disabled
    const disabledCategories = disabledCategoriesEnv
      .split(',')
      .map((c) => c.trim()) as ToolCategory[];
    enabledCategories = ALL_CATEGORIES.filter((c) => !disabledCategories.includes(c));
    logger.info({ disabledCategories, enabledCategories }, 'Using disabled categories');
  } else {
    // Default: all enabled
    enabledCategories = [...ALL_CATEGORIES];
  }

  // Check for disabled tools
  const disabledToolsEnv = process.env.MCP_DISABLED_TOOLS;
  const disabledTools = disabledToolsEnv?.split(',').map((t) => t.trim());

  if (disabledTools?.length) {
    logger.info({ disabledTools }, 'Individual tools disabled');
  }

  return {
    enabledCategories,
    disabledTools,
  };
}

/**
 * Filter tools based on configuration
 */
export function filterEnabledTools<T extends { name: string; category: ToolCategory }>(
  tools: T[],
  config: ToolsConfig
): T[] {
  return tools.filter((tool) => {
    // Check if tool is explicitly disabled
    if (config.disabledTools?.includes(tool.name)) {
      return false;
    }

    // Check if tool's category is enabled
    return config.enabledCategories.includes(tool.category);
  });
}

/**
 * Remove category field from tools for MCP response
 * (MCP protocol doesn't need the category field)
 */
export function stripCategories<T extends { category: ToolCategory }>(
  tools: T[]
): Omit<T, 'category'>[] {
  return tools.map(({ category, ...rest }) => rest);
}

