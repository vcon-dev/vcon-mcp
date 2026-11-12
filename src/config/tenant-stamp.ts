/**
 * The TENANT_MODE=writer stamp rule.
 *
 * Every vCon written in writer mode is stored under exactly one tenant. The
 * tenant comes from the vCon's tenant attachment:
 *
 *   {"purpose": "tenant", "encoding": "json", "body": {"id": "t-0123456789abcdef"}, ...}
 *
 * A missing, malformed or conflicting stamp stores the vCon under the reserved
 * tenant `_quarantine`. Nothing is dropped because of tenancy. Only the staff
 * function release_vcon_from_quarantine() moves a vCon out of quarantine.
 *
 * What counts as a tenant attachment: `purpose` or the legacy `type` equal to
 * TENANT_ATTACHMENT_TYPE (default `tenant`).
 *
 * What counts as malformed, for any one tenant attachment:
 *   - no body, or an empty string body
 *   - `encoding: base64url` (the body is not read)
 *   - a string body that is not JSON, or JSON that is not an object
 *   - no value at TENANT_JSON_PATH (default `id`), or a value that is not a string
 *   - an id that is not `t-` plus 16 lowercase hex digits, or is `_quarantine`
 *     (no trimming, no case folding)
 * An object body and a JSON-string body are both read, whatever the encoding
 * says, apart from base64url.
 *
 * What counts as conflicting: two tenant attachments naming different ids. The
 * same id twice is not a conflict. One malformed attachment beside a good one
 * quarantines the vCon, since the stamp can no longer be trusted.
 *
 * supabase/migrations/20261112120100_fix_tenant_backfill.sql applies the same
 * rule in SQL (vcon_tenant_stamp with p_strict = true), for the default
 * attachment type `tenant` and path `id` only.
 */

import { Attachment, VCon } from '../types/vcon.js';
import { TenantConfig } from './tenant-config.js';

export const QUARANTINE_TENANT = '_quarantine';

/** A tenant id: `t-` plus 16 lowercase hex digits. */
export const TENANT_ID_PATTERN = /^t-[0-9a-f]{16}$/;

export type StampStatus = 'ok' | 'missing' | 'malformed' | 'conflict';

export interface WriterTenant {
  /** The tenant the vCon is stored under: the stamped id, or `_quarantine`. */
  tenantId: string;
  status: StampStatus;
  /** Why the vCon went to quarantine. Never holds body content. */
  detail?: string;
}

type AttachmentStamp = { ok: true; id: string } | { ok: false; detail: string };

export function isValidTenantId(value: unknown): value is string {
  return typeof value === 'string' && TENANT_ID_PATTERN.test(value);
}

export function isTenantAttachment(attachment: Attachment, config: TenantConfig): boolean {
  return attachment.purpose === config.attachmentType || attachment.type === config.attachmentType;
}

/** Read one tenant attachment under the writer rule. */
export function readTenantStamp(attachment: Attachment, config: TenantConfig): AttachmentStamp {
  const body: unknown = attachment.body;
  if (body === undefined || body === null || body === '') {
    return { ok: false, detail: 'tenant attachment has no body' };
  }
  if (attachment.encoding === 'base64url') {
    return { ok: false, detail: 'tenant attachment body is base64url' };
  }

  let data: unknown = body;
  if (typeof body === 'string') {
    try {
      data = JSON.parse(body);
    } catch {
      return { ok: false, detail: 'tenant attachment body is not JSON' };
    }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, detail: 'tenant attachment body is not a JSON object' };
  }

  let value: unknown = data;
  for (const part of config.jsonPath.split('.')) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      value = undefined;
      break;
    }
    value = (value as Record<string, unknown>)[part];
  }

  if (value === undefined || value === null) {
    return { ok: false, detail: `tenant attachment has no ${config.jsonPath}` };
  }
  if (typeof value !== 'string') {
    return { ok: false, detail: `tenant attachment ${config.jsonPath} is not a string` };
  }
  if (value === QUARANTINE_TENANT) {
    return { ok: false, detail: `tenant attachment names the reserved ${QUARANTINE_TENANT}` };
  }
  if (!TENANT_ID_PATTERN.test(value)) {
    return { ok: false, detail: `tenant attachment ${config.jsonPath} is not t- and 16 lowercase hex digits` };
  }
  return { ok: true, id: value };
}

/**
 * Decide the tenant a vCon is stored under in writer mode. Always returns a
 * tenant: the stamped id, or `_quarantine` with the reason.
 */
export function resolveWriterTenant(vcon: VCon, config: TenantConfig): WriterTenant {
  const stamps = (vcon.attachments ?? [])
    .filter((attachment) => attachment && isTenantAttachment(attachment, config))
    .map((attachment) => readTenantStamp(attachment, config));

  if (stamps.length === 0) {
    return { tenantId: QUARANTINE_TENANT, status: 'missing', detail: 'no tenant attachment' };
  }

  const bad = stamps.find((s): s is { ok: false; detail: string } => !s.ok);
  if (bad) {
    return { tenantId: QUARANTINE_TENANT, status: 'malformed', detail: bad.detail };
  }

  const ids = new Set(stamps.map((s) => (s as { ok: true; id: string }).id));
  if (ids.size > 1) {
    return {
      tenantId: QUARANTINE_TENANT,
      status: 'conflict',
      detail: `${ids.size} tenant attachments name different tenants`,
    };
  }

  return { tenantId: [...ids][0], status: 'ok' };
}
