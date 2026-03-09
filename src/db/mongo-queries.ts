/**
 * MongoDB Implementation of VCon Queries
 */

import { Db, ObjectId } from 'mongodb';
import { Analysis, Attachment, Dialog, VCon } from '../types/vcon.js';
import { IVConQueries } from './interfaces.js';
import { logWithContext, recordCounter, withSpan } from '../observability/instrumentation.js';
import { ATTR_DB_OPERATION, ATTR_SEARCH_RESULTS_COUNT, ATTR_SEARCH_THRESHOLD, ATTR_SEARCH_TYPE, ATTR_VCON_UUID } from '../observability/attributes.js';

export class MongoVConQueries implements IVConQueries {
    private db: Db;
    private readonly VCONS_COLLECTION = 'vcons';

    constructor(db: Db) {
        this.db = db;
    }

    /**
     * Initialize collections and indexes
     */
    async initialize(): Promise<void> {
        const vcons = this.db.collection(this.VCONS_COLLECTION);

        // Unique index on UUID
        await vcons.createIndex({ uuid: 1 }, { unique: true });

        // Text index for keyword search
        await vcons.createIndex({
            subject: 'text',
            'analysis.body': 'text',
            'dialog.body': 'text',
            'parties.name': 'text',
            'parties.tel': 'text',
            'parties.mailto': 'text'
        }, {
            name: 'vcon_text_search'
        });

        // Indexes for sorting and filtering
        await vcons.createIndex({ created_at: -1 });
        await vcons.createIndex({ 'parties.tel': 1 });
        await vcons.createIndex({ 'parties.mailto': 1 });
    }

    /**
     * Create a new vCon
     */
    async createVCon(vcon: VCon): Promise<{ uuid: string; id: string }> {
        return withSpan('mongo.createVCon', async (span) => {
            span.setAttributes({
                [ATTR_VCON_UUID]: vcon.uuid,
                [ATTR_DB_OPERATION]: 'insert',
            });

            const collection = this.db.collection(this.VCONS_COLLECTION);

            // Check if exists
            const existing = await collection.findOne({ uuid: vcon.uuid });
            if (existing) {
                throw new Error(`vCon with UUID ${vcon.uuid} already exists`);
            }

            await collection.insertOne(vcon);

            recordCounter('db.query.count', 1, { operation: 'createVCon', type: 'mongo' });

            return { uuid: vcon.uuid, id: vcon.uuid };
        });
    }

    async deleteVCon(uuid: string): Promise<void> {
        return withSpan('mongo.deleteVCon', async (span) => {
            span.setAttributes({
                [ATTR_VCON_UUID]: uuid,
                [ATTR_DB_OPERATION]: 'delete',
            });

            const collection = this.db.collection(this.VCONS_COLLECTION);
            const result = await collection.deleteOne({ uuid });

            if (result.deletedCount === 0) {
                // Not found is considered success for idempotent delete, but service expects false if not found?
                // Actually service checks existence first.
            }
        });
    }

    async getVCon(uuid: string): Promise<VCon> {
        return withSpan('mongo.getVCon', async (span) => {
            span.setAttributes({
                [ATTR_VCON_UUID]: uuid,
                [ATTR_DB_OPERATION]: 'find',
            });

            const collection = this.db.collection(this.VCONS_COLLECTION);
            const vcon = await collection.findOne({ uuid });

            if (!vcon) {
                throw new Error(`vCon not found: ${uuid}`);
            }

            // Remove MongoDB internal _id
            const { _id, ...rest } = vcon;
            return rest as unknown as VCon;
        });
    }

    async addDialog(vconUuid: string, dialog: Dialog): Promise<void> {
        return withSpan('mongo.addDialog', async () => {
            const collection = this.db.collection(this.VCONS_COLLECTION);
            const result = await collection.updateOne(
                { uuid: vconUuid },
                { $push: { dialog: dialog } }
            );

            if (result.matchedCount === 0) {
                throw new Error(`vCon not found: ${vconUuid}`);
            }
        });
    }

    async addAnalysis(vconUuid: string, analysis: Analysis): Promise<void> {
        return withSpan('mongo.addAnalysis', async () => {
            const collection = this.db.collection(this.VCONS_COLLECTION);
            const result = await collection.updateOne(
                { uuid: vconUuid },
                { $push: { analysis: analysis } }
            );

            if (result.matchedCount === 0) {
                throw new Error(`vCon not found: ${vconUuid}`);
            }
        });
    }

