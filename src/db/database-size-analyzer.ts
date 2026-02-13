/**
 * Database Size Analyzer
 * 
 * Analyzes database size and provides smart recommendations for query limits
 */

import { SupabaseClient } from '@supabase/supabase-js';

import { IDatabaseSizeAnalyzer, DatabaseSizeInfo, SmartLimits } from './types.js';

export class SupabaseDatabaseSizeAnalyzer implements IDatabaseSizeAnalyzer {
  constructor(private supabase: SupabaseClient) { }

  /**
   * Get comprehensive database size information
   */
  async getDatabaseSizeInfo(includeRecommendations: boolean = true): Promise<DatabaseSizeInfo> {
    // Get basic table statistics
    const tableStatsQuery = `
      SELECT 
        'vcons' as table_name,
        COUNT(*) as row_count,
        pg_total_relation_size('vcons') as size_bytes
      FROM vcons
      UNION ALL
      SELECT 
        'parties' as table_name,
        COUNT(*) as row_count,
        pg_total_relation_size('parties') as size_bytes
      FROM parties
      UNION ALL
      SELECT 
        'dialog' as table_name,
        COUNT(*) as row_count,
        pg_total_relation_size('dialog') as size_bytes
      FROM dialog
      UNION ALL
      SELECT 
        'analysis' as table_name,
        COUNT(*) as row_count,
        pg_total_relation_size('analysis') as size_bytes
      FROM analysis
      UNION ALL
      SELECT 
        'attachments' as table_name,
        COUNT(*) as row_count,
        pg_total_relation_size('attachments') as size_bytes
      FROM attachments
    `;

    const { data: tableData, error } = await this.supabase.rpc('exec_sql', {
      q: tableStatsQuery,
      params: {}
    });

    if (error) throw error;

    const tableSizes: any = {};
    let totalSizeBytes = 0;
    let totalVCons = 0;

    tableData?.forEach((row: any) => {
      const sizeBytes = parseInt(row.size_bytes);
      const rowCount = parseInt(row.row_count);

      tableSizes[row.table_name] = {
        row_count: rowCount,
        size_bytes: sizeBytes,
        size_pretty: this.formatBytes(sizeBytes)
      };

      totalSizeBytes += sizeBytes;
      if (row.table_name === 'vcons') {
        totalVCons = rowCount;
      }
    });

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

  /**
   * Get smart search limits based on query type and database size
   */
  async getSmartSearchLimits(queryType: string, estimatedResultSize: string): Promise<SmartLimits> {
    const sizeInfo = await this.getDatabaseSizeInfo(false);

    let recommendedLimit: number;
    let recommendedFormat: string;
    let memoryWarning: boolean;
    let explanation: string;

    // Base limits by query type
    const baseLimits = {
      basic: 50,
      content: 100,
      semantic: 100,
      hybrid: 100,
      analytics: 200
    };

    // Adjust based on database size
    const sizeMultiplier = {
      small: 1.0,
      medium: 0.8,
      large: 0.5,
      very_large: 0.3
    };

    // Adjust based on estimated result size
    const resultMultiplier = {
      small: 1.0,
      medium: 0.7,
      large: 0.4,
      unknown: 0.5
    };

    const baseLimit = baseLimits[queryType as keyof typeof baseLimits] || 50;
    const sizeMult = sizeMultiplier[sizeInfo.size_category];
    const resultMult = resultMultiplier[estimatedResultSize as keyof typeof resultMultiplier];

    recommendedLimit = Math.max(1, Math.round(baseLimit * sizeMult * resultMult));

    // Determine response format
    if (sizeInfo.size_category === 'very_large' || estimatedResultSize === 'large') {
      recommendedFormat = 'metadata';
      memoryWarning = true;
    } else if (sizeInfo.size_category === 'large' || estimatedResultSize === 'medium') {
      recommendedFormat = 'metadata';
      memoryWarning = false;
    } else {
      recommendedFormat = 'full';
      memoryWarning = false;
    }

    // Generate explanation
    explanation = `Database has ${sizeInfo.total_vcons.toLocaleString()} vCons (${sizeInfo.size_category} size). `;
    explanation += `For ${queryType} queries with ${estimatedResultSize} results, `;
    explanation += `recommend limit of ${recommendedLimit} with ${recommendedFormat} format.`;

    if (memoryWarning) {
      explanation += ' ⚠️ Memory warning: Large dataset detected.';
    }

    return {
      query_type: queryType,
      estimated_result_size: estimatedResultSize,
      recommended_limit: recommendedLimit,
      recommended_response_format: recommendedFormat,
      memory_warning: memoryWarning,
      explanation
    };
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
