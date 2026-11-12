/**
 * The TENANT_MODE=writer migrations against a real Postgres.
 *
 * Runs scripts/test-tenant-writer.sh, which builds a throwaway cluster, applies
 * the migration chain from this checkout and prints one PASS or FAIL line per
 * check. Opt in with VCON_SQL_TESTS=1; it needs PostgreSQL 15+ server
 * binaries (PGBIN, or found on the usual paths) and takes about half a minute.
 *
 *   VCON_SQL_TESTS=1 npx vitest run tests/db/tenant-writer-sql.test.ts
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { join } from 'path';

const enabled = process.env.VCON_SQL_TESTS === '1';
const script = join(__dirname, '..', '..', 'scripts', 'test-tenant-writer.sh');

describe.skipIf(!enabled)('tenant writer migrations on a real Postgres', () => {
  const results = new Map<string, { ok: boolean; line: string }>();
  let status: number | null = null;
  let output = '';

  beforeAll(() => {
    const run = spawnSync('bash', [script], { encoding: 'utf8', timeout: 300_000, env: process.env });
    status = run.status;
    output = `${run.stdout}\n${run.stderr}`;
    for (const line of run.stdout.split('\n')) {
      const m = line.match(/^(PASS|FAIL) (\S+) /);
      if (m) results.set(m[2], { ok: m[1] === 'PASS', line });
    }
  }, 310_000);

  const expectPass = (id: string) => {
    const r = results.get(id);
    expect(r, `check ${id} did not run:\n${output.slice(-2000)}`).toBeDefined();
    expect(r!.ok, r!.line).toBe(true);
  };

  it('the harness sees the old bugs before the migrations (w3, w4, s3, old backfill)', () => {
    for (const id of ['before-w3', 'before-w4', 'before-s3', 'before-old-abort', 'before-old-purpose']) expectPass(id);
  });

  it('w3 inverted: a service-key re-post with no tenant keeps the stored tenant on the vCon and its children', () => {
    expectPass('after-w3');
    expectPass('after-w3-content');
  });

  it('w4 inverted: a re-post stamped for another tenant keeps the stored tenant', () => {
    expectPass('after-w4');
    expectPass('after-w4-content');
  });

  it('a NULL tenant still takes a stamp, and _quarantine stays put on a re-post', () => {
    for (const id of ['after-null', 'after-quarantine-kept', 'after-null-to-quarantine']) expectPass(id);
  });

  it('only release_vcon_from_quarantine moves a vCon out, and it logs reason and evidence', () => {
    for (const id of ['rel-ok', 'rel-moved', 'rel-other-children', 'rel-log', 'rel-again', 'rel-anon', 'rel-auth',
      'log-update', 'log-delete', 'log-truncate']) expectPass(id);
  });

  it('backfill_tenant_id_batch runs on all nine tables, s3_sync_tracking included', () => {
    expectPass('bf-s3_sync_tracking');
    expectPass('bf-done');
  });

  it('backfill_vcon_tenant_ids reads purpose and type, survives a non-JSON body, and applies the writer rule', () => {
    for (const id of ['bvt-loose', 'bvt-strict', 'bvt-loose-children']) expectPass(id);
  });

  it('re-applying the migrations changes nothing, and the anon lockdown checks still pass', () => {
    for (const id of ['setup-3', 'rerun-w3', 'rerun-w4', 'sqltest']) expectPass(id);
  });

  it('every check passes', () => {
    const failed = [...results.values()].filter((r) => !r.ok).map((r) => r.line);
    expect(failed).toEqual([]);
    expect(status, output.slice(-2000)).toBe(0);
  });
});
