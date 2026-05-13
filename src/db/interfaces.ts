/**
 * Interface for vCon Database Queries
 * 
 * Provides abstraction layer for database operations to support multiple backends
 * (Supabase/PostgreSQL and MongoDB)
 */

import { Analysis, Attachment, Dialog, VCon } from '../types/vcon.js';

export interface SearchResult {
    vcon_id: string;
    score: number;
    highlight?: string;
    // Fields for specific search types
    rank?: number;
    snippet?: string | null;
    combined_score?: number;
    semantic_score?: number;
    keyword_score?: number;
    content_type?: string;
    content_reference?: string | null;
    content_text?: string;
    similarity?: number;
}

export interface DistinctValuesResult {
    values: string[];
    countsPerValue?: Record<string, number>;
    totalVCons: number;
}

export interface IVConQueries {
    /**
     * Initialize the database connection and schema (e.g. indexes)
     */
    initialize(): Promise<void>;

    /**
     * Create a new vCon with all related entities
     */
    createVCon(vcon: VCon): Promise<{ uuid: string; id: string }>;

    /**
     * Get a complete vCon by UUID
     */
    getVCon(uuid: string): Promise<VCon>;

    /**
     * Add dialog to a vCon
     */
    addDialog(vconUuid: string, dialog: Dialog): Promise<void>;

    /**
     * Add analysis to a vCon
     */
    addAnalysis(vconUuid: string, analysis: Analysis): Promise<void>;

    /**
     * Delete a vCon by UUID
     */
    deleteVCon(uuid: string): Promise<void>;

    /**
     * Add attachment to a vCon
     */
    addAttachment(vconUuid: string, attachment: Attachment): Promise<void>;

    /**
     * Keyword search
     */
    keywordSearch(params: {
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
    }>>;

    /**
     * Get count of distinct vCons matching keyword search criteria
     */
    keywordSearchCount(params: {
        query: string;
        startDate?: string;
        endDate?: string;
        tags?: Record<string, string>;
    }): Promise<number>;

    /**
     * Semantic search (vector based)
     */
    semanticSearch(params: {
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
    }>>;

    /**
     * Hybrid search (keyword + semantic)
     */
    hybridSearch(params: {
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
    }>>;

    /**
     * Search vCons by metadata filters
     */
    searchVCons(filters: {
        subject?: string;
        partyName?: string;
        partyEmail?: string;
        partyTel?: string;
        startDate?: string;
        endDate?: string;
        tags?: Record<string, string>;
        /** Match strolid_dealer attachment id (string form, for example "1174"). */
        dealerId?: string;
        /** Case-insensitive substring match on strolid_dealer attachment name. */
        dealerName?: string;
        limit?: number;
    }): Promise<VCon[]>;

    /**
     * Get count of vCons matching metadata filters
     */
    searchVConsCount(filters: {
        subject?: string;
        partyName?: string;
        partyEmail?: string;
        partyTel?: string;
        startDate?: string;
        endDate?: string;
        tags?: Record<string, string>;
        dealerId?: string;
        dealerName?: string;
    }): Promise<number>;

    /**
     * Roll up vCons with strolid_dealer attachments by dealer id (Postgres RPC).
     */
    aggregateVconsByDealerStats(params: {
        tagFilter: Record<string, string>;
        startDate?: string;
        endDate?: string;
        minBaseline: number;
        limit: number;
    }): Promise<Array<{
        dealer_id: string;
        dealer_name: string | null;
        team_id: number | null;
        team_name: string | null;
        filtered_count: number;
        baseline_count: number;
    }>>;

    /**
     * Optional DB-backed coverage hints for taxonomy (best-effort; may omit on error).
     */
    getTaxonomyCoverageSnapshot(): Promise<{
        vcons_total: number | null;
        with_strolid_dealer_attachment_pct: number | null;
        with_dealer_name_tag_pct: number | null;
    }>;

    /**
     * Update vCon metadata (subject, extensions, must_support)
     */
    updateVCon(uuid: string, updates: Partial<VCon>): Promise<void>;

    // ── Tag Management ────────────────────────────────────────────────────────

    /**
     * Get all tags for a vCon as a key→value map
     */
    getTags(vconUuid: string): Promise<Record<string, string>>;

    /**
     * Get a single tag value (returns defaultValue if not found)
     */
    getTag(vconUuid: string, key: string, defaultValue?: any): Promise<any>;

    /**
     * Add or update a single tag
     */
    addTag(vconUuid: string, key: string, value: string | number | boolean, overwrite?: boolean): Promise<void>;

    /**
     * Remove a single tag by key
     */
    removeTag(vconUuid: string, key: string): Promise<void>;

    /**
     * Remove all tags from a vCon
     */
    removeAllTags(vconUuid: string): Promise<void>;

    /**
     * Search vCons that have all the given tags (returns UUIDs)
     */
    searchByTags(tags: Record<string, string>, limit?: number): Promise<string[]>;

    /**
     * Get all unique tag keys (and optionally values/counts) across the database
     */
    getUniqueTags(options?: {
        includeCounts?: boolean;
        keyFilter?: string;
        minCount?: number;
    }): Promise<{
        keys: string[];
        tagsByKey: Record<string, string[]>;
        countsPerValue?: Record<string, Record<string, number>>;
        totalVCons: number;
    }>;

    /**
     * Get all unique legacy attachment types (and optionally counts) across the database.
     * Prefer attachment purposes for spec-facing discovery.
     */
    getUniqueAttachmentTypes(options?: {
        includeCounts?: boolean;
        minCount?: number;
    }): Promise<DistinctValuesResult>;

    /**
     * Get all unique attachment purposes (and optionally counts) across the database.
     * This is the canonical spec-facing attachment classification surface.
     */
    getUniqueAttachmentPurposes(options?: {
        includeCounts?: boolean;
        minCount?: number;
    }): Promise<DistinctValuesResult>;

    /**
     * Get all unique analysis types (and optionally counts) across the database
     */
    getUniqueAnalysisTypes(options?: {
        includeCounts?: boolean;
        minCount?: number;
    }): Promise<DistinctValuesResult>;
}
