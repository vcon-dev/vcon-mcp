/**
 * Synthetic tenants and canaries for the tenant isolation shapes.
 *
 * Every row a fixture owns, in all ten tenant tables, carries its marker: ids
 * and vCon uuids start with a per-fixture prefix, and every text column a
 * search can reach holds a per-fixture canary word. A response to tenant A
 * that contains another fixture's marker is a leak. A positive read must also
 * contain A's own marker, so an empty response cannot pass.
 *
 *   A    tenant A, two vCons (one is deleted by the own-delete check)
 *   B    tenant B
 *   BN   tenant B, every child row with a NULL tenant_id (rows written before
 *        the child triggers existed)
 *   N    no tenant: the vCon and its children have NULL tenant_id
 *   Q    the reserved `_quarantine` tenant
 *
 * The fixtures carry no lawful_basis attachment, on purpose: they are fake
 * calls, and no basis is invented for one. They hold no phone numbers.
 */
import { Stack, startStack, type StackOptions } from './stack.ts';

export const TENANT_A = 't-aaaaaaaaaaaaaaaa';
export const TENANT_B = 't-bbbbbbbbbbbbbbbb';
export const QUARANTINE = '_quarantine';

export type FixtureKey = 'A' | 'A2' | 'B' | 'BN' | 'N' | 'Q';

export interface Fixture {
  key: FixtureKey;
  tenant: string | null;
  /** vCon uuid; also the vcons.id. */
  uuid: string;
  /** Word placed in every searchable text column. */
  canary: string;
  /** Prefix of every uuid the fixture owns. */
  prefix: string;
  /** Child rows get a NULL tenant_id after insert. */
  nullChildren?: boolean;
}

const id = (prefix: string, kind: number, n: number) =>
  `${prefix}-${kind.toString(16).padStart(4, '0')}-4000-8000-${n.toString(16).padStart(12, '0')}`;

// Prefix per tenant label: aaaaaaaa (A), bbbbbbbb (B), cccccccc (none), dddddddd (quarantine).
export const FIXTURES: Record<FixtureKey, Fixture> = {
  A: { key: 'A', tenant: TENANT_A, uuid: id('aaaaaaaa', 0, 1), canary: 'zqcanaryalpha', prefix: 'aaaaaaaa' },
  A2: { key: 'A2', tenant: TENANT_A, uuid: id('aaaaaaaa', 0, 2), canary: 'zqcanaryalphatwo', prefix: 'aaaaaaaa' },
  B: { key: 'B', tenant: TENANT_B, uuid: id('bbbbbbbb', 0, 1), canary: 'zqcanarybravo', prefix: 'bbbbbbbb' },
  BN: { key: 'BN', tenant: TENANT_B, uuid: id('bbbbbbbb', 0, 2), canary: 'zqcanarynullchild', prefix: 'bbbbbbbb', nullChildren: true },
  N: { key: 'N', tenant: null, uuid: id('cccccccc', 0, 1), canary: 'zqcanarynotenant', prefix: 'cccccccc' },
  Q: { key: 'Q', tenant: QUARANTINE, uuid: id('dddddddd', 0, 1), canary: 'zqcanaryquarantine', prefix: 'dddddddd' },
};

/** Row ids per fixture and table, derived from the vCon number so tests can address them. */
export function rowId(f: Fixture, table: string): string {
  const kinds: Record<string, number> = {
    parties: 1, dialog: 2, analysis: 3, attachments: 4, groups: 5, party_history: 6, vcon_embeddings: 7, dealer: 8,
  };
  const n = parseInt(f.uuid.slice(-12), 16);
  return id(f.prefix, kinds[table], n);
}

/** The ten tables that carry tenant_id. */
export const TENANT_TABLES = [
  'vcons', 'parties', 'dialog', 'attachments', 'analysis', 'groups',
  'party_history', 'vcon_embeddings', 'embedding_queue', 's3_sync_tracking',
] as const;

