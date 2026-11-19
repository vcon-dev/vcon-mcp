/**
 * VCon Service
 *
 * Encapsulates vCon lifecycle operations with hooks, validation, and metrics.
 * This service is the single source of truth for vCon CRUD operations,
 * ensuring consistent behavior across MCP tools and REST API.
 */

import { randomUUID } from 'crypto';
import pLimit from 'p-limit';
import { IVConQueries } from '../db/interfaces.js';
import { RequestContext } from '../hooks/plugin-interface.js';
import { PluginManager } from '../hooks/plugin-manager.js';
import { ATTR_VCON_UUID } from '../observability/attributes.js';
import { logWithContext, recordCounter } from '../observability/instrumentation.js';
import { VCon, VCON_VERSION } from '../types/vcon.js';
import { MigrationReport, carryMigrationReport, looksLegacy, migrate040To050, reportSummary } from '../utils/vcon-migration.js';
import { extensionsInUse } from '../utils/vcon-validation.js';
import { encryptedForm, signedForm, validateVconDict } from '../utils/vcon-reference-validation.js';
import { isVConNotFoundError, VConNotFoundError } from '../utils/errors.js';
import { validateVCon } from '../utils/validation.js';

// ============================================================================
// Types
// ============================================================================

export interface VConServiceContext {
  queries: IVConQueries;
  pluginManager: PluginManager;
}

export interface CreateVConOptions {
  /** Skip beforeCreate/afterCreate hooks */
  skipHooks?: boolean;
  /** Skip validation */
  skipValidation?: boolean;
  /** Custom request context for hooks (timestamp auto-populated if missing) */
  requestContext?: Partial<RequestContext>;
  /** Source identifier for metrics (e.g., 'mcp', 'rest-api', 'batch') */
  source?: string;
}

export interface CreateVConResult {
  uuid: string;
  id: string;
  vcon: VCon;
  /** Present when the input was a 0.4.0 vCon and was migrated to 0.5.0 before it was stored. */
  migration?: MigrationReport;
}

export interface BatchCreateResult {
  uuid: string;
  success: boolean;
  id?: string;
  error?: string;
}

export interface BatchCreateVConsResult {
  total: number;
  created: number;
  failed: number;
  results: BatchCreateResult[];
}

export interface GetVConOptions {
  /** Skip beforeRead/afterRead hooks */
  skipHooks?: boolean;
  /** Custom request context for hooks (timestamp auto-populated if missing) */
  requestContext?: Partial<RequestContext>;
}

export interface SearchHookOptions {
  /** Custom request context for hooks (timestamp auto-populated if missing) */
  requestContext?: Partial<RequestContext>;
  /** Skip beforeSearch/afterSearch hooks */
  skipHooks?: boolean;
}

export type KeywordHit = Awaited<ReturnType<IVConQueries['keywordSearch']>>[number];
export type SemanticHit = Awaited<ReturnType<IVConQueries['semanticSearch']>>[number];
export type HybridHit = Awaited<ReturnType<IVConQueries['hybridSearch']>>[number];

export interface HitSearchOptions<H> extends SearchHookOptions {
  /**
   * Narrow the raw hits to the page the caller returns, BEFORE afterSearch runs.
   * Keeps pagination decided on raw rows (CON-1243) and loads only page vCons.
   */
  selectPage?: (hits: H[]) => H[];
  /** Load the selected hits' vCons into `vcons` even when no afterSearch hook needs them. */
  hydrate?: boolean;
}

export interface HitSearchResult<H> {
  /** Hits after selectPage and afterSearch filtering */
  hits: H[];
  /** Raw DB hit count, before selectPage and hooks */
  rawCount: number;
  /** Hit count after selectPage, before hooks */
  selectedCount: number;
  /** Hit vCons keyed by lowercase uuid (post-afterSearch); set when hooks ran or hydrate was asked */
  vcons?: Map<string, VCon>;
}

