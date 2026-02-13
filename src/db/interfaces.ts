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
}