/** Every child of vcons, keyed by vcon_id. party_history hangs off dialog. */
export const VCON_CHILDREN = [
  'parties', 'dialog', 'attachments', 'analysis', 'groups', 'vcon_embeddings', 'embedding_queue', 's3_sync_tracking',
] as const;

/** A 384-dimension unit vector; every fixture embeds the same one, so only the tenant filter separates them. */
export const EMBEDDING = `[${['1', ...Array(383).fill('0')].join(',')}]`;

const lit = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);

function fixtureSql(f: Fixture): string {
  const t = lit(f.tenant);
  const c = f.canary;
  const u = f.uuid;
  const tags = JSON.stringify(['team:sales', `fixture:${c}`]);
  const dealer = JSON.stringify({ id: `dealer-${c}`, name: `${c} motors` });
  return `
INSERT INTO vcons (id, uuid, vcon_version, subject, created_at, updated_at, tenant_id)
  VALUES ('${u}', '${u}', '0.4.0', 'zebra ${c} subject', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', ${t});
INSERT INTO parties (id, vcon_id, party_index, name, mailto, tenant_id)
  VALUES ('${rowId(f, 'parties')}', '${u}', 0, '${c} caller', '${c}@example.invalid', ${t});
INSERT INTO dialog (id, vcon_id, dialog_index, type, start_time, parties, body, encoding, tenant_id)
  VALUES ('${rowId(f, 'dialog')}', '${u}', 0, 'text', '2026-11-01T00:00:00Z', '{0}', 'zebra ${c} dialog', 'none', ${t});
INSERT INTO analysis (id, vcon_id, analysis_index, type, vendor, body, encoding, tenant_id)
  VALUES ('${rowId(f, 'analysis')}', '${u}', 0, 'summary', 'test', 'zebra ${c} analysis', 'none', ${t});
INSERT INTO attachments (id, vcon_id, attachment_index, purpose, start_time, party, dialog, encoding, body, tenant_id)
  VALUES ('${rowId(f, 'attachments')}', '${u}', 0, 'tags', '2026-11-01T00:00:00Z', 0, 0, 'json', '${tags}', ${t}),
         ('${rowId(f, 'dealer')}', '${u}', 1, 'dealer', '2026-11-01T00:00:00Z', 0, 0, 'json', '${dealer}', ${t});
UPDATE attachments SET type = purpose WHERE id = '${rowId(f, 'dealer')}';
INSERT INTO groups (id, vcon_id, group_index, body, encoding, tenant_id)
  VALUES ('${rowId(f, 'groups')}', '${u}', 0, '{"note":"${c} group"}', 'json', ${t});
INSERT INTO party_history (id, dialog_id, party_index, time, event, tenant_id)
  VALUES ('${rowId(f, 'party_history')}', '${rowId(f, 'dialog')}', 0, '2026-11-01T00:00:00Z', 'join', ${t});
INSERT INTO vcon_embeddings (id, vcon_id, content_type, content_reference, content_text, embedding, embedding_model, embedding_dimension, tenant_id)
  VALUES ('${rowId(f, 'vcon_embeddings')}', '${u}', 'subject', NULL, 'zebra ${c} embedding', '${EMBEDDING}', 'test-model', 384, ${t});
INSERT INTO s3_sync_tracking (vcon_id, vcon_uuid, s3_key, synced_at, updated_at, embedding_model, embedding_dimension, tenant_id)
  VALUES ('${u}', '${u}', '${c}.json', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 'test-model', 384, ${t});
${f.nullChildren ? VCON_CHILDREN.map(tbl => `UPDATE ${tbl} SET tenant_id = NULL WHERE vcon_id = '${u}';`).join('\n') + `\nUPDATE party_history SET tenant_id = NULL WHERE dialog_id = '${rowId(f, 'dialog')}';` : ''}
`;
}

/**
 * Load every fixture as `postgres` (BYPASSRLS), refresh the tag view, and put
 * a B row in vkong.vcons, which has no tenant column at all.
 */
