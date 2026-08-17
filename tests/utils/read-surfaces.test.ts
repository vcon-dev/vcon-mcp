import { describe, expect, it } from 'vitest';
import { extractTags, parseTagsBody } from '../../src/utils/read-surfaces.js';

describe('parseTagsBody', () => {
  it('parses the "key:value" array this server writes', () => {
    expect(parseTagsBody('["department:sales","priority:high"]')).toEqual({
      department: 'sales',
      priority: 'high',
    });
  });

  it('keeps colons inside the value', () => {
    expect(parseTagsBody('["url:https://example.com/x"]')).toEqual({
      url: 'https://example.com/x',
    });
  });

  it('parses a flat JSON object body from external ingest', () => {
    // The shape 10k+ vCons in the dev corpus carry; before this it read as {}.
    const body = JSON.stringify({
      source: 'gmail',
      thread_id: '19e7470beb715121',
      message_count: '1',
      is_revenue_deal: false,
      health: 50,
      deal_reason: null,
      nested: { a: 1 },
    });

    expect(parseTagsBody(body)).toEqual({
      source: 'gmail',
      thread_id: '19e7470beb715121',
      message_count: '1',
      is_revenue_deal: 'false',
      health: '50',
      nested: '{"a":1}',
    });
  });

  it('returns {} for empty, null and unparseable bodies', () => {
    expect(parseTagsBody(undefined)).toEqual({});
    expect(parseTagsBody(null)).toEqual({});
    expect(parseTagsBody('')).toEqual({});
    expect(parseTagsBody('not json')).toEqual({});
    expect(parseTagsBody('null')).toEqual({});
    expect(parseTagsBody('5')).toEqual({});
    expect(parseTagsBody('["novalue",":emptykey"]')).toEqual({});
  });
});

describe('extractTags', () => {
  it('reads an object-bodied tags attachment', () => {
    const vcon: any = {
      vcon: '0.4.0',
      uuid: 'x',
      attachments: [{ type: 'tags', encoding: 'json', body: '{"source":"gmail"}' }],
    };
    expect(extractTags(vcon)).toEqual({ source: 'gmail' });
  });
});
