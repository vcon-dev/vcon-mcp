/**
 * Lawful basis detection (draft-howe-vcon-lawful-basis).
 *
 * Pure, read-only helpers. Nothing here creates, defaults, or infers a lawful
 * basis or consent record: they only report on what the caller supplied.
 */

export const LAWFUL_BASIS_PURPOSE = 'lawful_basis';

export const LAWFUL_BASIS_VALUES = [
  'consent',
  'contract',
  'legal_obligation',
  'vital_interests',
  'public_task',
  'legitimate_interests',
] as const;

export const MISSING_LAWFUL_BASIS_WARNING =
  'no lawful_basis attachment: this vCon carries no record of the lawful basis for processing';

interface AttachmentLike {
  purpose?: unknown;
  type?: unknown;
  body?: unknown;
}

interface VConLike {
  attachments?: unknown;
}

function lawfulBasisAttachments(vcon: VConLike | null | undefined): AttachmentLike[] {
  const attachments = vcon?.attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.filter(
    (a): a is AttachmentLike =>
      !!a &&
      typeof a === 'object' &&
      ((a as AttachmentLike).purpose === LAWFUL_BASIS_PURPOSE ||
        // Legacy spelling: pre-0.4.0 attachments used `type` for classification.
        (a as AttachmentLike).type === LAWFUL_BASIS_PURPOSE)
  );
}

/** True when attachments[] holds an entry with purpose (or legacy type) "lawful_basis". */
export function hasLawfulBasis(vcon: VConLike | null | undefined): boolean {
  return lawfulBasisAttachments(vcon).length > 0;
}

function parseBody(body: unknown): Record<string, unknown> | null {
  let value = body;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Warnings about lawful basis presence and quality. Empty array means a
 * well-formed attachment is present. Never throws.
 */
export function lawfulBasisWarnings(
  vcon: VConLike | null | undefined,
  now: Date = new Date()
): string[] {
  const found = lawfulBasisAttachments(vcon);
  if (found.length === 0) return [MISSING_LAWFUL_BASIS_WARNING];

  const warnings: string[] = [];
  found.forEach((att, i) => {
    const label = found.length > 1 ? `lawful_basis attachment ${i}` : 'lawful_basis attachment';
    const body = parseBody(att.body);
    if (!body) {
      warnings.push(`${label}: body is missing or not a JSON object`);
      return;
    }

    const basis = body.lawful_basis;
    if (typeof basis !== 'string' || !(LAWFUL_BASIS_VALUES as readonly string[]).includes(basis)) {
      warnings.push(`${label}: lawful_basis must be one of ${LAWFUL_BASIS_VALUES.join(', ')}`);
    }

    const expiration = body.expiration;
    if (expiration === undefined || expiration === null) {
      if (basis !== 'legitimate_interests') {
        warnings.push(`${label}: expiration is missing (only legitimate_interests may omit it)`);
      }
    } else {
      const t = typeof expiration === 'string' ? Date.parse(expiration) : NaN;
      if (Number.isNaN(t)) {
        warnings.push(`${label}: expiration is not a valid datetime`);
      } else if (t < now.getTime()) {
        warnings.push(`${label}: expiration is in the past`);
      }
    }

    if (!Array.isArray(body.purpose_grants) || body.purpose_grants.length === 0) {
      warnings.push(`${label}: purpose_grants is empty`);
    }
    if (!Array.isArray(body.proof_mechanisms) || body.proof_mechanisms.length === 0) {
      warnings.push(`${label}: proof_mechanisms is empty`);
    }
  });
  return warnings;
}
