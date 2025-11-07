/**
 * Tests for tool definition schemas
 * 
 * Validates that tool definitions have correct structure and schemas
 */

import { describe, it, expect } from 'vitest';
import { allDatabaseTools } from '../../src/tools/database-tools.js';
import { allDatabaseAnalyticsTools } from '../../src/tools/database-analytics.js';
import { allDatabaseSizeTools } from '../../src/tools/database-size-tools.js';
import { allTagTools } from '../../src/tools/tag-tools.js';
import { getSchemaTool, getExamplesTool } from '../../src/tools/schema-tools.js';
import { createFromTemplateTool } from '../../src/tools/templates.js';

describe('Tool Definitions', () => {
  describe('Database Tools', () => {
    it('should export allDatabaseTools array', () => {
      expect(Array.isArray(allDatabaseTools)).toBe(true);
      expect(allDatabaseTools.length).toBeGreaterThan(0);
    });

    it('should have valid tool structure', () => {
      allDatabaseTools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(tool.inputSchema).toHaveProperty('type');
      });
    });

    it('should have unique tool names', () => {
      const names = allDatabaseTools.map(t => t.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });
  });

  describe('Database Analytics Tools', () => {
    it('should export allDatabaseAnalyticsTools array', () => {
      expect(Array.isArray(allDatabaseAnalyticsTools)).toBe(true);
      expect(allDatabaseAnalyticsTools.length).toBeGreaterThan(0);
    });

    it('should have valid tool structure', () => {
      allDatabaseAnalyticsTools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      });
    });

    it('should have unique tool names', () => {
      const names = allDatabaseAnalyticsTools.map(t => t.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });
  });

  describe('Database Size Tools', () => {
    it('should export allDatabaseSizeTools array', () => {
      expect(Array.isArray(allDatabaseSizeTools)).toBe(true);
      expect(allDatabaseSizeTools.length).toBeGreaterThan(0);
    });

    it('should have valid tool structure', () => {
      allDatabaseSizeTools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      });
    });
  });

  describe('Tag Tools', () => {
    it('should export allTagTools array', () => {
      expect(Array.isArray(allTagTools)).toBe(true);
      expect(allTagTools.length).toBeGreaterThan(0);
    });

    it('should have valid tool structure', () => {
      allTagTools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      });
    });

    it('should have unique tool names', () => {
      const names = allTagTools.map(t => t.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });
  });

  describe('Schema Tools', () => {
    it('should export getSchemaTool', () => {
      expect(getSchemaTool).toBeDefined();
      expect(getSchemaTool).toHaveProperty('name');
      expect(getSchemaTool).toHaveProperty('description');
      expect(getSchemaTool).toHaveProperty('inputSchema');
    });

    it('should export getExamplesTool', () => {
      expect(getExamplesTool).toBeDefined();
      expect(getExamplesTool).toHaveProperty('name');
      expect(getExamplesTool).toHaveProperty('description');
      expect(getExamplesTool).toHaveProperty('inputSchema');
    });
  });

  describe('Template Tools', () => {
    it('should export createFromTemplateTool', () => {
      expect(createFromTemplateTool).toBeDefined();
      expect(createFromTemplateTool).toHaveProperty('name');
      expect(createFromTemplateTool).toHaveProperty('description');
      expect(createFromTemplateTool).toHaveProperty('inputSchema');
    });
  });

  describe('Tool Schema Validation', () => {
    it('should have required fields in inputSchema', () => {
      const allTools = [
        ...allDatabaseTools,
        ...allDatabaseAnalyticsTools,
        ...allDatabaseSizeTools,
        ...allTagTools,
        getSchemaTool,
        getExamplesTool,
        createFromTemplateTool,
      ];

      allTools.forEach(tool => {
        expect(tool.inputSchema).toHaveProperty('type');
        if (tool.inputSchema.type === 'object') {
          expect(tool.inputSchema).toHaveProperty('properties');
        }
      });
    });

    it('should have valid property types in schemas', () => {
      const allTools = [
        ...allDatabaseTools,
        ...allDatabaseAnalyticsTools,
        ...allDatabaseSizeTools,
        ...allTagTools,
      ];

      allTools.forEach(tool => {
        if (tool.inputSchema.type === 'object' && tool.inputSchema.properties) {
          Object.values(tool.inputSchema.properties).forEach((prop: any) => {
            // Properties can have 'type' or 'oneOf' (for union types)
            if (prop.type) {
              expect(['string', 'number', 'boolean', 'object', 'array']).toContain(prop.type);
            } else if (prop.oneOf) {
              // oneOf is valid for union types
              expect(Array.isArray(prop.oneOf)).toBe(true);
            } else {
              // Should have either type or oneOf
              expect(prop.type || prop.oneOf).toBeDefined();
            }
          });
        }
      });
    });
  });
});