export interface UpdateVConOptions {
  /** Skip beforeUpdate/afterUpdate hooks */
  skipHooks?: boolean;
  /** Custom request context for hooks (timestamp auto-populated if missing) */
  requestContext?: Partial<RequestContext>;
  /** Source identifier for metrics */
  source?: string;
  /** Return the updated vCon (default: true) */
  returnUpdated?: boolean;
}

export interface DeleteVConOptions {
  /** Skip beforeDelete/afterDelete hooks */
  skipHooks?: boolean;
  /** Custom request context for hooks (timestamp auto-populated if missing) */
  requestContext?: Partial<RequestContext>;
  /** Source identifier for metrics */
  source?: string;
}

// ============================================================================
// VCon Service
// ============================================================================

export class VConService {
  constructor(private context: VConServiceContext) { }

  /**
   * Normalize partial RequestContext to full RequestContext
   */
  private normalizeRequestContext(
    partial?: Partial<RequestContext>,
    defaultPurpose: string = 'vcon-service'
  ): RequestContext {
    return {
      timestamp: new Date(),
      purpose: defaultPurpose,
      ...partial,
    };
  }

  /**
   * Create a new vCon with full lifecycle handling
   *
   * This method:
   * 1. Normalizes the vCon data (generates UUID, timestamps if missing)
   * 2. Executes beforeCreate hooks (can modify or block)
   * 3. Validates the vCon structure
   * 4. Persists to database (handles denormalization)
   * 5. Executes afterCreate hooks
   * 6. Records metrics
   */
  async create(
    vconData: Partial<VCon>,
    options: CreateVConOptions = {}
  ): Promise<CreateVConResult> {
    const startTime = Date.now();
    const source = options.source || 'unknown';
    const requestContext = this.normalizeRequestContext(options.requestContext, source);

    // Step 1: Normalize vCon data
    const normalized = this.normalizeVCon(vconData);
    let vcon: VCon = normalized.vcon;
    const migration = normalized.migration;

    // Step 2: Execute beforeCreate hook
    if (!options.skipHooks) {
      const modifiedVCon = await this.context.pluginManager.executeHook<VCon>(
        'beforeCreate', vcon, requestContext
      );
      if (modifiedVCon) {
        vcon = modifiedVCon;
      }
    }

    // Step 3: Validate
    if (!options.skipValidation) {
      const validation = validateVCon(vcon);
      if (!validation.valid) {
        throw new VConValidationError(validation.errors);
      }
    }

    // Step 4: Persist to database
    const result = await this.context.queries.createVCon(vcon);
    if (migration && this.context.queries.saveMigrationReport) {
      // Posted as 0.4.0: keep the report with the record (the reference requires it for a
      // production migration). The vCon is already stored, so a failure is logged, not thrown;
      // the caller still gets the report in the result.
      try {
        await this.context.queries.saveMigrationReport(result.uuid, migration, 'create');
      } catch (err) {
        logWithContext('error', 'Could not store the migration report of a vCon posted as 0.4.0', {
          vcon_uuid: result.uuid,
          error_message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Step 5: Execute afterCreate hook
    if (!options.skipHooks) {
      await this.context.pluginManager.executeHook('afterCreate', vcon, requestContext);
    }

    // Step 6: Record metrics
    const duration = Date.now() - startTime;
    recordCounter('vcon.created.count', 1, {
      [ATTR_VCON_UUID]: result.uuid,
      source,
    }, 'vCon creation count');

    logWithContext('debug', 'vCon created', {
      uuid: result.uuid,
      source,
      duration_ms: duration,
      parties_count: vcon.parties?.length || 0,
      dialog_count: vcon.dialog?.length || 0,
      analysis_count: vcon.analysis?.length || 0,
    });

    return {
      uuid: result.uuid,
      id: result.id,
      vcon,
      ...(migration ? { migration } : {}),
    };
  }

  /**
   * Create multiple vCons in batch
   *
   * Processes each vCon individually, collecting results.
   * Continues processing even if some fail.
   */
  async createBatch(
    vcons: Partial<VCon>[],
    options: CreateVConOptions = {}
  ): Promise<BatchCreateVConsResult> {
    // Process all vCons concurrently, capped at 10 in-flight at once.
    // Promise.allSettled collects every result without short-circuiting on failure.
    const limit = pLimit(10);

    const settled = await Promise.allSettled(
      vcons.map((vconData) =>
        limit(() =>
          this.create(vconData, {
            ...options,
            source: options.source || 'batch',
          })
        )
      )
    );

    const results: BatchCreateResult[] = settled.map((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        return { uuid: outcome.value.uuid, success: true, id: outcome.value.id };
      }
      return {
        uuid: vcons[i].uuid || 'unknown',
        success: false,
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      };
    });

    const successCount = results.filter((r) => r.success).length;
    const errorCount   = results.filter((r) => !r.success).length;

    return { total: vcons.length, created: successCount, failed: errorCount, results };
  }

  /**
   * Get a vCon by UUID with hook support
   */
  async get(uuid: string, options: GetVConOptions = {}): Promise<VCon> {
    const requestContext = this.normalizeRequestContext(options.requestContext, 'read');

    // Execute beforeRead hook (can throw to block)
    if (!options.skipHooks) {
      await this.context.pluginManager.executeHook('beforeRead', uuid, requestContext);
    }

    const vcon = await this.context.queries.getVCon(uuid);

    // Execute afterRead hook (can modify response). A vCon migrated on read carries its report
    // (getMigrationReport); a hook may return a different object, so the report is carried over.
    if (!options.skipHooks) {
      const modifiedVCon = await this.context.pluginManager.executeHook<VCon>(
        'afterRead', vcon, requestContext
      );
      if (modifiedVCon) {
        carryMigrationReport(vcon, modifiedVCon);
        return modifiedVCon;
      }
    }

    return vcon;
  }

  /**
   * Update a vCon's metadata with full lifecycle handling
   *
   * Only whitelisted fields (subject, extensions, critical) can be updated.
   * Executes beforeUpdate/afterUpdate hooks for plugin integration.
   *
   * @returns the updated vCon if returnUpdated is true, otherwise void
   */
  async update(
    uuid: string,
    updates: Partial<VCon>,
    options: UpdateVConOptions = {}
  ): Promise<VCon | undefined> {
    const source = options.source || 'unknown';
    const requestContext = this.normalizeRequestContext(options.requestContext, source);
    const returnUpdated = options.returnUpdated ?? true;

    // Whitelist allowed fields
    const allowed: Partial<VCon> = {} as Partial<VCon>;
    if (Object.prototype.hasOwnProperty.call(updates, 'subject')) {
      allowed.subject = updates.subject;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'extensions')) {
      allowed.extensions = updates.extensions;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'critical')) {
      allowed.critical = updates.critical as string[] | undefined;
    } else if (Object.prototype.hasOwnProperty.call(updates, 'must_support')) {
      // 'must_support' is the pre-0.4.0 name; critical wins when both are given.
      allowed.critical = (updates as any).must_support as string[] | undefined;
    }

    // Hook: beforeUpdate
    if (!options.skipHooks) {
      await this.context.pluginManager.executeHook('beforeUpdate', uuid, allowed, requestContext);
    }

    await this.context.queries.updateVCon(uuid, allowed);

    // Hook: afterUpdate
    let updated: VCon | undefined;
    if (returnUpdated || !options.skipHooks) {
      updated = await this.context.queries.getVCon(uuid);
      if (!options.skipHooks) {
        const modified = await this.context.pluginManager.executeHook<VCon>(
          'afterUpdate', updated, requestContext
        );
        if (modified) updated = modified;
      }
    }

    // Record metrics
    recordCounter('vcon.updated.count', 1, {
      [ATTR_VCON_UUID]: uuid,
      source,
    }, 'vCon update count');

    return returnUpdated ? updated : undefined;
  }

  /**
   * Delete a vCon by UUID with hook support
   *
   * @returns true if deleted, false if not found
   */
  async delete(uuid: string, options: DeleteVConOptions = {}): Promise<boolean> {
    const source = options.source || 'unknown';
    const requestContext = this.normalizeRequestContext(options.requestContext, 'delete');

    // Check if vCon exists. Only a genuine not-found is reported as one; any other failure
    // (refused credential, store or network error) propagates, so it is never mistaken for it.
    try {
      await this.context.queries.getVCon(uuid);
    } catch (error) {
      if (isVConNotFoundError(error)) return false;
      throw error;
    }

    // Execute beforeDelete hook (can throw to prevent)
    if (!options.skipHooks) {
      await this.context.pluginManager.executeHook('beforeDelete', uuid, requestContext);
    }

    // Delete from database. A backend that counts the rows it removed reports 0 when none was visible:
    // under row-level security another tenant's uuid matches nothing and no error comes back.
    const removed = await this.context.queries.deleteVCon(uuid);
    if (removed === 0) return false;

    // Execute afterDelete hook
    if (!options.skipHooks) {
      await this.context.pluginManager.executeHook('afterDelete', uuid, requestContext);
    }

    // Record metrics
    recordCounter('vcon.deleted.count', 1, {
      [ATTR_VCON_UUID]: uuid,
      source,
    }, 'vCon deletion count');

    return true;
  }

  /**
   * Search vCons with hook support
   */
  async search(
    filters: Parameters<IVConQueries['searchVCons']>[0],
    options: SearchHookOptions = {}
  ): Promise<VCon[]> {
    return (await this.searchWithRawCount(filters, options)).vcons;
  }

  /**
   * As search, plus `rawCount`: the DB row count before afterSearch, for callers
   * that derive pagination from it (a filtering plugin must not shift has_more).
   */
  async searchWithRawCount(
    filters: Parameters<IVConQueries['searchVCons']>[0],
    options: SearchHookOptions = {}
  ): Promise<{ vcons: VCon[]; rawCount: number }> {
    const requestContext = this.normalizeRequestContext(options.requestContext, 'search');

    // beforeSearch can modify criteria; afterSearch can filter or modify results.
    const searchFilters = await this.runBeforeSearch(filters, requestContext, options.skipHooks);
    const results = await this.context.queries.searchVCons(searchFilters);
    const vcons = await this.runAfterSearch(results, requestContext, options.skipHooks);
    return { vcons, rawCount: results.length };
  }

  /**
   * Search one page of vCons and report whether a next page exists.
   *
   * `filters.limit` is the page size. The query asks for one extra row and
   * `hasMore` is decided from the raw DB result, BEFORE the afterSearch hook
   * runs: a filtering plugin could otherwise drop the probe row (or any row) and
   * make has_more lie (CON-1243). The hook sees only the page, never the probe.
   */
  async searchPage(
    filters: Parameters<IVConQueries['searchVCons']>[0] & { limit: number },
    options: SearchHookOptions = {}
  ): Promise<{ vcons: VCon[]; hasMore: boolean }> {
    const requestContext = this.normalizeRequestContext(options.requestContext, 'search');

    const searchFilters = await this.runBeforeSearch(filters, requestContext, options.skipHooks);

    const pageSize = searchFilters.limit ?? filters.limit;
    const probed = await this.context.queries.searchVCons({ ...searchFilters, limit: pageSize + 1 });
    const hasMore = probed.length > pageSize;
    const page = hasMore ? probed.slice(0, pageSize) : probed;

    const vcons = await this.runAfterSearch(page, requestContext, options.skipHooks);
    return { vcons, hasMore };
  }

  /**
   * Run beforeSearch on criteria built by a caller that queries in a custom way
   * (e.g. the cursor-walking id listing resource). Returns the criteria to use.
   */
  async applyBeforeSearch<T extends object>(criteria: T, options: SearchHookOptions = {}): Promise<T> {
    const requestContext = this.normalizeRequestContext(options.requestContext, 'search');
    return this.runBeforeSearch(criteria, requestContext, options.skipHooks);
  }

  /**
   * Run afterSearch on a list of vCons a caller fetched itself (see applyBeforeSearch).
   */
  async applyAfterSearch(vcons: VCon[], options: SearchHookOptions = {}): Promise<VCon[]> {
    const requestContext = this.normalizeRequestContext(options.requestContext, 'search');
    return this.runAfterSearch(vcons, requestContext, options.skipHooks);
  }

  /**
   * Keyword (full-text) search with beforeSearch/afterSearch hooks.
   * Hits whose vCon afterSearch drops are removed; hits whose vCon it alters
   * get `snippet: null` (see filterHits).
   */
  async keywordSearch(
    params: Parameters<IVConQueries['keywordSearch']>[0],
    options: HitSearchOptions<KeywordHit> = {}
  ): Promise<HitSearchResult<KeywordHit>> {
    const requestContext = this.normalizeRequestContext(options.requestContext, 'search');
    const criteria = await this.runBeforeSearch(params, requestContext, options.skipHooks);
    const raw = await this.context.queries.keywordSearch(criteria);
    return this.finishHitSearch(raw, ['snippet'], options, requestContext);
  }

  /**
   * Semantic (embedding) search with beforeSearch/afterSearch hooks.
   * Hits whose vCon afterSearch alters get `content_text: null`.
   */
  async semanticSearch(
    params: Parameters<IVConQueries['semanticSearch']>[0],
    options: HitSearchOptions<SemanticHit> = {}
  ): Promise<HitSearchResult<SemanticHit>> {
    const requestContext = this.normalizeRequestContext(options.requestContext, 'search');
    const criteria = await this.runBeforeSearch(params, requestContext, options.skipHooks);
    const raw = await this.context.queries.semanticSearch(criteria);
    return this.finishHitSearch(raw, ['content_text'], options, requestContext);
  }

  /**
   * Hybrid (keyword + semantic) search with beforeSearch/afterSearch hooks.
   * Hybrid hits carry only scores, so afterSearch can only drop them.
   */
  async hybridSearch(
    params: Parameters<IVConQueries['hybridSearch']>[0],
    options: HitSearchOptions<HybridHit> = {}
  ): Promise<HitSearchResult<HybridHit>> {
    const requestContext = this.normalizeRequestContext(options.requestContext, 'search');
    const criteria = await this.runBeforeSearch(params, requestContext, options.skipHooks);
    const raw = await this.context.queries.hybridSearch(criteria);
    return this.finishHitSearch(raw, [], options, requestContext);
  }

  /**
   * Tag search with beforeSearch/afterSearch hooks. Returns matching uuids
   * (afterSearch can drop them) plus hydrated vCons when hooks loaded them.
   */
  async searchByTags(
    tags: Record<string, string>,
    limit?: number,
    options: HitSearchOptions<{ vcon_id: string }> = {}
  ): Promise<{ uuids: string[]; vcons?: Map<string, VCon>; rawCount: number }> {
    const requestContext = this.normalizeRequestContext(options.requestContext, 'search');
    const criteria = await this.runBeforeSearch({ tags, limit }, requestContext, options.skipHooks);
    const uuids = await this.context.queries.searchByTags(criteria.tags, criteria.limit);
    const result = await this.finishHitSearch(
      uuids.map(vcon_id => ({ vcon_id })), [], options, requestContext
    );
    return { uuids: result.hits.map(h => h.vcon_id), vcons: result.vcons, rawCount: result.rawCount };
  }

  /**
   * Full vCons for `ids` (in order) from a hit search result. When an
   * afterSearch hook ran these are its outputs, and ids it dropped are skipped;
   * with no afterSearch hook the rows are loaded raw, which is what the hook
   * would have returned. With `readHooks`, each vCon then also goes through
   * beforeRead/afterRead (the full-body contract of the search_* tools,
   * CON-1240), applied to that same object so each hook runs once per vCon.
   * A vCon that is unreadable (deleted since the search) or that beforeRead
   * blocks is skipped rather than failing the whole call.
   */
  async vconsForHits(
    result: { vcons?: Map<string, VCon> },
    ids: string[],
    options: GetVConOptions & { readHooks?: boolean } = {}
  ): Promise<VCon[]> {
    const map = result.vcons;
    const base = map
      ? ids.map(id => map.get(id.toLowerCase())).filter((v): v is VCon => v !== undefined)
      : await this.loadMany(ids);
    if (!options.readHooks || options.skipHooks) return base;

    const requestContext = this.normalizeRequestContext(options.requestContext, 'read');
    const settled = await Promise.allSettled(base.map(async (vcon) => {
      // Hit filtering already ran the read hooks on this object: do not run them twice.
      if (this.readHooked.has(vcon)) return vcon;
      return this.applyReadHooks(vcon, requestContext);
    }));
    const out: VCon[] = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        out.push(outcome.value);
      } else {
        logWithContext('warn', 'Skipping vCon blocked by a read hook in search results', {
          vcon_uuid: base[i].uuid,
          reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
      }
    });
    return out;
  }

