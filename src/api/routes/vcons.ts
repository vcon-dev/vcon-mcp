/**
 * vCon CRUD Routes
 *
 * Handles create, read, update, delete operations for vCons
 * and sub-resource append operations (dialog, analysis, attachments).
 */

import Router from '@koa/router';
import type { Context } from 'koa';
import { AnalysisSchema, DialogSchema, AttachmentSchema } from '../../tools/vcon-crud.js';
import { Analysis, Attachment, Dialog, VCon } from '../../types/vcon.js';
import { RestApiContext } from '../context.js';
import { parsePagination, PaginationState } from '../middleware/pagination.js';
import { sendCreated, sendError, sendPaginated, sendSuccess } from '../response.js';
import {
  normalizeDateString,
  parseJsonQueryParam,
  validateResponseFormat,
  validateUUID,
} from '../validation.js';
import { VConValidationError } from '../../services/vcon-service.js';
import { logWithContext, recordCounter } from '../../observability/instrumentation.js';

/**
 * Format a vCon based on response_format parameter
 */
function formatVCon(vcon: VCon, format: string): any {
  if (format === 'metadata') {
    return {
      vcon: vcon.vcon,
      uuid: vcon.uuid,
      created_at: vcon.created_at,
      updated_at: vcon.updated_at,
      subject: vcon.subject,
      extensions: vcon.extensions,
      critical: vcon.critical,
      parties: vcon.parties,
    };
  }
  if (format === 'summary') {
    const summaryAnalysis = (vcon.analysis || []).filter((a: any) => a.type === 'summary');
    return {
      vcon: vcon.vcon,
      uuid: vcon.uuid,
      created_at: vcon.created_at,
      updated_at: vcon.updated_at,
      subject: vcon.subject,
      extensions: vcon.extensions,
      critical: vcon.critical,
      parties: vcon.parties,
      analysis: summaryAnalysis,
    };
  }
  return vcon;
}

/**
 * Format search results based on response_format parameter
 */
function formatSearchResults(vcons: VCon[], format: string): any[] {
  if (format === 'ids_only') {
    return vcons.map(v => v.uuid);
  }
  if (format === 'metadata') {
    return vcons.map(v => ({
      uuid: v.uuid,
      subject: v.subject,
      created_at: v.created_at,
      parties_count: v.parties?.length || 0,
      dialog_count: v.dialog?.length || 0,
      analysis_count: v.analysis?.length || 0,
      attachments_count: v.attachments?.length || 0,
    }));
  }
  return vcons;
}

