
import { Db } from 'mongodb';
import { IDatabaseSizeAnalyzer, DatabaseSizeInfo, SmartLimits } from './types.js';
import { calculateSmartSearchLimits } from './shared-utils.js';

export class MongoDatabaseSizeAnalyzer implements IDatabaseSizeAnalyzer {
    constructor(private db: Db) { }

    async getDatabaseSizeInfo(includeRecommendations: boolean = true): Promise<DatabaseSizeInfo> {
        // Get stats from collections
        const collections = ['vcons', 'vcon_embeddings']; // Main collections
        const tableSizes: any = {};
        let totalSizeBytes = 0;
        let totalVCons = 0;

        for (const collName of collections) {
            try {
                const stats = await this.db.command({ collStats: collName });
                // storageSize or totalSize? totalSize includes indexes
                const sizeBytes = stats.storageSize + (stats.totalIndexSize || 0);
                const rowCount = stats.count;

                tableSizes[collName] = {
                    row_count: rowCount,
                    size_bytes: sizeBytes,
                    size_pretty: this.formatBytes(sizeBytes)
                };

                totalSizeBytes += sizeBytes;
                if (collName === 'vcons') {
                    totalVCons = rowCount;
                }
            } catch (e) {
                // Collection might not exist yet
                tableSizes[collName] = { row_count: 0, size_bytes: 0, size_pretty: '0 Bytes' };
            }
        }

        // Determine size category
        let sizeCategory: 'small' | 'medium' | 'large' | 'very_large';
        if (totalVCons < 1000) {
            sizeCategory = 'small';
        } else if (totalVCons < 10000) {
            sizeCategory = 'medium';
        } else if (totalVCons < 100000) {
            sizeCategory = 'large';
        } else {
            sizeCategory = 'very_large';
        }

        const info: DatabaseSizeInfo = {
            total_vcons: totalVCons,
            total_size_bytes: totalSizeBytes,
            total_size_pretty: this.formatBytes(totalSizeBytes),
            size_category: sizeCategory,
            recommendations: {
                max_basic_search_limit: 10,
                max_content_search_limit: 50,
                max_semantic_search_limit: 50,
                max_analytics_limit: 100,
                recommended_response_format: 'metadata',
                memory_warning: false
            },
            table_sizes: tableSizes
        };

        if (includeRecommendations) {
            info.recommendations = this.generateRecommendations(totalVCons, totalSizeBytes, sizeCategory);
        }

        return info;
    }

    async getSmartSearchLimits(queryType: string, estimatedResultSize: string): Promise<SmartLimits> {
        const sizeInfo = await this.getDatabaseSizeInfo(false);
        return calculateSmartSearchLimits(sizeInfo, queryType, estimatedResultSize);
    }

    private generateRecommendations(totalVCons: number, totalSizeBytes: number, sizeCategory: string) {
        const recommendations: any = {
            max_basic_search_limit: 10,
            max_content_search_limit: 50,
            max_semantic_search_limit: 50,
            max_analytics_limit: 100,
            recommended_response_format: 'metadata',
            memory_warning: false
        };

        if (sizeCategory === 'small') {
            recommendations.max_basic_search_limit = 100;
            recommendations.max_content_search_limit = 200;
            recommendations.max_semantic_search_limit = 200;
            recommendations.max_analytics_limit = 500;
            recommendations.recommended_response_format = 'full';
        } else if (sizeCategory === 'medium') {
            recommendations.max_basic_search_limit = 50;
            recommendations.max_content_search_limit = 100;
            recommendations.max_semantic_search_limit = 100;
            recommendations.max_analytics_limit = 200;
            recommendations.recommended_response_format = 'metadata';
        } else if (sizeCategory === 'large') {
            recommendations.max_basic_search_limit = 25;
            recommendations.max_content_search_limit = 50;
            recommendations.max_semantic_search_limit = 50;
            recommendations.max_analytics_limit = 100;
            recommendations.recommended_response_format = 'metadata';
            recommendations.memory_warning = true;
        } else { // very_large
            recommendations.max_basic_search_limit = 10;
            recommendations.max_content_search_limit = 25;
            recommendations.max_semantic_search_limit = 25;
            recommendations.max_analytics_limit = 50;
            recommendations.recommended_response_format = 'metadata';
            recommendations.memory_warning = true;
        }

        return recommendations;
    }

    private formatBytes(bytes: number): string {
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 Bytes';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }
}
