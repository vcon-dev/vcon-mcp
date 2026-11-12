import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// What the two TENANT_MODE=writer migrations promise, checked on the files so a
// later migration that replaces one of these functions cannot drop the fix
// unnoticed. scripts/test-tenant-writer.sh proves the same against a real
// Postgres; tests/db/tenant-writer-sql.test.ts runs it under VCON_SQL_TESTS=1.
const dir = join(__dirname, '..', '..', 'supabase', 'migrations');
const KEEP = '20261112120000_keep_stored_tenant.sql';
const BACKFILL = '20261112120100_fix_tenant_backfill.sql';

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/** The newest CREATE OR REPLACE of a function across the chain, and its file. */
function latestDefinition(fn: string): { file: string; body: string } {
  let found = { file: '', body: '' };
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = stripComments(readFileSync(join(dir, f), 'utf8'));
    const re = new RegExp(`CREATE OR REPLACE FUNCTION ${fn}\\s*\\([\\s\\S]*?\\n\\$\\$;`, 'gi');
    const m = sql.match(re);
    if (m) found = { file: f, body: m[m.length - 1] };
  }
  return found;
}

describe('save_vcon_batch keeps a stored tenant', () => {
  const { file, body } = latestDefinition('save_vcon_batch');

  it('the newest definition is this fix or a later one', () => {
    expect(file >= KEEP).toBe(true);
  });

  // w3: a service-key re-post with no tenant used to move the vCon to NULL.
  // w4: a re-post stamped for another tenant used to move it there.
  // Both now keep the stored value; only a NULL takes the new one.
  it('w3 and w4: the vcons conflict branch writes COALESCE(stored, new) for tenant_id', () => {
    expect(body).toMatch(/spec\.tbl = 'vcons' AND k = 'tenant_id'/);
    expect(body).toContain('tenant_id = COALESCE(vcons.tenant_id, EXCLUDED.tenant_id)');
  });

  it('every other column still takes the re-post value', () => {
    expect(body).toMatch(/format\('%I = EXCLUDED\.%I', k, k\)/);
  });
});

describe('release_vcon_from_quarantine', () => {
  const sql = stripComments(readFileSync(join(dir, KEEP), 'utf8'));
  const { body } = latestDefinition('release_vcon_from_quarantine');

  it('moves only a vCon in _quarantine, to a well-formed tenant, with a reason, evidence and who', () => {
    expect(body).toMatch(/IS DISTINCT FROM '_quarantine'/);
    expect(body).toContain("'^t-[0-9a-f]{16}$'");
    expect(body).toMatch(/p_reason IS NULL OR btrim\(p_reason\) = ''/);
    expect(body).toMatch(/jsonb_typeof\(p_evidence\) <> 'object'/);
    expect(body).toMatch(/p_released_by IS NULL OR btrim\(p_released_by\) = ''/);
    expect(body).toMatch(/INSERT INTO tenant_quarantine_releases/);
  });

  it('is service_role only, and its log is append-only', () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION release_vcon_from_quarantine\([^)]*\)\s+FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION release_vcon_from_quarantine\([^)]*\) TO service_role;/);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON tenant_quarantine_releases TO service_role;/);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON tenant_quarantine_releases/);
    expect(sql).toMatch(/BEFORE TRUNCATE ON tenant_quarantine_releases/);
  });
});

describe('backfill fixes', () => {
  it('backfill_tenant_id_batch keys s3_sync_tracking by vcon_id', () => {
    const { file, body } = latestDefinition('backfill_tenant_id_batch');
    expect(file >= BACKFILL).toBe(true);
    const s3 = body.slice(body.indexOf("'s3_sync_tracking'"), body.indexOf('ELSE'));
    expect(s3).toMatch(/SELECT s3\.vcon_id, v\.tenant_id/);
    expect(s3).toMatch(/WHERE s3\.vcon_id = batch\.vcon_id/);
    expect(s3).not.toMatch(/s3\.id\b/);
  });

  it('vcon_tenant_stamp reads purpose or type and survives a non-JSON body', () => {
    const { body } = latestDefinition('vcon_tenant_stamp');
    expect(body).toMatch(/a\.purpose = 'tenant' OR a\.type = 'tenant'/);
    expect(body).toMatch(/EXCEPTION WHEN invalid_text_representation THEN/);
    expect(body).toContain("'^t-[0-9a-f]{16}$'");
  });

  it('backfill_vcon_tenant_ids only fills a NULL tenant', () => {
    const { body } = latestDefinition('backfill_vcon_tenant_ids');
    const updates = body.match(/UPDATE vcons[\s\S]*?;/g) ?? [];
    expect(updates.length).toBe(2);
    expect(body.match(/WHERE v\.tenant_id IS NULL/g)?.length).toBe(2);
  });
});

describe('grants in the two migrations', () => {
  for (const f of [KEEP, BACKFILL]) {
    const sql = stripComments(readFileSync(join(dir, f), 'utf8'));

    it(`${f} grants nothing to anon or PUBLIC`, () => {
      for (const g of sql.match(/\bGRANT\b[^;]*\bTO\b[^;]*;/gi) ?? []) {
        expect(g).not.toMatch(/\bTO\b[^;]*\b(anon|PUBLIC)\b/i);
      }
    });

    it(`${f} revokes EXECUTE from PUBLIC and anon on every function it creates`, () => {
      const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\s*\(/g)].map((m) => m[1]);
      expect(fns.length).toBeGreaterThan(0);
      for (const fn of fns) {
        expect(sql, fn).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${fn}\\([^)]*\\)\\s+FROM PUBLIC, anon`));
      }
    });
  }
});