export function createVConRoutes(apiContext: RestApiContext): Router {
  const router = new Router();

  // ── POST /vcons — Create a vCon ───────────────────────────────────────────
  router.post('/vcons', async (ctx: Context) => {
    const body = ctx.request.body as any;
    const startTime = Date.now();

    try {
      const result = await apiContext.vconService.create(body, {
        requestContext: { purpose: 'rest-api-ingest' },
        source: 'rest-api',
      });

      const duration = Date.now() - startTime;
      logWithContext('info', 'vCon created via REST API', {
        uuid: result.uuid,
        duration_ms: duration,
        parties_count: result.vcon.parties?.length || 0,
      });

      sendCreated(ctx, {
        uuid: result.uuid,
        id: result.id,
        message: 'vCon created successfully',
        duration_ms: duration,
      });
    } catch (error) {
      if (error instanceof VConValidationError) {
        return sendError(ctx, 400, error.errors.join('; '));
      }
      throw error;
    }
  });

  // ── POST /vcons/batch — Batch create vCons ────────────────────────────────
  router.post('/vcons/batch', async (ctx: Context) => {
    const startTime = Date.now();
    const body = ctx.request.body as any;
    const vcons: Partial<VCon>[] = body;

    if (!Array.isArray(vcons)) {
      return sendError(ctx, 400, 'Request body must be an array of vCons');
    }
    if (vcons.length === 0) {
      return sendError(ctx, 400, 'Empty vCons array');
    }
    if (vcons.length > 100) {
      return sendError(ctx, 400, 'Maximum 100 vCons per batch');
    }

    const batchResult = await apiContext.vconService.createBatch(vcons, {
      requestContext: { purpose: 'rest-api-batch-ingest' },
      source: 'rest-api-batch',
    });

    const duration = Date.now() - startTime;
    ctx.status = batchResult.failed === 0 ? 201 : 207;
    ctx.body = {
      success: batchResult.failed === 0,
      total: batchResult.total,
      created: batchResult.created,
      failed: batchResult.failed,
      results: batchResult.results,
      duration_ms: duration,
    };
  });

  // ── GET /vcons — List/search vCons ────────────────────────────────────────
  router.get('/vcons', parsePagination(), async (ctx: Context) => {
    const { limit, offset, includeCount } = ctx.state.pagination as PaginationState;
    const { result: fmtResult, value: format } = validateResponseFormat(
      ctx.query.format, ['full', 'metadata', 'ids_only'], 'metadata'
    );
    if (!fmtResult.valid) return sendError(ctx, 400, fmtResult.errors[0]);

    const { result: tagsResult, value: tags } = parseJsonQueryParam(ctx.query.tags, 'tags');
    if (!tagsResult.valid) return sendError(ctx, 400, tagsResult.errors[0]);

    const filters = {
      subject: ctx.query.subject as string | undefined,
      partyName: ctx.query.party_name as string | undefined,
      partyEmail: ctx.query.party_email as string | undefined,
      partyTel: ctx.query.party_tel as string | undefined,
      startDate: normalizeDateString(ctx.query.start_date as string | undefined),
      endDate: normalizeDateString(ctx.query.end_date as string | undefined),
      tags,
      limit,
    };

    const vcons = await apiContext.vconService.search(
      filters,
      { requestContext: { purpose: 'rest-api-list' } }
    );

    let total: number | undefined;
    if (includeCount) {
      try {
        total = await apiContext.queries.searchVConsCount({
          subject: filters.subject,
          partyName: filters.partyName,
          partyEmail: filters.partyEmail,
          partyTel: filters.partyTel,
          startDate: filters.startDate,
          endDate: filters.endDate,
          tags: filters.tags,
        });
      } catch { /* count is best-effort */ }
    }

    const formattedResults = formatSearchResults(vcons, format);
    sendPaginated(ctx, formattedResults, {
      limit,
      offset,
      total,
      has_more: vcons.length === limit,
    }, { response_format: format });
  });

  // ── GET /vcons/:uuid — Get vCon by UUID ───────────────────────────────────
  router.get('/vcons/:uuid', async (ctx: Context) => {
    const { uuid } = ctx.params;
    const uuidCheck = validateUUID(uuid);
    if (!uuidCheck.valid) return sendError(ctx, 400, uuidCheck.errors[0]);

    const { result: fmtResult, value: format } = validateResponseFormat(
      ctx.query.format, ['full', 'summary', 'metadata'], 'full'
    );
    if (!fmtResult.valid) return sendError(ctx, 400, fmtResult.errors[0]);

    try {
      const vcon = await apiContext.vconService.get(uuid, {
        requestContext: { purpose: 'rest-api-read' },
      });
      sendSuccess(ctx, { vcon: formatVCon(vcon, format) });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return sendError(ctx, 404, `vCon with UUID ${uuid} not found`);
      }
      throw error;
    }
  });

  // ── PATCH /vcons/:uuid — Update vCon metadata ────────────────────────────
  router.patch('/vcons/:uuid', async (ctx: Context) => {
    const { uuid } = ctx.params;
    const uuidCheck = validateUUID(uuid);
    if (!uuidCheck.valid) return sendError(ctx, 400, uuidCheck.errors[0]);

    const updates = ctx.request.body as Partial<VCon>;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return sendError(ctx, 400, 'Request body must be an object with fields to update');
    }

    try {
      const updated = await apiContext.vconService.update(uuid, updates, {
        requestContext: { purpose: 'rest-api-update' },
        source: 'rest-api',
        returnUpdated: true,
      });
      sendSuccess(ctx, { vcon: updated });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return sendError(ctx, 404, `vCon with UUID ${uuid} not found`);
      }
      throw error;
    }
  });

  // ── DELETE /vcons/:uuid — Delete a vCon ───────────────────────────────────
  router.delete('/vcons/:uuid', async (ctx: Context) => {
    const { uuid } = ctx.params;
    const uuidCheck = validateUUID(uuid);
    if (!uuidCheck.valid) return sendError(ctx, 400, uuidCheck.errors[0]);

    const deleted = await apiContext.vconService.delete(uuid, {
      requestContext: { purpose: 'rest-api-delete' },
      source: 'rest-api',
    });

    if (!deleted) {
      return sendError(ctx, 404, `vCon with UUID ${uuid} not found`);
    }
    sendSuccess(ctx, { message: `vCon ${uuid} deleted successfully` });
  });

  // ── POST /vcons/:uuid/dialog — Add dialog ────────────────────────────────
  router.post('/vcons/:uuid/dialog', async (ctx: Context) => {
    const { uuid } = ctx.params;
    const uuidCheck = validateUUID(uuid);
    if (!uuidCheck.valid) return sendError(ctx, 400, uuidCheck.errors[0]);

    const dialogData = ctx.request.body as any;
    if (!dialogData || typeof dialogData !== 'object') {
      return sendError(ctx, 400, 'Request body must be a dialog object');
    }

    try {
      const dialog = DialogSchema.parse(dialogData) as Dialog;
      await apiContext.queries.addDialog(uuid, dialog);
      sendCreated(ctx, {
        message: `Added ${dialog.type} dialog to vCon ${uuid}`,
        dialog,
      });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return sendError(ctx, 400, `Invalid dialog: ${error.errors?.map((e: any) => e.message).join('; ')}`);
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return sendError(ctx, 404, `vCon with UUID ${uuid} not found`);
      }
      throw error;
    }
  });

  // ── POST /vcons/:uuid/analysis — Add analysis ────────────────────────────
  router.post('/vcons/:uuid/analysis', async (ctx: Context) => {
    const { uuid } = ctx.params;
    const uuidCheck = validateUUID(uuid);
    if (!uuidCheck.valid) return sendError(ctx, 400, uuidCheck.errors[0]);

    const analysisData = ctx.request.body as any;
    if (!analysisData || typeof analysisData !== 'object') {
      return sendError(ctx, 400, 'Request body must be an analysis object');
    }
    if (!analysisData.vendor) {
      return sendError(ctx, 400, 'Analysis vendor is REQUIRED per IETF spec Section 4.5.5');
    }

    try {
      const analysis = AnalysisSchema.parse(analysisData) as Analysis;
      await apiContext.queries.addAnalysis(uuid, analysis);
      sendCreated(ctx, {
        message: `Added ${analysis.type} analysis from ${analysis.vendor} to vCon ${uuid}`,
        analysis,
      });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return sendError(ctx, 400, `Invalid analysis: ${error.errors?.map((e: any) => e.message).join('; ')}`);
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return sendError(ctx, 404, `vCon with UUID ${uuid} not found`);
      }
      throw error;
    }
  });

  // ── POST /vcons/:uuid/attachments — Add attachment ────────────────────────
  router.post('/vcons/:uuid/attachments', async (ctx: Context) => {
    const { uuid } = ctx.params;
    const uuidCheck = validateUUID(uuid);
    if (!uuidCheck.valid) return sendError(ctx, 400, uuidCheck.errors[0]);

    const attachmentData = ctx.request.body as any;
    if (!attachmentData || typeof attachmentData !== 'object') {
      return sendError(ctx, 400, 'Request body must be an attachment object');
    }

    try {
      const attachment = AttachmentSchema.parse(attachmentData) as Attachment;
      await apiContext.queries.addAttachment(uuid, attachment);
      sendCreated(ctx, {
        message: `Added attachment to vCon ${uuid}`,
        attachment,
      });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return sendError(ctx, 400, `Invalid attachment: ${error.errors?.map((e: any) => e.message).join('; ')}`);
      }
      if (error instanceof Error && error.message.includes('not found')) {
        return sendError(ctx, 404, `vCon with UUID ${uuid} not found`);
      }
      throw error;
    }
  });

  return router;
}
