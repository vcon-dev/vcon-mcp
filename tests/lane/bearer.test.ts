import { describe, expect, it } from 'vitest';
import { MAX_BEARER_LENGTH, readLaneBearer } from '../../src/lane/bearer.js';
import { TENANT_A, tenantJwt } from './helpers.js';

const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
const token = (claims: object, header: object = { alg: 'HS256', typ: 'JWT' }, sig = 'c2ln') =>
  `${b64(header)}.${b64(claims)}.${sig}`;

describe('readLaneBearer', () => {
  it('accepts a tenant token and reads its tenant for logs', () => {
    const jwt = tenantJwt(TENANT_A);
    const r = readLaneBearer(`Bearer ${jwt}`);
    expect(r).toEqual({ ok: true, jwt, tenantIdForLog: TENANT_A });
    expect(readLaneBearer(`bearer   ${jwt}  `)).toMatchObject({ ok: true, jwt });
    expect(readLaneBearer([`Bearer ${jwt}`])).toMatchObject({ ok: true, jwt });
  });

  it('accepts an act claim (staff acting for a tenant)', () => {
    expect(readLaneBearer(`Bearer ${tenantJwt(TENANT_A, { act: 'staff-user-1' })}`).ok).toBe(true);
  });

  it('reports a missing header as missing', () => {
    expect(readLaneBearer(undefined)).toEqual({ ok: false, problem: 'missing' });
    expect(readLaneBearer('')).toEqual({ ok: false, problem: 'missing' });
    expect(readLaneBearer('   ')).toEqual({ ok: false, problem: 'missing' });
  });

  it('refuses anything that cannot be a tenant token as malformed', () => {
    const malformed = [
      'Basic dXNlcjpwYXNz',
      'Bearer',
      'Bearer not-a-jwt',
      'Bearer a.b',
      'Bearer a.b.c.d',
      `Bearer ${token({ role: 'authenticated', tenant_id: TENANT_A }, undefined, '')}`, // unsigned
      `Bearer ${token({ role: 'authenticated', tenant_id: TENANT_A })} extra`,
      'Bearer !!!.@@@.###',
      `Bearer ${b64({ alg: 'HS256' })}.bm90IGpzb24.c2ln`, // payload not JSON
      `Bearer ${b64({ alg: 'HS256' })}.${b64(['array'])}.c2ln`, // payload not an object
      `Bearer ${token({ role: 'service_role', tenant_id: TENANT_A })}`,
      `Bearer ${token({ role: 'anon', tenant_id: TENANT_A })}`,
      `Bearer ${token({ tenant_id: TENANT_A })}`,
      `Bearer ${token({ role: 'authenticated' })}`,
      `Bearer ${token({ role: 'authenticated', tenant_id: '' })}`,
      `Bearer ${token({ role: 'authenticated', tenant_id: 42 })}`,
      `Bearer ${'a'.repeat(MAX_BEARER_LENGTH)}.b.c`,
    ];
    for (const header of malformed) {
      expect(readLaneBearer(header), header.slice(0, 40)).toEqual({ ok: false, problem: 'malformed' });
    }
  });

  it('keeps an odd tenant claim printable and short in its log form', () => {
    const r = readLaneBearer(`Bearer ${token({ role: 'authenticated', tenant_id: 'x\n"y'.repeat(40) })}`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tenantIdForLog).toMatch(/^[A-Za-z0-9_.:?-]{1,64}$/);
    }
  });
});
