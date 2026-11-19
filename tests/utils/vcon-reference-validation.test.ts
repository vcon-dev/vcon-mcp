/**
 * The reference validation (vcon-lib 1.0.5): content_hash form, url without
 * content_hash, JSON bodies serialized as strings, lawful_basis bodies,
 * created_at offsets, and signed (JWS) / encrypted (JWE) containers. Expected
 * messages are the reference's, verbatim.
 */

import { describe, it, expect } from 'vitest';
import {
  contentHashProblems,
  lawfulBasisFindings,
  signedPayload,
  validateReference,
  validateVconDict,
} from '../../src/utils/vcon-reference-validation.js';
import { validateVConDocument } from '../../src/utils/vcon-validation.js';
import { computeContentHash } from '../../src/utils/media-storage.js';

const T = '2026-01-01T00:00:00Z';
const HASH = 'sha512-K7gkq531t9atY96FBDkQ9b7tiTZxnlO-X17gnDOayQY6NU4tWLz6AXZxFK7R_l_kqwI_iDUVkqvg2ljFK0Z-4Q';
const doc = (extra: Record<string, any> = {}): any => ({
  vcon: '0.5.0',
  uuid: '018f0000-0000-7000-8000-000000000001',
  created_at: T,
  parties: [{ name: 'A' }, { name: 'B' }],
  sessions: [{ start: T, parties: [0, 1], dialog: [0] }],
  dialog: [{ type: 'recording', start: T, parties: [0], mediatype: 'audio/x-wav', url: 'https://example.com/a.wav', content_hash: HASH }],
  attachments: [],
  ...extra,
});
const att = (extra: Record<string, any> = {}): any => ({
  purpose: 'note', start: T, party: 0, session: 0, mediatype: 'text/plain', encoding: 'none', body: 'x', ...extra,
});
const basis = (body: unknown): any => att({ purpose: 'lawful_basis', mediatype: 'application/json', encoding: 'json', body });
const goodBasis = {
  lawful_basis: 'consent',
  expiration: '2999-01-01T00:00:00Z',
  purpose_grants: [{ purpose: 'recording', granted: true, granted_at: T }],
};
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

describe('content_hash', () => {
  it('accepts <algorithm>-<unpadded base64url> with the right digest length', () => {
    expect(contentHashProblems(HASH)).toEqual([]);
    expect(contentHashProblems([HASH, 'sha256-' + 'A'.repeat(43)])).toEqual([]);
    expect(contentHashProblems('blake3-anything_goes-123')).toEqual([]);
  });

  it('reports hex digests, padding, separators, a trailing newline, non-strings and an empty array', () => {
    expect(contentHashProblems('sha256-' + 'a'.repeat(64))).toEqual([
      `'sha256-${'a'.repeat(64)}' has a sha256 digest of 64 base64url characters, expected 43`,
    ]);
    expect(contentHashProblems('sha-256:abcd')).toEqual(["'sha-256:abcd' is not of the form '<algorithm>-<base64url digest>'"]);
    expect(contentHashProblems(HASH + '==')).toHaveLength(1);
    expect(contentHashProblems(HASH + '\n')).toEqual([`'${HASH}\\n' is not of the form '<algorithm>-<base64url digest>'`]);
    expect(contentHashProblems(5)).toEqual(['5 is not a string']);
    expect(contentHashProblems([])).toEqual(['must not be an empty array']);
  });

  it('is an error on Dialog, Attachment, Analysis, redacted_from and amended_from', () => {
    const bad = 'sha512-x';
    const { errors } = validateVconDict(doc({
      dialog: [{ ...doc().dialog[0], content_hash: bad }],
      attachments: [att({ content_hash: bad })],
      analysis: [{ type: 'summary', vendor: 'v', dialog: 0, encoding: 'none', body: 's', content_hash: bad }],
      redacted_from: { type: 'pii', uuid: '018f0000-0000-7000-8000-000000000002', content_hash: bad },
    }));
    const msg = "has an invalid content_hash: 'sha512-x' has a sha512 digest of 1 base64url characters, expected 86.";
    expect(errors).toEqual(expect.arrayContaining([
      `redacted_from ${msg}`, `Dialog at index 0 ${msg}`, `Attachment at index 0 ${msg}`, `Analysis at index 0 ${msg}`,
    ]));
  });

  it('the media offload writes a valid ContentHash', () => {
    expect(contentHashProblems(computeContentHash(Buffer.from('audio')))).toEqual([]);
  });
});

describe('warnings for url without content_hash and JSON bodies as strings', () => {
  it('warns (an error from vcon 1.1) on a url with no content_hash', () => {
    const { content_hash: _h, ...noHash } = doc().dialog[0];
    const { errors, warnings } = validateVconDict(doc({ dialog: [noHash] }));
    expect(errors).toEqual([]);
    expect(warnings).toContain(
      'Dialog at index 0 has a url but no content_hash (an external reference MUST have both; this will be an error in vcon 1.1).'
    );
  });

  it('warns when an encoding json body is a serialized JSON string', () => {
    const { warnings } = validateVconDict(doc({ attachments: [att({ encoding: 'json', mediatype: 'application/json', body: '{"a":1}' })] }));
    expect(warnings).toContain(
      "Attachment at index 0 has encoding 'json' and a body that is a serialized JSON string; the body should be the JSON value itself (section 2.3.2)."
    );
  });
});

