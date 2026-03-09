
import { Db } from 'mongodb';
import {
    IDatabaseAnalytics,
    DatabaseAnalyticsOptions,
    MonthlyGrowthOptions,
    AttachmentAnalyticsOptions,
    TagAnalyticsOptions,
    ContentAnalyticsOptions,
    DatabaseHealthOptions
} from './types.js';

export class MongoDatabaseAnalytics implements IDatabaseAnalytics {
    constructor(private db: Db) { }

    async getDatabaseAnalytics(options: DatabaseAnalyticsOptions = {}) {
        const {
            includeGrowthTrends = true,
            includeContentAnalytics = true,
            includeAttachmentStats = true,
            includeTagAnalytics = true,
            includeHealthMetrics = true,
            monthsBack = 12,
        } = options;

        const analytics: any = {
            timestamp: new Date().toISOString(),
            summary: {},
        };

        // Summary usage stats
        const vconsCount = await this.db.collection('vcons').countDocuments();
        // Assuming dialogs/attachments are inside vcons or separate?
        // In Mongo implementation vCon is a document, so we aggregate sub-arrays

        // We need to check if we are using separate collections or embedded arrays.
        // In MongoVConQueries, we store vCon as a single document in 'vcons' collection.
        // So dialog, analysis, attachments are arrays inside the vcon document.

        const summaryAggregation = await this.db.collection('vcons').aggregate([
            {
                $project: {
                    dialog_count: { $size: { $ifNull: ["$dialog", []] } },
                    analysis_count: { $size: { $ifNull: ["$analysis", []] } },
                    attachment_count: { $size: { $ifNull: ["$attachments", []] } },
                    // Estimate size? BSON size is hard to get in aggregation without $bsonSize (5.0+)
                    // We can use $bsonSize if available, or just skip size for now
                }
            },
            {
                $group: {
                    _id: null,
                    total_dialogs: { $sum: "$dialog_count" },
                    total_analysis: { $sum: "$analysis_count" },
                    total_attachments: { $sum: "$attachment_count" }
                }
            }
        ]).toArray();

        const summary = summaryAggregation[0] || { total_dialogs: 0, total_analysis: 0, total_attachments: 0 };

        analytics.summary = {
            total_vcons: vconsCount,
            total_dialogs: summary.total_dialogs,
            total_analysis: summary.total_analysis,
            total_attachments: summary.total_attachments,
        };

        if (includeGrowthTrends) {
            analytics.growth = await this.getMonthlyGrowthAnalytics({ monthsBack });
        }

        if (includeContentAnalytics) {
            analytics.content = await this.getContentAnalytics();
        }

        if (includeAttachmentStats) {
            analytics.attachments = await this.getAttachmentAnalytics();
        }

        if (includeTagAnalytics) {
            analytics.tags = await this.getTagAnalytics();
        }

        if (includeHealthMetrics) {
            analytics.health = await this.getDatabaseHealthMetrics();
        }

        return analytics;
    }

    async getMonthlyGrowthAnalytics(options: MonthlyGrowthOptions = {}) {
        // Mongo aggregation for monthly growth
        // Group by creation date
        const { monthsBack = 12 } = options;
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);

        const trends = await this.db.collection('vcons').aggregate([
            { $match: { created_at: { $gte: cutoffDate.toISOString() } } }, // creation_date is string ISO usually
            {
                $group: {
                    _id: {
                        // Try to parse ISO string to date if possible, or substring
                        // Assuming created_at is ISO string YYYY-MM-DD...
                        month: { $substr: ["$created_at", 0, 7] } // YYYY-MM
                    },
                    vcon_count: { $sum: 1 },
                    dialog_count: { $sum: { $size: { $ifNull: ["$dialog", []] } } }
                }
            },
            { $sort: { "_id.month": 1 } }
        ]).toArray();

        return {
            timestamp: new Date().toISOString(),
            trends: trends.map(t => ({
                period: t._id.month,
                vcon_count: t.vcon_count,
                dialog_count: t.dialog_count
            }))
        };
    }

    async getAttachmentAnalytics(options: AttachmentAnalyticsOptions = {}) {
        // Unwind attachments to analyze them
        const attachmentStats = await this.db.collection('vcons').aggregate([
            { $unwind: "$attachments" },
            {
                $group: {
                    _id: "$attachments.type",
                    count: { $sum: 1 },
                    // size if available, usually not in vCon standard text structure unless metadata has it
                }
            },
            { $sort: { count: -1 } },
            { $limit: options.topNTypes || 10 }
        ]).toArray();

        return {
            types: attachmentStats.map(a => ({ type: a._id, count: a.count }))
        };
    }

    async getTagAnalytics(options: TagAnalyticsOptions = {}) {
        // Tags on vCon are usually at root? or attachments?
        // Type def says `tags?: Record<string, string>;` on VCon?
        // Wait, let's check src/types/vcon.ts
        // Assuming root level tags for now, typically "tags" object

        // Since tags is a Map/Object, we need to convert to array to aggregate
        // $objectToArray (Mongo 3.4+)

        const tagStats = await this.db.collection('vcons').aggregate([
            { $project: { tags: { $objectToArray: "$tags" } } },
            { $unwind: "$tags" },
            {
                $group: {
                    _id: "$tags.k",
                    count: { $sum: 1 },
                    values: { $addToSet: "$tags.v" } // careful with cardinality
                }
            },
            { $sort: { count: -1 } },
            { $limit: options.topNKeys || 20 }
        ]).toArray();

        return {
            tag_keys: tagStats.map(t => ({ key: t._id, count: t.count, unique_values: t.values.length }))
        };
    }

    async getContentAnalytics(options: ContentAnalyticsOptions = {}) {
        // Better approach: Use facets to separate the concerns
        // One facet for party count (per vcon), one for duration (per dialog)
        const complexStats = await this.db.collection('vcons').aggregate([
            {
                $facet: {
                    "general": [
                        {
                            $project: {
                                party_count: { $size: { $ifNull: ["$parties", []] } }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                avg_parties: { $avg: "$party_count" }
                            }
                        }
                    ],
                    "content": [
                        { $unwind: { path: "$dialog", preserveNullAndEmptyArrays: false } }, // Only consider vcons with dialogs for duration stats
                        {
                            $group: {
                                _id: null,
                                total_duration: { $sum: "$dialog.duration" },
                                avg_duration: { $avg: "$dialog.duration" }
                            }
                        }
                    ]
                }
            }
        ]).toArray();

        const generalStats = (complexStats[0].general && complexStats[0].general[0]) || {};
        const durationStats = (complexStats[0].content && complexStats[0].content[0]) || {};

        return {
            avg_parties_per_vcon: generalStats.avg_parties || 0,
            total_conversation_duration: durationStats.total_duration || 0,
            avg_dialog_duration: durationStats.avg_duration || 0
        };
    }

    async getDatabaseHealthMetrics(options: DatabaseHealthOptions = {}) {
        // Basic health check
        try {
            const ping = await this.db.command({ ping: 1 });
            return { status: "healthy", ping: ping };
        } catch (e) {
            return { status: "unhealthy", error: e };
        }
    }
}
