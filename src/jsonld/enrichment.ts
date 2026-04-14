
import { Analysis, VCon } from '../types/vcon.js';
import { VCON_CONTEXT, JsonLdDocument } from './context.js';

/**
 * Extended Analysis type including JSON-LD extensions
 */
export interface EnrichedAnalysis extends Analysis, JsonLdDocument {
    "@confidence"?: number;
    "@source"?: string;
}

/**
 * Extended vCon type including JSON-LD context and extensions
 */
export interface EnrichedVCon extends VCon, JsonLdDocument {
    "@integrity"?: string;
}

/**
 * Enriches an Analysis object with confidence score and source provenance.
 * 
 * @param analysis The original Analysis object
 * @param confidence Confidence score (0.0 to 1.0)
 * @param source URI of the model or agent that generated the analysis
 * @returns EnrichedAnalysis object
 */
export function enrichAnalysis(
    analysis: Analysis,
    confidence?: number,
    source?: string
): EnrichedAnalysis {
    const enriched: EnrichedAnalysis = { ...analysis };

    if (confidence !== undefined) {
        if (confidence < 0 || confidence > 1) {
            throw new Error("Confidence score must be between 0.0 and 1.0");
        }
        enriched["@confidence"] = confidence;
    }

    if (source) {
        enriched["@source"] = source;
    }

    return enriched;
}

/**
 * Converts a standard vCon to a JSON-LD EnrichedVCon.
 * Adds the @context definition.
 * 
 * @param vcon The original vCon object
 * @returns EnrichedVCon with @context
 */
export function toJsonLd(vcon: VCon): EnrichedVCon {
    return {
        "@context": VCON_CONTEXT["@context"],
        ...vcon,
        // Safely cast analysis array if it exists to allow for EnrichedAnalysis
        analysis: vcon.analysis as EnrichedAnalysis[] | undefined
    };
}
