/**
 * Taxonomy Configuration
 *
 * Deployment-specific guidance returned by vcon_taxonomy and vcon_capabilities
 * (dataset label, portal classification values, tag hints, the attachment type
 * that carries dealer data). The public defaults are neutral: no dataset label,
 * no portal values, and a generic dealer attachment type. A deployment restores
 * its own guidance through environment variables and an optional JSON file.
 *
 * Environment:
 *   VCON_TAXONOMY_CONFIG         Path to a JSON file (keys below, all optional)
 *   VCON_TAXONOMY_DATASET        Dataset label (overrides the file's "dataset")
 *   VCON_DEALER_ATTACHMENT_TYPE  Attachment type holding dealer data
 *                                (overrides the file's "dealer_attachment_type")
 *
 * JSON file keys: dataset, dealer_attachment_type, portal_values, common_tags,
 * preferred_sources, query_recipes, bad_call_signals, recommended_patterns.
 * Array keys present in the file replace the built-in defaults verbatim.
 */

import { readFileSync } from 'fs';
import { createLogger } from '../observability/logger.js';

export const DEFAULT_DEALER_ATTACHMENT_TYPE = 'dealer';

export interface TaxonomyConfig {
  /** Dataset label reported by vcon_taxonomy; null when not configured. */
  dataset: string | null;
  /** Attachment `type` that carries dealer data. */
  dealerAttachmentType: string;
  /** Overrides for vcon_taxonomy sections; undefined means use built-in defaults. */
  portalValues?: unknown[];
  commonTags?: unknown[];
  preferredSources?: unknown[];
  queryRecipes?: unknown[];
  /** vcon_capabilities taxonomy_hints.preferred_bad_call_signals. */
  badCallSignals?: string[];
  /** vcon_capabilities search.recommended_patterns. */
  recommendedPatterns?: string[];
}

const ARRAY_KEYS = [
  'portal_values',
  'common_tags',
  'preferred_sources',
  'query_recipes',
  'bad_call_signals',
  'recommended_patterns',
] as const;

const logger = createLogger('taxonomy-config');

let cachedPath: string | undefined;
let cachedFile: Record<string, unknown> = {};

/**
 * Read and validate the JSON file once per path. A missing or malformed file logs
 * one warning and falls back to the built-in defaults; the failure is cached so
 * the file is not re-read on every call.
 */
function readConfigFile(path: string | undefined): Record<string, unknown> {
  if (!path) return {};
  if (path === cachedPath) return cachedFile;
  cachedPath = path;
  cachedFile = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('file must contain a JSON object');
    }
    const file = parsed as Record<string, unknown>;
    for (const key of ARRAY_KEYS) {
      if (file[key] !== undefined && !Array.isArray(file[key])) {
        throw new Error(`key "${key}" must be an array`);
      }
    }
    cachedFile = file;
  } catch (error) {
    logger.warn(
      { path, error: error instanceof Error ? error.message : String(error) },
      'VCON_TAXONOMY_CONFIG could not be used; falling back to default taxonomy guidance',
    );
  }
  return cachedFile;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalArray<T = unknown>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value as T[]) : undefined;
}

/**
 * Get taxonomy configuration from environment variables and the optional JSON file.
 * The file is read once per path and cached, including a failed read.
 */
export function getTaxonomyConfig(): TaxonomyConfig {
  const file = readConfigFile(nonEmptyString(process.env.VCON_TAXONOMY_CONFIG));

  return {
    dataset: nonEmptyString(process.env.VCON_TAXONOMY_DATASET) ?? nonEmptyString(file.dataset) ?? null,
    dealerAttachmentType:
      nonEmptyString(process.env.VCON_DEALER_ATTACHMENT_TYPE) ??
      nonEmptyString(file.dealer_attachment_type) ??
      DEFAULT_DEALER_ATTACHMENT_TYPE,
    portalValues: optionalArray(file.portal_values),
    commonTags: optionalArray(file.common_tags),
    preferredSources: optionalArray(file.preferred_sources),
    queryRecipes: optionalArray(file.query_recipes),
    badCallSignals: optionalArray<string>(file.bad_call_signals),
    recommendedPatterns: optionalArray<string>(file.recommended_patterns),
  };
}