describe('created_at', () => {
  it('rejects an offset of 24 hours or more, as the reference does', () => {
    expect(validateVconDict(doc({ created_at: '2026-01-01T00:00:00+24:00' })).errors).toEqual([
      'Invalid created_at format. Must be an ISO 8601 datetime string: offset must be a timedelta strictly between -timedelta(hours=24) and timedelta(hours=24).',
    ]);
    expect(validateVconDict(doc({ created_at: '2026-01-01T00:00:00+23:59' })).errors).toEqual([]);
  });

  it('is checked on the accept path too', () => {
    expect(validateVConDocument(doc({ created_at: 'not-a-date' })).errors).toEqual([
      'Invalid created_at format. Must be an ISO 8601 datetime string: Unknown string format: not-a-date',
    ]);
  });
});

describe('lawful_basis bodies', () => {
  it('accepts a complete basis', () => {
    expect(validateReference(doc({ attachments: [basis(goodBasis)], extensions: ['lawful_basis'] })).errors).toEqual([]);
  });

  it('reports missing fields with the attachment prefix, and never throws on malformed values', () => {
    const v = doc({
      attachments: [basis({ lawful_basis: ['x'], expiration: 5, purpose_grants: ['not an object'], registry: 'r', content_hash: 3 })],
      extensions: ['lawful_basis'],
    });
    expect(lawfulBasisFindings(v).errors).toEqual([
      "Attachment at index 0 (lawful_basis): Unsupported lawful basis: ['x']",
      'Attachment at index 0 (lawful_basis): Invalid expiration timestamp format',
      'Attachment at index 0 (lawful_basis): Purpose grant 0: Missing required field in purpose grant: purpose, Missing required field in purpose grant: granted, Missing required field in purpose grant: granted_at',
      'Attachment at index 0 (lawful_basis): Content hash validation failed: Missing required field in content_hash: algorithm, Missing required field in content_hash: canonicalization, Missing required field in content_hash: value',
      'Attachment at index 0 (lawful_basis): Registry validation failed: Missing required field in registry: type, Missing required field in registry: url',
    ]);
  });

  it('reports values outside the open vocabularies as warnings', () => {
    const body = { ...goodBasis, proof_mechanisms: [{ proof_type: 'carrier-attestation', timestamp: T, proof_data: {} }] };
    const f = lawfulBasisFindings(doc({ attachments: [basis(body)] }));
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual([
      "Attachment at index 0 (lawful_basis): Proof mechanism 0: Proof type 'carrier-attestation' is not one of the types the draft defines",
    ]);
  });

  it('are warnings, not errors, on the accept path', () => {
    const v = doc({ attachments: [basis({ lawful_basis: 'consent' })], extensions: ['lawful_basis'] });
    const f = validateVConDocument(v);
    expect(f.errors).toEqual([]);
    expect(f.warnings).toContain('Attachment at index 0 (lawful_basis): Missing required field: expiration');
  });
});

describe('signed (JWS) and encrypted (JWE) vCons', () => {
  const payload = doc();

  it('validates a JWS as a JWS and its payload as a vCon', () => {
    const jws = { payload: b64(payload), signatures: [{ protected: b64({ alg: 'RS256' }), signature: 'sig' }] };
    expect(signedPayload(jws)).toEqual(payload);
    expect(validateVconDict(jws)).toEqual({ errors: [], warnings: [] });
    const { uuid: _uuid, ...noUuid } = payload;
    const broken = { payload: b64(noUuid), signatures: [] };
    expect(validateVconDict(broken).errors).toEqual([
      "Signed vCon: 'signatures' must be a non-empty array.",
      'Missing required field: uuid',
    ]);
    expect(validateVconDict({ payload: '!!!', signatures: [{ header: {}, signature: 's' }] }).errors).toEqual([
      "Signed vCon: 'payload' is not a base64url-encoded JSON object.",
    ]);
  });

  it('checks a JWE as a JWE only, with a warning that its content was not validated', () => {
    expect(validateVconDict({ ciphertext: 'x', iv: 'y', tag: 'z', recipients: [{}], protected: 'p' })).toEqual({
      errors: [],
      warnings: ['Encrypted vCon: the content cannot be validated without decrypting it.'],
    });
    expect(validateVconDict({ ciphertext: 1, recipients: [] }).errors).toEqual([
      "Encrypted vCon: 'ciphertext' must be a base64url string.",
      "Encrypted vCon: 'recipients' must be a non-empty array.",
    ]);
  });
});
