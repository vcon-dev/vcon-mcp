/**
 * vCon CRUD Handler Tests
 * 
 * Tests for vCon CRUD tool handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  CreateVConHandler,
  CreateVConFromTemplateHandler,
  GetVConHandler,
  UpdateVConHandler,
  DeleteVConHandler,
  AddAnalysisHandler,
  AddDialogHandler,
  AddAttachmentHandler,
} from '../../src/tools/handlers/vcon-crud.js';
import { ToolHandlerContext } from '../../src/tools/handlers/base.js';
import { VCon, Analysis, Dialog, Attachment } from '../../src/types/vcon.js';
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

vi.mock('../../src/observability/attributes.js', () => ({
  ATTR_VCON_UUID: 'vcon.uuid',
  ATTR_TOOL_NAME: 'tool.name',
  ATTR_TOOL_SUCCESS: 'tool.success',
  ATTR_SEARCH_TYPE: 'search.type',
  ATTR_SEARCH_RESULTS_COUNT: 'search.results.count',
}));

// Mock templates
vi.mock('../../src/tools/templates.js', () => ({
  buildTemplateVCon: vi.fn((template, subject, parties) => ({
    vcon: '0.3.0',
    uuid: randomUUID(),
    created_at: new Date().toISOString(),
    subject: subject || `Template: ${template}`,
    parties: parties,
  })),
}));

describe('vCon CRUD Handlers', () => {
  let mockContext: ToolHandlerContext;
  let mockQueries: any;
  let mockPluginManager: any;

  beforeEach(() => {
    mockQueries = {
      createVCon: vi.fn(),
      getVCon: vi.fn(),
      updateVCon: vi.fn(),
      deleteVCon: vi.fn(),
      addAnalysis: vi.fn(),
      addDialog: vi.fn(),
      addAttachment: vi.fn(),
    };

    mockPluginManager = {
      executeHook: vi.fn(),
    };

    mockContext = {
      queries: mockQueries as any,
      pluginManager: mockPluginManager as any,
      dbInspector: {} as DatabaseInspector,
      dbAnalytics: {} as DatabaseAnalytics,
      dbSizeAnalyzer: {} as DatabaseSizeAnalyzer,
      supabase: {},
    };
  });

  describe('CreateVConHandler', () => {
    it('should create a vCon successfully', async () => {
      const handler = new CreateVConHandler();
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test User' }],
      };

      mockQueries.createVCon.mockResolvedValue({ uuid: testVCon.uuid });
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await handler.handle({
        parties: [{ name: 'Test User' }],
      }, mockContext);

      expect(mockQueries.createVCon).toHaveBeenCalled();
      expect(mockPluginManager.executeHook).toHaveBeenCalledWith('beforeCreate', expect.any(Object), expect.any(Object));
      expect(mockPluginManager.executeHook).toHaveBeenCalledWith('afterCreate', expect.any(Object), expect.any(Object));

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.uuid).toBe(testVCon.uuid);
    });

    it('should apply plugin modifications from beforeCreate hook', async () => {
      const handler = new CreateVConHandler();
      const modifiedVCon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        subject: 'Modified Subject',
        parties: [{ name: 'Test User' }],
      };

      mockQueries.createVCon.mockResolvedValue({ uuid: modifiedVCon.uuid });
      mockPluginManager.executeHook.mockImplementation((hook: string) => {
        if (hook === 'beforeCreate') return Promise.resolve(modifiedVCon);
        return Promise.resolve(undefined);
      });

      const result = await handler.handle({
        parties: [{ name: 'Test User' }],
      }, mockContext);

      expect(mockQueries.createVCon).toHaveBeenCalledWith(modifiedVCon);
      const response = JSON.parse(result.content[0].text);
      expect(response.vcon.subject).toBe('Modified Subject');
    });

    it('should throw error if vCon validation fails', async () => {
      const handler = new CreateVConHandler();
      mockPluginManager.executeHook.mockResolvedValue(undefined);
      mockQueries.createVCon.mockRejectedValue(new Error('Validation failed'));

      await expect(handler.handle({
        parties: [], // Invalid - no parties
      }, mockContext)).rejects.toThrow();
    });
  });

  describe('CreateVConFromTemplateHandler', () => {
    it('should create vCon from template', async () => {
      const handler = new CreateVConFromTemplateHandler();
      const uuid = randomUUID();
      mockQueries.createVCon.mockResolvedValue({ uuid });
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await handler.handle({
        template_name: 'phone_call',
        parties: [{ name: 'Caller' }, { name: 'Agent' }],
        subject: 'Test Call',
      }, mockContext);

      expect(mockQueries.createVCon).toHaveBeenCalled();
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.uuid).toBe(uuid);
    });

    it('should throw error if template_name is missing', async () => {
      const handler = new CreateVConFromTemplateHandler();
      await expect(handler.handle({
        parties: [{ name: 'Test' }],
      }, mockContext)).rejects.toThrow(McpError);
    });

    it('should throw error if parties are missing', async () => {
      const handler = new CreateVConFromTemplateHandler();
      await expect(handler.handle({
        template_name: 'phone_call',
      }, mockContext)).rejects.toThrow(McpError);
    });
  });

  describe('GetVConHandler', () => {
    it('should retrieve a vCon by UUID', async () => {
      const handler = new GetVConHandler();
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test User' }],
      };

      mockQueries.getVCon.mockResolvedValue(testVCon);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await handler.handle({
        uuid: testVCon.uuid,
      }, mockContext);

      expect(mockQueries.getVCon).toHaveBeenCalledWith(testVCon.uuid);
      expect(mockPluginManager.executeHook).toHaveBeenCalledWith('beforeRead', testVCon.uuid, expect.any(Object));
      expect(mockPluginManager.executeHook).toHaveBeenCalledWith('afterRead', testVCon, expect.any(Object));

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.vcon.uuid).toBe(testVCon.uuid);
    });

    it('should apply plugin modifications from afterRead hook', async () => {
      const handler = new GetVConHandler();
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid: randomUUID(),
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test User' }],
      };
      const filteredVCon = { ...testVCon, subject: 'Filtered' };

      mockQueries.getVCon.mockResolvedValue(testVCon);
      mockPluginManager.executeHook.mockImplementation((hook: string) => {
        if (hook === 'afterRead') return Promise.resolve(filteredVCon);
        return Promise.resolve(undefined);
      });

      const result = await handler.handle({
        uuid: testVCon.uuid,
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.vcon.subject).toBe('Filtered');
    });

    it('should throw error if UUID is invalid', async () => {
      const handler = new GetVConHandler();
      await expect(handler.handle({
        uuid: 'invalid-uuid',
      }, mockContext)).rejects.toThrow(McpError);
    });
  });

  describe('UpdateVConHandler', () => {
    it('should update vCon successfully', async () => {
      const handler = new UpdateVConHandler();
      const uuid = randomUUID();
      const updatedVCon: VCon = {
        vcon: '0.3.0',
        uuid,
        created_at: new Date().toISOString(),
        subject: 'Updated Subject',
        parties: [{ name: 'Test User' }],
      };

      mockQueries.updateVCon.mockResolvedValue(undefined);
      mockQueries.getVCon.mockResolvedValue(updatedVCon);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await handler.handle({
        uuid,
        updates: { subject: 'Updated Subject' },
        return_updated: true,
      }, mockContext);

      expect(mockQueries.updateVCon).toHaveBeenCalledWith(uuid, { subject: 'Updated Subject' });
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.vcon.subject).toBe('Updated Subject');
    });

    it('should not return updated vCon if return_updated is false', async () => {
      const handler = new UpdateVConHandler();
      const uuid = randomUUID();

      mockQueries.updateVCon.mockResolvedValue(undefined);
      mockQueries.getVCon.mockResolvedValue({} as VCon);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await handler.handle({
        uuid,
        updates: { subject: 'Updated' },
        return_updated: false,
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.message).toContain('Updated vCon');
      expect(response.vcon).toBeUndefined();
    });

    it('should throw error if updates is not an object', async () => {
      const handler = new UpdateVConHandler();
      await expect(handler.handle({
        uuid: randomUUID(),
        updates: 'not-an-object',
      }, mockContext)).rejects.toThrow(McpError);
    });
  });

  describe('DeleteVConHandler', () => {
    it('should delete a vCon successfully', async () => {
      const handler = new DeleteVConHandler();
      const uuid = randomUUID();

      mockQueries.deleteVCon.mockResolvedValue(undefined);
      mockPluginManager.executeHook.mockResolvedValue(undefined);

      const result = await handler.handle({
        uuid,
      }, mockContext);

      expect(mockQueries.deleteVCon).toHaveBeenCalledWith(uuid);
      expect(mockPluginManager.executeHook).toHaveBeenCalledWith('beforeDelete', uuid, expect.any(Object));
      expect(mockPluginManager.executeHook).toHaveBeenCalledWith('afterDelete', uuid, expect.any(Object));

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.message).toContain('Deleted vCon');
    });

    it('should throw error if UUID is invalid', async () => {
      const handler = new DeleteVConHandler();
      await expect(handler.handle({
        uuid: 'invalid-uuid',
      }, mockContext)).rejects.toThrow(McpError);
    });
  });

  describe('AddAnalysisHandler', () => {
    it('should add analysis to vCon', async () => {
      const handler = new AddAnalysisHandler();
      const uuid = randomUUID();
      const analysis: Analysis = {
        type: 'transcript',
        vendor: 'TestVendor',
        body: 'test content',
        encoding: 'none',
      };

      mockQueries.addAnalysis.mockResolvedValue(undefined);

      const result = await handler.handle({
        vcon_uuid: uuid,
        analysis,
      }, mockContext);

      expect(mockQueries.addAnalysis).toHaveBeenCalledWith(uuid, expect.objectContaining({
        vendor: 'TestVendor',
        type: 'transcript',
      }));

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.message).toContain('Added');
    });

    it('should throw error if vendor is missing', async () => {
      const handler = new AddAnalysisHandler();
      await expect(handler.handle({
        vcon_uuid: randomUUID(),
        analysis: { type: 'transcript' },
      }, mockContext)).rejects.toThrow(McpError);
    });

    it('should throw error if analysis is missing', async () => {
      const handler = new AddAnalysisHandler();
      await expect(handler.handle({
        vcon_uuid: randomUUID(),
      }, mockContext)).rejects.toThrow(McpError);
    });
  });

  describe('AddDialogHandler', () => {
    it('should add dialog to vCon', async () => {
      const handler = new AddDialogHandler();
      const uuid = randomUUID();
      const dialog: Dialog = {
        type: 'text',
        body: 'Hello',
        encoding: 'none',
      };

      mockQueries.addDialog.mockResolvedValue(undefined);

      const result = await handler.handle({
        vcon_uuid: uuid,
        dialog,
      }, mockContext);

      expect(mockQueries.addDialog).toHaveBeenCalledWith(uuid, expect.objectContaining({
        type: 'text',
      }));

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
    });

    it('should throw error if dialog is missing', async () => {
      const handler = new AddDialogHandler();
      await expect(handler.handle({
        vcon_uuid: randomUUID(),
      }, mockContext)).rejects.toThrow(McpError);
    });
  });

  describe('AddAttachmentHandler', () => {
    it('should add attachment to vCon', async () => {
      const handler = new AddAttachmentHandler();
      const uuid = randomUUID();
      const attachment: Attachment = {
        body: 'attachment content',
        encoding: 'none',
      };

      mockQueries.addAttachment.mockResolvedValue(undefined);

      const result = await handler.handle({
        vcon_uuid: uuid,
        attachment,
      }, mockContext);

      expect(mockQueries.addAttachment).toHaveBeenCalledWith(uuid, expect.objectContaining({
        body: 'attachment content',
      }));

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
    });

    it('should throw error if attachment is missing', async () => {
      const handler = new AddAttachmentHandler();
      await expect(handler.handle({
        vcon_uuid: randomUUID(),
      }, mockContext)).rejects.toThrow(McpError);
    });
  });
});

