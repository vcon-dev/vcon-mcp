/**
 * Unit tests for the pure vCon child-array mutation helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  ChildIndexError,
  assertIndexInRange,
  replacePartyAt,
  replaceDialogAt,
  replaceAnalysisAt,
  replaceAttachmentAt,
  appendParty,
  emptyPartyPlaceholder,
  strippedDialogPlaceholder,
  removePartyAt,
  removeDialogAt,
  removeAnalysisAt,
  removeAttachmentAt,
} from '../../src/utils/vcon-children.js';
import { VCon } from '../../src/types/vcon.js';

function sampleVCon(): VCon {
  return {
    vcon: '0.4.0',
    uuid: '11111111-1111-1111-1111-111111111111',
    created_at: '2026-01-01T00:00:00Z',
    parties: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }],
    dialog: [
      { type: 'text', body: 'hi', parties: [0, 1], party_history: [{ party: 0, time: '2026-01-01T00:00:00Z', event: 'join' }] },
      { type: 'recording', url: 'https://x/y', parties: [0, 1] },
    ],
    analysis: [
      { type: 'summary', vendor: 'A', body: 'one' },
      { type: 'sentiment', vendor: 'B', body: 'two' },
      { type: 'transcript', vendor: 'C', body: 'three' },
    ],
    attachments: [
      { purpose: 'doc', body: 'a' },
      { type: 'tags', encoding: 'json', body: '["k:v"]' },
      { purpose: 'image', body: 'c' },
    ],
  };
}

describe('assertIndexInRange', () => {
  it('throws ChildIndexError for negative, non-integer, out-of-range, and empty', () => {
    expect(() => assertIndexInRange([1, 2], -1, 'party')).toThrow(ChildIndexError);
    expect(() => assertIndexInRange([1, 2], 1.5, 'party')).toThrow(ChildIndexError);
    expect(() => assertIndexInRange([1, 2], 2, 'party')).toThrow(ChildIndexError);
    expect(() => assertIndexInRange([], 0, 'party')).toThrow(ChildIndexError);
    expect(() => assertIndexInRange(undefined, 0, 'dialog')).toThrow(ChildIndexError);
  });
  it('passes for a valid index', () => {
    expect(() => assertIndexInRange([1, 2], 0, 'party')).not.toThrow();
    expect(() => assertIndexInRange([1, 2], 1, 'party')).not.toThrow();
  });
});

describe('replace (PUT)', () => {
  it('swaps the slot, preserves length and siblings, does not mutate input', () => {
    const v = sampleVCon();
    const out = replacePartyAt(v, 1, { name: 'Bob2', tel: '+1' });
    expect(out.parties).toHaveLength(3);
    expect(out.parties[1]).toEqual({ name: 'Bob2', tel: '+1' });
    expect(out.parties[0]).toEqual({ name: 'Alice' });
    expect(v.parties[1]).toEqual({ name: 'Bob' }); // input untouched
  });
  it('works for dialog/analysis/attachment and rejects bad index', () => {
    const v = sampleVCon();
    expect(replaceDialogAt(v, 0, { type: 'incomplete' }).dialog![0]).toEqual({ type: 'incomplete' });
    expect(replaceAnalysisAt(v, 2, { type: 'x', vendor: 'V' }).analysis![2].vendor).toBe('V');
    expect(replaceAttachmentAt(v, 0, { purpose: 'p' }).attachments![0]).toEqual({ purpose: 'p' });
    expect(() => replaceDialogAt(v, 9, { type: 'text' })).toThrow(ChildIndexError);
  });
});

describe('appendParty', () => {
  it('adds at the end and returns the new index', () => {
    const v = sampleVCon();
    const { vcon, index } = appendParty(v, { name: 'Dave' });
    expect(index).toBe(3);
    expect(vcon.parties).toHaveLength(4);
    expect(vcon.parties[3]).toEqual({ name: 'Dave' });
    expect(v.parties).toHaveLength(3); // input untouched
  });
});

describe('remove: placeholders (parties, dialog)', () => {
  it('emptyPartyPlaceholder returns {} or anonymized', () => {
    expect(emptyPartyPlaceholder()).toEqual({});
    expect(emptyPartyPlaceholder(true)).toEqual({ name: 'anonymous' });
  });
  it('removePartyAt empties the slot but keeps the index (no renumber)', () => {
    const v = sampleVCon();
    const out = removePartyAt(v, 1);
    expect(out.parties).toHaveLength(3);
    expect(out.parties[1]).toEqual({});
    expect(out.parties[2]).toEqual({ name: 'Carol' }); // index 2 unchanged
  });
  it('removePartyAt with anonymize writes {name:"anonymous"}', () => {
    expect(removePartyAt(sampleVCon(), 0, { anonymize: true }).parties[0]).toEqual({ name: 'anonymous' });
  });
  it('strippedDialogPlaceholder keeps only type', () => {
    expect(strippedDialogPlaceholder({ type: 'recording', body: 'x', url: 'y' })).toEqual({ type: 'recording' });
    expect(strippedDialogPlaceholder({} as any)).toEqual({ type: 'incomplete' });
  });
  it('removeDialogAt strips content, keeps type and index', () => {
    const v = sampleVCon();
    const out = removeDialogAt(v, 0);
    expect(out.dialog).toHaveLength(2);
    expect(out.dialog![0]).toEqual({ type: 'text' });
    expect(out.dialog![1].type).toBe('recording'); // sibling untouched
  });
});

describe('remove: compaction (analysis, attachments)', () => {
  it('removeAnalysisAt drops the element and keeps remaining contiguous', () => {
    const v = sampleVCon();
    const out = removeAnalysisAt(v, 1);
    expect(out.analysis).toHaveLength(2);
    expect(out.analysis!.map(a => a.type)).toEqual(['summary', 'transcript']);
    expect(v.analysis).toHaveLength(3); // input untouched
  });
  it('removeAttachmentAt drops the element and compacts', () => {
    const out = removeAttachmentAt(sampleVCon(), 0);
    expect(out.attachments).toHaveLength(2);
    expect(out.attachments![0].type).toBe('tags'); // shifted down into slot 0
  });
  it('rejects out-of-range', () => {
    expect(() => removeAnalysisAt(sampleVCon(), 5)).toThrow(ChildIndexError);
  });
});
