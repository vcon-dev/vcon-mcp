/**
 * Test helpers for TENANT_MODE=lane.
 *
 * `fakeStore` stands in for the lane PostgREST: it records every request, refuses one without a bearer,
 * and answers only with the rows of the tenant its bearer names, the way row-level policies keyed on the
 * tenant_id claim would. It does not verify signatures. It proves the lane's plumbing (which token goes
 * where, how zero rows are reported). It is not the real-database test: that runs real PostgREST, real
 * supabase-js and pgvector in the strict-pack harness.
 */

import { createHmac } from 'crypto';

export const TENANT_A = 't-aaaaaaaaaaaaaaaa';
export const TENANT_B = 't-bbbbbbbbbbbbbbbb';
export const UUID_A = '00000000-0000-4000-8000-00000000000a';
export const UUID_A2 = '00000000-0000-4000-8000-0000000000a2';
export const UUID_B = '00000000-0000-4000-8000-00000000000b';
export const CANARY_A = 'canary-alpha-7f3e';
export const CANARY_B = 'canary-bravo-91c2';

const TEST_SECRET = 'lane-test-secret-not-a-real-secret-0000';

const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** A tenant token shaped like the portal mints it. Signed with a test secret nobody verifies. */
export function tenantJwt(tenantId: string, claims: Record<string, unknown> = {}): string {
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    role: 'authenticated',
    tenant_id: tenantId,
    sub: `sub-${tenantId}`,
    exp: Math.floor(Date.now() / 1000) + 60,
    ...claims,
  });
  const sig = createHmac('sha256', TEST_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export interface StoreRequest {
  method: string;
  path: string;
  params: URLSearchParams;
  headers: Headers;
  body: any;
  /** Tenant the bearer named, or null. */
  tenant: string | null;
}

interface Row {
  id: number;
  uuid: string;
  tenant_id: string;
  subject: string;
  created_at: string;
  tags: Record<string, string>;
}

function tenantOf(headers: Headers): string | null {
  const auth = headers.get('authorization') ?? '';
  const m = /^Bearer (.+)$/.exec(auth);
  if (!m) return null;
  try {
    const claims = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString('utf8'));
    return typeof claims.tenant_id === 'string' ? claims.tenant_id : null;
  } catch {
    return null;
  }
}

function eq(params: URLSearchParams, name: string): string | undefined {
  const v = params.get(name);
  return v?.startsWith('eq.') ? v.slice(3) : undefined;
}

export interface FakeStore {
  fetch: typeof fetch;
  requests: StoreRequest[];
  rows: Row[];
  /** Delay every answer by this many ms (concurrency tests). */
  delayMs: number;
  /** Answer DELETE with no rows even when one is visible (a policy that allows reading but not deleting). */
  deleteMatchesNothing: boolean;
  /** When set and it returns a Response, that is the answer: a store error or a refused token. */
  override?: (request: StoreRequest) => Response | undefined;
}

/** A PostgREST-style JSON answer. */
export function storeAnswer(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' },
  });
}

