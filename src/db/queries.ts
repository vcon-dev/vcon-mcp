/**
 * Database Queries for vCon Operations
 * 
 * ⚠️ CRITICAL: Uses corrected field names per IETF spec
 * - analysis.schema (NOT schema_version)
 * - analysis.vendor (REQUIRED)
 * - analysis.body (TEXT type)
 * - parties.uuid (added field)
 * - dialog.session_id, application, message_id (added fields)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import Redis from 'ioredis';
import { VCon, Analysis, Dialog, Party, Attachment } from '../types/vcon.js';
import { withSpan, recordCounter, recordHistogram, logWithContext } from '../observability/instrumentation.js';
import { ATTR_VCON_UUID, ATTR_DB_OPERATION, ATTR_CACHE_HIT, ATTR_SEARCH_TYPE, ATTR_SEARCH_RESULTS_COUNT, ATTR_SEARCH_THRESHOLD } from '../observability/attributes.js';

export class VConQueries {
  private redis: Redis | null = null;
  private cacheEnabled: boolean = false;
  private cacheTTL: number = 3600; // Default 1 hour

  constructor(
    private supabase: SupabaseClient,
    redis?: Redis | null
  ) {
    if (redis) {
      this.redis = redis;
      this.cacheEnabled = true;
      // Get TTL from environment or use default
      this.cacheTTL = parseInt(process.env.VCON_REDIS_EXPIRY || '3600', 10);
      logWithContext('info', 'Cache layer enabled', {
        cache_ttl: this.cacheTTL,
      });
    } else {
      logWithContext('info', 'Cache layer disabled', {
        reason: 'Redis not configured',
      });
    }
  }

  /**
   * Create a new vCon with all related entities
   * ✅ Uses corrected field names throughout
   */
  async createVCon(vcon: VCon): Promise<{ uuid: string; id: string }> {
    return withSpan('db.createVCon', async (span) => {
      span.setAttributes({
        [ATTR_VCON_UUID]: vcon.uuid,
        [ATTR_DB_OPERATION]: 'insert',
      });
      
      recordCounter('db.query.count', 1, {
        operation: 'createVCon',
      }, 'Database query count');
      
      // Insert main vcon
      const { data: vconData, error: vconError } = await this.supabase
        .from('vcons')
        .insert({
          uuid: vcon.uuid,
          vcon_version: vcon.vcon,
          subject: vcon.subject,
          created_at: vcon.created_at,
          updated_at: vcon.updated_at,
          extensions: vcon.extensions,          // ✅ Added per spec
          must_support: vcon.must_support,      // ✅ Added per spec
          redacted: vcon.redacted || {},
          appended: vcon.appended || {},        // ✅ Added per spec
        })
        .select('id, uuid')
        .single();

      if (vconError) {
        recordCounter('db.query.errors', 1, {
          operation: 'createVCon',
          error_type: vconError.code || 'unknown',
        }, 'Database query errors');
        throw vconError;
      }

    // Insert parties
    if (vcon.parties.length > 0) {
      const partiesData = vcon.parties.map((party, index) => ({
        vcon_id: vconData.id,
        party_index: index,
        tel: party.tel,
        sip: party.sip,
        stir: party.stir,
        mailto: party.mailto,
        name: party.name,
        did: party.did,                       // ✅ Added per spec
        uuid: party.uuid,                     // ✅ Added per spec Section 4.2.12
        validation: party.validation,
        jcard: party.jcard,
        gmlpos: party.gmlpos,
        civicaddress: party.civicaddress,
        timezone: party.timezone,
      }));

      const { error: partiesError } = await this.supabase
        .from('parties')
        .insert(partiesData);

      if (partiesError) throw partiesError;
    }

    // Insert dialog if present
    if (vcon.dialog && vcon.dialog.length > 0) {
      for (let i = 0; i < vcon.dialog.length; i++) {
        await this.addDialog(vconData.uuid, vcon.dialog[i]);
      }
    }

    // Insert analysis if present
    if (vcon.analysis && vcon.analysis.length > 0) {
      for (let i = 0; i < vcon.analysis.length; i++) {
        await this.addAnalysis(vconData.uuid, vcon.analysis[i]);
      }
    }

      // Insert attachments if present
      if (vcon.attachments && vcon.attachments.length > 0) {
        for (let i = 0; i < vcon.attachments.length; i++) {
          await this.addAttachment(vconData.uuid, vcon.attachments[i]);
        }
      }

      // Invalidate cache after creation
      if (this.cacheEnabled && this.redis) {
        await this.redis.del(`vcon:${vconData.uuid}`);
      }

      return { uuid: vconData.uuid, id: vconData.id };
    });
  }

  /**
   * Keyword search via RPC `search_vcons_keyword` with optional tag filters and date range.
   */
  async keywordSearch(params: {
    query: string;
    startDate?: string;
    endDate?: string;
    tags?: Record<string, string>;
    limit?: number;
  }): Promise<Array<{
    vcon_id: string;
    doc_type: string;
    ref_index: number | null;
    rank: number;
    snippet: string | null;
  }>> {
    return withSpan('db.keywordSearch', async (span) => {
      span.setAttributes({
        [ATTR_SEARCH_TYPE]: 'keyword',
        [ATTR_DB_OPERATION]: 'search',
      });
      
      recordCounter('db.query.count', 1, {
        operation: 'keywordSearch',
      }, 'Database query count');
      
      const { data, error } = await this.supabase.rpc('search_vcons_keyword', {
        query_text: params.query,
        start_date: params.startDate ?? null,
        end_date: params.endDate ?? null,
        tag_filter: params.tags ?? {},
        max_results: params.limit ?? 50,
      });
      
      if (error) {
        recordCounter('db.query.errors', 1, {
          operation: 'keywordSearch',
          error_type: error.code || 'unknown',
        }, 'Database query errors');
        throw error;
      }
      
      const results = data as any;
      span.setAttributes({
        [ATTR_SEARCH_RESULTS_COUNT]: results?.length || 0,
      });
      
      return results;
    });
  }

  /**
   * Get count of distinct vCons matching keyword search criteria
   * 
   * NOTE: This method has a limitation - it fetches results and counts distinct vcon_ids,
   * which means it's still subject to Supabase's 1000 row limit. For accurate counts
   * exceeding 1000, a database RPC function that returns count directly would be needed.
   * 
   * @param params - Search parameters
   * @returns Count of distinct vCons matching the search
   */
  async keywordSearchCount(params: {
    query: string;
    startDate?: string;
    endDate?: string;
    tags?: Record<string, string>;
  }): Promise<number> {
    // Use a large limit to get as many results as possible (still capped at 1000 by Supabase)
    // Then count distinct vcon_ids
    const results = await this.keywordSearch({
      ...params,
      limit: 1000, // Maximum allowed by Supabase
    });
    
    // Count distinct vcon_ids (since one vcon can match multiple times)
    const distinctVconIds = new Set(results.map(r => r.vcon_id));
    return distinctVconIds.size;
  }

  /**
   * Semantic search via RPC `search_vcons_semantic`.
   * Pass a precomputed embedding vector to avoid coupling to an embedding provider here.
   */
  async semanticSearch(params: {
    embedding: number[]; // vector(384)
    tags?: Record<string, string>;
    threshold?: number;
    limit?: number;
  }): Promise<Array<{
    vcon_id: string;
    content_type: string;
    content_reference: string | null;
    content_text: string;
    similarity: number;
  }>> {
    return withSpan('db.semanticSearch', async (span) => {
      span.setAttributes({
        [ATTR_SEARCH_TYPE]: 'semantic',
        [ATTR_DB_OPERATION]: 'search',
        [ATTR_SEARCH_THRESHOLD]: params.threshold || 0.7,
      });
      
      recordCounter('db.query.count', 1, {
        operation: 'semanticSearch',
      }, 'Database query count');
      
      const { data, error } = await this.supabase.rpc('search_vcons_semantic', {
        query_embedding: params.embedding,
        tag_filter: params.tags ?? {},
        match_threshold: params.threshold ?? 0.7,
        match_count: params.limit ?? 50,
      });
      
      if (error) {
        recordCounter('db.query.errors', 1, {
          operation: 'semanticSearch',
          error_type: error.code || 'unknown',
        }, 'Database query errors');
        throw error;
      }
      
      const results = data as any;
      span.setAttributes({
        [ATTR_SEARCH_RESULTS_COUNT]: results?.length || 0,
      });
      
      return results;
    });
  }

  /**
   * Hybrid search via RPC `search_vcons_hybrid`.
   * Provide either or both keyword_query and embedding.
   */
  async hybridSearch(params: {
    keywordQuery?: string;
    embedding?: number[];
    tags?: Record<string, string>;
    semanticWeight?: number; // 0..1
    limit?: number;
  }): Promise<Array<{
    vcon_id: string;
    combined_score: number;
    semantic_score: number;
    keyword_score: number;
  }>> {
    return withSpan('db.hybridSearch', async (span) => {
      span.setAttributes({
        [ATTR_SEARCH_TYPE]: 'hybrid',
        [ATTR_DB_OPERATION]: 'search',
        'search.semantic_weight': params.semanticWeight || 0.6,
      });
      
      recordCounter('db.query.count', 1, {
        operation: 'hybridSearch',
      }, 'Database query count');
      
      const { data, error } = await this.supabase.rpc('search_vcons_hybrid', {
        keyword_query: params.keywordQuery ?? null,
        query_embedding: params.embedding ?? null,
        tag_filter: params.tags ?? {},
        semantic_weight: params.semanticWeight ?? 0.6,
        limit_results: params.limit ?? 50,
      });
      
      if (error) {
        recordCounter('db.query.errors', 1, {
          operation: 'hybridSearch',
          error_type: error.code || 'unknown',
        }, 'Database query errors');
        throw error;
      }
      
      const results = data as any;
      span.setAttributes({
        [ATTR_SEARCH_RESULTS_COUNT]: results?.length || 0,
      });
      
      return results;
    });
  }

  /**
   * Add analysis to a vCon
   * ✅ CRITICAL: Uses 'schema' field, NOT 'schema_version'
   * ✅ CRITICAL: 'vendor' is required (NOT NULL)
   * ✅ CRITICAL: 'body' is TEXT type
   */
  async addAnalysis(vconUuid: string, analysis: Analysis): Promise<void> {
    // Get vcon_id
    const { data: vcon, error: vconError } = await this.supabase
      .from('vcons')
      .select('id')
      .eq('uuid', vconUuid)
      .single();

    if (vconError) throw vconError;

    // Get next analysis index
    const { data: existingAnalysis } = await this.supabase
      .from('analysis')
      .select('analysis_index')
      .eq('vcon_id', vcon.id)
      .order('analysis_index', { ascending: false })
      .limit(1);

    const nextIndex = existingAnalysis && existingAnalysis.length > 0 
      ? existingAnalysis[0].analysis_index + 1 
      : 0;

    // ✅ CRITICAL CORRECTIONS:
    // - Uses 'schema' field (NOT 'schema_version')
    // - 'vendor' is required and provided
    // - 'body' is TEXT type (can store any string format)
    const { error: analysisError } = await this.supabase
      .from('analysis')
      .insert({
        vcon_id: vcon.id,
        analysis_index: nextIndex,
        type: analysis.type,
        dialog_indices: Array.isArray(analysis.dialog) 
          ? analysis.dialog 
          : (analysis.dialog !== undefined ? [analysis.dialog] : null),
        mediatype: analysis.mediatype,
        filename: analysis.filename,
        vendor: analysis.vendor,              // ✅ REQUIRED field
        product: analysis.product,
        schema: analysis.schema,              // ✅ CORRECT: 'schema' NOT 'schema_version'
        body: analysis.body,                  // ✅ CORRECT: TEXT type, supports all formats
        encoding: analysis.encoding,
        url: analysis.url,
        content_hash: analysis.content_hash,
      });

    if (analysisError) throw analysisError;
  }

  /**
   * Add dialog to a vCon
   * ✅ Includes new fields: session_id, application, message_id
   */
  async addDialog(vconUuid: string, dialog: Dialog): Promise<void> {
    const { data: vcon, error: vconError } = await this.supabase
      .from('vcons')
      .select('id')
      .eq('uuid', vconUuid)
      .single();

    if (vconError) throw vconError;

    // Get next dialog index
    const { data: existingDialog } = await this.supabase
      .from('dialog')
      .select('dialog_index')
      .eq('vcon_id', vcon.id)
      .order('dialog_index', { ascending: false })
      .limit(1);

    const nextIndex = existingDialog && existingDialog.length > 0 
      ? existingDialog[0].dialog_index + 1 
      : 0;

    // Normalize parties array
    let parties = null;
    if (dialog.parties !== undefined) {
      if (Array.isArray(dialog.parties)) {
        parties = dialog.parties;
      } else {
        parties = [dialog.parties];
      }
    }

    const { data: dialogData, error: dialogError } = await this.supabase
      .from('dialog')
      .insert({
        vcon_id: vcon.id,
        dialog_index: nextIndex,
        type: dialog.type,
        start_time: dialog.start,
        duration_seconds: dialog.duration,
        parties: parties,
        originator: dialog.originator,
        mediatype: dialog.mediatype,
        filename: dialog.filename,
        body: dialog.body,
        encoding: dialog.encoding,
        url: dialog.url,
        content_hash: dialog.content_hash,
        disposition: dialog.disposition,
        session_id: dialog.session_id,        // ✅ Added per spec Section 4.3.10
        application: dialog.application,      // ✅ Added per spec Section 4.3.13
        message_id: dialog.message_id,        // ✅ Added per spec Section 4.3.14
      })
      .select('id')
      .single();

    if (dialogError) throw dialogError;

    // Handle party_history if present
    if (dialog.party_history && dialog.party_history.length > 0 && dialogData) {
      const historyData = dialog.party_history.map(h => ({
        dialog_id: dialogData.id,
        party_index: h.party,
        time: h.time,
        event: h.event,
      }));

      await this.supabase
        .from('party_history')
        .insert(historyData);
    }
  }

  /**
   * Add attachment to a vCon
   * ✅ Includes dialog field per spec Section 4.4.4
   */
  async addAttachment(vconUuid: string, attachment: Attachment): Promise<void> {
    const { data: vcon, error: vconError } = await this.supabase
      .from('vcons')
      .select('id')
      .eq('uuid', vconUuid)
      .single();

    if (vconError) throw vconError;

    // Get next attachment index
    const { data: existingAttachments } = await this.supabase
      .from('attachments')
      .select('attachment_index')
      .eq('vcon_id', vcon.id)
      .order('attachment_index', { ascending: false })
      .limit(1);

    const nextIndex = existingAttachments && existingAttachments.length > 0 
      ? existingAttachments[0].attachment_index + 1 
      : 0;

    const { error: attachmentError } = await this.supabase
      .from('attachments')
      .insert({
        vcon_id: vcon.id,
        attachment_index: nextIndex,
        type: attachment.type,
        start_time: attachment.start,
        party: attachment.party,
        dialog: attachment.dialog,            // ✅ Added per spec Section 4.4.4
        mimetype: attachment.mediatype,
        filename: attachment.filename,
        body: attachment.body,
        encoding: attachment.encoding,
        url: attachment.url,
        content_hash: attachment.content_hash,
      });

    if (attachmentError) throw attachmentError;
  }

  /**
   * Cache helper: Get vCon from Redis cache
   * @private
   */
  private async getCachedVCon(uuid: string): Promise<VCon | null> {
    if (!this.cacheEnabled || !this.redis) return null;

    try {
      const cached = await this.redis.get(`vcon:${uuid}`);
      if (cached) {
        console.error(`✅ Cache HIT for vCon ${uuid}`);
        return JSON.parse(cached) as VCon;
      }
      console.error(`ℹ️  Cache MISS for vCon ${uuid}`);
      return null;
    } catch (error) {
      console.error(`⚠️  Cache read error for ${uuid}:`, error);
      return null; // Fall through to database
    }
  }

  /**
   * Cache helper: Store vCon in Redis cache
   * @private
   */
  private async setCachedVCon(uuid: string, vcon: VCon): Promise<void> {
    if (!this.cacheEnabled || !this.redis) return;

    try {
      await this.redis.setex(
        `vcon:${uuid}`,
        this.cacheTTL,
        JSON.stringify(vcon)
      );
      console.error(`✅ Cached vCon ${uuid} (TTL: ${this.cacheTTL}s)`);
    } catch (error) {
      console.error(`⚠️  Cache write error for ${uuid}:`, error);
      // Non-fatal: continue without caching
    }
  }

  /**
   * Cache helper: Invalidate cached vCon
   * @private
   */
  private async invalidateCachedVCon(uuid: string): Promise<void> {
    if (!this.cacheEnabled || !this.redis) return;

    try {
      await this.redis.del(`vcon:${uuid}`);
      console.error(`✅ Invalidated cache for vCon ${uuid}`);
    } catch (error) {
      console.error(`⚠️  Cache invalidation error for ${uuid}:`, error);
    }
  }

  /**
   * Get a complete vCon by UUID (cache-first strategy)
   * ✅ Returns all fields with correct names
   * ✅ Checks Redis cache first, falls back to Supabase
   */
  async getVCon(uuid: string): Promise<VCon> {
    return withSpan('db.getVCon', async (span) => {
      span.setAttributes({
        [ATTR_VCON_UUID]: uuid,
        [ATTR_DB_OPERATION]: 'select',
      });
      
      // Try cache first
      const cached = await this.getCachedVCon(uuid);
      if (cached) {
        recordCounter('cache.hit', 1, { operation: 'getVCon' }, 'Cache hits');
        span.setAttributes({ [ATTR_CACHE_HIT]: true });
        return cached;
      }

      // Cache miss
      recordCounter('cache.miss', 1, { operation: 'getVCon' }, 'Cache misses');
      span.setAttributes({ [ATTR_CACHE_HIT]: false });
      
      recordCounter('db.query.count', 1, {
        operation: 'getVCon',
      }, 'Database query count');

      // Cache miss - fetch from Supabase
    // Get main vcon
    const { data: vconData, error: vconError } = await this.supabase
      .from('vcons')
      .select('*')
      .eq('uuid', uuid)
      .single();

    if (vconError) throw vconError;

    // Get parties
    const { data: parties } = await this.supabase
      .from('parties')
      .select('*')
      .eq('vcon_id', vconData.id)
      .order('party_index');

    // Get dialog
    const { data: dialogs } = await this.supabase
      .from('dialog')
      .select('*')
      .eq('vcon_id', vconData.id)
      .order('dialog_index');

    // Get analysis - ✅ Queries 'schema' field (NOT 'schema_version')
    const { data: analysis } = await this.supabase
      .from('analysis')
      .select('*')
      .eq('vcon_id', vconData.id)
      .order('analysis_index');

    // Get attachments
    const { data: attachments } = await this.supabase
      .from('attachments')
      .select('*')
      .eq('vcon_id', vconData.id)
      .order('attachment_index');

    // Reconstruct vCon with all correct field names
    const vcon: VCon = {
      vcon: vconData.vcon_version as '0.3.0',
      uuid: vconData.uuid,
      extensions: vconData.extensions,
      must_support: vconData.must_support,
      created_at: vconData.created_at,
      updated_at: vconData.updated_at,
      subject: vconData.subject,
      parties: parties?.map(p => ({
        tel: p.tel,
        sip: p.sip,
        stir: p.stir,
        mailto: p.mailto,
        name: p.name,
        did: p.did,
        uuid: p.uuid,                         // ✅ Correct field
        validation: p.validation,
        jcard: p.jcard,
        gmlpos: p.gmlpos,
        civicaddress: p.civicaddress,
        timezone: p.timezone,
      })) || [],
      dialog: dialogs?.map(d => ({
        type: d.type,
        start: d.start_time,
        duration: d.duration_seconds,
        parties: d.parties,
        originator: d.originator,
        mediatype: d.mediatype,
        filename: d.filename,
        body: d.body,
        encoding: d.encoding,
        url: d.url,
        content_hash: d.content_hash,
        disposition: d.disposition,
        session_id: d.session_id,             // ✅ Correct field
        application: d.application,           // ✅ Correct field
        message_id: d.message_id,             // ✅ Correct field
      })),
      analysis: analysis?.map(a => ({
        type: a.type,
        dialog: a.dialog_indices?.length === 1 ? a.dialog_indices[0] : a.dialog_indices,
        mediatype: a.mediatype,
        filename: a.filename,
        vendor: a.vendor,                     // ✅ Required field
        product: a.product,
        schema: a.schema,                     // ✅ CORRECT: 'schema' NOT 'schema_version'
        body: a.body,                         // ✅ TEXT type
        encoding: a.encoding,
        url: a.url,
        content_hash: a.content_hash,
      })),
      attachments: attachments?.map(att => ({
        type: att.type,
        start: att.start_time,
        party: att.party,
        dialog: att.dialog,                   // ✅ Correct field
        mediatype: att.mimetype,
        filename: att.filename,
        body: att.body,
        encoding: att.encoding,
        url: att.url,
        content_hash: att.content_hash,
      })),
    };

      // Cache the result for future reads
      await this.setCachedVCon(uuid, vcon);

      return vcon;
    });
  }

  /**
   * Search vCons by various criteria
   */
  async searchVCons(filters: {
    subject?: string;
    partyName?: string;
    partyEmail?: string;
    partyTel?: string;
    startDate?: string;
    endDate?: string;
    tags?: Record<string, string>;
    limit?: number;
  }): Promise<VCon[]> {
    let query = this.supabase
      .from('vcons')
      .select('uuid');

    if (filters.subject) {
      query = query.ilike('subject', `%${filters.subject}%`);
    }

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    query = query.order('created_at', { ascending: false });

    let data, error;
    try {
      const result = await query;
      data = result.data;
      error = result.error;
    } catch (fetchError: any) {
      // Handle network/connection errors
      if (fetchError instanceof TypeError && fetchError.message.includes('fetch failed')) {
        throw new Error(
          `Database connection failed: Unable to reach Supabase. ` +
          `Check your network connection and SUPABASE_URL configuration. ` +
          `Original error: ${fetchError.message}`
        );
      }
      throw fetchError;
    }
    
    if (error) throw error;
    if (!data) {
      // This shouldn't happen if error is null, but TypeScript needs this check
      return [];
    }

    // If party filters, need to join with parties table
    let vconUuids = data.map(v => v.uuid);

    if (filters.partyName || filters.partyEmail || filters.partyTel) {
      let partyQuery = this.supabase
        .from('parties')
        .select('vcon_id');

      if (filters.partyName) {
        partyQuery = partyQuery.ilike('name', `%${filters.partyName}%`);
      }
      if (filters.partyEmail) {
        partyQuery = partyQuery.ilike('mailto', `%${filters.partyEmail}%`);
      }
      if (filters.partyTel) {
        partyQuery = partyQuery.ilike('tel', `%${filters.partyTel}%`);
      }

      const { data: partyData, error: partyError } = await partyQuery;
      if (partyError) throw partyError;

      const partyVconIds = new Set(partyData.map(p => p.vcon_id));
      
      // Get UUIDs for matching vcon_ids
      const { data: matchingVcons } = await this.supabase
        .from('vcons')
        .select('uuid, id')
        .in('id', Array.from(partyVconIds));

      vconUuids = vconUuids.filter(uuid => 
        matchingVcons?.some(v => v.uuid === uuid)
      );
    }

    // If tag filters, get matching UUIDs and intersect with current results
    if (filters.tags && Object.keys(filters.tags).length > 0) {
      const tagMatchingUuids = await this.searchByTags(filters.tags, filters.limit || 1000);
      const tagMatchingSet = new Set(tagMatchingUuids);
      vconUuids = vconUuids.filter(uuid => tagMatchingSet.has(uuid));
    }

    // Fetch full vCons
    return Promise.all(
      vconUuids.map(uuid => this.getVCon(uuid))
    );
  }

  /**
   * Get count of vCons matching search criteria (without fetching all data)
   * This bypasses Supabase's 1000 row default limit by using count query
   */
  async searchVConsCount(filters: {
    subject?: string;
    partyName?: string;
    partyEmail?: string;
    partyTel?: string;
    startDate?: string;
    endDate?: string;
    tags?: Record<string, string>;
  }): Promise<number> {
    // Build the same query as searchVCons but just get count
    let query = this.supabase
      .from('vcons')
      .select('*', { count: 'exact', head: true });

    if (filters.subject) {
      query = query.ilike('subject', `%${filters.subject}%`);
    }

    if (filters.startDate) {
      query = query.gte('created_at', filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte('created_at', filters.endDate);
    }

    // If party filters, we need to count vCons that match party criteria
    // This is more complex - we'll need to do a subquery or join
    if (filters.partyName || filters.partyEmail || filters.partyTel) {
      // For party filters, we need to count distinct vcons that match party criteria
      // Use a separate query to get matching vcon_ids, then count
      let partyQuery = this.supabase
        .from('parties')
        .select('vcon_id');

      if (filters.partyName) {
        partyQuery = partyQuery.ilike('name', `%${filters.partyName}%`);
      }
      if (filters.partyEmail) {
        partyQuery = partyQuery.ilike('mailto', `%${filters.partyEmail}%`);
      }
      if (filters.partyTel) {
        partyQuery = partyQuery.ilike('tel', `%${filters.partyTel}%`);
      }

      const { data: partyData, error: partyError } = await partyQuery;
      if (partyError) throw partyError;

      if (!partyData || partyData.length === 0) {
        return 0;
      }

      const partyVconIds = new Set(partyData.map(p => p.vcon_id));
      
      // Apply date/subject filters and count only matching vcons
      let vconQuery = this.supabase
        .from('vcons')
        .select('id', { count: 'exact', head: true })
        .in('id', Array.from(partyVconIds));

      if (filters.subject) {
        vconQuery = vconQuery.ilike('subject', `%${filters.subject}%`);
      }
      if (filters.startDate) {
        vconQuery = vconQuery.gte('created_at', filters.startDate);
      }
      if (filters.endDate) {
        vconQuery = vconQuery.lte('created_at', filters.endDate);
      }

      const { count, error: countError } = await vconQuery;
      if (countError) throw countError;
      
      // If tag filters, intersect with tag matching UUIDs
      if (filters.tags && Object.keys(filters.tags).length > 0) {
        const tagMatchingUuids = await this.searchByTags(filters.tags, 10000);
        const tagMatchingSet = new Set(tagMatchingUuids);
        
        // Get UUIDs for the party-filtered vcons and count intersection
        const { data: vconData } = await this.supabase
          .from('vcons')
          .select('uuid')
          .in('id', Array.from(partyVconIds));
        
        const matchingUuids = vconData?.filter(v => tagMatchingSet.has(v.uuid)).map(v => v.uuid) || [];
        return matchingUuids.length;
      }
      
      return count || 0;
    }

    // If tag filters but no party filters, get tag matching UUIDs and count intersection
    if (filters.tags && Object.keys(filters.tags).length > 0) {
      const tagMatchingUuids = await this.searchByTags(filters.tags, 10000);
      const tagMatchingSet = new Set(tagMatchingUuids);
      
      // Get all UUIDs from the base query (with subject/date filters)
      const { data: vconData } = await query.select('uuid');
      if (!vconData) return 0;
      
      const matchingUuids = vconData.filter(v => tagMatchingSet.has(v.uuid));
      return matchingUuids.length;
    }

    // For non-party, non-tag filters, use the simple count query
    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  }

  /**
   * Delete a vCon and all related entities
   */
  async deleteVCon(uuid: string): Promise<void> {
    const { error } = await this.supabase
      .from('vcons')
      .delete()
      .eq('uuid', uuid);

    if (error) throw error;

    // Invalidate cache
    await this.invalidateCachedVCon(uuid);
  }

  /**
   * Update vCon metadata
   */
  async updateVCon(uuid: string, updates: Partial<VCon>): Promise<void> {
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (updates.subject !== undefined) updateData.subject = updates.subject;
    if (updates.extensions !== undefined) updateData.extensions = updates.extensions;
    if (updates.must_support !== undefined) updateData.must_support = updates.must_support;

    const { error } = await this.supabase
      .from('vcons')
      .update(updateData)
      .eq('uuid', uuid);

    if (error) throw error;

    // Invalidate cache since data changed
    await this.invalidateCachedVCon(uuid);
  }

  // ============================================================================
  // Tag Management Methods
  // ============================================================================

  /**
   * Get all tags from a vCon as a key-value object
   */
  async getTags(vconUuid: string): Promise<Record<string, string>> {
    // Get vcon_id
    const { data: vcon, error: vconError } = await this.supabase
      .from('vcons')
      .select('id')
      .eq('uuid', vconUuid)
      .single();

    if (vconError) throw vconError;

    // Get tags attachment with encoding='json' (since body is JSON.stringify'd)
    const { data: attachments, error: attachmentError } = await this.supabase
      .from('attachments')
      .select('body')
      .eq('vcon_id', vcon.id)
      .eq('type', 'tags')
      .eq('encoding', 'json');

    if (attachmentError) throw attachmentError;

    if (!attachments || attachments.length === 0) {
      return {};
    }

    // Parse tags from body (array of "key:value" strings)
    const tagsArray = JSON.parse(attachments[0].body || '[]');
    const tagsObject: Record<string, string> = {};
    
    for (const tagString of tagsArray) {
      const colonIndex = tagString.indexOf(':');
      if (colonIndex > 0) {
        const key = tagString.substring(0, colonIndex);
        const value = tagString.substring(colonIndex + 1);
        tagsObject[key] = value;
      }
    }

    return tagsObject;
  }

  /**
   * Get a specific tag value
   */
  async getTag(vconUuid: string, key: string, defaultValue: any = null): Promise<any> {
    const tags = await this.getTags(vconUuid);
    return tags[key] !== undefined ? tags[key] : defaultValue;
  }

  /**
   * Add or update a single tag
   */
  async addTag(vconUuid: string, key: string, value: string | number | boolean, overwrite: boolean = true): Promise<void> {
    // Convert value to string
    const valueStr = String(value);

    // Get current tags
    const currentTags = await this.getTags(vconUuid);

    // Check if tag exists and overwrite is false
    if (currentTags[key] !== undefined && !overwrite) {
      throw new Error(`Tag '${key}' already exists. Set overwrite=true to update.`);
    }

    // Update tags
    currentTags[key] = valueStr;

    // Save tags
    await this.saveTags(vconUuid, currentTags);
  }

  /**
   * Remove a specific tag
   */
  async removeTag(vconUuid: string, key: string): Promise<void> {
    const currentTags = await this.getTags(vconUuid);
    
    if (currentTags[key] === undefined) {
      return; // Tag doesn't exist, nothing to do
    }

    delete currentTags[key];
    await this.saveTags(vconUuid, currentTags);
  }

  /**
   * Update multiple tags at once
   */
  async updateTags(vconUuid: string, tags: Record<string, string | number | boolean>, merge: boolean = true): Promise<void> {
    let finalTags: Record<string, string>;

    if (merge) {
      // Merge with existing tags
      const currentTags = await this.getTags(vconUuid);
      finalTags = { ...currentTags };
      
      // Add/update new tags
      for (const [key, value] of Object.entries(tags)) {
        finalTags[key] = String(value);
      }
    } else {
      // Replace all tags
      finalTags = {};
      for (const [key, value] of Object.entries(tags)) {
        finalTags[key] = String(value);
      }
    }

    await this.saveTags(vconUuid, finalTags);
  }

  /**
   * Remove all tags from a vCon
   */
  async removeAllTags(vconUuid: string): Promise<void> {
    await this.saveTags(vconUuid, {});
  }

  /**
   * Search vCons by tags
   */
  async searchByTags(tags: Record<string, string>, limit: number = 50): Promise<string[]> {
    // Use the database RPC to search by tags
    const { data, error } = await this.supabase.rpc('search_vcons_by_tags', {
      tag_filter: tags,
      max_results: limit,
    });

    // Helper function for manual search fallback
    const performManualSearch = async (): Promise<string[]> => {
      // Get all vCons with tags attachments (use pagination to bypass Supabase's 1000 row default limit)
      // Note: We look for type='tags' regardless of encoding to handle legacy data
      
      // First, get the total count
      const { count, error: countError } = await this.supabase
        .from('attachments')
        .select('*', { count: 'exact', head: true })
        .eq('type', 'tags');

      if (countError) throw countError;

      // Fetch all attachments in batches (Supabase defaults to 1000 rows per query)
      // Stop early if we've found enough matches
      const batchSize = 1000;
      const totalBatches = Math.ceil((count || 0) / batchSize);
      const matchingVconIds = new Set<number>();

      for (let i = 0; i < totalBatches; i++) {
        // Stop fetching if we have enough matches
        if (matchingVconIds.size >= limit) {
          break;
        }

        const from = i * batchSize;
        const to = Math.min(from + batchSize - 1, (count || 0) - 1);
        
        const { data: batch, error: attachmentError } = await this.supabase
          .from('attachments')
          .select('vcon_id, body')
          .eq('type', 'tags')
          .range(from, to);

        if (attachmentError) throw attachmentError;

        // Process batch immediately to allow early exit
        for (const attachment of batch || []) {
          try {
            const tagsArray = JSON.parse(attachment.body || '[]');
            const tagsObject: Record<string, string> = {};
            
            for (const tagString of tagsArray) {
              if (typeof tagString !== 'string') continue;
              const colonIndex = tagString.indexOf(':');
              if (colonIndex > 0) {
                const key = tagString.substring(0, colonIndex);
                const value = tagString.substring(colonIndex + 1);
                tagsObject[key] = value;
              }
            }

            // Check if all requested tags match
            let allMatch = true;
            for (const [key, value] of Object.entries(tags)) {
              if (tagsObject[key] !== value) {
                allMatch = false;
                break;
              }
            }

            if (allMatch) {
              matchingVconIds.add(attachment.vcon_id);
              // Stop processing if we have enough matches
              if (matchingVconIds.size >= limit) {
                break;
              }
            }
          } catch (parseError) {
            // Skip attachments with invalid JSON
            continue;
          }
        }
      }

      // Get UUIDs for matching vcon_ids
      if (matchingVconIds.size === 0) {
        return [];
      }

      const { data: vcons, error: vconsError } = await this.supabase
        .from('vcons')
        .select('uuid')
        .in('id', Array.from(matchingVconIds))
        .limit(limit);

      if (vconsError) throw vconsError;

      return (vcons || []).map(v => v.uuid);
    };

    // If RPC doesn't exist or fails, use fallback
    if (error) {
      return performManualSearch();
    }

    // RPC succeeded but returned empty results
    // Check if materialized view might be stale by verifying tag attachments exist
    if (!data || data.length === 0) {
      // Quick check: if there are any tag attachments, the view might be stale
      const { count } = await this.supabase
        .from('attachments')
        .select('*', { count: 'exact', head: true })
        .eq('type', 'tags')
        .limit(1);

      // If tag attachments exist but RPC returned empty, view is likely stale - use fallback
      if (count && count > 0) {
        return performManualSearch();
      }
    }

    // RPC succeeded and returned results (or no tag attachments exist)
    return (data || []) as string[];
  }

  /**
   * Get unique tags across all vCons
   */
  async getUniqueTags(options?: {
    includeCounts?: boolean;
    keyFilter?: string;
    minCount?: number;
  }): Promise<{
    keys: string[];
    tagsByKey: Record<string, string[]>;
    countsPerValue?: Record<string, Record<string, number>>;
    totalVCons: number;
  }> {
    const includeCounts = options?.includeCounts ?? false;
    const keyFilter = options?.keyFilter?.toLowerCase();
    const minCount = options?.minCount ?? 1;

    // Get all tags attachments (use pagination to bypass Supabase's 1000 row default limit)
    // Note: We look for type='tags' regardless of encoding to handle legacy data
    // Tags should have encoding='json', but we're lenient to find tags that may have wrong encoding
    
    // First, get the total count
    const { count, error: countError } = await this.supabase
      .from('attachments')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'tags');

    if (countError) throw countError;

    // Fetch all attachments in batches (Supabase defaults to 1000 rows per query)
    const batchSize = 1000;
    const totalBatches = Math.ceil((count || 0) / batchSize);
    const attachments: any[] = [];

    for (let i = 0; i < totalBatches; i++) {
      const from = i * batchSize;
      const to = Math.min(from + batchSize - 1, (count || 0) - 1);
      
      const { data: batch, error } = await this.supabase
        .from('attachments')
        .select('vcon_id, body, encoding')
        .eq('type', 'tags')
        .range(from, to);

      if (error) throw error;
      if (batch) attachments.push(...batch);
    }

    const allTags: Record<string, Set<string>> = {};
    const tagCounts: Record<string, Record<string, number>> = {};
    const vconIds = new Set<number>();

    // Parse all tags
    let tagsWithWrongEncoding = 0;
    for (const attachment of attachments || []) {
      vconIds.add(attachment.vcon_id);
      
      // Warn if encoding is not 'json' (tags should have encoding='json')
      if (attachment.encoding !== 'json') {
        tagsWithWrongEncoding++;
        if (tagsWithWrongEncoding === 1) {
          // Only log once to avoid spam
          logWithContext('warn', 'Found tags attachments with incorrect encoding', {
            encoding: attachment.encoding || 'NULL',
            suggestion: 'Run migration script: npx tsx scripts/migrate-tags-encoding.ts'
          });
        }
      }
      
      try {
        const tagsArray = JSON.parse(attachment.body || '[]');
        
        if (!Array.isArray(tagsArray)) {
          logWithContext('warn', 'Tags attachment body is not an array', {
            vcon_id: attachment.vcon_id,
            encoding: attachment.encoding
          });
          continue;
        }
        
        for (const tagString of tagsArray) {
          if (typeof tagString !== 'string') {
            continue;
          }
          
          const colonIndex = tagString.indexOf(':');
          if (colonIndex > 0) {
            const key = tagString.substring(0, colonIndex);
            const value = tagString.substring(colonIndex + 1);

            // Apply key filter if provided
            if (keyFilter && !key.toLowerCase().includes(keyFilter)) {
              continue;
            }

            // Initialize structures
            if (!allTags[key]) {
              allTags[key] = new Set<string>();
            }
            if (includeCounts) {
              if (!tagCounts[key]) {
                tagCounts[key] = {};
              }
              tagCounts[key][value] = (tagCounts[key][value] || 0) + 1;
            }

            allTags[key].add(value);
          }
        }
      } catch (parseError) {
        logWithContext('error', 'Failed to parse tags attachment', {
          vcon_id: attachment.vcon_id,
          encoding: attachment.encoding,
          error: parseError instanceof Error ? parseError.message : String(parseError)
        });
        // Continue processing other attachments
      }
    }
    
    if (tagsWithWrongEncoding > 0) {
      logWithContext('info', `Processed ${tagsWithWrongEncoding} tags attachments with incorrect encoding`, {
        total_tags: attachments?.length || 0,
        wrong_encoding_count: tagsWithWrongEncoding
      });
    }

    // Convert sets to arrays and apply min count filter
    const tagsByKey: Record<string, string[]> = {};
    const filteredCounts: Record<string, Record<string, number>> = {};

    for (const [key, valuesSet] of Object.entries(allTags)) {
      const values: string[] = [];
      
      for (const value of valuesSet) {
        const count = tagCounts[key]?.[value] ?? 1;
        if (count >= minCount) {
          values.push(value);
          if (includeCounts && tagCounts[key]) {
            if (!filteredCounts[key]) {
              filteredCounts[key] = {};
            }
            filteredCounts[key][value] = count;
          }
        }
      }

      if (values.length > 0) {
        tagsByKey[key] = values.sort();
      }
    }

    const result: any = {
      keys: Object.keys(tagsByKey).sort(),
      tagsByKey,
      totalVCons: vconIds.size
    };

    if (includeCounts) {
      result.countsPerValue = filteredCounts;
    }

    return result;
  }

  /**
   * Internal helper to save tags to the database
   */
  private async saveTags(vconUuid: string, tags: Record<string, string>): Promise<void> {
    // Get vcon_id
    const { data: vcon, error: vconError } = await this.supabase
      .from('vcons')
      .select('id')
      .eq('uuid', vconUuid)
      .single();

    if (vconError) throw vconError;

    // Convert tags object to array of "key:value" strings
    const tagsArray = Object.entries(tags).map(([key, value]) => `${key}:${value}`);
    const tagsBody = JSON.stringify(tagsArray);

    // Check if tags attachment exists
    const { data: existingAttachments } = await this.supabase
      .from('attachments')
      .select('id')
      .eq('vcon_id', vcon.id)
      .eq('type', 'tags')
      .eq('encoding', 'json');

    if (existingAttachments && existingAttachments.length > 0) {
      // Update existing tags attachment
      const { error: updateError } = await this.supabase
        .from('attachments')
        .update({ body: tagsBody })
        .eq('id', existingAttachments[0].id);

      if (updateError) throw updateError;
    } else {
      // Create new tags attachment with encoding='json' (since body is JSON.stringify'd)
      const { data: nextIndexData } = await this.supabase
        .from('attachments')
        .select('attachment_index')
        .eq('vcon_id', vcon.id)
        .order('attachment_index', { ascending: false })
        .limit(1);

      const nextIndex = nextIndexData && nextIndexData.length > 0 
        ? nextIndexData[0].attachment_index + 1 
        : 0;

      const { error: insertError } = await this.supabase
        .from('attachments')
        .insert({
          vcon_id: vcon.id,
          attachment_index: nextIndex,
          type: 'tags',
          encoding: 'json',
          body: tagsBody,
        });

      if (insertError) throw insertError;
    }

    // Update the vCon's updated_at timestamp
    await this.supabase
      .from('vcons')
      .update({ updated_at: new Date().toISOString() })
      .eq('uuid', vconUuid);
  }
}

