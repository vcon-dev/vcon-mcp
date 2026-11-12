import { describe, expect, it } from 'vitest';
import { getTenantMode, TENANT_MODES } from '../../src/config/tenant-mode.js';

describe('getTenantMode', () => {
  it('defaults to off when TENANT_MODE is unset or blank', () => {
    expect(getTenantMode({})).toBe('off');
    expect(getTenantMode({ TENANT_MODE: '' })).toBe('off');
    expect(getTenantMode({ TENANT_MODE: '   ' })).toBe('off');
  });

  it('reads each mode, ignoring case and surrounding space', () => {
    expect(getTenantMode({ TENANT_MODE: 'off' })).toBe('off');
    expect(getTenantMode({ TENANT_MODE: 'writer' })).toBe('writer');
    expect(getTenantMode({ TENANT_MODE: 'lane' })).toBe('lane');
    expect(getTenantMode({ TENANT_MODE: ' Writer ' })).toBe('writer');
    expect(getTenantMode({ TENANT_MODE: 'LANE' })).toBe('lane');
  });

  it('throws on an unknown mode instead of falling back to off', () => {
    expect(() => getTenantMode({ TENANT_MODE: 'write' })).toThrow('TENANT_MODE must be one of off, writer, lane');
    expect(() => getTenantMode({ TENANT_MODE: 'true' })).toThrow(/TENANT_MODE/);
  });

  it('lists exactly the three modes', () => {
    expect(TENANT_MODES).toEqual(['off', 'writer', 'lane']);
  });

  it('reads process.env by default', () => {
    const prev = process.env.TENANT_MODE;
    try {
      process.env.TENANT_MODE = 'writer';
      expect(getTenantMode()).toBe('writer');
      delete process.env.TENANT_MODE;
      expect(getTenantMode()).toBe('off');
    } finally {
      if (prev === undefined) delete process.env.TENANT_MODE;
      else process.env.TENANT_MODE = prev;
    }
  });
});
