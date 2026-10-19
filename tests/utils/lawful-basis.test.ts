import { describe, it, expect } from 'vitest';
import { hasLawfulBasis, lawfulBasisWarnings } from '../../src/utils/lawful-basis.js';

const valid = {
  purpose: 'lawful_basis',
  start: '2025-01-02T12:15:30Z',
  party: 0,
  dialog: 0,
  mediatype: 'application/json',
  encoding: 'json',
  body: {
    lawful_basis: 'consent',
    expiration: '2999-01-02T12:00:00Z',
    purpose_grants: [{ purpose: 'recording', granted: true, granted_at: '2025-01-02T12:15:30Z' }],
    proof_mechanisms: [{ mechanism_type: 'audio_recording', dialog_index: 0, description: 'Verbal consent captured at start of recording' }],
  },
};

describe('hasLawfulBasis', () => {
  it('detects purpose', () => {
    expect(hasLawfulBasis({ attachments: [valid] })).toBe(true);
  });
  it('detects legacy type', () => {
    expect(hasLawfulBasis({ attachments: [{ type: 'lawful_basis', body: '{}' }] })).toBe(true);
  });
  it('is false when absent or malformed', () => {
    expect(hasLawfulBasis({})).toBe(false);
    expect(hasLawfulBasis(null)).toBe(false);
    expect(hasLawfulBasis({ attachments: [{ purpose: 'tags' }, null as any] })).toBe(false);
  });
});

describe('lawfulBasisWarnings', () => {
  it('warns when missing', () => {
    const w = lawfulBasisWarnings({ attachments: [] });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('no lawful_basis attachment');
  });
  it('is empty for a complete attachment, object or string body', () => {
    expect(lawfulBasisWarnings({ attachments: [valid] })).toEqual([]);
    expect(lawfulBasisWarnings({ attachments: [{ ...valid, body: JSON.stringify(valid.body) }] })).toEqual([]);
  });
  it('flags a bad enum', () => {
    const w = lawfulBasisWarnings({ attachments: [{ ...valid, body: { ...valid.body, lawful_basis: 'vibes' } }] });
    expect(w.join()).toContain('lawful_basis must be one of');
  });
  it('flags past and missing expiration, but allows null for legitimate_interests', () => {
    const past = lawfulBasisWarnings({ attachments: [{ ...valid, body: { ...valid.body, expiration: '2020-01-01T00:00:00Z' } }] });
    expect(past.join()).toContain('in the past');
    const missing = lawfulBasisWarnings({ attachments: [{ ...valid, body: { ...valid.body, expiration: null } }] });
    expect(missing.join()).toContain('expiration is missing');
    const li = lawfulBasisWarnings({ attachments: [{ ...valid, body: { ...valid.body, lawful_basis: 'legitimate_interests', expiration: null } }] });
    expect(li).toEqual([]);
  });
  it('flags empty grants, empty proof mechanisms, and unparseable body', () => {
    const w = lawfulBasisWarnings({ attachments: [{ ...valid, body: { ...valid.body, purpose_grants: [], proof_mechanisms: [] } }] });
    expect(w.join()).toContain('purpose_grants is empty');
    expect(w.join()).toContain('proof_mechanisms is empty');
    expect(lawfulBasisWarnings({ attachments: [{ purpose: 'lawful_basis', body: 'not json' }] }).join()).toContain('not a JSON object');
  });
});
