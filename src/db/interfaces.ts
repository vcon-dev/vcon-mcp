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
    }): Promise<number>;

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
}