    async addAttachment(vconUuid: string, attachment: Attachment): Promise<void> {
        return withSpan('mongo.addAttachment', async () => {
            const collection = this.db.collection(this.VCONS_COLLECTION);
            const result = await collection.updateOne(
                { uuid: vconUuid },
                { $push: { attachments: attachment } }
            );

            if (result.matchedCount === 0) {
                throw new Error(`vCon not found: ${vconUuid}`);
            }
        });
    }

    async keywordSearch(params: {
        query: string;
        startDate?: string;
        endDate?: string;
        tags?: Record<string, string>;
        limit?: number;
    }): Promise<Array<{
        vcon_id: string;
        doc_type: string;
        rank: number;
        snippet: string | null;
        ref_index: number | null;
    }>> {
        return withSpan('mongo.keywordSearch', async (span) => {
            span.setAttributes({
                [ATTR_SEARCH_TYPE]: 'keyword',
                [ATTR_DB_OPERATION]: 'search',
            });

            const collection = this.db.collection(this.VCONS_COLLECTION);
            const limit = params.limit || 50;

            const query: any = { $text: { $search: params.query } };

            if (params.startDate || params.endDate) {
                query.created_at = {};
                if (params.startDate) query.created_at.$gte = params.startDate;
                if (params.endDate) query.created_at.$lte = params.endDate;
            }

            // Note: tags search not strictly implemented in this basic version 
            // as tags structure in vCon can vary (attachment vs inline)

            const results = await collection
                .find(query)
                .project({ score: { $meta: 'textScore' }, uuid: 1, created_at: 1, subject: 1 })
                .sort({ score: { $meta: 'textScore' } })
                .limit(limit)
                .toArray();

            span.setAttributes({
                [ATTR_SEARCH_RESULTS_COUNT]: results.length,
            });

            return results.map(r => ({
                vcon_id: r.uuid,
                doc_type: 'vcon', // Basic implementation treats whole document as match
                rank: r.score as number,
                snippet: (r as any).subject || null,
                ref_index: null
            }));
        });
    }

    async keywordSearchCount(params: {
        query: string;
        startDate?: string;
        endDate?: string;
        tags?: Record<string, string>;
    }): Promise<number> {
        const collection = this.db.collection(this.VCONS_COLLECTION);
        const query: any = { $text: { $search: params.query } };

        if (params.startDate || params.endDate) {
            query.created_at = {};
            if (params.startDate) query.created_at.$gte = params.startDate;
            if (params.endDate) query.created_at.$lte = params.endDate;
        }

        return await collection.countDocuments(query);
    }