export function loadFixtures(stack: Stack): void {
  const b = FIXTURES.B;
  stack.sql(`
BEGIN;
${Object.values(FIXTURES).map(fixtureSql).join('\n')}
INSERT INTO vkong.vcons (uuid, vcon, subject, source)
  VALUES ('${b.uuid}', '{"subject":"zebra ${b.canary} subject"}', 'zebra ${b.canary} subject', 'fixture');
COMMIT;
REFRESH MATERIALIZED VIEW vcon_tags_mv;
`);
}

/** Rows per tenant across the ten tables, for logs. */
export function tenantCounts(stack: Stack): string {
  return stack.sql(`
SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
  SELECT coalesce(tenant_id, 'NULL') t, count(*) n FROM (
    ${TENANT_TABLES.map(t => `SELECT tenant_id FROM ${t}`).join(' UNION ALL ')}
  ) x GROUP BY 1) y`).trim();
}

/**
 * The data cut the strict pack needs before it applies, done the way the
 * operator's cut does it: children take their parent's tenant, and vCons with
 * no tenant go to `_quarantine` with their children. Nothing is guessed.
 */
export function dataCut(stack: Stack): void {
  stack.sql(`
BEGIN;
${VCON_CHILDREN.map(t => `UPDATE ${t} c SET tenant_id = v.tenant_id FROM vcons v
  WHERE v.uuid = c.vcon_id AND v.tenant_id IS NOT NULL AND c.tenant_id IS DISTINCT FROM v.tenant_id;`).join('\n')}
UPDATE party_history h SET tenant_id = d.tenant_id FROM dialog d
  WHERE d.id = h.dialog_id AND d.tenant_id IS NOT NULL AND h.tenant_id IS DISTINCT FROM d.tenant_id;
UPDATE vcons SET tenant_id = '${QUARANTINE}' WHERE tenant_id IS NULL;
${TENANT_TABLES.map(t => `UPDATE ${t} SET tenant_id = '${QUARANTINE}' WHERE tenant_id IS NULL;`).join('\n')}
COMMIT;
REFRESH MATERIALIZED VIEW vcon_tags_mv;
`);
}

/** Which fixtures' markers a response body contains. */
export function markersIn(body: string): Set<FixtureKey | 'A*'> {
  const seen = new Set<FixtureKey | 'A*'>();
  if (body.includes('aaaaaaaa-') || body.includes(FIXTURES.A.canary)) seen.add('A*');
  // B is anything of tenant B; BN also names the vCon whose children had no tenant.
  if (body.includes('bbbbbbbb-') || body.includes(FIXTURES.B.canary) || body.includes(FIXTURES.BN.canary)) seen.add('B');
  if (body.includes(FIXTURES.BN.canary) || /bbbbbbbb-[0-9a-f]{4}-4000-8000-000000000002/.test(body)) seen.add('BN');
  if (body.includes('cccccccc-') || body.includes(FIXTURES.N.canary)) seen.add('N');
  if (body.includes('dddddddd-') || body.includes(FIXTURES.Q.canary)) seen.add('Q');
  return seen;
}

/** Markers that belong to anyone other than tenant A. */
export function foreignIn(body: string): string[] {
  return [...markersIn(body)].filter(k => k !== 'A*').sort();
}

export function ownIn(body: string): boolean {
  return markersIn(body).has('A*');
}

/**
 * One call for a ready stack: migrations, fixtures and, when `strict`, the
 * data cut and the strict pack, then PostgREST. Returns the apply-script
 * output from the first (refused) and second (applied) runs.
 */
export async function prepareStack(opts: StackOptions & { strict: boolean }): Promise<{
  stack: Stack; migrations: number; refused?: { code: number; out: string }; applied?: string;
}> {
  const stack = await startStack(opts);
  try {
    const migrations = stack.applyMigrations();
    loadFixtures(stack);
    if (!opts.strict) {
      await stack.startRest();
      return { stack, migrations };
    }
    const refused = stack.runApplyScript();
    dataCut(stack);
    const applied = stack.applyStrictPack();
    await stack.startRest();
    return { stack, migrations, refused, applied };
  } catch (e) {
    await stack.stop();
    throw e;
  }
}
