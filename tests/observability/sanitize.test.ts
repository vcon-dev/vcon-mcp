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
