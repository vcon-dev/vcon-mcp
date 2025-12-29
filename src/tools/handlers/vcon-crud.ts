/**
 * vCon CRUD Tool Handlers
 * 
 * Uses VConService for unified lifecycle handling with hooks, validation, and metrics.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BaseToolHandler, ToolHandlerContext, ToolResponse } from './base.js';
import { VCon, Analysis, Dialog, Attachment } from '../../types/vcon.js';
import { AnalysisSchema, DialogSchema, AttachmentSchema } from '../vcon-crud.js';
import { buildTemplateVCon } from '../templates.js';
import { VConValidationError } from '../../services/vcon-service.js';
import {
  requireUUID,
  requireValidAnalysis,
  requireValidDialog,
  requireValidAttachment,
  requireParam,
} from './validation.js';

/**
 * Handler for create_vcon tool
 */
export class CreateVConHandler extends BaseToolHandler {
  readonly toolName = 'create_vcon';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const requestContext = this.createRequestContext(args);
    
    try {
      const result = await context.vconService.create(
        {
          subject: args?.subject as string | undefined,
          parties: (args?.parties as any[]) || [],
          extensions: args?.extensions as string[] | undefined,
          must_support: args?.must_support as string[] | undefined,
        },
        {
          requestContext,
          source: 'mcp-tool',
        }
      );

      return this.createSuccessResponse({
        uuid: result.uuid,
        message: `Created vCon with UUID: ${result.uuid}`,
        vcon: result.vcon,
      });
    } catch (error) {
      if (error instanceof VConValidationError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      }
      throw error;
    }
  }
}

/**
 * Handler for create_vcon_from_template tool
 */
export class CreateVConFromTemplateHandler extends BaseToolHandler {
  readonly toolName = 'create_vcon_from_template';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const template = args?.template_name as string;
    const parties = (args?.parties as any[]) || [];
    const subject = args?.subject as string | undefined;
    
    if (!template || !Array.isArray(parties) || parties.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'template_name and parties are required');
    }

    // Build vCon from template
    const templateVCon = buildTemplateVCon(template, subject, parties);
    const requestContext = this.createRequestContext(args);

    try {
      const result = await context.vconService.create(templateVCon, {
        requestContext,
        source: 'mcp-tool-template',
      });

      return this.createSuccessResponse({
        uuid: result.uuid,
        vcon: result.vcon,
      });
    } catch (error) {
      if (error instanceof VConValidationError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      }
      throw error;
    }
  }
}

/**
 * Handler for get_vcon tool
 */
export class GetVConHandler extends BaseToolHandler {
  readonly toolName = 'get_vcon';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const uuid = requireUUID(args?.uuid as string, 'uuid');
    const requestContext = this.createRequestContext(args);

    const vcon = await context.vconService.get(uuid, { requestContext });
    
    return this.createSuccessResponse({
      vcon,
    });
  }
}

/**
 * Handler for update_vcon tool
 */
export class UpdateVConHandler extends BaseToolHandler {
  readonly toolName = 'update_vcon';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const uuid = requireUUID(args?.uuid as string, 'uuid');
    const updates = requireParam(args?.updates as Partial<VCon> | undefined, 'updates') as Partial<VCon>;
    const returnUpdated = (args?.return_updated as boolean | undefined) ?? true;
    
    if (typeof updates !== 'object' || Array.isArray(updates)) {
      throw new McpError(ErrorCode.InvalidParams, 'updates must be an object');
    }

    // Whitelist fields
    const allowed: Partial<VCon> = {} as Partial<VCon>;
    if (Object.prototype.hasOwnProperty.call(updates, 'subject')) {
      allowed.subject = updates.subject;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'extensions')) {
      allowed.extensions = updates.extensions;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'must_support')) {
      allowed.must_support = updates.must_support as string[] | undefined;
    }

    const requestContext = this.createRequestContext(args);

    // Hook: beforeUpdate
    await context.pluginManager.executeHook('beforeUpdate', uuid, allowed, requestContext);

    await context.queries.updateVCon(uuid, allowed);

    if (returnUpdated) {
      let updated = await context.queries.getVCon(uuid);
      const modified = await context.pluginManager.executeHook<VCon>('afterUpdate', updated, requestContext);
      if (modified) updated = modified;
      return this.createSuccessResponse({ vcon: updated });
    } else {
      await context.pluginManager.executeHook('afterUpdate', await context.queries.getVCon(uuid), requestContext);
      return this.createSuccessResponse({ message: `Updated vCon ${uuid}` });
    }
  }
}

/**
 * Handler for delete_vcon tool
 */
export class DeleteVConHandler extends BaseToolHandler {
  readonly toolName = 'delete_vcon';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const uuid = requireUUID(args?.uuid as string, 'uuid');
    const requestContext = this.createRequestContext(args);

    const deleted = await context.vconService.delete(uuid, {
      requestContext,
      source: 'mcp-tool',
    });

    if (!deleted) {
      throw new McpError(ErrorCode.InvalidRequest, `vCon with UUID ${uuid} not found`);
    }

    return this.createSuccessResponse({
      message: `Deleted vCon ${uuid}`,
    });
  }
}

/**
 * Handler for add_analysis tool
 */
export class AddAnalysisHandler extends BaseToolHandler {
  readonly toolName = 'add_analysis';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const vconUuid = requireUUID(args?.vcon_uuid as string, 'vcon_uuid');
    const analysisData = requireParam(args?.analysis, 'analysis');

    // CRITICAL: Validate that vendor is provided
    if (!(analysisData as any).vendor) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Analysis vendor is REQUIRED per IETF spec Section 4.5.5'
      );
    }

    // Parse and validate with Zod
    const analysis = AnalysisSchema.parse(analysisData) as Analysis;

    // Additional validation
    requireValidAnalysis(analysis);

    await context.queries.addAnalysis(vconUuid, analysis);
    
    return this.createSuccessResponse({
      message: `Added ${analysis.type} analysis from ${analysis.vendor} to vCon ${vconUuid}`,
      analysis: analysis
    });
  }
}

/**
 * Handler for add_dialog tool
 */
export class AddDialogHandler extends BaseToolHandler {
  readonly toolName = 'add_dialog';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const vconUuid = requireUUID(args?.vcon_uuid as string, 'vcon_uuid');
    const dialogData = requireParam(args?.dialog, 'dialog');

    // Parse and validate
    const dialog = DialogSchema.parse(dialogData) as Dialog;
    requireValidDialog(dialog);

    await context.queries.addDialog(vconUuid, dialog);
    
    return this.createSuccessResponse({
      message: `Added ${dialog.type} dialog to vCon ${vconUuid}`,
      dialog: dialog
    });
  }
}

/**
 * Handler for add_attachment tool
 */
export class AddAttachmentHandler extends BaseToolHandler {
  readonly toolName = 'add_attachment';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const vconUuid = requireUUID(args?.vcon_uuid as string, 'vcon_uuid');
    const attachmentData = requireParam(args?.attachment, 'attachment');

    // Parse and validate
    const attachment = AttachmentSchema.parse(attachmentData) as Attachment;
    requireValidAttachment(attachment);

    await context.queries.addAttachment(vconUuid, attachment);
    
    return this.createSuccessResponse({
      message: `Added attachment to vCon ${vconUuid}`,
      attachment: attachment
    });
  }
}