  /** vCons already run through beforeRead/afterRead by hit filtering (result objects). */
  private readHooked = new WeakSet<VCon>();

  /** beforeRead then afterRead on one vCon; beforeRead throwing blocks it. */
  private async applyReadHooks(vcon: VCon, requestContext: RequestContext): Promise<VCon> {
    await this.context.pluginManager.executeHook('beforeRead', vcon.uuid, requestContext);
    const modified = await this.context.pluginManager.executeHook<VCon>('afterRead', vcon, requestContext);
    const result = modified ?? vcon;
    this.readHooked.add(result);
    return result;
  }

  /**
   * All tags of a vCon. Runs beforeRead (access check). afterRead cannot run:
   * the result is a tag map from vcon_tags_mv, not a VCon.
   */
  async getTags(uuid: string, options: GetVConOptions = {}): Promise<Record<string, any>> {
    const requestContext = this.normalizeRequestContext(options.requestContext, 'read');
    if (!options.skipHooks) {
      await this.context.pluginManager.executeHook('beforeRead', uuid, requestContext);
    }
    return this.context.queries.getTags(uuid);
  }

  /**
   * One tag of a vCon. Runs beforeRead (access check), as getTags.
   */
  async getTag(uuid: string, key: string, defaultValue?: any, options: GetVConOptions = {}): Promise<any> {
    const requestContext = this.normalizeRequestContext(options.requestContext, 'read');
    if (!options.skipHooks) {
      await this.context.pluginManager.executeHook('beforeRead', uuid, requestContext);
    }
    return this.context.queries.getTag(uuid, key, defaultValue);
  }

