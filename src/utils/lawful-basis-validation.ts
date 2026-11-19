/**
 * Validation of lawful basis attachment bodies (draft-howe-vcon-lawful-basis).
 *
 * A port of the reference library's LawfulBasisValidator
 * (vcon-lib 1.0.5, vcon.extensions.lawful_basis.validation) with the same
 * messages, by way of vcon-js (src/lawful-basis.ts, MIT). It never throws on a
 * malformed body: every problem is an error or a warning. Values outside the
 * draft's open vocabularies (proof type, hash algorithm, canonicalization,
 * registry type) are warnings.
 */
import { isPlainObject, parsePyIsoformat, pyRepr, pyStr } from './py-compat.js';

export const LAWFUL_BASIS_TYPES = [
  'consent',
  'contract',
  'legal_obligation',
  'vital_interests',
  'public_task',
  'legitimate_interests'
];
export const LAWFUL_BASIS_PROOF_TYPES = [
  'verbal_confirmation',
  'signed_document',
  'cryptographic_signature',
  'external_system'
];
export const LAWFUL_BASIS_HASH_ALGORITHMS = ['sha-256', 'sha-3-256', 'blake2b-256'];
export const LAWFUL_BASIS_CANONICALIZATION = ['jcs'];

export interface LawfulBasisValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function newResult(): LawfulBasisValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

function addError(result: LawfulBasisValidationResult, error: string): void {
  result.errors.push(error);
  result.valid = false;
}

/**
 * Read a field of a value that should be an object. A value that is not an
 * object is treated as an empty one, so it reports its required fields as
 * missing, as the reference does.
 */
function fields(value: unknown): Record<string, any> {
  return isPlainObject(value) ? value : {};
}

function isoTimestampOk(value: unknown): boolean {
  return typeof value === 'string' && parsePyIsoformat(value.replace(/Z/g, '+00:00')) !== undefined;
}

