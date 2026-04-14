
/**
 * Database Inspector Interface
 * Defines contracts for analyzing database structure and performance
 */
export interface IDatabaseInspector {
    getDatabaseShape(options?: InspectorOptions): Promise<any>;
    getDatabaseStats(options?: InspectorStatsOptions): Promise<any>;
    analyzeQuery(query: string, analyzeMode?: 'explain' | 'explain_analyze'): Promise<any>;
    getConnectionInfo(): Promise<any>;
}

export interface InspectorOptions {
    includeCounts?: boolean;
    includeSizes?: boolean;
    includeIndexes?: boolean;
    includeColumns?: boolean;
}

export interface InspectorStatsOptions {
    includeQueryStats?: boolean;
    includeIndexUsage?: boolean;
    includeCacheStats?: boolean;
    tableName?: string;
}

/**
 * Database Analytics Interface
 * Defines contracts for business intelligence and data growth analysis
 */
export interface IDatabaseAnalytics {
    getDatabaseAnalytics(options?: DatabaseAnalyticsOptions): Promise<any>;
    getMonthlyGrowthAnalytics(options?: MonthlyGrowthOptions): Promise<any>;
    getAttachmentAnalytics(options?: AttachmentAnalyticsOptions): Promise<any>;
    getTagAnalytics(options?: TagAnalyticsOptions): Promise<any>;
    getContentAnalytics(options?: ContentAnalyticsOptions): Promise<any>;
    getDatabaseHealthMetrics(options?: DatabaseHealthOptions): Promise<any>;
}

export interface DatabaseAnalyticsOptions {
    includeGrowthTrends?: boolean;
    includeContentAnalytics?: boolean;
    includeAttachmentStats?: boolean;
    includeTagAnalytics?: boolean;
    includeHealthMetrics?: boolean;
    monthsBack?: number;
}

export interface MonthlyGrowthOptions {
    monthsBack?: number;
    includeProjections?: boolean;
    granularity?: 'monthly' | 'weekly' | 'daily';
}

export interface AttachmentAnalyticsOptions {
    includeSizeDistribution?: boolean;
    includeTypeBreakdown?: boolean;
    includeTemporalPatterns?: boolean;
    topNTypes?: number;
}

export interface TagAnalyticsOptions {
    includeFrequencyAnalysis?: boolean;
    includeValueDistribution?: boolean;
    includeTemporalTrends?: boolean;
    topNKeys?: number;
    minUsageCount?: number;
}

export interface ContentAnalyticsOptions {
    includeDialogAnalysis?: boolean;
    includeAnalysisBreakdown?: boolean;
    includePartyPatterns?: boolean;
    includeConversationMetrics?: boolean;
    includeTemporalContent?: boolean;
}

export interface DatabaseHealthOptions {
    includePerformanceMetrics?: boolean;
    includeStorageEfficiency?: boolean;
    includeIndexHealth?: boolean;
    includeConnectionMetrics?: boolean;
    includeRecommendations?: boolean;
}

/**
 * Database Size Analyzer Interface
 * Defines contracts for analyzing database size and providing smart recommendations
 */
export interface IDatabaseSizeAnalyzer {
    getDatabaseSizeInfo(includeRecommendations?: boolean): Promise<DatabaseSizeInfo>;
    getSmartSearchLimits(queryType: string, estimatedResultSize: string): Promise<SmartLimits>;
}

export interface DatabaseSizeInfo {
    total_vcons: number;
    total_size_bytes: number;
    total_size_pretty: string;
    size_category: 'small' | 'medium' | 'large' | 'very_large';
    recommendations: {
        max_basic_search_limit: number;
        max_content_search_limit: number;
        max_semantic_search_limit: number;
        max_analytics_limit: number;
        recommended_response_format: string;
        memory_warning: boolean;
    };
    table_sizes: {
        [table_name: string]: {
            row_count: number;
            size_bytes: number;
            size_pretty: string;
        };
    };
}

export interface SmartLimits {
    query_type: string;
    estimated_result_size: string;
    recommended_limit: number;
    recommended_response_format: string;
    memory_warning: boolean;
    explanation: string;
}
