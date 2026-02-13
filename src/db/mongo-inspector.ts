import { Db } from 'mongodb';
import { IDatabaseInspector, InspectorOptions, InspectorStatsOptions } from './types.js';

export class MongoDatabaseInspector implements IDatabaseInspector {
    constructor(private db: Db) { }

    /**
     * Get comprehensive database shape information
     */
    async getDatabaseShape(options: InspectorOptions = {}) {
        const {
            includeCounts = true,
            includeSizes = true,
            includeIndexes = true,
            includeColumns = false,
        } = options;

        const shape: any = {
            timestamp: new Date().toISOString(),
            collections: [],
        };

        const collections = await this.db.listCollections().toArray();

        for (const collectionInfo of collections) {
            const collName = collectionInfo.name;
            const collection = this.db.collection(collName);

            // Basic info
            const collStats: any = {
                name: collName,
                type: collectionInfo.type,
            };

            // Sizes and Counts (using collateral stats for speed if available, or direct calls)
            if (includeSizes || includeCounts) {
                // collection.stats() is deprecated in some drivers but still useful, or use aggregations
                // For standard drivers, we can use distinct commands

                if (includeCounts) {
                    collStats.document_count = await collection.countDocuments();
                }

                if (includeSizes) {
                    // We can't easily get exact storage size without stats() command which requires privileges
                    // We can try to estimate or use db.stats() for global, but per collection is harder without privileges in some Atlas tiers
                    // For now, let's try to get what we can from a sample or just skip detailed size per collection if restricted
                    // Actually, listCollections doesn't return size. 
                    // We will skip size per collection for now unless we want to run a heavier command
                }
            }

            // Indexes
            if (includeIndexes) {
                collStats.indexes = await collection.indexes();
            }

            // Columns (Schema Inference from sample)
            if (includeColumns) {
                const sample = await collection.findOne({});
                if (sample) {
                    collStats.schema_sample = Object.keys(sample).map(key => ({
                        name: key,
                        type: typeof sample[key]
                    }));
                }
            }

            shape.collections.push(collStats);
        }

        return shape;
    }

    /**
     * Get database performance statistics
     */
    async getDatabaseStats(options: InspectorStatsOptions = {}) {
        const {
            includeQueryStats = true,
            includeIndexUsage = true,
            includeCacheStats = true,
            tableName, // interpreted as collection name
        } = options;

        const stats: any = {
            timestamp: new Date().toISOString(),
        };

        // Index Usage using $indexStats
        if (includeIndexUsage) {
            const collections = tableName ? [{ name: tableName }] : await this.db.listCollections().toArray();
            const indexUsage: Record<string, any[]> = {};

            for (const coll of collections) {
                try {
                    const usage = await this.db.collection(coll.name).aggregate([
                        { $indexStats: {} }
                    ]).toArray();
                    indexUsage[coll.name] = usage;
                } catch (e) {
                    // Ignore if not supported/allowed
                }
            }
            stats.index_usage = indexUsage;
        }

        // Server Status (requires privilege, might fail on shared tiers)
        try {
            if (includeCacheStats || includeQueryStats) {
                const serverStatus = await this.db.command({ serverStatus: 1 });

                if (includeCacheStats && serverStatus.wiredTiger) {
                    stats.cache = serverStatus.wiredTiger.cache;
                }

                if (includeQueryStats && serverStatus.opcounters) {
                    stats.opcounters = serverStatus.opcounters;
                }
            }
        } catch (e) {
            stats.error = "Insufficient privileges for serverStatus";
        }

        return stats;
    }

    /**
     * Analyze a query's execution plan
     * For Mongo, this will interpret 'query' as a JSON aggregation pipeline if strict, 
     * but since the interface accepts a string, we might need a convention.
     * For now, we'll assume it's checking specific collection performance or just return available info.
     */
    async analyzeQuery(query: string, analyzeMode: 'explain' | 'explain_analyze' = 'explain') {
        return {
            warning: "Query analysis for raw strings not fully implemented for Mongo. Use specific aggregation explain methods.",
            query: query
        };
    }

    /**
     * Get database connection info
     */
    async getConnectionInfo() {
        try {
            const buildInfo = await this.db.command({ buildInfo: 1 });
            const dbStats = await this.db.stats();

            return {
                database_name: this.db.databaseName,
                version: buildInfo.version,
                data_size: dbStats.dataSize,
                storage_size: dbStats.storageSize,
                objects: dbStats.objects,
            };
        } catch (e) {
            return {
                database_name: this.db.databaseName,
                error: "Could not fetch detailed stats"
            };
        }
    }
}
