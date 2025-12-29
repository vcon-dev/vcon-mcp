/**
 * VCon Service
 * 
 * Encapsulates vCon lifecycle operations with hooks, validation, and metrics.
 * This service is the single source of truth for vCon CRUD operations,
 * ensuring consistent behavior across MCP tools and REST API.
 */

import { randomUUID } from 'crypto';
import { VConQueries } from '../db/queries.js';
import { PluginManager } from '../hooks/plugin-manager.js';
import { RequestContext } from '../hooks/plugin-interface.js';
import { ATTR_VCON_UUID } from '../observability/attributes.js';
import { logWithContext, recordCounter } from '../observability/instrumentation.js';
import { VCon } from '../types/vcon.js';
import { validateVCon } from '../utils/validation.js';

// ============================================================================
// Types
// ============================================================================

export interface VConServiceContext {
  queries: VConQueries;
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
  constructor(private context: VConServiceContext) {}

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
    let vcon: VCon = this.normalizeVCon(vconData);

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
    const results: BatchCreateResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const vconData of vcons) {
      try {
        const result = await this.create(vconData, {
          ...options,
          source: options.source || 'batch',
        });
        results.push({
          uuid: result.uuid,
          success: true,
          id: result.id,
        });
        successCount++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({
          uuid: vconData.uuid || 'unknown',
          success: false,
          error: errorMsg,
        });
        errorCount++;
      }
    }

    return {
      total: vcons.length,
      created: successCount,
      failed: errorCount,
      results,
    };
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

    // Execute afterRead hook (can modify response)
    if (!options.skipHooks) {
      const modifiedVCon = await this.context.pluginManager.executeHook<VCon>(
        'afterRead', vcon, requestContext
      );
      if (modifiedVCon) {
        return modifiedVCon;
      }
    }

    return vcon;
  }

  /**
   * Delete a vCon by UUID with hook support
   * 
   * @returns true if deleted, false if not found
   */
  async delete(uuid: string, options: DeleteVConOptions = {}): Promise<boolean> {
    const source = options.source || 'unknown';
    const requestContext = this.normalizeRequestContext(options.requestContext, 'delete');

    // Check if vCon exists
    try {
      await this.context.queries.getVCon(uuid);
    } catch {
      return false; // Not found
    }

    // Execute beforeDelete hook (can throw to prevent)
    if (!options.skipHooks) {
      await this.context.pluginManager.executeHook('beforeDelete', uuid, requestContext);
    }

    // Delete from database
    await this.context.queries.deleteVCon(uuid);

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
    filters: Parameters<VConQueries['searchVCons']>[0],
    options: { requestContext?: Partial<RequestContext>; skipHooks?: boolean } = {}
  ): Promise<VCon[]> {
    const requestContext = this.normalizeRequestContext(options.requestContext, 'search');

    // Execute beforeSearch hook (can modify criteria)
    let searchFilters = filters;
    if (!options.skipHooks) {
      const modifiedFilters = await this.context.pluginManager.executeHook<typeof filters>(
        'beforeSearch', filters, requestContext
      );
      if (modifiedFilters) {
        searchFilters = modifiedFilters;
      }
    }

    const results = await this.context.queries.searchVCons(searchFilters);

    // Execute afterSearch hook (can filter results)
    if (!options.skipHooks) {
      const modifiedResults = await this.context.pluginManager.executeHook<VCon[]>(
        'afterSearch', results, requestContext
      );
      if (modifiedResults) {
        return modifiedResults;
      }
    }

    return results;
  }

  // ========== Private Helpers ==========

  /**
   * Normalize vCon data with defaults
   */
  private normalizeVCon(data: Partial<VCon>): VCon {
    return {
      vcon: data.vcon || '0.3.0',
      uuid: data.uuid || randomUUID(),
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at,
      subject: data.subject,
      parties: data.parties || [],
      dialog: data.dialog,
      analysis: data.analysis,
      attachments: data.attachments,
      group: data.group,
      extensions: data.extensions,
      must_support: data.must_support,
      redacted: data.redacted,
      appended: data.appended,
    };
  }
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

export class VConNotFoundError extends Error {
  constructor(uuid: string) {
    super(`vCon with UUID ${uuid} not found`);
    this.name = 'VConNotFoundError';
  }
}

