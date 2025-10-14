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
import { VCon, Analysis, Dialog, Party, Attachment } from '../types/vcon.js';

export class VConQueries {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create a new vCon with all related entities
   * ✅ Uses corrected field names throughout
   */
  async createVCon(vcon: VCon): Promise<{ uuid: string; id: string }> {
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

    if (vconError) throw vconError;

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

    return { uuid: vconData.uuid, id: vconData.id };
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
    const { data, error } = await this.supabase.rpc('search_vcons_keyword', {
      query_text: params.query,
      start_date: params.startDate ?? null,
      end_date: params.endDate ?? null,
      tag_filter: params.tags ?? {},
      max_results: params.limit ?? 50,
    });
    if (error) throw error;
    return data as any;
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
    const { data, error } = await this.supabase.rpc('search_vcons_semantic', {
      query_embedding: params.embedding,
      tag_filter: params.tags ?? {},
      match_threshold: params.threshold ?? 0.7,
      match_count: params.limit ?? 50,
    });
    if (error) throw error;
    return data as any;
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
    const { data, error } = await this.supabase.rpc('search_vcons_hybrid', {
      keyword_query: params.keywordQuery ?? null,
      query_embedding: params.embedding ?? null,
      tag_filter: params.tags ?? {},
      semantic_weight: params.semanticWeight ?? 0.6,
      limit_results: params.limit ?? 50,
    });
    if (error) throw error;
    return data as any;
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
   * Get a complete vCon by UUID
   * ✅ Returns all fields with correct names
   */
  async getVCon(uuid: string): Promise<VCon> {
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

    return vcon;
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

    const { data, error } = await query;
    if (error) throw error;

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

    // Fetch full vCons
    return Promise.all(
      vconUuids.map(uuid => this.getVCon(uuid))
    );
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
  }
}

