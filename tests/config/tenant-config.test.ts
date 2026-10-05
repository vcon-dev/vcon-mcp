import { describe, expect, it } from 'vitest';
import { extractTenantFromVCon, TenantConfig } from '../../src/config/tenant-config.js';

const config: TenantConfig = { enabled: true, attachmentType: 'tenant', jsonPath: 'id' };
const vcon = (attachment: Record<string, unknown>) =>
  ({ uuid: 'u', vcon: '0.3.0', parties: [], attachments: [attachment] }) as any;

describe('extractTenantFromVCon', () => {
  it('reads a purpose-only tenant attachment (what the conserver sends)', () => {
    expect(extractTenantFromVCon(vcon({ purpose: 'tenant', encoding: 'json', body: '{"id":"VB"}' }), config)).toBe('VB');
  });

  it('still reads a legacy type-only tenant attachment', () => {
    expect(extractTenantFromVCon(vcon({ type: 'tenant', encoding: 'json', body: '{"id":"VZ"}' }), config)).toBe('VZ');
  });

  it('ignores other attachments', () => {
    expect(extractTenantFromVCon(vcon({ purpose: 'tags', encoding: 'json', body: '{"id":"VB"}' }), config)).toBeNull();
  });
});