export function fakeStore(): FakeStore {
  const store: FakeStore = {
    requests: [],
    delayMs: 0,
    deleteMatchesNothing: false,
    rows: [
      { id: 1, uuid: UUID_A, tenant_id: TENANT_A, subject: `call about ${CANARY_A}`, created_at: '2026-11-01T10:00:00.000Z', tags: { synthetic: 'e2e' } },
      { id: 2, uuid: UUID_A2, tenant_id: TENANT_A, subject: 'second call for tenant a', created_at: '2026-11-02T10:00:00.000Z', tags: {} },
      { id: 3, uuid: UUID_B, tenant_id: TENANT_B, subject: `call about ${CANARY_B}`, created_at: '2026-11-01T11:00:00.000Z', tags: { synthetic: 'e2e' } },
    ],
    fetch: undefined as unknown as typeof fetch,
  };

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });

  store.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const raw = init?.body;
    const body = typeof raw === 'string' && raw ? JSON.parse(raw) : undefined;
    const method = (init?.method ?? 'GET').toUpperCase();
    const tenant = tenantOf(headers);
    const request = { method, path: url.pathname, params: url.searchParams, headers, body, tenant };
    store.requests.push(request);
    if (store.delayMs) await new Promise((r) => setTimeout(r, store.delayMs));
    const overridden = store.override?.(request);
    if (overridden) return overridden;

    if (!tenant || headers.get('apikey') === null) return json(401, { code: 'PGRST301', message: 'JWT required' });
    const visible = store.rows.filter((r) => r.tenant_id === tenant);
    const path = url.pathname.replace(/^\/rest\/v1/, '');
    const p = url.searchParams;
    const inRange = (r: Row, after?: string | null, before?: string | null) =>
      (!after || r.created_at >= new Date(after).toISOString()) && (!before || r.created_at <= new Date(before).toISOString());
    const tagsMatch = (r: Row, filter: Record<string, string> = {}) =>
      Object.entries(filter).every(([k, v]) => r.tags[k] === v);

    if (path === '/vcons' && (method === 'GET' || method === 'HEAD')) {
      const uuid = eq(p, 'uuid');
      if (uuid !== undefined) {
        const row = visible.find((r) => r.uuid === uuid);
        const single = (headers.get('accept') ?? '').includes('vnd.pgrst.object');
        if (single) {
          return row
            ? json(200, { ...row, vcon_version: '0.4.0' })
            : json(406, { code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' });
        }
        return json(200, row ? [{ ...row }] : []);
      }
      let rows = [...visible];
      const gte = p.get('created_at')?.startsWith('gte.') ? p.get('created_at')!.slice(4) : null;
      const lte = p.getAll('created_at').find((v) => v.startsWith('lte.'))?.slice(4) ?? null;
      const gte2 = p.getAll('created_at').find((v) => v.startsWith('gte.'))?.slice(4) ?? gte;
      rows = rows.filter((r) => inRange(r, gte2, lte));
      const subject = p.get('subject');
      if (subject?.startsWith('ilike.')) {
        const needle = subject.slice(6).replace(/[%*]/g, '').toLowerCase();
        rows = rows.filter((r) => r.subject.toLowerCase().includes(needle));
      }
      // An exact count with no body: select(..., { count: 'exact', head: true }).
      if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Range': `*/${rows.length}` } });
      rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.uuid.localeCompare(a.uuid));
      const offset = Number(p.get('offset') ?? 0);
      const limit = Number(p.get('limit') ?? rows.length);
      return json(200, rows.slice(offset, offset + limit).map((r) => ({ uuid: r.uuid, id: r.id })));
    }

    if (['/parties', '/dialog', '/analysis', '/attachments'].includes(path) && method === 'GET') {
      const vconId = Number(eq(p, 'vcon_id'));
      const owner = visible.find((r) => r.id === vconId);
      if (!owner || path !== '/attachments' || Object.keys(owner.tags).length === 0) return json(200, []);
      return json(200, [{
        attachment_index: 0, type: 'tags', purpose: 'tags', encoding: 'json',
        body: JSON.stringify(Object.entries(owner.tags).map(([k, v]) => `${k}:${v}`)),
      }]);
    }

    if (path === '/vcons' && method === 'DELETE') {
      const uuid = eq(p, 'uuid');
      const row = visible.find((r) => r.uuid === uuid);
      if (!row || store.deleteMatchesNothing) return json(200, []);
      store.rows = store.rows.filter((r) => r !== row);
      return json(200, [{ uuid: row.uuid }]);
    }

    if (path === '/rpc/search_vcons_by_tags_and_date_count' && method === 'POST') {
      return json(200, visible.filter((r) => tagsMatch(r, body?.tag_filter) && inRange(r, body?.vcon_created_after, body?.vcon_created_before)).length);
    }
    if (path === '/rpc/search_vcons_by_tags_and_date' && method === 'POST') {
      return json(200, visible
        .filter((r) => tagsMatch(r, body?.tag_filter) && inRange(r, body?.vcon_created_after, body?.vcon_created_before))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, body?.max_results ?? 1000)
        .map((r) => ({ vcon_uuid: r.uuid })));
    }
    if (path === '/rpc/search_vcons_keyword' && method === 'POST') {
      return json(200, visible
        .filter((r) => r.subject.includes(body?.query_text ?? '') && inRange(r, body?.start_date, body?.end_date))
        .map((r) => ({ vcon_id: r.uuid, doc_type: 'subject', ref_index: null, rank: 1, snippet: r.subject })));
    }
    if (path === '/rpc/search_vcons_semantic' && method === 'POST') {
      return json(200, visible.map((r) => ({
        vcon_id: r.uuid, content_type: 'subject', content_reference: null, content_text: r.subject, similarity: 0.9,
      })));
    }
    if (path === '/rpc/refresh_vcon_tags_mv_if_stale') {
      return json(403, { code: '42501', message: 'permission denied' });
    }
    return json(404, { code: 'PGRST205', message: `no route ${method} ${path}` });
  }) as typeof fetch;

  return store;
}
