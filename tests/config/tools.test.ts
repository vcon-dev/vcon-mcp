/**
 * Tests for Tool Categories Configuration
 *
 * Verifies that tools can be enabled/disabled via:
 * - Deployment profiles (full, readonly, user, admin, minimal)
 * - Category-based configuration
 * - Individual tool disabling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadToolsConfig,
  filterEnabledTools,
  stripCategories,
  ALL_CATEGORIES,
  DEPLOYMENT_PROFILES,
  DEFAULT_TOOLS_CONFIG,
  type ToolCategory,
  type ToolDefinition,
} from '../../src/config/tools.js';

// Sample tools for testing
const sampleTools: ToolDefinition[] = [
  { name: 'get_vcon', category: 'read', description: 'Get vCon', inputSchema: {} },
  { name: 'search_vcons', category: 'read', description: 'Search vCons', inputSchema: {} },
  { name: 'create_vcon', category: 'write', description: 'Create vCon', inputSchema: {} },
  { name: 'delete_vcon', category: 'write', description: 'Delete vCon', inputSchema: {} },
  { name: 'get_schema', category: 'schema', description: 'Get schema', inputSchema: {} },
  { name: 'get_database_analytics', category: 'analytics', description: 'Get analytics', inputSchema: {} },
  { name: 'get_database_shape', category: 'infra', description: 'Get DB shape', inputSchema: {} },
];

describe('Tool Categories Configuration', () => {
  // Store original env vars
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original env vars
    originalEnv.MCP_TOOLS_PROFILE = process.env.MCP_TOOLS_PROFILE;
    originalEnv.MCP_ENABLED_CATEGORIES = process.env.MCP_ENABLED_CATEGORIES;
    originalEnv.MCP_DISABLED_CATEGORIES = process.env.MCP_DISABLED_CATEGORIES;
    originalEnv.MCP_DISABLED_TOOLS = process.env.MCP_DISABLED_TOOLS;

    // Clear all env vars
    delete process.env.MCP_TOOLS_PROFILE;
    delete process.env.MCP_ENABLED_CATEGORIES;
    delete process.env.MCP_DISABLED_CATEGORIES;
    delete process.env.MCP_DISABLED_TOOLS;
  });

  afterEach(() => {
    // Restore original env vars
    if (originalEnv.MCP_TOOLS_PROFILE !== undefined) {
      process.env.MCP_TOOLS_PROFILE = originalEnv.MCP_TOOLS_PROFILE;
    } else {
      delete process.env.MCP_TOOLS_PROFILE;
    }
    if (originalEnv.MCP_ENABLED_CATEGORIES !== undefined) {
      process.env.MCP_ENABLED_CATEGORIES = originalEnv.MCP_ENABLED_CATEGORIES;
    } else {
      delete process.env.MCP_ENABLED_CATEGORIES;
    }
    if (originalEnv.MCP_DISABLED_CATEGORIES !== undefined) {
      process.env.MCP_DISABLED_CATEGORIES = originalEnv.MCP_DISABLED_CATEGORIES;
    } else {
      delete process.env.MCP_DISABLED_CATEGORIES;
    }
    if (originalEnv.MCP_DISABLED_TOOLS !== undefined) {
      process.env.MCP_DISABLED_TOOLS = originalEnv.MCP_DISABLED_TOOLS;
    } else {
      delete process.env.MCP_DISABLED_TOOLS;
    }
  });

  describe('Constants', () => {
    it('should have all 5 categories defined', () => {
      expect(ALL_CATEGORIES).toEqual(['read', 'write', 'schema', 'analytics', 'infra']);
    });

    it('should have default config with all categories enabled', () => {
      expect(DEFAULT_TOOLS_CONFIG.enabledCategories).toEqual(ALL_CATEGORIES);
      expect(DEFAULT_TOOLS_CONFIG.disabledTools).toBeUndefined();
    });

    it('should have all deployment profiles defined', () => {
      expect(Object.keys(DEPLOYMENT_PROFILES)).toEqual(['full', 'readonly', 'user', 'admin', 'minimal']);
    });
  });

  describe('Deployment Profiles', () => {
    it('full profile should enable all categories', () => {
      expect(DEPLOYMENT_PROFILES.full.enabledCategories).toEqual(['read', 'write', 'schema', 'analytics', 'infra']);
    });

    it('readonly profile should only enable read and schema', () => {
      expect(DEPLOYMENT_PROFILES.readonly.enabledCategories).toEqual(['read', 'schema']);
    });

    it('user profile should enable read, write, and schema', () => {
      expect(DEPLOYMENT_PROFILES.user.enabledCategories).toEqual(['read', 'write', 'schema']);
    });

    it('admin profile should enable read, analytics, infra, and schema', () => {
      expect(DEPLOYMENT_PROFILES.admin.enabledCategories).toEqual(['read', 'analytics', 'infra', 'schema']);
    });

    it('minimal profile should only enable read and write', () => {
      expect(DEPLOYMENT_PROFILES.minimal.enabledCategories).toEqual(['read', 'write']);
    });
  });

  describe('loadToolsConfig', () => {
    it('should return default config when no env vars set', () => {
      const config = loadToolsConfig();
      expect(config.enabledCategories).toEqual(ALL_CATEGORIES);
      expect(config.disabledTools).toBeUndefined();
    });

    it('should load profile from MCP_TOOLS_PROFILE', () => {
      process.env.MCP_TOOLS_PROFILE = 'readonly';
      const config = loadToolsConfig();
      expect(config.enabledCategories).toEqual(['read', 'schema']);
    });

    it('should load user profile from MCP_TOOLS_PROFILE', () => {
      process.env.MCP_TOOLS_PROFILE = 'user';
      const config = loadToolsConfig();
      expect(config.enabledCategories).toEqual(['read', 'write', 'schema']);
    });

    it('should load admin profile from MCP_TOOLS_PROFILE', () => {
      process.env.MCP_TOOLS_PROFILE = 'admin';
      const config = loadToolsConfig();
      expect(config.enabledCategories).toEqual(['read', 'analytics', 'infra', 'schema']);
    });

    it('should load minimal profile from MCP_TOOLS_PROFILE', () => {
      process.env.MCP_TOOLS_PROFILE = 'minimal';
      const config = loadToolsConfig();
      expect(config.enabledCategories).toEqual(['read', 'write']);
    });

    it('should ignore invalid profile and use default', () => {
      process.env.MCP_TOOLS_PROFILE = 'invalid_profile';
      const config = loadToolsConfig();
      expect(config.enabledCategories).toEqual(ALL_CATEGORIES);
    });

    it('should parse MCP_ENABLED_CATEGORIES', () => {
      process.env.MCP_ENABLED_CATEGORIES = 'read,write';
      const config = loadToolsConfig();
      expect(config.enabledCategories).toEqual(['read', 'write']);
    });

    it('should handle whitespace in MCP_ENABLED_CATEGORIES', () => {
      process.env.MCP_ENABLED_CATEGORIES = ' read , write , schema ';
      const config = loadToolsConfig();
      expect(config.enabledCategories).toEqual(['read', 'write', 'schema']);
    });

    it('should filter invalid categories from MCP_ENABLED_CATEGORIES', () => {
      process.env.MCP_ENABLED_CATEGORIES = 'read,invalid,write';
      const config = loadToolsConfig();
      expect(config.enabledCategories).toEqual(['read', 'write']);
    });

    it('should parse MCP_DISABLED_CATEGORIES', () => {
      process.env.MCP_DISABLED_CATEGORIES = 'analytics,infra';
      const config = loadToolsConfig();
      expect(config.enabledCategories).toEqual(['read', 'write', 'schema']);
    });

    it('should prioritize MCP_ENABLED_CATEGORIES over MCP_DISABLED_CATEGORIES', () => {
      process.env.MCP_ENABLED_CATEGORIES = 'read';
      process.env.MCP_DISABLED_CATEGORIES = 'write';
      const config = loadToolsConfig();
      // MCP_ENABLED_CATEGORIES takes precedence
      expect(config.enabledCategories).toEqual(['read']);
    });

    it('should parse MCP_DISABLED_TOOLS', () => {
      process.env.MCP_DISABLED_TOOLS = 'delete_vcon,analyze_query';
      const config = loadToolsConfig();
      expect(config.disabledTools).toEqual(['delete_vcon', 'analyze_query']);
    });

    it('should combine profile with disabled tools', () => {
      process.env.MCP_TOOLS_PROFILE = 'user';
      process.env.MCP_DISABLED_TOOLS = 'delete_vcon';
      const config = loadToolsConfig();
      expect(config.enabledCategories).toEqual(['read', 'write', 'schema']);
      expect(config.disabledTools).toEqual(['delete_vcon']);
    });

    it('should prioritize profile over category env vars', () => {
      process.env.MCP_TOOLS_PROFILE = 'readonly';
      process.env.MCP_ENABLED_CATEGORIES = 'read,write,schema';
      const config = loadToolsConfig();
      // Profile takes precedence
      expect(config.enabledCategories).toEqual(['read', 'schema']);
    });
  });

  describe('filterEnabledTools', () => {
    it('should return all tools when all categories enabled', () => {
      const config = { enabledCategories: ALL_CATEGORIES as ToolCategory[] };
      const filtered = filterEnabledTools(sampleTools, config);
      expect(filtered).toHaveLength(sampleTools.length);
      expect(filtered.map((t) => t.name)).toEqual(sampleTools.map((t) => t.name));
    });

    it('should filter tools by category', () => {
      const config = { enabledCategories: ['read'] as ToolCategory[] };
      const filtered = filterEnabledTools(sampleTools, config);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((t) => t.name)).toEqual(['get_vcon', 'search_vcons']);
    });

    it('should filter tools for readonly profile', () => {
      const config = { enabledCategories: ['read', 'schema'] as ToolCategory[] };
      const filtered = filterEnabledTools(sampleTools, config);
      expect(filtered).toHaveLength(3);
      expect(filtered.map((t) => t.name)).toEqual(['get_vcon', 'search_vcons', 'get_schema']);
    });

    it('should filter tools for user profile', () => {
      const config = { enabledCategories: ['read', 'write', 'schema'] as ToolCategory[] };
      const filtered = filterEnabledTools(sampleTools, config);
      expect(filtered).toHaveLength(5);
      expect(filtered.map((t) => t.name)).toEqual([
        'get_vcon',
        'search_vcons',
        'create_vcon',
        'delete_vcon',
        'get_schema',
      ]);
    });

    it('should filter tools for admin profile', () => {
      const config = { enabledCategories: ['read', 'analytics', 'infra', 'schema'] as ToolCategory[] };
      const filtered = filterEnabledTools(sampleTools, config);
      expect(filtered).toHaveLength(5);
      expect(filtered.map((t) => t.name)).toEqual([
        'get_vcon',
        'search_vcons',
        'get_schema',
        'get_database_analytics',
        'get_database_shape',
      ]);
    });

    it('should exclude individually disabled tools', () => {
      const config = {
        enabledCategories: ALL_CATEGORIES as ToolCategory[],
        disabledTools: ['delete_vcon'],
      };
      const filtered = filterEnabledTools(sampleTools, config);
      expect(filtered).toHaveLength(6);
      expect(filtered.map((t) => t.name)).not.toContain('delete_vcon');
    });

    it('should exclude multiple disabled tools', () => {
      const config = {
        enabledCategories: ALL_CATEGORIES as ToolCategory[],
        disabledTools: ['delete_vcon', 'get_database_shape'],
      };
      const filtered = filterEnabledTools(sampleTools, config);
      expect(filtered).toHaveLength(5);
      expect(filtered.map((t) => t.name)).not.toContain('delete_vcon');
      expect(filtered.map((t) => t.name)).not.toContain('get_database_shape');
    });

    it('should combine category filtering with tool disabling', () => {
      const config = {
        enabledCategories: ['read', 'write'] as ToolCategory[],
        disabledTools: ['delete_vcon'],
      };
      const filtered = filterEnabledTools(sampleTools, config);
      expect(filtered).toHaveLength(3);
      expect(filtered.map((t) => t.name)).toEqual(['get_vcon', 'search_vcons', 'create_vcon']);
    });

    it('should return empty array when no categories enabled', () => {
      const config = { enabledCategories: [] as ToolCategory[] };
      const filtered = filterEnabledTools(sampleTools, config);
      expect(filtered).toHaveLength(0);
    });

    it('should handle empty tools array', () => {
      const config = { enabledCategories: ALL_CATEGORIES as ToolCategory[] };
      const filtered = filterEnabledTools([], config);
      expect(filtered).toHaveLength(0);
    });
  });

  describe('stripCategories', () => {
    it('should remove category field from tools', () => {
      const stripped = stripCategories(sampleTools);
      expect(stripped).toHaveLength(sampleTools.length);
      stripped.forEach((tool) => {
        expect(tool).not.toHaveProperty('category');
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      });
    });

    it('should preserve all other fields', () => {
      const stripped = stripCategories(sampleTools);
      expect(stripped[0]).toEqual({
        name: 'get_vcon',
        description: 'Get vCon',
        inputSchema: {},
      });
    });

    it('should handle empty array', () => {
      const stripped = stripCategories([]);
      expect(stripped).toHaveLength(0);
    });
  });

  describe('Integration: Profile-based filtering', () => {
    it('readonly profile should only return read and schema tools', () => {
      process.env.MCP_TOOLS_PROFILE = 'readonly';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(sampleTools, config);

      expect(filtered.map((t) => t.name)).toEqual(['get_vcon', 'search_vcons', 'get_schema']);
    });

    it('user profile should exclude analytics and infra tools', () => {
      process.env.MCP_TOOLS_PROFILE = 'user';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(sampleTools, config);

      expect(filtered.map((t) => t.name)).toEqual([
        'get_vcon',
        'search_vcons',
        'create_vcon',
        'delete_vcon',
        'get_schema',
      ]);
      expect(filtered.map((t) => t.name)).not.toContain('get_database_analytics');
      expect(filtered.map((t) => t.name)).not.toContain('get_database_shape');
    });

    it('admin profile should exclude write tools', () => {
      process.env.MCP_TOOLS_PROFILE = 'admin';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(sampleTools, config);

      expect(filtered.map((t) => t.name)).not.toContain('create_vcon');
      expect(filtered.map((t) => t.name)).not.toContain('delete_vcon');
    });

    it('minimal profile should only return read and write tools', () => {
      process.env.MCP_TOOLS_PROFILE = 'minimal';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(sampleTools, config);

      expect(filtered.map((t) => t.name)).toEqual([
        'get_vcon',
        'search_vcons',
        'create_vcon',
        'delete_vcon',
      ]);
    });

    it('user profile with disabled delete should exclude delete_vcon', () => {
      process.env.MCP_TOOLS_PROFILE = 'user';
      process.env.MCP_DISABLED_TOOLS = 'delete_vcon';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(sampleTools, config);

      expect(filtered.map((t) => t.name)).toEqual([
        'get_vcon',
        'search_vcons',
        'create_vcon',
        'get_schema',
      ]);
    });
  });
});

