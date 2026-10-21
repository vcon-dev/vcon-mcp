/**
 * Tag Routes
 *
 * Sub-resource routes for per-vCon tags and collection-level tag discovery.
 */

import Router from '@koa/router';
import type { Context } from 'koa';
import { RestApiContext } from '../context.js';
import { sendError, sendNoContent, sendSuccess } from '../response.js';
import { parseJsonQueryParam, validateIntRange, validateNonEmptyString, validateUUID } from '../validation.js';

export function createTagRoutes(apiContext: RestApiContext): Router {
  const router = new Router();

  // ── GET /vcons/:uuid/tags — Get all tags (or single via ?key) ─────────────
  router.get('/vcons/:uuid/tags', async (ctx: Context) => {
    const { uuid } = ctx.params;
    const uuidCheck = validateUUID(uuid);
    if (!uuidCheck.valid) return sendError(ctx, 400, uuidCheck.errors[0]);

    const key = ctx.query.key as string | undefined;

    try {
      if (key) {
        const defaultValue = ctx.query.default ?? null;
        // beforeRead (access check) runs in the service; a tag value is not a VCon, so no afterRead.
        const value = await apiContext.vconService.getTag(uuid, key, defaultValue, {
          requestContext: { purpose: 'rest-api-tag-read' },
        });
        sendSuccess(ctx, { key, value });
      } else {
        const tags = await apiContext.vconService.getTags(uuid, {
          requestContext: { purpose: 'rest-api-tag-read' },
        });
        sendSuccess(ctx, { tags });
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return sendError(ctx, 404, `vCon with UUID ${uuid} not found`);
      }
      throw error;
    }
  });

  // ── PUT /vcons/:uuid/tags/:key — Set a tag ────────────────────────────────
  router.put('/vcons/:uuid/tags/:key', async (ctx: Context) => {
    const { uuid, key } = ctx.params;
    const uuidCheck = validateUUID(uuid);
    if (!uuidCheck.valid) return sendError(ctx, 400, uuidCheck.errors[0]);

    const keyCheck = validateNonEmptyString(key, 'key');
    if (!keyCheck.valid) return sendError(ctx, 400, keyCheck.errors[0]);

    const body = ctx.request.body as any;
    if (!body || body.value === undefined) {
      return sendError(ctx, 400, 'Request body must contain a "value" field');
    }

    try {
      await apiContext.queries.addTag(uuid, key, String(body.value), true);
      sendSuccess(ctx, { key, value: String(body.value), message: `Tag "${key}" set on vCon ${uuid}` });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return sendError(ctx, 404, `vCon with UUID ${uuid} not found`);
      }
      throw error;
    }
  });

  // ── DELETE /vcons/:uuid/tags/:key — Remove a tag ──────────────────────────
  router.delete('/vcons/:uuid/tags/:key', async (ctx: Context) => {
    const { uuid, key } = ctx.params;
    const uuidCheck = validateUUID(uuid);
    if (!uuidCheck.valid) return sendError(ctx, 400, uuidCheck.errors[0]);

    try {
      await apiContext.queries.removeTag(uuid, key);
      sendNoContent(ctx);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return sendError(ctx, 404, `vCon with UUID ${uuid} not found`);
      }
      throw error;
    }
  });

  // ── DELETE /vcons/:uuid/tags — Remove all tags ────────────────────────────
  router.delete('/vcons/:uuid/tags', async (ctx: Context) => {
    const { uuid } = ctx.params;
    const uuidCheck = validateUUID(uuid);
    if (!uuidCheck.valid) return sendError(ctx, 400, uuidCheck.errors[0]);

    try {
      await apiContext.queries.removeAllTags(uuid);
      sendNoContent(ctx);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return sendError(ctx, 404, `vCon with UUID ${uuid} not found`);
      }
      throw error;
    }
  });

  // ── GET /tags — Discover unique tags across the database ──────────────────
  router.get('/tags', async (ctx: Context) => {
    const includeCounts = ctx.query.include_counts === 'true';
    const keyFilter = ctx.query.key_filter as string | undefined;
    const { result: minCountResult, value: minCount } = validateIntRange(ctx.query.min_count, 'min_count', 1, 100000, 1);
    if (!minCountResult.valid) return sendError(ctx, 400, minCountResult.errors[0]);

    // Aggregate surface (tag keys and counts across the corpus): per-vCon read hooks do not apply.
    const result = await apiContext.queries.getUniqueTags({
      includeCounts,
      keyFilter,
      minCount,
    });

    sendSuccess(ctx, result);
  });

  // ── GET /tags/search — Search vCons by tag values ─────────────────────────
  router.get('/tags/search', async (ctx: Context) => {
    const { result: tagsResult, value: tags } = parseJsonQueryParam(ctx.query.tags, 'tags');
    if (!tagsResult.valid) return sendError(ctx, 400, tagsResult.errors[0]);
    if (!tags || typeof tags !== 'object' || Object.keys(tags).length === 0) {
      return sendError(ctx, 400, 'tags query parameter is required and must be a non-empty JSON object');
    }

    const { result: limitResult, value: limit } = validateIntRange(ctx.query.limit, 'limit', 1, 100, 50);
    if (!limitResult.valid) return sendError(ctx, 400, limitResult.errors[0]);

    // beforeSearch/afterSearch run in the service; afterSearch can drop uuids.
    const { uuids } = await apiContext.vconService.searchByTags(tags, limit, {
      requestContext: { purpose: 'rest-api-search' },
    });
    sendSuccess(ctx, { count: uuids.length, uuids });
  });

  return router;
}
