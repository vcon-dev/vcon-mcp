
import { DatabaseSizeInfo, SmartLimits } from './types.js';

/**
 * Shared utility to calculate smart search limits based on database size.
 * Used by both Supabase and MongoDB implementations to ensure consistent behavior.
 */
export function calculateSmartSearchLimits(
    sizeInfo: DatabaseSizeInfo,
    queryType: string,
    estimatedResultSize: string
): SmartLimits {
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
