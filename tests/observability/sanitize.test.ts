import { describe, expect, it } from 'vitest';
import { sanitizeErrorMessage } from '../../src/observability/instrumentation.js';
import { sanitizeSpan, SanitizingSpanExporter } from '../../src/observability/span-sanitizer.js';

describe('sanitizeErrorMessage phone numbers', () => {
  it.each([
    ['call +1 (555) 123-4567 failed', '4567', ['555', '123']],
    ['lookup 555-123-4567', '4567', ['555-123']],
    ['tel=15551234567 not found', '4567', ['1555123']],
    ['no match for +442071838750', '8750', ['442071']],
  ])('masks %s to the last four digits', (input, last4, gone) => {
    const out = sanitizeErrorMessage(input);
    expect(out).toContain(`***${last4}`);
    for (const g of gone) expect(out).not.toContain(g);
  });

  it('leaves dates and short numbers alone', () => {
    expect(sanitizeErrorMessage('at 2026-11-22 after 120 ms, row 4821')).toBe('at 2026-11-22 after 120 ms, row 4821');
  });
});

describe('span sanitizer', () => {
  const span = (attributes: Record<string, unknown>, name = 'GET') => ({ name, attributes }) as any;

  it('drops query strings from http and undici attributes and names', () => {
    const s = sanitizeSpan(span({
      'http.target': '/mcp?api_key=k&q=private',
      'http.url': 'http://h/mcp?api_key=k',
      'url.full': 'http://h/rest/v1/vcons?mailto=ilike.%25a@b.com%25&tel=ilike.%25%2B1555%25',
      'url.query': 'mailto=ilike.%25a@b.com%25',
      'url.path': '/rest/v1/vcons',
      'http.method': 'GET',
    }, 'GET /mcp?api_key=k'));
    expect(JSON.stringify(s)).not.toMatch(/api_key|private|mailto|ilike|tel=/);
    expect(s.attributes['http.target']).toBe('/mcp');
    expect(s.attributes['url.full']).toBe('http://h/rest/v1/vcons');
    expect(s.attributes['http.method']).toBe('GET');
  });

  it('sanitizes before the inner exporter sees the span', () => {
    const seen: any[] = [];
    const exporter = new SanitizingSpanExporter({ export: (spans: any[], cb: any) => { seen.push(...spans); cb({ code: 0 }); }, shutdown: async () => {} });
    exporter.export([span({ 'http.url': 'http://h/p?secret=1' })], () => undefined);
    expect(seen[0].attributes['http.url']).toBe('http://h/p');
  });
});

describe('span sanitizer covers every field and never throws', () => {
  const URL_Q = 'http://h/rest/v1/vcons?mailto=ilike.%25a@b.com%25&tel=ilike.%25%2B1555%25';
  const full = () => ({
    name: 'GET',
    kind: 3,
    spanContext: () => ({ traceId: 't', spanId: 's', traceFlags: 1 }),
    status: { code: 2, message: `fetch failed for ${URL_Q} after 3 tries` },
    attributes: {
      'http.url': URL_Q,
      'url.query': 'mailto=x',
      note: `retrying ${URL_Q} now`,
      urls: [URL_Q, 'plain'],
      count: 3,
    },
    events: [{ name: `GET ${URL_Q}`, time: [0, 0], attributes: { 'url.full': URL_Q, detail: `see ${URL_Q}` } }],
    links: [{ context: { traceId: 't', spanId: 'x' }, attributes: { 'http.url': URL_Q } }],
  }) as any;
  const leaks = /mailto|ilike|tel=|1555/;

  it('cleans events, links, status message, array values and URLs inside longer strings', () => {
    const out = sanitizeSpan(full());
    expect(JSON.stringify(out)).not.toMatch(leaks);
    expect(out.attributes.count).toBe(3);
    expect((out.attributes as any).urls[1]).toBe('plain');
    expect(out.status.code).toBe(2);
    expect((out.attributes as any).note).toBe('retrying http://h/rest/v1/vcons now');
  });

  it('works on a copy and leaves the original untouched', () => {
    const original = full();
    sanitizeSpan(original);
    expect(original.attributes['http.url']).toBe(URL_Q);
  });

  it('handles a read-only span without throwing', () => {
    const frozen = full();
    Object.freeze(frozen.attributes);
    Object.freeze(frozen.events[0].attributes);
    Object.freeze(frozen.events);
    Object.freeze(frozen.status);
    Object.freeze(frozen);
    let out: any;
    expect(() => { out = sanitizeSpan(frozen); }).not.toThrow();
    expect(JSON.stringify(out)).not.toMatch(leaks);
  });

  it('drops an attribute it cannot read and still exports the rest', () => {
    const span = full();
    Object.defineProperty(span.attributes, 'bad', { enumerable: true, get() { throw new Error('boom'); } });
    const seen: any[] = [];
    let result: any;
    new SanitizingSpanExporter({ export: (s: any[], cb: any) => { seen.push(...s); cb({ code: 0 }); }, shutdown: async () => {} })
      .export([span], (r) => { result = r; });
    expect(result).toEqual({ code: 0 });
    expect(seen).toHaveLength(1);
    expect(seen[0].attributes).not.toHaveProperty('bad');
    expect(seen[0].attributes.count).toBe(3);
  });

  it('always calls the result callback, even when the inner exporter throws', () => {
    let result: any;
    new SanitizingSpanExporter({ export: () => { throw new Error('exporter broke'); }, shutdown: async () => {} })
      .export([full()], (r) => { result = r; });
    expect(result?.code).toBe(1);
  });
});