    async semanticSearch(params: {
        embedding: number[];
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
        return withSpan('mongo.semanticSearch', async (span) => {
            span.setAttributes({
                [ATTR_SEARCH_TYPE]: 'semantic',
                [ATTR_DB_OPERATION]: 'search',
                [ATTR_SEARCH_THRESHOLD]: params.threshold || 0.7,
            });

            const collection = this.db.collection('vcon_embeddings');
            const limit = params.limit || 50;
            const indexName = 'vector_index'; // Assumed index name

            // Basic $vectorSearch aggregation
            // Note: This requires an Atlas Vector Search index to be created on 'vcon_embeddings'
            const pipeline: any[] = [
                {
                    $vectorSearch: {
                        index: indexName,
                        path: "embedding",
                        queryVector: params.embedding,
                        numCandidates: limit * 10,
                        limit: limit
                    }
                },
                {
                    $project: {
                        vcon_id: 1,
                        content_type: 1,
                        content_reference: 1,
                        content_text: 1,
                        score: { $meta: "vectorSearchScore" }
                    }
                }
            ];

            // Filter by threshold if provided
            if (params.threshold) {
                pipeline.push({
                    $match: {
                        score: { $gte: params.threshold }
                    }
                });
            }

            try {
                const results = await collection.aggregate(pipeline).toArray();

                span.setAttributes({
                    [ATTR_SEARCH_RESULTS_COUNT]: results.length,
                });

                return results.map(r => ({
                    vcon_id: r.vcon_id,
                    content_type: r.content_type,
                    content_reference: r.content_reference,
                    content_text: r.content_text,
                    similarity: r.score
                }));
            } catch (error) {
                // If index doesn't exist, we might get an error. 
                // Log and return empty to avoid crashing if feature not set up.
                logWithContext('error', 'Vector search failed (likely missing Atlas index)', {
                    error: error instanceof Error ? error.message : String(error)
                });
                return [];
            }
        });
    }

    async hybridSearch(params: {
        keywordQuery?: string;
        embedding?: number[];
        tags?: Record<string, string>;
        semanticWeight?: number;
        limit?: number;
    }): Promise<Array<{
        vcon_id: string;
        combined_score: number;
        semantic_score: number;
        keyword_score: number;
    }>> {
        // Implementation of Reciprocal Rank Fusion (RRF) or Linear Combination
        // For simplicity matching Supabase implementation, we'll fetch both and combine in memory
        // since MongoDB doesn't easily support joining $text and $vectorSearch in one performant query phase
        // without complex lookups.

        const limit = params.limit || 50;
        const semanticWeight = params.semanticWeight ?? 0.6;
        const keywordWeight = 1.0 - semanticWeight;

        let keywordResults: any[] = [];
        let semanticResults: any[] = [];

        // Run searches in parallel
        await Promise.all([
            // Keyword Search
            (async () => {
                if (params.keywordQuery) {
                    keywordResults = await this.keywordSearch({
                        query: params.keywordQuery,
                        tags: params.tags,
                        limit: limit
                    });
                }
            })(),
            // Semantic Search
            (async () => {
                if (params.embedding) {
                    semanticResults = await this.semanticSearch({
                        embedding: params.embedding,
                        tags: params.tags,
                        limit: limit
                    });
                }
            })()
        ]);

        // Normalize scores (0-1 range approx)
        // Text scores in Mongo are arbitrary, so we normalize by max score
        const maxKeywordScore = Math.max(...keywordResults.map(r => r.rank), 1);
        const maxSemanticScore = Math.max(...semanticResults.map(r => r.similarity), 1);

        const resultsMap = new Map<string, {
            vcon_id: string,
            semantic_score: number,
            keyword_score: number
        }>();

        // Process Keyword Results
        keywordResults.forEach(r => {
            const normalizedScore = r.rank / maxKeywordScore;
            resultsMap.set(r.vcon_id, {
                vcon_id: r.vcon_id,
                semantic_score: 0,
                keyword_score: normalizedScore
            });
        });

        // Process Semantic Results
        semanticResults.forEach(r => {
            const existing = resultsMap.get(r.vcon_id) || {
                vcon_id: r.vcon_id,
                semantic_score: 0,
                keyword_score: 0
            };
            existing.semantic_score = r.similarity; // already 0-1 usually (cosine)
            resultsMap.set(r.vcon_id, existing);
        });

        // Calculate combined score and sort
        const finalResults = Array.from(resultsMap.values()).map(r => ({
            ...r,
            combined_score: (r.keyword_score * keywordWeight) + (r.semantic_score * semanticWeight)
        }));

        return finalResults
            .sort((a, b) => b.combined_score - a.combined_score)
            .slice(0, limit);
    }

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
        const collection = this.db.collection(this.VCONS_COLLECTION);
        const query: any = {};

        if (filters.subject) {
            query.subject = { $regex: filters.subject, $options: 'i' };
        }

        if (filters.startDate || filters.endDate) {
            query.created_at = {};
            if (filters.startDate) query.created_at.$gte = filters.startDate;
            if (filters.endDate) query.created_at.$lte = filters.endDate;
        }

        if (filters.partyName) {
            query['parties.name'] = { $regex: filters.partyName, $options: 'i' };
        }
        if (filters.partyEmail) {
            query['parties.mailto'] = { $regex: filters.partyEmail, $options: 'i' };
        }
        if (filters.partyTel) {
            query['parties.tel'] = { $regex: filters.partyTel, $options: 'i' };
        }

        const results = await collection
            .find(query)
            .sort({ created_at: -1 })
            .limit(filters.limit || 10)
            .toArray();

        return results.map(r => {
            const { _id, ...rest } = r;
            return rest as unknown as VCon;
        });
    }
}
