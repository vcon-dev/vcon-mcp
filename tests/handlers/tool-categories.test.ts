/**
 * Integration Tests for Tool Categories in Handlers
 *
 * Verifies that:
 * - Only enabled tools are listed
 * - Disabled tools cannot be called
 * - Error messages are helpful
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadToolsConfig,
  filterEnabledTools,
  type ToolDefinition,
} from '../../src/config/tools.js';

// Import actual tools to test with real data
import { allTools } from '../../src/tools/vcon-crud.js';
import { allTagTools } from '../../src/tools/tag-tools.js';
import { allDatabaseTools } from '../../src/tools/database-tools.js';
import { allDatabaseAnalyticsTools } from '../../src/tools/database-analytics.js';
import { allDatabaseSizeTools } from '../../src/tools/database-size-tools.js';
import { getSchemaTool, getExamplesTool } from '../../src/tools/schema-tools.js';
import { createFromTemplateTool } from '../../src/tools/templates.js';

describe('Tool Categories Integration', () => {
  // Store original env vars
  const originalEnv: Record<string, string | undefined> = {};

  // Combine all tools like the handler does
  const allToolsWithCategories: ToolDefinition[] = [
    ...allTools,
    createFromTemplateTool,
    getSchemaTool,
    getExamplesTool,
    ...allDatabaseTools,
    ...allDatabaseAnalyticsTools,
    ...allDatabaseSizeTools,
    ...allTagTools,
  ] as ToolDefinition[];

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
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    });
  });

  describe('All tools have categories', () => {
    it('should have category defined for all core tools', () => {
      allTools.forEach((tool: any) => {
        expect(tool.category, `Tool ${tool.name} should have category`).toBeDefined();
        expect(['read', 'write', 'schema', 'analytics', 'infra']).toContain(tool.category);
      });
    });

    it('should have category defined for all tag tools', () => {
      allTagTools.forEach((tool: any) => {
        expect(tool.category, `Tool ${tool.name} should have category`).toBeDefined();
        expect(['read', 'write']).toContain(tool.category);
      });
    });

    it('should have category defined for all database tools', () => {
      allDatabaseTools.forEach((tool: any) => {
        expect(tool.category, `Tool ${tool.name} should have category`).toBeDefined();
        expect(tool.category).toBe('infra');
      });
    });

    it('should have category defined for all analytics tools', () => {
      allDatabaseAnalyticsTools.forEach((tool: any) => {
        expect(tool.category, `Tool ${tool.name} should have category`).toBeDefined();
        expect(tool.category).toBe('analytics');
      });
    });

    it('should have category defined for schema tools', () => {
      expect((getSchemaTool as any).category).toBe('schema');
      expect((getExamplesTool as any).category).toBe('schema');
    });

    it('should have category defined for template tool', () => {
      expect((createFromTemplateTool as any).category).toBe('write');
    });
  });

  describe('Tool count by category', () => {
    it('should have expected number of read tools', () => {
      const readTools = allToolsWithCategories.filter((t) => t.category === 'read');
      // get_vcon, search_vcons, search_vcons_content, search_vcons_semantic, search_vcons_hybrid
      // get_tags, search_by_tags, get_unique_tags
      expect(readTools.length).toBe(8);
    });

    it('should have expected number of write tools', () => {
      const writeTools = allToolsWithCategories.filter((t) => t.category === 'write');
      // create_vcon, update_vcon, delete_vcon, add_analysis, add_dialog, add_attachment
      // create_vcon_from_template, manage_tag, remove_all_tags
      expect(writeTools.length).toBe(9);
    });

    it('should have expected number of schema tools', () => {
      const schemaTools = allToolsWithCategories.filter((t) => t.category === 'schema');
      // get_schema, get_examples
      expect(schemaTools.length).toBe(2);
    });

    it('should have expected number of analytics tools', () => {
      const analyticsTools = allToolsWithCategories.filter((t) => t.category === 'analytics');
      // 6 analytics tools
      expect(analyticsTools.length).toBe(6);
    });

    it('should have expected number of infra tools', () => {
      const infraTools = allToolsWithCategories.filter((t) => t.category === 'infra');
      // get_database_shape, get_database_stats, analyze_query
      // get_database_size_info, get_smart_search_limits
      expect(infraTools.length).toBe(5);
    });

    it('should have 30 total tools', () => {
      expect(allToolsWithCategories.length).toBe(30);
    });
  });

  describe('Filtering with profiles', () => {
    it('full profile should return all 30 tools', () => {
      process.env.MCP_TOOLS_PROFILE = 'full';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(allToolsWithCategories, config);
      expect(filtered.length).toBe(30);
    });

    it('readonly profile should return only read and schema tools (10 total)', () => {
      process.env.MCP_TOOLS_PROFILE = 'readonly';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(allToolsWithCategories, config);
      expect(filtered.length).toBe(10); // 8 read + 2 schema

      // Verify specific tools
      const toolNames = filtered.map((t) => t.name);
      expect(toolNames).toContain('get_vcon');
      expect(toolNames).toContain('search_vcons');
      expect(toolNames).toContain('get_schema');
      expect(toolNames).not.toContain('create_vcon');
      expect(toolNames).not.toContain('delete_vcon');
    });

    it('user profile should return read, write, and schema tools (19 total)', () => {
      process.env.MCP_TOOLS_PROFILE = 'user';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(allToolsWithCategories, config);
      expect(filtered.length).toBe(19); // 8 read + 9 write + 2 schema

      // Verify specific tools
      const toolNames = filtered.map((t) => t.name);
      expect(toolNames).toContain('get_vcon');
      expect(toolNames).toContain('create_vcon');
      expect(toolNames).toContain('delete_vcon');
      expect(toolNames).not.toContain('get_database_analytics');
      expect(toolNames).not.toContain('get_database_shape');
    });

    it('admin profile should return read, analytics, infra, and schema tools (21 total)', () => {
      process.env.MCP_TOOLS_PROFILE = 'admin';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(allToolsWithCategories, config);
      expect(filtered.length).toBe(21); // 8 read + 6 analytics + 5 infra + 2 schema

      // Verify specific tools
      const toolNames = filtered.map((t) => t.name);
      expect(toolNames).toContain('get_vcon');
      expect(toolNames).toContain('get_database_analytics');
      expect(toolNames).toContain('get_database_shape');
      expect(toolNames).not.toContain('create_vcon');
      expect(toolNames).not.toContain('delete_vcon');
    });

    it('minimal profile should return only read and write tools (17 total)', () => {
      process.env.MCP_TOOLS_PROFILE = 'minimal';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(allToolsWithCategories, config);
      expect(filtered.length).toBe(17); // 8 read + 9 write

      // Verify specific tools
      const toolNames = filtered.map((t) => t.name);
      expect(toolNames).toContain('get_vcon');
      expect(toolNames).toContain('create_vcon');
      expect(toolNames).not.toContain('get_schema');
      expect(toolNames).not.toContain('get_database_analytics');
    });
  });

  describe('Individual tool disabling', () => {
    it('should disable delete_vcon with MCP_DISABLED_TOOLS', () => {
      process.env.MCP_DISABLED_TOOLS = 'delete_vcon';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(allToolsWithCategories, config);

      const toolNames = filtered.map((t) => t.name);
      expect(toolNames).not.toContain('delete_vcon');
      expect(filtered.length).toBe(29);
    });

    it('should disable multiple tools', () => {
      process.env.MCP_DISABLED_TOOLS = 'delete_vcon,analyze_query,remove_all_tags';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(allToolsWithCategories, config);

      const toolNames = filtered.map((t) => t.name);
      expect(toolNames).not.toContain('delete_vcon');
      expect(toolNames).not.toContain('analyze_query');
      expect(toolNames).not.toContain('remove_all_tags');
      expect(filtered.length).toBe(27);
    });

    it('should combine profile with disabled tools', () => {
      process.env.MCP_TOOLS_PROFILE = 'user';
      process.env.MCP_DISABLED_TOOLS = 'delete_vcon';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(allToolsWithCategories, config);

      const toolNames = filtered.map((t) => t.name);
      expect(toolNames).not.toContain('delete_vcon');
      expect(toolNames).not.toContain('get_database_analytics'); // Excluded by profile
      expect(filtered.length).toBe(18); // 19 - 1 disabled
    });
  });

  describe('Category-based filtering', () => {
    it('should enable only specified categories', () => {
      process.env.MCP_ENABLED_CATEGORIES = 'read,schema';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(allToolsWithCategories, config);

      expect(filtered.length).toBe(10);
      filtered.forEach((tool) => {
        expect(['read', 'schema']).toContain(tool.category);
      });
    });

    it('should disable specified categories', () => {
      process.env.MCP_DISABLED_CATEGORIES = 'analytics,infra';
      const config = loadToolsConfig();
      const filtered = filterEnabledTools(allToolsWithCategories, config);

      expect(filtered.length).toBe(19); // 30 - 6 analytics - 5 infra
      filtered.forEach((tool) => {
        expect(['analytics', 'infra']).not.toContain(tool.category);
      });
    });
  });

  describe('Tool lookup for disabled check', () => {
    it('should find tool definition by name', () => {
      const toolName = 'delete_vcon';
      const toolDef = allToolsWithCategories.find((t) => t.name === toolName);

      expect(toolDef).toBeDefined();
      expect(toolDef?.category).toBe('write');
    });

    it('should correctly identify if tool is disabled', () => {
      process.env.MCP_TOOLS_PROFILE = 'readonly';
      const config = loadToolsConfig();

      // Check if delete_vcon would be filtered out
      const toolDef = allToolsWithCategories.find((t) => t.name === 'delete_vcon');
      expect(toolDef).toBeDefined();

      const enabledTools = filterEnabledTools([toolDef!], config);
      expect(enabledTools.length).toBe(0); // Should be filtered out
    });

    it('should correctly identify if tool is enabled', () => {
      process.env.MCP_TOOLS_PROFILE = 'readonly';
      const config = loadToolsConfig();

      // Check if get_vcon would be included
      const toolDef = allToolsWithCategories.find((t) => t.name === 'get_vcon');
      expect(toolDef).toBeDefined();

      const enabledTools = filterEnabledTools([toolDef!], config);
      expect(enabledTools.length).toBe(1); // Should be included
    });
  });
});

