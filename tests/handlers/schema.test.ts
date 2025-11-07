/**
 * Schema Handler Tests
 * 
 * Tests for schema and example tool handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  GetSchemaHandler,
  GetExamplesHandler,
} from '../../src/tools/handlers/schema.js';
import { ToolHandlerContext } from '../../src/tools/handlers/base.js';
import { VConQueries } from '../../src/db/queries.js';
import { PluginManager } from '../../src/hooks/plugin-manager.js';
import { DatabaseInspector } from '../../src/db/database-inspector.js';
import { DatabaseAnalytics } from '../../src/db/database-analytics.js';
import { DatabaseSizeAnalyzer } from '../../src/db/database-size-analyzer.js';

// Mock observability
vi.mock('../../src/observability/instrumentation.js', () => ({
  withSpan: vi.fn((name, fn) => fn({ setAttributes: vi.fn(), setStatus: vi.fn() })),
  recordCounter: vi.fn(),
  recordHistogram: vi.fn(),
  logWithContext: vi.fn(),
  attachErrorToSpan: vi.fn(),
}));

describe('Schema Handlers', () => {
  let mockContext: ToolHandlerContext;

  beforeEach(() => {
    mockContext = {
      queries: {} as VConQueries,
      pluginManager: {} as PluginManager,
      dbInspector: {} as DatabaseInspector,
      dbAnalytics: {} as DatabaseAnalytics,
      dbSizeAnalyzer: {} as DatabaseSizeAnalyzer,
      supabase: {},
    };
  });

  describe('GetSchemaHandler', () => {
    it('should return JSON schema format by default', async () => {
      const handler = new GetSchemaHandler();
      const result = await handler.handle({}, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.note).toContain('JSON Schema export');
    });

    it('should return JSON schema format when explicitly requested', async () => {
      const handler = new GetSchemaHandler();
      const result = await handler.handle({
        format: 'json_schema',
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
    });

    it('should return TypeScript format when requested', async () => {
      const handler = new GetSchemaHandler();
      const result = await handler.handle({
        format: 'typescript',
      }, mockContext);

      expect(result.content[0].text).toContain('src/types/vcon.ts');
    });

    it('should throw error for unsupported format', async () => {
      const handler = new GetSchemaHandler();
      await expect(handler.handle({
        format: 'invalid',
      }, mockContext)).rejects.toThrow(McpError);
      await expect(handler.handle({
        format: 'invalid',
      }, mockContext)).rejects.toThrow('Unsupported schema format');
    });
  });

  describe('GetExamplesHandler', () => {
    it('should return minimal example by default format', async () => {
      const handler = new GetExamplesHandler();
      const result = await handler.handle({
        example_type: 'minimal',
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.vcon).toBe('0.3.0');
      expect(response.parties).toBeDefined();
    });

    it('should return phone_call example', async () => {
      const handler = new GetExamplesHandler();
      const result = await handler.handle({
        example_type: 'phone_call',
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.subject).toBe('Phone Call');
      expect(response.dialog).toBeDefined();
    });

    it('should return chat example', async () => {
      const handler = new GetExamplesHandler();
      const result = await handler.handle({
        example_type: 'chat',
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.subject).toBe('Chat');
    });

    it('should return email example', async () => {
      const handler = new GetExamplesHandler();
      const result = await handler.handle({
        example_type: 'email',
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.subject).toBe('Email Thread');
      expect(response.attachments).toBeDefined();
    });

    it('should return video example', async () => {
      const handler = new GetExamplesHandler();
      const result = await handler.handle({
        example_type: 'video',
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.subject).toBe('Video Meeting');
    });

    it('should return full_featured example', async () => {
      const handler = new GetExamplesHandler();
      const result = await handler.handle({
        example_type: 'full_featured',
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.analysis).toBeDefined();
      expect(response.attachments).toBeDefined();
    });

    it('should return YAML format when requested', async () => {
      const handler = new GetExamplesHandler();
      const result = await handler.handle({
        example_type: 'minimal',
        format: 'yaml',
      }, mockContext);

      expect(result.content[0].text).toContain('vcon:');
      expect(result.content[0].text).toContain('uuid:');
      expect(result.content[0].text).toContain('created_at:');
    });

    it('should throw error for unknown example type', async () => {
      const handler = new GetExamplesHandler();
      await expect(handler.handle({
        example_type: 'nonexistent',
      }, mockContext)).rejects.toThrow(McpError);
      await expect(handler.handle({
        example_type: 'nonexistent',
      }, mockContext)).rejects.toThrow('Unknown example_type');
    });

    it('should throw error for unsupported format', async () => {
      const handler = new GetExamplesHandler();
      await expect(handler.handle({
        example_type: 'minimal',
        format: 'xml',
      }, mockContext)).rejects.toThrow(McpError);
      await expect(handler.handle({
        example_type: 'minimal',
        format: 'xml',
      }, mockContext)).rejects.toThrow('Unsupported format');
    });

    it('should throw error if example_type is missing', async () => {
      const handler = new GetExamplesHandler();
      await expect(handler.handle({}, mockContext)).rejects.toThrow();
    });
  });
});