  // ========== Search hook helpers ==========

  private async runBeforeSearch<T>(criteria: T, requestContext: RequestContext, skipHooks?: boolean): Promise<T> {
    if (skipHooks) return criteria;
    const modified = await this.context.pluginManager.executeHook<T>('beforeSearch', criteria, requestContext);
    return modified ?? criteria;
  }

  private async runAfterSearch(results: VCon[], requestContext: RequestContext, skipHooks?: boolean): Promise<VCon[]> {
    if (skipHooks) return results;
    const modified = await this.context.pluginManager.executeHook<VCon[]>('afterSearch', results, requestContext);
    return modified ?? results;
  }

  /** Unknown plugin manager shape (no hasHook): assume the hook exists, i.e. fail closed. */
  private hasHook(name: 'afterSearch' | 'beforeRead' | 'afterRead'): boolean {
    const pm = this.context.pluginManager as Partial<PluginManager>;
    return typeof pm.hasHook === 'function' ? pm.hasHook(name) : true;
  }

  private async loadMany(ids: string[]): Promise<VCon[]> {
    const settled = await Promise.allSettled(ids.map(id => this.context.queries.getVCon(id)));
    const vcons: VCon[] = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        if (outcome.value) vcons.push(outcome.value);
      } else {
        logWithContext('warn', 'Skipping unreadable vCon in search results', {
          vcon_uuid: ids[i],
          reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
      }
    });
    return vcons;
  }

  private async finishHitSearch<H extends { vcon_id: string }>(
    raw: H[],
    textFields: (keyof H)[],
    options: HitSearchOptions<H>,
    requestContext: RequestContext
  ): Promise<HitSearchResult<H>> {
    const selected = options.selectPage ? options.selectPage(raw) : raw;
    const filtered = await this.filterHits(selected, textFields, options, requestContext);
    return { ...filtered, rawCount: raw.length, selectedCount: selected.length };
  }

  /**
   * Apply afterSearch to hit-level results (rows that point at a vCon rather
   * than being one). The hit vCons are loaded and passed to afterSearch, the
   * same hook search_vcons runs. A hit survives only if its vCon does. If the
   * hook altered a vCon (e.g. redacted it), the hit's text fields, which were
   * cut from the raw DB content, are nulled so they cannot leak what the hook
   * removed. With no afterSearch hook (and no hydrate request) nothing is loaded.
   */
  private async filterHits<H extends { vcon_id: string }>(
    hits: H[],
    textFields: (keyof H)[],
    options: HitSearchOptions<H>,
    requestContext: RequestContext
  ): Promise<{ hits: H[]; vcons?: Map<string, VCon> }> {
    // Any hook that can hide or alter a vCon's content also guards the hit text cut from it:
    // an ACL/redactor that implements only beforeRead/afterRead must not leak snippets.
    const hasReadHook = this.hasHook('beforeRead') || this.hasHook('afterRead');
    const runHook = !options.skipHooks && (this.hasHook('afterSearch') || hasReadHook);
    if (!runHook && !options.hydrate) return { hits };

    const ids = [...new Set(hits.map(h => h.vcon_id))];
    const loaded = await this.loadMany(ids);
    if (!runHook) {
      return { hits, vcons: new Map(loaded.map(v => [v.uuid.toLowerCase(), v])) };
    }

    // Snapshot before the hooks: plugins may mutate in place.
    const before = new Map(loaded.map(v => [v.uuid.toLowerCase(), JSON.stringify(v)]));
    let visible = await this.runAfterSearch(loaded, requestContext, false);
    if (hasReadHook) {
      // beforeRead blocks (fail closed: the vCon and its hits are dropped), afterRead redacts.
      const settled = await Promise.allSettled(visible.map(v => this.applyReadHooks(v, requestContext)));
      const read: VCon[] = [];
      settled.forEach((outcome, i) => {
        if (outcome.status === 'fulfilled') {
          read.push(outcome.value);
        } else {
          logWithContext('warn', 'Dropping hit blocked by a read hook', {
            vcon_uuid: visible[i].uuid,
            reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          });
        }
      });
      visible = read;
    }
    const vcons = new Map(visible.map(v => [v.uuid.toLowerCase(), v]));

    // Fail closed: a hit whose vCon could not be loaded, or that the hook dropped, is removed.
    const kept: H[] = [];
    for (const hit of hits) {
      const key = hit.vcon_id.toLowerCase();
      const vcon = vcons.get(key);
      if (!vcon) continue;
      if (textFields.length > 0 && JSON.stringify(vcon) !== before.get(key)) {
        const masked = { ...hit };
        for (const field of textFields) (masked as any)[field] = null;
        kept.push(masked);
      } else {
        kept.push(hit);
      }
    }
    return { hits: kept, vcons };
  }

  // ========== Private Helpers ==========

  /**
   * Normalize vCon data with defaults. Writers emit 0.5.0.
   *
   * A 0.4.0 vCon (declared, or undeclared with dialog and none of the 0.5.0
   * parameters) is migrated with the reference semantics before it is stored;
   * the report comes back with the result. Deprecated key spellings are mapped
   * to the current names and never carried through `...data`. Extensions the
   * server recognises (lawful_basis, wtf_transcription) are added to
   * `extensions` because 0.5.0 makes listing them a MUST.
   */
  private normalizeVCon(data: Partial<VCon>): { vcon: VCon; migration?: MigrationReport } {
    // A signed (JWS) or encrypted (JWE) container is not a vCon this server can store:
    // the rows would hold neither the signature nor the ciphertext. It is refused, with
    // what the reference finds in it, before any default (uuid, created_at) is added.
    if (signedForm(data) || encryptedForm(data)) {
      const what = signedForm(data)
        ? 'A signed (JWS) vCon cannot be stored as is: verify it'
        : 'An encrypted (JWE) vCon cannot be stored as is: verify and decrypt it';
      throw new VConValidationError([
        `${what} and send the vCon it carries.`,
        ...validateVconDict(data as Record<string, any>).errors,
      ]);
    }
    let migration: MigrationReport | undefined;
    let input: Record<string, any> = data as Record<string, any>;

    const declared = input.vcon;
    const legacyShape = declared === '0.4.0' || (declared === undefined && looksLegacy(input));
    if (legacyShape) {
      const withDefaults = { ...input, created_at: input.created_at || new Date().toISOString(), vcon: '0.4.0' };
      let migrated;
      try {
        migrated = migrate040To050(withDefaults);
      } catch (err) {
        throw new VConValidationError([err instanceof Error ? err.message : String(err)]);
      }
      input = migrated.vcon;
      migration = migrated.report;
      logWithContext('info', 'Migrated 0.4.0 vCon on create', { summary: reportSummary(migration) });
    }

    // Deprecated read aliases. The current name wins when both are present.
    const { must_support, appended, redacted, amended, ...rest } = input as Record<string, any>;
    const extensions = new Set<string>(Array.isArray(rest.extensions) ? rest.extensions : []);
    const { names } = extensionsInUse(rest);
    // Each extension named in critical MUST also be listed in extensions (4.1.3).
    const critical: string[] | undefined = rest.critical ?? must_support;
    const added = [...new Set([...names, ...(Array.isArray(critical) ? critical : [])])].filter((n) => !extensions.has(n));
    const mergedExtensions = rest.extensions !== undefined || added.length > 0
      ? [...(Array.isArray(rest.extensions) ? rest.extensions : []), ...added]
      : undefined;

    const vcon = {
      ...rest, // keep extension keys such as top-level meta (CON-1047)
      vcon: VCON_VERSION,
      uuid: rest.uuid || randomUUID(),
      created_at: rest.created_at || new Date().toISOString(),
      updated_at: rest.updated_at,
      subject: rest.subject,
      parties: rest.parties || [],
      sessions: rest.sessions,
      dialog: renameLegacyMimetype(rest.dialog),
      events: rest.events,
      analysis: renameLegacyMimetype(rest.analysis),
      attachments: renameLegacyMimetype(rest.attachments),
      group: rest.group,
      extensions: mergedExtensions,
      critical: rest.critical ?? must_support,
      redacted_from: rest.redacted_from ?? redacted,
      amended_from: rest.amended_from ?? amended ?? appended,
    } as VCon;
    return { vcon, ...(migration ? { migration } : {}) };
  }
}

/**
 * Rename legacy `mimetype` to `mediatype` on each entry (new name wins; the
 * legacy key is never left behind).
 */
function renameLegacyMimetype<T>(items: T[] | undefined): T[] | undefined {
  if (!Array.isArray(items)) return items;
  return items.map(item => {
    if (!item || typeof item !== 'object' || !('mimetype' in item)) return item;
    const { mimetype, ...others } = item as T & { mimetype?: string };
    const out: any = { ...others };
    if (out.mediatype === undefined && mimetype !== undefined) out.mediatype = mimetype;
    return out as T;
  });
}

// ============================================================================
// Custom Errors
// ============================================================================

export class VConValidationError extends Error {
  constructor(public errors: string[]) {
    super(`Validation failed: ${errors.join('; ')}`);
    this.name = 'VConValidationError';
  }
}

// VConNotFoundError lives in utils/errors so the db layer can throw it without
// importing the service layer. Re-exported here for existing importers.
export { VConNotFoundError };
