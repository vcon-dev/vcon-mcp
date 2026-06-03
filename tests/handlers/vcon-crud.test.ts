/**
 * vCon CRUD Handler Tests
 * 
 * Tests for vCon CRUD tool handlers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  CreateVConHandler,
  CreateVConFromTemplateHandler,
  GetVConHandler,
  UpdateVConHandler,
  DeleteVConHandler,
  AddAnalysisHandler,
  AddDialogHandler,
  AddAttachmentHandler,
  UpdateDialogHandler,
  RemoveDialogHandler,
  UpdateAnalysisHandler,
  RemoveAnalysisHandler,
  UpdateAttachmentHandler,
  RemoveAttachmentHandler,
  AddPartyHandler,
  UpdatePartyHandler,
  RemovePartyHandler,
} from '../../src/tools/handlers/vcon-crud.js';
import { ChildIndexError } from '../../src/utils/vcon-children.js';
import { ToolHandlerContext } from '../../src/tools/handlers/base.js';
import { VCon, Analysis, Dialog, Attachment } from '../../src/types/vcon.js';
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
  let mockVConService: any;

  beforeEach(() => {
    mockQueries = {
      createVCon: vi.fn(),
      getVCon: vi.fn(),
      updateVCon: vi.fn(),
      deleteVCon: vi.fn(),
      addAnalysis: vi.fn(),
      addDialog: vi.fn(),
      addAttachment: vi.fn(),
      updateDialog: vi.fn(),
      removeDialog: vi.fn(),
      updateAnalysis: vi.fn(),
      removeAnalysis: vi.fn(),
      updateAttachment: vi.fn(),
      removeAttachment: vi.fn(),
      addParty: vi.fn().mockResolvedValue({ index: 2 }),
      updateParty: vi.fn(),
      removeParty: vi.fn(),
    };

    mockPluginManager = {
      executeHook: vi.fn(),
    };

    mockVConService = {
      create: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      createBatch: vi.fn(),
      search: vi.fn(),
    };

    mockContext = {
      queries: mockQueries as any,
      pluginManager: mockPluginManager as any,
      dbInspector: {} as DatabaseInspector,
      dbAnalytics: {} as DatabaseAnalytics,
      dbSizeAnalyzer: {} as DatabaseSizeAnalyzer,
      supabase: {},
      vconService: mockVConService as any,
    };
  });

  describe('CreateVConHandler', () => {
    it('should create a vCon successfully', async () => {
      const handler = new CreateVConHandler();
      const testUuid = randomUUID();
      const testVCon: VCon = {
        vcon: '0.3.0',
        uuid: testUuid,
        created_at: new Date().toISOString(),
        parties: [{ name: 'Test User' }],
      };

      // Mock vconService.create to return the result
      mockVConService.create.mockResolvedValue({
        uuid: testUuid,
        id: '1',
        vcon: testVCon,
      });

      const result = await handler.handle({
        parties: [{ name: 'Test User' }],
      }, mockContext);

      expect(mockVConService.create).toHaveBeenCalledWith(
        expect.objectContaining({ parties: [{ name: 'Test User' }] }),
        expect.objectContaining({ source: 'mcp-tool' })
      );

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.uuid).toBe(testUuid);
    });

    it('forwards inline dialog/analysis/attachments and maps must_support to critical', async () => {
      const handler = new CreateVConHandler();
      mockVConService.create.mockResolvedValue({ uuid: randomUUID(), id: '1', vcon: {} as VCon });

      await handler.handle({
        parties: [{ name: 'A' }],
        dialog: [{ type: 'text', body: 'hi' }],
        analysis: [{ type: 'summary', vendor: 'V' }],
        attachments: [{ purpose: 'doc', body: 'x', encoding: 'none' }],
        must_support: ['ext-a'],
      }, mockContext);

      expect(mockVConService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          dialog: [{ type: 'text', body: 'hi' }],
          analysis: [{ type: 'summary', vendor: 'V' }],
          attachments: [{ purpose: 'doc', body: 'x', encoding: 'none' }],
          critical: ['ext-a'],   // must_support mapped to critical
        }),
        expect.objectContaining({ source: 'mcp-tool' })
      );
    });

    it('should apply plugin modifications from beforeCreate hook', async () => {
      const handler = new CreateVConHandler();
      const testUuid = randomUUID();
      const modifiedVCon: VCon = {
        vcon: '0.3.0',
        uuid: testUuid,
        created_at: new Date().toISOString(),
        subject: 'Modified Subject',
        parties: [{ name: 'Test User' }],
      };

      // VConService handles hooks internally, so we just mock the result
      mockVConService.create.mockResolvedValue({
        uuid: testUuid,
        id: '1',
        vcon: modifiedVCon,
      });

      const result = await handler.handle({
        parties: [{ name: 'Test User' }],
      }, mockContext);

      const response = JSON.parse(result.content[0].text);
      expect(response.vcon.subject).toBe('Modified Subject');
    });

    it('should throw error if vCon validation fails', async () => {
      const handler = new CreateVConHandler();
      // VConService throws VConValidationError for validation failures
      const { VConValidationError } = await import('../../src/services/vcon-service.js');
      mockVConService.create.mockRejectedValue(new VConValidationError(['parties is required']));

      await expect(handler.handle({
        parties: [], // Invalid - no parties
      }, mockContext)).rejects.toThrow();
    });
  });

  describe('CreateVConFromTemplateHandler', () => {
    it('should create vCon from template', async () => {
      const handler = new CreateVConFromTemplateHandler();
      const uuid = randomUUID();
      const templateVCon: VCon = {
        vcon: '0.3.0',
        uuid,
        created_at: new Date().toISOString(),
        subject: 'Test Call',
        parties: [{ name: 'Caller' }, { name: 'Agent' }],
      };

      mockVConService.create.mockResolvedValue({
        uuid,
        id: '1',
        vcon: templateVCon,
      });

      const result = await handler.handle({
        template_name: 'phone_call',
        parties: [{ name: 'Caller' }, { name: 'Agent' }],
        subject: 'Test Call',
      }, mockContext);

      expect(mockVConService.create).toHaveBeenCalled();
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

      // VConService.get handles hooks internally
      mockVConService.get.mockResolvedValue(testVCon);

      const result = await handler.handle({
        uuid: testVCon.uuid,
      }, mockContext);

      expect(mockVConService.get).toHaveBeenCalledWith(testVCon.uuid, expect.any(Object));

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

      // VConService handles hooks internally, so mock returns the filtered result
      mockVConService.get.mockResolvedValue(filteredVCon);

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

      // VConService.delete returns true on success
      mockVConService.delete.mockResolvedValue(true);

      const result = await handler.handle({
        uuid,
      }, mockContext);

      expect(mockVConService.delete).toHaveBeenCalledWith(uuid, expect.any(Object));

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

  // ── Index-addressed child CRUD ─────────────────────────────────────────────

  describe('UpdateDialogHandler', () => {
    it('replaces the dialog at the index', async () => {
      const uuid = randomUUID();
      await new UpdateDialogHandler().handle(
        { vcon_uuid: uuid, index: 1, dialog: { type: 'text', body: 'hi' } },
        mockContext
      );
      expect(mockQueries.updateDialog).toHaveBeenCalledWith(uuid, 1, expect.objectContaining({ type: 'text' }));
    });

    it('accepts index 0', async () => {
      const uuid = randomUUID();
      await new UpdateDialogHandler().handle(
        { vcon_uuid: uuid, index: 0, dialog: { type: 'text' } },
        mockContext
      );
      expect(mockQueries.updateDialog).toHaveBeenCalledWith(uuid, 0, expect.anything());
    });

    it('rejects a negative index', async () => {
      await expect(new UpdateDialogHandler().handle(
        { vcon_uuid: randomUUID(), index: -1, dialog: { type: 'text' } },
        mockContext
      )).rejects.toThrow(McpError);
    });

    it('maps a ChildIndexError from the query layer to McpError', async () => {
      mockQueries.updateDialog.mockRejectedValueOnce(new ChildIndexError('dialog index 9 not found'));
      await expect(new UpdateDialogHandler().handle(
        { vcon_uuid: randomUUID(), index: 9, dialog: { type: 'text' } },
        mockContext
      )).rejects.toThrow(McpError);
    });
  });

  describe('RemoveDialogHandler', () => {
    it('removes the dialog at the index', async () => {
      const uuid = randomUUID();
      await new RemoveDialogHandler().handle({ vcon_uuid: uuid, index: 0 }, mockContext);
      expect(mockQueries.removeDialog).toHaveBeenCalledWith(uuid, 0);
    });
  });

  describe('UpdateAnalysisHandler', () => {
    it('replaces the analysis at the index', async () => {
      const uuid = randomUUID();
      await new UpdateAnalysisHandler().handle(
        { vcon_uuid: uuid, index: 2, analysis: { type: 'summary', vendor: 'V' } },
        mockContext
      );
      expect(mockQueries.updateAnalysis).toHaveBeenCalledWith(uuid, 2, expect.objectContaining({ vendor: 'V' }));
    });

    it('rejects missing vendor', async () => {
      await expect(new UpdateAnalysisHandler().handle(
        { vcon_uuid: randomUUID(), index: 0, analysis: { type: 'summary' } },
        mockContext
      )).rejects.toThrow(McpError);
    });
  });

  describe('RemoveAnalysisHandler / RemoveAttachmentHandler', () => {
    it('removes analysis by index', async () => {
      const uuid = randomUUID();
      await new RemoveAnalysisHandler().handle({ vcon_uuid: uuid, index: 1 }, mockContext);
      expect(mockQueries.removeAnalysis).toHaveBeenCalledWith(uuid, 1);
    });
    it('removes attachment by index', async () => {
      const uuid = randomUUID();
      await new RemoveAttachmentHandler().handle({ vcon_uuid: uuid, index: 0 }, mockContext);
      expect(mockQueries.removeAttachment).toHaveBeenCalledWith(uuid, 0);
    });
  });

  describe('UpdateAttachmentHandler', () => {
    it('replaces the attachment at the index', async () => {
      const uuid = randomUUID();
      await new UpdateAttachmentHandler().handle(
        { vcon_uuid: uuid, index: 0, attachment: { purpose: 'doc', body: 'x', encoding: 'none' } },
        mockContext
      );
      expect(mockQueries.updateAttachment).toHaveBeenCalledWith(uuid, 0, expect.objectContaining({ purpose: 'doc' }));
    });
  });

  describe('AddPartyHandler', () => {
    it('appends a party and returns the new index', async () => {
      const uuid = randomUUID();
      const result = await new AddPartyHandler().handle(
        { vcon_uuid: uuid, party: { name: 'Dave' } },
        mockContext
      );
      expect(mockQueries.addParty).toHaveBeenCalledWith(uuid, expect.objectContaining({ name: 'Dave' }));
      expect(JSON.parse(result.content[0].text).index).toBe(2);
    });

    it('rejects a party with no identifier', async () => {
      await expect(new AddPartyHandler().handle(
        { vcon_uuid: randomUUID(), party: {} },
        mockContext
      )).rejects.toThrow(McpError);
    });
  });

  describe('UpdatePartyHandler', () => {
    it('replaces the party at the index', async () => {
      const uuid = randomUUID();
      await new UpdatePartyHandler().handle(
        { vcon_uuid: uuid, index: 1, party: { name: 'Bob2' } },
        mockContext
      );
      expect(mockQueries.updateParty).toHaveBeenCalledWith(uuid, 1, expect.objectContaining({ name: 'Bob2' }));
    });
  });

  describe('RemovePartyHandler', () => {
    it('removes the party (empty placeholder) without validating it', async () => {
      const uuid = randomUUID();
      await new RemovePartyHandler().handle({ vcon_uuid: uuid, index: 0 }, mockContext);
      expect(mockQueries.removeParty).toHaveBeenCalledWith(uuid, 0, { anonymize: false });
    });

    it('forwards anonymize=true', async () => {
      const uuid = randomUUID();
      await new RemovePartyHandler().handle({ vcon_uuid: uuid, index: 0, anonymize: true }, mockContext);
      expect(mockQueries.removeParty).toHaveBeenCalledWith(uuid, 0, { anonymize: true });
    });
  });
});

