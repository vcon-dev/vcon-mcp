import { describe, expect, it } from 'vitest';
import { TenantConfig } from '../../src/config/tenant-config.js';
import {
  isValidTenantId,
  QUARANTINE_TENANT,
  readTenantStamp,
  resolveWriterTenant,
} from '../../src/config/tenant-stamp.js';

const config: TenantConfig = { enabled: false, attachmentType: 'tenant', jsonPath: 'id' };
const TA = 't-aaaaaaaaaaaaaaaa';
const TB = 't-bbbbbbbbbbbbbbbb';

// The tenant attachment shape: purpose, start, party, dialog, an object body.
// The fixture vCons carry no lawful_basis attachment, on purpose: no basis is
// invented for a fake call.
const stamp = (id: unknown, extra: Record<string, unknown> = {}) => ({
  purpose: 'tenant',
  start: '2026-11-01T00:00:00Z',
  party: 0,
  dialog: 0,
  mediatype: 'application/json',
  encoding: 'json',
  body: { id },
  ...extra,
});
const vcon = (...attachments: Record<string, unknown>[]) =>
  ({ vcon: '0.4.0', uuid: 'u', created_at: '2026-11-01T00:00:00Z', parties: [], attachments }) as any;

describe('isValidTenantId', () => {
  it('accepts t- and 16 lowercase hex digits only', () => {
    expect(isValidTenantId(TA)).toBe(true);
    expect(isValidTenantId('t-0123456789abcdef')).toBe(true);
    for (const bad of ['t-AAAAAAAAAAAAAAAA', 'T-aaaaaaaaaaaaaaaa', 't-aaaa', 't-aaaaaaaaaaaaaaaaa', ` ${TA}`, `${TA}\n`,
      't-gggggggggggggggg', 'aaaaaaaaaaaaaaaa', '', QUARANTINE_TENANT, 42, null, undefined]) {
      expect(isValidTenantId(bad), String(bad)).toBe(false);
    }
  });
});

describe('resolveWriterTenant: a good stamp', () => {
  it('reads the object body the design names', () => {
    expect(resolveWriterTenant(vcon(stamp(TA)), config)).toEqual({ tenantId: TA, status: 'ok' });
  });

  it('reads a JSON-string body', () => {
    expect(resolveWriterTenant(vcon(stamp(TA, { body: JSON.stringify({ id: TA }) })), config).tenantId).toBe(TA);
  });

  it('reads the legacy type field', () => {
    const legacy = { type: 'tenant', encoding: 'json', body: JSON.stringify({ id: TA }) };
    expect(resolveWriterTenant(vcon(legacy), config).tenantId).toBe(TA);
  });

  it('reads a JSON-string body whatever the encoding says, base64url apart', () => {
    expect(resolveWriterTenant(vcon(stamp(TA, { encoding: 'none', body: `{"id":"${TA}"}` })), config).tenantId).toBe(TA);
    expect(resolveWriterTenant(vcon(stamp(TA, { encoding: undefined })), config).tenantId).toBe(TA);
  });

  it('takes the same id named twice', () => {
    const r = resolveWriterTenant(vcon(stamp(TA), { type: 'tenant', encoding: 'json', body: `{"id":"${TA}"}` }), config);
    expect(r).toEqual({ tenantId: TA, status: 'ok' });
  });

  it('ignores other attachments, including a tags body holding an id', () => {
    const tags = { purpose: 'tags', encoding: 'json', body: `{"id":"${TB}"}` };
    expect(resolveWriterTenant(vcon(tags, stamp(TA)), config).tenantId).toBe(TA);
  });

  it('honours TENANT_ATTACHMENT_TYPE and TENANT_JSON_PATH', () => {
    const custom: TenantConfig = { enabled: false, attachmentType: 'account', jsonPath: 'org.id' };
    const att = { purpose: 'account', encoding: 'json', body: { org: { id: TA } } };
    expect(resolveWriterTenant(vcon(att), custom).tenantId).toBe(TA);
  });
});

describe('resolveWriterTenant: a missing stamp stores under _quarantine', () => {
  it('no attachments at all', () => {
    expect(resolveWriterTenant({ uuid: 'u', vcon: '0.4.0', parties: [] } as any, config))
      .toMatchObject({ tenantId: QUARANTINE_TENANT, status: 'missing' });
  });

  it('attachments, none of them a tenant stamp', () => {
    expect(resolveWriterTenant(vcon({ purpose: 'tags', encoding: 'json', body: '[]' }), config))
      .toMatchObject({ tenantId: QUARANTINE_TENANT, status: 'missing' });
  });
});

describe('resolveWriterTenant: a malformed stamp stores under _quarantine', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['no body', stamp(TA, { body: undefined })],
    ['null body', stamp(TA, { body: null })],
    ['empty string body', stamp(TA, { body: '' })],
    ['base64url body', stamp(TA, { encoding: 'base64url', body: 'eyJpZCI6InQtYWFhYSJ9' })],
    ['string body that is not JSON', stamp(TA, { body: 'not json' })],
    ['plain-text id with encoding none', stamp(TA, { encoding: 'none', body: TA })],
    ['JSON that is not an object', stamp(TA, { body: JSON.stringify(TA) })],
    ['JSON array body', stamp(TA, { body: [TA] })],
    ['no id', stamp(TA, { body: { tenant: TA } })],
    ['null id', stamp(null)],
    ['numeric id', stamp(42)],
    ['object id', stamp({ id: TA })],
    ['empty id', stamp('')],
    ['upper-case id', stamp('t-AAAAAAAAAAAAAAAA')],
    ['short id', stamp('t-4f2a')],
    ['id with surrounding space', stamp(` ${TA} `)],
    ['id without the t- prefix', stamp('aaaaaaaaaaaaaaaa')],
    ['the reserved _quarantine', stamp(QUARANTINE_TENANT)],
  ];

  for (const [label, att] of cases) {
    it(label, () => {
      const r = resolveWriterTenant(vcon(att), config);
      expect(r.tenantId).toBe(QUARANTINE_TENANT);
      expect(r.status).toBe('malformed');
      expect(r.detail).toBeTruthy();
    });
  }

  it('a malformed stamp beside a good one', () => {
    expect(resolveWriterTenant(vcon(stamp(TA), stamp('t-1')), config))
      .toMatchObject({ tenantId: QUARANTINE_TENANT, status: 'malformed' });
  });

  it('never puts body content in the detail', () => {
    const r = resolveWriterTenant(vcon(stamp(TA, { body: 'secret-looking text' })), config);
    expect(r.detail).not.toContain('secret');
  });
});

describe('resolveWriterTenant: a conflicting stamp stores under _quarantine', () => {
  it('two ids, where the old extractor kept the first silently', () => {
    expect(resolveWriterTenant(vcon(stamp(TA), stamp(TB)), config))
      .toMatchObject({ tenantId: QUARANTINE_TENANT, status: 'conflict' });
  });

  it('two ids across purpose and legacy type', () => {
    const legacy = { type: 'tenant', encoding: 'json', body: `{"id":"${TB}"}` };
    expect(resolveWriterTenant(vcon(stamp(TA), legacy), config).status).toBe('conflict');
  });
});

describe('readTenantStamp', () => {
  it('returns the id for a good attachment', () => {
    expect(readTenantStamp(stamp(TA) as any, config)).toEqual({ ok: true, id: TA });
  });
});
