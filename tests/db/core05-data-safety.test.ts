/**
 * core-05 data safety: the schema migration must not break writes to existing rows, a
 * rewritten 0.4.0 vCon must not keep stale 0.4.0 columns, and the migration report of a
 * rewrite is stored before the 0.4.0 rows are replaced.
 *
 * The SQL checks read the migration text; the same file was also applied on top of every
 * earlier migration in a throwaway Postgres (twice, for idempotency) with 0.4.0 rows seeded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildDialogRows, buildEventRows, buildSessionRows } from '../../src/db/batch-writer.js';
import { VConQueries } from '../../src/db/queries.js';
import { getMigrationReport, migrateOnRead } from '../../src/utils/vcon-migration.js';

const SQL = readFileSync(
  join(__dirname, '..', '..', 'supabase', 'migrations', '20261118120000_vcon_core_05_sessions_events.sql'),
  'utf8'
);
const fn = (name: string) => {
  const m = SQL.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([^)]*\\)[\\s\\S]*?\\$\\$ LANGUAGE plpgsql[^;]*;`, 'i'));
  return m ? m[0] : '';
};

describe('20261118120000 migration SQL', () => {
  it('redefines the draft-01 sync trigger on amended_from, so vcons INSERT/UPDATE keep working after the rename', () => {
    const body = fn('sync_vcon_deprecated_fields');
    expect(body).not.toBe('');
    expect(body).toMatch(/NEW\.amended_from/);
    expect(body).not.toMatch(/NEW\.amended\b(?!_from)/);
    // defined after the rename statement in the same file
    expect(SQL.indexOf('RENAME COLUMN amended TO amended_from')).toBeLessThan(SQL.indexOf('FUNCTION sync_vcon_deprecated_fields'));
  });

  it('redefines get_vcon_amended on amended_from', () => {
    const body = fn('get_vcon_amended');
    expect(body).toMatch(/NULLIF\(amended_from/);
    expect(body).not.toMatch(/NULLIF\(amended,/);
  });

  it('points the new child tables at vcons(uuid), like every other child table', () => {
    const tables = ['sessions', 'events', 'vcon_migration_reports'];
    for (const t of tables) {
      const create = SQL.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\([\\s\\S]*?\\n\\);`))?.[0] ?? '';
      expect(create, t).toMatch(/REFERENCES vcons\(uuid\) ON DELETE CASCADE/);
    }
    expect(SQL).not.toMatch(/REFERENCES vcons\(id\)/);
  });

  it('keeps 0.4.0 recording-set rows legal in the dialog type check', () => {
    expect(SQL).toMatch(/dialog_type_check[\s\S]*?'transfer', 'recording-set'\)\)/);
  });

  it('creates the append-only migration report table with tenant isolation', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS vcon_migration_reports/);
    expect(SQL).toMatch(/ALTER TABLE vcon_migration_reports ENABLE ROW LEVEL SECURITY/);
    expect(fn('cascade_tenant_id_update')).toMatch(/UPDATE vcon_migration_reports SET tenant_id/);
  });

  it('documents a rollback', () => {
    expect(SQL).toMatch(/-- Rollback/);
  });
});

describe('batch rows of a rewritten 0.4.0 vCon', () => {
  it('a {} Dialog row names every column as null, so save_vcon_batch clears the stale 0.4.0 type', () => {
    // A vCon whose only Dialog was a transfer: after migration it is [{}]. With no row naming
    // `type`, save_vcon_batch left the stored 'transfer' in place.
    const [row] = JSON.parse(JSON.stringify(buildDialogRows({ uuid: 'u', dialog: [{}] } as any, null)));
    expect(row).toHaveProperty('type', null);
    expect(row).toHaveProperty('start_time', null);
    expect(row).toHaveProperty('parties', null);
    expect(row).toHaveProperty('extra', null);
  });

  it('session and event rows name every column too', () => {
    const [s] = JSON.parse(JSON.stringify(buildSessionRows({ uuid: 'u', sessions: [{}] } as any, null)));
    expect(s).toHaveProperty('originator', null);
    const [e] = JSON.parse(JSON.stringify(buildEventRows({ uuid: 'u', events: [{ type: 'join', time: 't', party: 0 }] } as any, null)));
    expect(e).toHaveProperty('button', null);
  });
});

describe('upgrade on write stores the migration report first', () => {
  const uuid = '018f0000-0000-7000-8000-00000000000a';
  const legacy = () => migrateOnRead({
    vcon: '0.4.0', uuid, created_at: '2022-01-01T00:00:00Z', parties: [{}, {}],
    dialog: [
      { type: 'recording', start: '2022-01-01T00:00:00Z', parties: [0, 1], mediatype: 'audio/x-wav', url: 'https://e/a', content_hash: 'sha512-x' },
      { type: 'transfer', start: '2022-01-01T00:01:00Z', transferee: 0, transferor: 1, original: 0, x_vendor: 'kept in report' },
    ],
  } as any);

  let queries: any;
  let order: string[];
  beforeEach(() => {
    order = [];
    queries = new VConQueries({} as any, null);
    vi.spyOn(queries, 'invalidateCachedVCon').mockResolvedValue(undefined);
  });

  it('saves the report, with the removed transfer Dialog verbatim, before rewriting', async () => {
    const migrated = legacy();
    expect(getMigrationReport(migrated)).toBeDefined();
    vi.spyOn(queries, 'getVCon').mockResolvedValue(migrated);
    const save = vi.spyOn(queries, 'saveMigrationReport').mockImplementation(async () => { order.push('report'); });
    const batch = await import('../../src/db/batch-writer.js');
    const write = vi.spyOn(batch, 'batchSaveVCon').mockImplementation(async () => { order.push('write'); return { uuid, id: uuid }; });
    try {
      await queries.upgradeStoredVCon(uuid, null);
    } finally {
      write.mockRestore();
    }
    expect(save).toHaveBeenCalledWith(uuid, expect.anything(), 'upgrade-on-write');
    const report = save.mock.calls[0][1] as any;
    expect(report.removed_dialogs['1']).toMatchObject({ type: 'transfer', x_vendor: 'kept in report' });
    expect(order).toEqual(['report', 'write']);
  });

  it('does not rewrite the vCon when the report cannot be stored', async () => {
    vi.spyOn(queries, 'getVCon').mockResolvedValue(legacy());
    vi.spyOn(queries, 'saveMigrationReport').mockRejectedValue(new Error('relation "vcon_migration_reports" does not exist'));
    const batch = await import('../../src/db/batch-writer.js');
    const write = vi.spyOn(batch, 'batchSaveVCon');
    await expect(queries.upgradeStoredVCon(uuid, null)).rejects.toThrow(/vcon_migration_reports/);
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it('inserts the report row into vcon_migration_reports', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const q = new VConQueries({ from: vi.fn(() => ({ insert })) } as any, null);
    const report = getMigrationReport(legacy())!;
    await q.saveMigrationReport(uuid, report, 'create');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      vcon_id: uuid, source_version: '0.4.0', target_version: '0.5.0', trigger: 'create', report,
    }));
  });
});

describe('MongoDB upgrade on write stores the migration report first', () => {
  it('inserts into vcon_migration_reports before replacing the 0.4.0 document', async () => {
    const { MongoVConQueries } = await import('../../src/db/mongo-queries.js');
    const calls: string[] = [];
    const stored = {
      _id: 'x', vcon: '0.4.0', uuid: 'm1', created_at: '2022-01-01T00:00:00Z', parties: [{}, {}],
      dialog: [{ type: 'transfer', start: '2022-01-01T00:01:00Z', transferee: 0, transferor: 1, original: 0 }],
    };
    const reports: any[] = [];
    const db: any = {
      collection: (name: string) => name === 'vcon_migration_reports'
        ? { insertOne: async (doc: any) => { calls.push('report'); reports.push(doc); } }
        : { findOne: async () => stored, replaceOne: async () => { calls.push('replace'); } },
    };
    const q: any = new MongoVConQueries(db);
    const migrated = await q.loadVConDoc('m1');
    expect(migrated.vcon).toBe('0.5.0');
    expect(calls).toEqual(['report', 'replace']);
    expect(reports[0]).toMatchObject({ vcon_uuid: 'm1', trigger: 'upgrade-on-write' });
    expect(reports[0].report.removed_dialogs['0']).toMatchObject({ type: 'transfer' });
  });
});
