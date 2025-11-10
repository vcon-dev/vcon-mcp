/**
 * Tenant Configuration and Extraction
 * 
 * Provides configurable tenant extraction from vCon attachments
 * for Row Level Security (RLS) multi-tenant isolation.
 */

import { VCon, Attachment } from '../types/vcon.js';

export interface TenantConfig {
  enabled: boolean;
  attachmentType: string;
  jsonPath: string;
  currentTenantId?: string;
}

/**
 * Get tenant configuration from environment variables
 */
export function getTenantConfig(): TenantConfig {
  const enabled = process.env.RLS_ENABLED === 'true';
  const attachmentType = process.env.TENANT_ATTACHMENT_TYPE || 'tenant';
  const jsonPath = process.env.TENANT_JSON_PATH || 'id';
  const currentTenantId = process.env.CURRENT_TENANT_ID;

  return {
    enabled,
    attachmentType,
    jsonPath,
    currentTenantId,
  };
}

/**
 * Extract tenant ID from a single attachment
 * 
 * @param attachment - The attachment to check
 * @param config - Tenant configuration
 * @returns The tenant ID if found, null otherwise
 */
export function extractTenantFromAttachment(
  attachment: Attachment,
  config: TenantConfig
): string | null {
  // Check if attachment type matches
  if (attachment.type !== config.attachmentType) {
    return null;
  }

  // If no body, cannot extract tenant
  if (!attachment.body) {
    return null;
  }

  // Try to parse body as JSON
  let bodyData: any;
  try {
    // Handle different encodings
    if (attachment.encoding === 'json' || !attachment.encoding) {
      bodyData = JSON.parse(attachment.body);
    } else {
      // For other encodings, try parsing anyway (might be plain JSON)
      bodyData = JSON.parse(attachment.body);
    }
  } catch (e) {
    // Not valid JSON, cannot extract tenant
    return null;
  }

  // Extract value from JSON path (simple dot notation support)
  const pathParts = config.jsonPath.split('.');
  let value: any = bodyData;
  
  for (const part of pathParts) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return null;
    }
    value = value[part];
  }

  // Convert to string if found
  if (value !== null && value !== undefined) {
    return String(value);
  }

  return null;
}

/**
 * Extract tenant ID from vCon attachments array
 * 
 * @param vcon - The vCon object
 * @param config - Tenant configuration
 * @returns The tenant ID if found, null otherwise
 */
export function extractTenantFromVCon(
  vcon: VCon,
  config: TenantConfig
): string | null {
  if (!vcon.attachments || vcon.attachments.length === 0) {
    return null;
  }

  // Search through attachments for tenant attachment
  for (const attachment of vcon.attachments) {
    const tenantId = extractTenantFromAttachment(attachment, config);
    if (tenantId) {
      return tenantId;
    }
  }

  return null;
}

/**
 * Get current tenant ID from configuration or JWT claims
 * 
 * This is used for RLS policies to determine which tenant
 * the current user/service should have access to.
 * 
 * @param config - Tenant configuration
 * @returns The current tenant ID, or null if not set
 */
export function getCurrentTenantId(config: TenantConfig): string | null {
  // First check environment variable (for service role)
  if (config.currentTenantId) {
    return config.currentTenantId;
  }

  // TODO: In the future, could extract from JWT claims
  // For now, return null if not set via env var
  return null;
}