/** The decoded body: a JSON string under encoding json (or none) is parsed. */
function decodeBody(attachment: Record<string, any>): unknown {
  const body = attachment.body;
  if (body === undefined || body === null) return null;
  if (typeof body === 'string' && (attachment.encoding === undefined || attachment.encoding === null || attachment.encoding === 'json')) {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
}

/** Validate a lawful basis attachment object. */
export function validateLawfulBasisAttachment(attachment: Record<string, any>): LawfulBasisValidationResult {
  const result = newResult();
  if (attachment.purpose !== 'lawful_basis') {
    addError(result, 'Invalid attachment purpose for lawful basis extension');
    return result;
  }
  if (attachment.encoding !== 'json') {
    addError(result, "Lawful basis attachment must use 'json' encoding");
  }
  // Core-05 scope (4.6.3 to 4.6.5). Warnings, so a bare attachment can be
  // checked before it is placed in a vCon; the document rules enforce party and
  // dialog/session.
  if (!('party' in attachment)) {
    result.warnings.push('Lawful basis attachment has no party (core-05 requires it)');
  }
  if (!('session' in attachment)) {
    result.warnings.push(
      'Lawful basis attachment has no session; core-05 scopes a basis to Sessions' +
        ('dialog' in attachment ? '' : ' and an attachment needs dialog or session')
    );
  }
  const body = decodeBody(attachment);
  if (!isPlainObject(body)) {
    addError(result, 'Lawful basis attachment body must be a dictionary');
    return result;
  }
  const bodyResult = validateLawfulBasisBody(body);
  result.warnings.push(...bodyResult.warnings);
  if (!bodyResult.valid) {
    result.errors.push(...bodyResult.errors);
    result.valid = false;
  }
  return result;
}

/** Validate the body of a lawful basis attachment. */
export function validateLawfulBasisBody(body: Record<string, any>): LawfulBasisValidationResult {
  const result = newResult();
  for (const field of ['lawful_basis', 'expiration', 'purpose_grants']) {
    if (!(field in body)) addError(result, `Missing required field: ${field}`);
  }
  if ('lawful_basis' in body && !LAWFUL_BASIS_TYPES.includes(body.lawful_basis)) {
    addError(result, `Unsupported lawful basis: ${pyStr(body.lawful_basis)}`);
  }
  if ('expiration' in body && body.expiration !== null) {
    const exp = typeof body.expiration === 'string' ? parsePyIsoformat(body.expiration.replace(/Z/g, '+00:00')) : undefined;
    if (exp === undefined) {
      addError(result, 'Invalid expiration timestamp format');
    } else if (exp.micros <= Date.now() * 1000) {
      // A value without an offset is read as UTC, as the reference does.
      result.warnings.push('Lawful basis has expired');
    }
  }
  if ('purpose_grants' in body) {
    const grants = body.purpose_grants;
    if (!Array.isArray(grants)) {
      addError(result, 'purpose_grants must be a list');
    } else {
      grants.forEach((grant, i) => {
        const g = validatePurposeGrant(grant);
        if (!g.valid) addError(result, `Purpose grant ${i}: ${g.errors.join(', ')}`);
        result.warnings.push(...g.warnings.map(w => `Grant ${i}: ${w}`));
      });
    }
  }
  if ('content_hash' in body) {
    const h = validateLawfulBasisContentHash(body.content_hash);
    result.warnings.push(...h.warnings.map(w => `Content hash: ${w}`));
    if (!h.valid) addError(result, `Content hash validation failed: ${h.errors.join(', ')}`);
  }
  if ('proof_mechanisms' in body) {
    const proofs = body.proof_mechanisms;
    if (!Array.isArray(proofs)) {
      addError(result, 'proof_mechanisms must be a list');
    } else {
      proofs.forEach((proof, i) => {
        const p = validateProofMechanism(proof);
        result.warnings.push(...p.warnings.map(w => `Proof mechanism ${i}: ${w}`));
        if (!p.valid) addError(result, `Proof mechanism ${i}: ${p.errors.join(', ')}`);
      });
    }
  }
  if ('registry' in body) {
    const r = validateRegistryInfo(body.registry);
    if (!r.valid) addError(result, `Registry validation failed: ${r.errors.join(', ')}`);
  }
  return result;
}

function validatePurposeGrant(value: unknown): LawfulBasisValidationResult {
  const result = newResult();
  const grant = fields(value);
  for (const field of ['purpose', 'granted', 'granted_at']) {
    if (!(field in grant)) addError(result, `Missing required field in purpose grant: ${field}`);
  }
  if ('granted' in grant && typeof grant.granted !== 'boolean') {
    addError(result, 'granted field must be a boolean');
  }
  if ('granted_at' in grant && !isoTimestampOk(grant.granted_at)) {
    addError(result, 'Invalid granted_at timestamp format');
  }
  if ('conditions' in grant) {
    const conditions = grant.conditions;
    if (!Array.isArray(conditions)) addError(result, 'conditions must be a list');
    else if (!conditions.every(c => typeof c === 'string')) addError(result, 'All conditions must be strings');
  }
  return result;
}

function validateLawfulBasisContentHash(value: unknown): LawfulBasisValidationResult {
  const result = newResult();
  const contentHash = fields(value);
  for (const field of ['algorithm', 'canonicalization', 'value']) {
    if (!(field in contentHash)) addError(result, `Missing required field in content_hash: ${field}`);
  }
  if ('algorithm' in contentHash && !LAWFUL_BASIS_HASH_ALGORITHMS.includes(contentHash.algorithm)) {
    result.warnings.push(`Hash algorithm ${pyRepr(contentHash.algorithm)} is not one this library can verify`);
  }
  if ('canonicalization' in contentHash && !LAWFUL_BASIS_CANONICALIZATION.includes(contentHash.canonicalization)) {
    result.warnings.push(
      `Canonicalization method ${pyRepr(contentHash.canonicalization)} is not one this library can apply`
    );
  }
  if ('value' in contentHash && !(typeof contentHash.value === 'string' && /^[0-9a-fA-F]*$/.test(contentHash.value))) {
    addError(result, 'Hash value must be a hexadecimal string');
  }
  return result;
}

function validateProofMechanism(value: unknown): LawfulBasisValidationResult {
  const result = newResult();
  const proof = fields(value);
  for (const field of ['proof_type', 'timestamp', 'proof_data']) {
    if (!(field in proof)) addError(result, `Missing required field in proof mechanism: ${field}`);
  }
  if ('proof_type' in proof && !LAWFUL_BASIS_PROOF_TYPES.includes(proof.proof_type)) {
    result.warnings.push(`Proof type ${pyRepr(proof.proof_type)} is not one of the types the draft defines`);
  }
  if ('timestamp' in proof && !isoTimestampOk(proof.timestamp)) {
    addError(result, 'Invalid timestamp format in proof mechanism');
  }
  if ('proof_data' in proof && !isPlainObject(proof.proof_data)) {
    addError(result, 'proof_data must be a dictionary');
  }
  return result;
}

function validateRegistryInfo(value: unknown): LawfulBasisValidationResult {
  const result = newResult();
  const registry = fields(value);
  for (const field of ['type', 'url']) {
    if (!(field in registry)) addError(result, `Missing required field in registry: ${field}`);
  }
  if ('type' in registry && registry.type !== 'scitt') {
    result.warnings.push(`Unknown registry type: ${pyStr(registry.type)}`);
  }
  if ('url' in registry) {
    const url = registry.url;
    if (typeof url !== 'string' || !(url.startsWith('http://') || url.startsWith('https://'))) {
      addError(result, 'Registry URL must be a valid HTTP/HTTPS URL');
    }
  }
  return result;
}
