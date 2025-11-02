/**
 * Database Analytics Implementation
 * 
 * Comprehensive analytics queries for database shape, growth, and content analysis
 */

import { SupabaseClient } from '@supabase/supabase-js';

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

export class DatabaseAnalytics {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get comprehensive database analytics
   */
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
      tables: {},
      growth: {},
      content: {},
      attachments: {},
      tags: {},
      health: {},
    };

    // Get basic table statistics
    const tableStats = await this.getTableStatistics();
    analytics.tables = tableStats;

    // Calculate summary metrics
    analytics.summary = {
      total_vcons: tableStats.vcons?.row_count || 0,
      total_parties: tableStats.parties?.row_count || 0,
      total_dialogs: tableStats.dialog?.row_count || 0,
      total_analysis: tableStats.analysis?.row_count || 0,
      total_attachments: tableStats.attachments?.row_count || 0,
      total_size_bytes: this.calculateTotalSize(tableStats),
      total_size_pretty: this.formatBytes(this.calculateTotalSize(tableStats)),
      database_health_score: await this.calculateHealthScore(),
    };

    // Growth trends
    if (includeGrowthTrends) {
      analytics.growth = await this.getGrowthTrends(monthsBack);
    }

    // Content analytics
    if (includeContentAnalytics) {
      analytics.content = await this.getContentAnalytics();
    }

    // Attachment statistics
    if (includeAttachmentStats) {
      analytics.attachments = await this.getAttachmentAnalytics();
    }

    // Tag analytics
    if (includeTagAnalytics) {
      analytics.tags = await this.getTagAnalytics();
    }

    // Health metrics
    if (includeHealthMetrics) {
      analytics.health = await this.getDatabaseHealthMetrics();
    }

    return analytics;
  }

  /**
   * Get monthly growth analytics
   */
  async getMonthlyGrowthAnalytics(options: MonthlyGrowthOptions = {}) {
    const {
      monthsBack = 12,
      includeProjections = true,
      granularity = 'monthly',
    } = options;

    const growth: any = {
      timestamp: new Date().toISOString(),
      period: `${monthsBack} months`,
      granularity,
      trends: {},
      projections: {},
    };

    // Get vCon creation trends
    const vconTrends = await this.getVConCreationTrends(monthsBack, granularity);
    growth.trends.vcon_creation = vconTrends;

    // Get size growth trends
    const sizeTrends = await this.getSizeGrowthTrends(monthsBack, granularity);
    growth.trends.size_growth = sizeTrends;

    // Get content volume trends
    const contentTrends = await this.getContentVolumeTrends(monthsBack, granularity);
    growth.trends.content_volume = contentTrends;

    // Calculate growth rates
    growth.growth_rates = this.calculateGrowthRates(vconTrends, sizeTrends);

    // Generate projections
    if (includeProjections) {
      growth.projections = this.generateProjections(vconTrends, sizeTrends, monthsBack);
    }

    return growth;
  }

  /**
   * Get attachment analytics
   */
  async getAttachmentAnalytics(options: AttachmentAnalyticsOptions = {}) {
    const {
      includeSizeDistribution = true,
      includeTypeBreakdown = true,
      includeTemporalPatterns = false,
      topNTypes = 10,
    } = options;

    const analytics: any = {
      timestamp: new Date().toISOString(),
      summary: {},
      type_breakdown: {},
      size_distribution: {},
      temporal_patterns: {},
    };

    // Get basic attachment statistics
    const attachmentStats = await this.getAttachmentStatistics();
    analytics.summary = attachmentStats;

    // File type breakdown
    if (includeTypeBreakdown) {
      const typeBreakdown = await this.getAttachmentTypeBreakdown(topNTypes);
      analytics.type_breakdown = typeBreakdown;
    }

    // Size distribution
    if (includeSizeDistribution) {
      const sizeDistribution = await this.getAttachmentSizeDistribution();
      analytics.size_distribution = sizeDistribution;
    }

    // Temporal patterns
    if (includeTemporalPatterns) {
      const temporalPatterns = await this.getAttachmentTemporalPatterns();
      analytics.temporal_patterns = temporalPatterns;
    }

    return analytics;
  }

  /**
   * Get tag analytics
   */
  async getTagAnalytics(options: TagAnalyticsOptions = {}) {
    const {
      includeFrequencyAnalysis = true,
      includeValueDistribution = true,
      includeTemporalTrends = false,
      topNKeys = 20,
      minUsageCount = 1,
    } = options;

    const analytics: any = {
      timestamp: new Date().toISOString(),
      summary: {},
      frequency_analysis: {},
      value_distribution: {},
      temporal_trends: {},
    };

    // Get basic tag statistics
    const tagStats = await this.getTagStatistics();
    analytics.summary = tagStats;

    // Frequency analysis
    if (includeFrequencyAnalysis) {
      const frequencyAnalysis = await this.getTagFrequencyAnalysis(topNKeys, minUsageCount);
      analytics.frequency_analysis = frequencyAnalysis;
    }

    // Value distribution
    if (includeValueDistribution) {
      const valueDistribution = await this.getTagValueDistribution(topNKeys);
      analytics.value_distribution = valueDistribution;
    }

    // Temporal trends
    if (includeTemporalTrends) {
      const temporalTrends = await this.getTagTemporalTrends();
      analytics.temporal_trends = temporalTrends;
    }

    return analytics;
  }

  /**
   * Get content analytics
   */
  async getContentAnalytics(options: ContentAnalyticsOptions = {}) {
    const {
      includeDialogAnalysis = true,
      includeAnalysisBreakdown = true,
      includePartyPatterns = true,
      includeConversationMetrics = true,
      includeTemporalContent = false,
    } = options;

    const analytics: any = {
      timestamp: new Date().toISOString(),
      summary: {},
      dialog_analysis: {},
      analysis_breakdown: {},
      party_patterns: {},
      conversation_metrics: {},
      temporal_content: {},
    };

    // Get basic content statistics
    const contentStats = await this.getContentStatistics();
    analytics.summary = contentStats;

    // Dialog analysis
    if (includeDialogAnalysis) {
      const dialogAnalysis = await this.getDialogAnalysis();
      analytics.dialog_analysis = dialogAnalysis;
    }

    // Analysis breakdown
    if (includeAnalysisBreakdown) {
      const analysisBreakdown = await this.getAnalysisBreakdown();
      analytics.analysis_breakdown = analysisBreakdown;
    }

    // Party patterns
    if (includePartyPatterns) {
      const partyPatterns = await this.getPartyPatterns();
      analytics.party_patterns = partyPatterns;
    }

    // Conversation metrics
    if (includeConversationMetrics) {
      const conversationMetrics = await this.getConversationMetrics();
      analytics.conversation_metrics = conversationMetrics;
    }

    // Temporal content
    if (includeTemporalContent) {
      const temporalContent = await this.getTemporalContentPatterns();
      analytics.temporal_content = temporalContent;
    }

    return analytics;
  }

  /**
   * Get database health metrics
   */
  async getDatabaseHealthMetrics(options: DatabaseHealthOptions = {}) {
    const {
      includePerformanceMetrics = true,
      includeStorageEfficiency = true,
      includeIndexHealth = true,
      includeConnectionMetrics = true,
      includeRecommendations = true,
    } = options;

    const health: any = {
      timestamp: new Date().toISOString(),
      overall_score: 0,
      metrics: {},
      recommendations: [],
      alerts: [],
    };

    // Performance metrics
    if (includePerformanceMetrics) {
      const performanceMetrics = await this.getPerformanceMetrics();
      health.metrics.performance = performanceMetrics;
    }

    // Storage efficiency
    if (includeStorageEfficiency) {
      const storageEfficiency = await this.getStorageEfficiency();
      health.metrics.storage = storageEfficiency;
    }

    // Index health
    if (includeIndexHealth) {
      const indexHealth = await this.getIndexHealth();
      health.metrics.indexes = indexHealth;
    }

    // Connection metrics
    if (includeConnectionMetrics) {
      const connectionMetrics = await this.getConnectionMetrics();
      health.metrics.connections = connectionMetrics;
    }

    // Calculate overall health score
    health.overall_score = await this.calculateHealthScore();

    // Generate recommendations and alerts
    if (includeRecommendations) {
      const recommendations = await this.generateRecommendations(health.metrics);
      health.recommendations = recommendations.recommendations;
      health.alerts = recommendations.alerts;
    }

    return health;
  }

  // Helper methods for specific analytics

  private async getTableStatistics() {
    const query = `
      SELECT 
        'vcons' as table_name,
        COUNT(*) as row_count,
        pg_size_pretty(pg_total_relation_size('vcons')) as total_size,
        pg_size_pretty(pg_relation_size('vcons')) as table_size
      FROM vcons
      UNION ALL
      SELECT 
        'parties' as table_name,
        COUNT(*) as row_count,
        pg_size_pretty(pg_total_relation_size('parties')) as total_size,
        pg_size_pretty(pg_relation_size('parties')) as table_size
      FROM parties
      UNION ALL
      SELECT 
        'dialog' as table_name,
        COUNT(*) as row_count,
        pg_size_pretty(pg_total_relation_size('dialog')) as total_size,
        pg_size_pretty(pg_relation_size('dialog')) as table_size
      FROM dialog
      UNION ALL
      SELECT 
        'analysis' as table_name,
        COUNT(*) as row_count,
        pg_size_pretty(pg_total_relation_size('analysis')) as total_size,
        pg_size_pretty(pg_relation_size('analysis')) as table_size
      FROM analysis
      UNION ALL
      SELECT 
        'attachments' as table_name,
        COUNT(*) as row_count,
        pg_size_pretty(pg_total_relation_size('attachments')) as total_size,
        pg_size_pretty(pg_relation_size('attachments')) as table_size
      FROM attachments
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;

    const stats: any = {};
    data?.forEach((row: any) => {
      stats[row.table_name] = {
        row_count: parseInt(row.row_count),
        total_size: row.total_size,
        table_size: row.table_size,
      };
    });

    return stats;
  }

  private calculateTotalSize(tableStats: any): number {
    // This is a simplified calculation - in practice you'd parse the size strings
    return Object.values(tableStats).reduce((total: number, table: any) => {
      return total + (table.row_count || 0) * 1024; // Rough estimate
    }, 0);
  }

  private formatBytes(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  private async calculateHealthScore(): Promise<number> {
    // Simplified health score calculation
    // In practice, this would consider multiple factors
    return 85; // Placeholder
  }

  // Implementation of specific analytics methods

  private async getGrowthTrends(monthsBack: number) {
    const query = `
      WITH monthly_stats AS (
        SELECT 
          DATE_TRUNC('month', created_at) as month,
          COUNT(*) as vcon_count,
          COUNT(DISTINCT v.id) as unique_vcons,
          SUM(COALESCE(d.size_bytes, 0)) as dialog_size,
          SUM(COALESCE(a.size_bytes, 0)) as attachment_size,
          COUNT(d.id) as dialog_count,
          COUNT(a.id) as attachment_count
        FROM vcons v
        LEFT JOIN dialog d ON d.vcon_id = v.id
        LEFT JOIN attachments a ON a.vcon_id = v.id
        WHERE v.created_at >= NOW() - INTERVAL '${monthsBack} months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month
      )
      SELECT 
        month,
        vcon_count,
        unique_vcons,
        dialog_size,
        attachment_size,
        dialog_count,
        attachment_count,
        dialog_size + attachment_size as total_size
      FROM monthly_stats
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;

    return {
      monthly_data: data || [],
      summary: this.calculateGrowthSummary(data || []),
    };
  }



  private async getVConCreationTrends(monthsBack: number, granularity: string) {
    const dateTrunc = granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month';
    
    const query = `
      SELECT 
        DATE_TRUNC('${dateTrunc}', created_at) as period,
        COUNT(*) as vcon_count,
        COUNT(DISTINCT id) as unique_vcons
      FROM vcons
      WHERE created_at >= NOW() - INTERVAL '${monthsBack} months'
      GROUP BY DATE_TRUNC('${dateTrunc}', created_at)
      ORDER BY period
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getSizeGrowthTrends(monthsBack: number, granularity: string) {
    const dateTrunc = granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month';
    
    const query = `
      WITH size_trends AS (
        SELECT 
          DATE_TRUNC('${dateTrunc}', v.created_at) as period,
          SUM(COALESCE(d.size_bytes, 0)) as dialog_size,
          SUM(COALESCE(a.size_bytes, 0)) as attachment_size,
          COUNT(d.id) as dialog_count,
          COUNT(a.id) as attachment_count
        FROM vcons v
        LEFT JOIN dialog d ON d.vcon_id = v.id
        LEFT JOIN attachments a ON a.vcon_id = v.id
        WHERE v.created_at >= NOW() - INTERVAL '${monthsBack} months'
        GROUP BY DATE_TRUNC('${dateTrunc}', v.created_at)
      )
      SELECT 
        period,
        dialog_size,
        attachment_size,
        dialog_size + attachment_size as total_size,
        dialog_count,
        attachment_count
      FROM size_trends
      ORDER BY period
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getContentVolumeTrends(monthsBack: number, granularity: string) {
    const dateTrunc = granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month';
    
    const query = `
      WITH content_trends AS (
        SELECT 
          DATE_TRUNC('${dateTrunc}', v.created_at) as period,
          COUNT(DISTINCT v.id) as vcon_count,
          COUNT(d.id) as dialog_count,
          COUNT(an.id) as analysis_count,
          COUNT(att.id) as attachment_count,
          SUM(COALESCE(d.duration_seconds, 0)) as total_duration
        FROM vcons v
        LEFT JOIN dialog d ON d.vcon_id = v.id
        LEFT JOIN analysis an ON an.vcon_id = v.id
        LEFT JOIN attachments att ON att.vcon_id = v.id
        WHERE v.created_at >= NOW() - INTERVAL '${monthsBack} months'
        GROUP BY DATE_TRUNC('${dateTrunc}', v.created_at)
      )
      SELECT 
        period,
        vcon_count,
        dialog_count,
        analysis_count,
        attachment_count,
        total_duration,
        ROUND(total_duration / NULLIF(dialog_count, 0), 2) as avg_duration_per_dialog
      FROM content_trends
      ORDER BY period
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private calculateGrowthRates(vconTrends: any[], sizeTrends: any[]) {
    if (vconTrends.length < 2) return { vcon_growth_rate: 0, size_growth_rate: 0 };

    const latest = vconTrends[vconTrends.length - 1];
    const previous = vconTrends[vconTrends.length - 2];
    
    const vconGrowthRate = previous.vcon_count > 0 
      ? ((latest.vcon_count - previous.vcon_count) / previous.vcon_count) * 100 
      : 0;

    const latestSize = sizeTrends[sizeTrends.length - 1];
    const previousSize = sizeTrends[sizeTrends.length - 2];
    
    const sizeGrowthRate = previousSize?.total_size > 0 
      ? ((latestSize?.total_size - previousSize?.total_size) / previousSize?.total_size) * 100 
      : 0;

    return {
      vcon_growth_rate: Math.round(vconGrowthRate * 100) / 100,
      size_growth_rate: Math.round(sizeGrowthRate * 100) / 100,
    };
  }

  private generateProjections(vconTrends: any[], sizeTrends: any[], monthsBack: number) {
    if (vconTrends.length < 2) return { projected_vcons: 0, projected_size: 0 };

    const growthRates = this.calculateGrowthRates(vconTrends, sizeTrends);
    const latest = vconTrends[vconTrends.length - 1];
    const latestSize = sizeTrends[sizeTrends.length - 1];

    // Simple linear projection for next 3 months
    const projectedVcons = Math.round(latest.vcon_count * (1 + growthRates.vcon_growth_rate / 100) * 3);
    const projectedSize = Math.round((latestSize?.total_size || 0) * (1 + growthRates.size_growth_rate / 100) * 3);

    return {
      next_3_months: {
        projected_vcons: projectedVcons,
        projected_size: projectedSize,
        projected_size_pretty: this.formatBytes(projectedSize),
      },
      growth_rates: growthRates,
    };
  }

  private async getAttachmentStatistics() {
    const query = `
      SELECT 
        COUNT(*) as total_attachments,
        SUM(COALESCE(size_bytes, 0)) as total_size,
        AVG(COALESCE(size_bytes, 0)) as avg_size,
        MIN(COALESCE(size_bytes, 0)) as min_size,
        MAX(COALESCE(size_bytes, 0)) as max_size,
        COUNT(DISTINCT type) as unique_types,
        COUNT(DISTINCT vcon_id) as vcons_with_attachments
      FROM attachments
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data && data.length > 0 ? data[0] : {};
  }

  private async getAttachmentTypeBreakdown(topNTypes: number) {
    const query = `
      SELECT 
        type,
        COUNT(*) as count,
        SUM(COALESCE(size_bytes, 0)) as total_size,
        AVG(COALESCE(size_bytes, 0)) as avg_size,
        ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 2) as percentage
      FROM attachments
      GROUP BY type
      ORDER BY count DESC
      LIMIT ${topNTypes}
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getAttachmentSizeDistribution() {
    const query = `
      WITH size_buckets AS (
        SELECT 
          CASE 
            WHEN size_bytes < 1024 THEN '< 1KB'
            WHEN size_bytes < 1024*1024 THEN '1KB - 1MB'
            WHEN size_bytes < 10*1024*1024 THEN '1MB - 10MB'
            WHEN size_bytes < 100*1024*1024 THEN '10MB - 100MB'
            ELSE '> 100MB'
          END as size_bucket,
          COUNT(*) as count,
          SUM(COALESCE(size_bytes, 0)) as total_size
        FROM attachments
        WHERE size_bytes IS NOT NULL
        GROUP BY 1
      )
      SELECT 
        size_bucket,
        count,
        total_size,
        ROUND(count::numeric / SUM(count) OVER () * 100, 2) as percentage
      FROM size_buckets 
      ORDER BY count DESC
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getAttachmentTemporalPatterns() {
    const query = `
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as attachment_count,
        SUM(COALESCE(size_bytes, 0)) as total_size,
        AVG(COALESCE(size_bytes, 0)) as avg_size
      FROM attachments
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getTagStatistics() {
    const query = `
      WITH tag_data AS (
        SELECT 
          key,
          value,
          vcon_id
        FROM attachments
        WHERE type = 'application/json' 
          AND body::jsonb ? 'tags'
          AND jsonb_typeof(body::jsonb->'tags') = 'object'
        CROSS JOIN LATERAL jsonb_each_text(body::jsonb->'tags')
      )
      SELECT 
        COUNT(DISTINCT key) as unique_keys,
        COUNT(DISTINCT value) as unique_values,
        COUNT(DISTINCT vcon_id) as vcons_with_tags,
        COUNT(*) as total_tag_assignments
      FROM tag_data
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data && data.length > 0 ? data[0] : {};
  }

  private async getTagFrequencyAnalysis(topNKeys: number, minUsageCount: number) {
    const query = `
      WITH tag_stats AS (
        SELECT 
          key,
          COUNT(*) as usage_count,
          COUNT(DISTINCT value) as unique_values,
          COUNT(DISTINCT vcon_id) as vcons_with_tag
        FROM attachments
        WHERE type = 'application/json' 
          AND body::jsonb ? 'tags'
          AND jsonb_typeof(body::jsonb->'tags') = 'object'
        CROSS JOIN LATERAL jsonb_each_text(body::jsonb->'tags')
        GROUP BY key
        HAVING COUNT(*) >= ${minUsageCount}
      )
      SELECT 
        key,
        usage_count,
        unique_values,
        vcons_with_tag,
        ROUND(usage_count::numeric / unique_values, 2) as avg_values_per_key
      FROM tag_stats
      ORDER BY usage_count DESC
      LIMIT ${topNKeys}
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getTagValueDistribution(topNKeys: number) {
    const query = `
      WITH top_keys AS (
        SELECT key
        FROM attachments
        WHERE type = 'application/json' 
          AND body::jsonb ? 'tags'
          AND jsonb_typeof(body::jsonb->'tags') = 'object'
        CROSS JOIN LATERAL jsonb_each_text(body::jsonb->'tags')
        GROUP BY key
        ORDER BY COUNT(*) DESC
        LIMIT ${topNKeys}
      ),
      tag_values AS (
        SELECT 
          t.key,
          t.value,
          COUNT(*) as count
        FROM attachments a
        CROSS JOIN LATERAL jsonb_each_text(a.body::jsonb->'tags') t
        INNER JOIN top_keys tk ON t.key = tk.key
        WHERE a.type = 'application/json' 
          AND a.body::jsonb ? 'tags'
          AND jsonb_typeof(a.body::jsonb->'tags') = 'object'
        GROUP BY t.key, t.value
      )
      SELECT 
        key,
        value,
        count,
        ROUND(count::numeric / SUM(count) OVER (PARTITION BY key) * 100, 2) as percentage
      FROM tag_values
      ORDER BY key, count DESC
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getTagTemporalTrends() {
    const query = `
      SELECT 
        DATE_TRUNC('month', a.created_at) as month,
        t.key,
        COUNT(*) as usage_count
      FROM attachments a
      CROSS JOIN LATERAL jsonb_each_text(a.body::jsonb->'tags') t
      WHERE a.type = 'application/json' 
        AND a.body::jsonb ? 'tags'
        AND jsonb_typeof(a.body::jsonb->'tags') = 'object'
        AND a.created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', a.created_at), t.key
      ORDER BY month, usage_count DESC
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getContentStatistics() {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM vcons) as total_vcons,
        (SELECT COUNT(*) FROM parties) as total_parties,
        (SELECT COUNT(*) FROM dialog) as total_dialogs,
        (SELECT COUNT(*) FROM analysis) as total_analysis,
        (SELECT COUNT(*) FROM attachments) as total_attachments,
        (SELECT SUM(COALESCE(duration_seconds, 0)) FROM dialog) as total_duration_seconds,
        (SELECT AVG(COALESCE(duration_seconds, 0)) FROM dialog WHERE duration_seconds > 0) as avg_duration_seconds
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data && data.length > 0 ? data[0] : {};
  }

  private async getDialogAnalysis() {
    const query = `
      SELECT 
        type,
        COUNT(*) as count,
        AVG(COALESCE(duration_seconds, 0)) as avg_duration,
        SUM(COALESCE(duration_seconds, 0)) as total_duration,
        SUM(COALESCE(size_bytes, 0)) as total_size,
        AVG(COALESCE(size_bytes, 0)) as avg_size,
        COUNT(DISTINCT vcon_id) as unique_vcons
      FROM dialog
      GROUP BY type
      ORDER BY count DESC
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getAnalysisBreakdown() {
    const query = `
      SELECT 
        type,
        vendor,
        COUNT(*) as count,
        AVG(COALESCE(confidence, 0)) as avg_confidence,
        COUNT(DISTINCT vcon_id) as unique_vcons
      FROM analysis
      GROUP BY type, vendor
      ORDER BY count DESC
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getPartyPatterns() {
    const query = `
      SELECT 
        role,
        COUNT(*) as count,
        COUNT(DISTINCT name) as unique_names,
        COUNT(DISTINCT mailto) as unique_emails,
        COUNT(DISTINCT tel) as unique_phones,
        COUNT(DISTINCT vcon_id) as unique_vcons
      FROM parties
      GROUP BY role
      ORDER BY count DESC
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getConversationMetrics() {
    const query = `
      WITH conversation_metrics AS (
        SELECT 
          v.id as vcon_id,
          v.subject,
          COUNT(DISTINCT p.id) as party_count,
          COUNT(d.id) as dialog_count,
          COUNT(an.id) as analysis_count,
          COUNT(att.id) as attachment_count,
          SUM(COALESCE(d.duration_seconds, 0)) as total_duration,
          SUM(COALESCE(d.size_bytes, 0)) as total_size
        FROM vcons v
        LEFT JOIN parties p ON p.vcon_id = v.id
        LEFT JOIN dialog d ON d.vcon_id = v.id
        LEFT JOIN analysis an ON an.vcon_id = v.id
        LEFT JOIN attachments att ON att.vcon_id = v.id
        GROUP BY v.id, v.subject
      )
      SELECT 
        COUNT(*) as total_conversations,
        AVG(party_count) as avg_parties_per_conversation,
        AVG(dialog_count) as avg_dialogs_per_conversation,
        AVG(analysis_count) as avg_analysis_per_conversation,
        AVG(attachment_count) as avg_attachments_per_conversation,
        AVG(total_duration) as avg_duration_per_conversation,
        AVG(total_size) as avg_size_per_conversation,
        MAX(party_count) as max_parties_in_conversation,
        MAX(dialog_count) as max_dialogs_in_conversation
      FROM conversation_metrics
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data && data.length > 0 ? data[0] : {};
  }

  private async getTemporalContentPatterns() {
    const query = `
      SELECT 
        DATE_TRUNC('month', v.created_at) as month,
        COUNT(DISTINCT v.id) as vcon_count,
        COUNT(d.id) as dialog_count,
        COUNT(an.id) as analysis_count,
        COUNT(att.id) as attachment_count,
        SUM(COALESCE(d.duration_seconds, 0)) as total_duration
      FROM vcons v
      LEFT JOIN dialog d ON d.vcon_id = v.id
      LEFT JOIN analysis an ON an.vcon_id = v.id
      LEFT JOIN attachments att ON att.vcon_id = v.id
      WHERE v.created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', v.created_at)
      ORDER BY month
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getPerformanceMetrics() {
    const query = `
      SELECT 
        schemaname,
        tablename,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        n_live_tup as live_rows,
        n_dead_tup as dead_rows,
        ROUND(n_dead_tup::numeric / NULLIF(n_live_tup, 0) * 100, 2) as dead_row_percentage,
        ROUND(idx_scan::numeric / NULLIF(seq_scan + idx_scan, 0) * 100, 2) as index_usage_ratio
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY seq_scan + idx_scan DESC
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getStorageEfficiency() {
    const query = `
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
        pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as index_size,
        ROUND(
          (pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename))::numeric / 
          NULLIF(pg_total_relation_size(schemaname||'.'||tablename), 0) * 100, 2
        ) as index_size_percentage
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getIndexHealth() {
    const query = `
      SELECT 
        schemaname,
        tablename,
        indexname,
        idx_scan as scans,
        idx_tup_read as rows_read,
        idx_tup_fetch as rows_fetched,
        pg_size_pretty(pg_relation_size(schemaname||'.'||indexname)) as index_size,
        CASE 
          WHEN idx_scan = 0 AND indexname NOT LIKE '%_pkey' THEN 'UNUSED'
          WHEN idx_scan < 10 THEN 'LOW_USAGE'
          ELSE 'ACTIVE'
        END as health_status
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
      ORDER BY idx_scan DESC
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data || [];
  }

  private async getConnectionMetrics() {
    const query = `
      SELECT 
        sum(heap_blks_read) as heap_read,
        sum(heap_blks_hit) as heap_hit,
        sum(heap_blks_hit) / NULLIF((sum(heap_blks_hit) + sum(heap_blks_read)), 0) as cache_hit_ratio,
        sum(idx_blks_read) as idx_read,
        sum(idx_blks_hit) as idx_hit,
        sum(idx_blks_hit) / NULLIF((sum(idx_blks_hit) + sum(idx_blks_read)), 0) as idx_cache_hit_ratio
      FROM pg_statio_user_tables
    `;

    const { data, error } = await this.supabase.rpc('exec_sql', {
      q: query,
      params: {}
    });

    if (error) throw error;
    return data && data.length > 0 ? data[0] : {};
  }

  private async generateRecommendations(metrics: any) {
    const recommendations = [];
    const alerts = [];

    // Check for unused indexes
    if (metrics.indexes?.index_usage) {
      const unusedIndexes = metrics.indexes.index_usage.filter((idx: any) => idx.health_status === 'UNUSED');
      if (unusedIndexes.length > 0) {
        recommendations.push(`Consider dropping ${unusedIndexes.length} unused indexes to save storage space`);
        alerts.push(`Found ${unusedIndexes.length} unused indexes`);
      }
    }

    // Check cache hit ratio
    if (metrics.connections?.cache_hit_ratio < 0.9) {
      recommendations.push('Cache hit ratio is below 90%. Consider increasing shared_buffers or check for inefficient queries');
      alerts.push('Low cache hit ratio detected');
    }

    // Check for high dead row percentage
    if (metrics.performance?.table_performance) {
      const highDeadRows = metrics.performance.table_performance.filter((table: any) => table.dead_row_percentage > 20);
      if (highDeadRows.length > 0) {
        recommendations.push('Some tables have high dead row percentage. Consider running VACUUM');
        alerts.push(`High dead row percentage in ${highDeadRows.length} tables`);
      }
    }

    return {
      recommendations,
      alerts,
    };
  }

  private calculateGrowthSummary(monthlyData: any[]) {
    if (monthlyData.length === 0) return { total_growth: 0, avg_monthly_growth: 0 };

    const first = monthlyData[0];
    const last = monthlyData[monthlyData.length - 1];
    
    const totalGrowth = last.vcon_count - first.vcon_count;
    const avgMonthlyGrowth = totalGrowth / monthlyData.length;

    return {
      total_growth: totalGrowth,
      avg_monthly_growth: Math.round(avgMonthlyGrowth * 100) / 100,
      growth_percentage: first.vcon_count > 0 ? Math.round((totalGrowth / first.vcon_count) * 100 * 100) / 100 : 0,
    };
  }
}
