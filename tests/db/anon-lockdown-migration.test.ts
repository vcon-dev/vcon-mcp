import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// anon must not read tenant rows through views, the tag materialized view or
// SECURITY DEFINER functions. scripts/test-anon-lockdown.sh proves it against a
// real database and PostgREST; these checks keep the files from drifting.
const root = join(__dirname, '..', '..');
const dir = join(root, 'supabase', 'migrations');
const LOCKDOWN = '20261109163739_revoke_anon_read_paths.sql';

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

const DEFINER_HELPERS = [
  'exec_sql(text, jsonb)',
  'exec_sql(jsonb, text)',
  'explain_query(text, boolean)',
  'set_tenant_context(text)',
  'clear_tenant_context()',
  'get_connection_metrics()',
  'get_index_health()',
  'get_performance_metrics()',
  'get_storage_efficiency()',
];

describe('anon read-path lockdown migration', () => {
  const sql = stripComments(readFileSync(join(dir, LOCKDOWN), 'utf8'));

  it('closes the SECURITY DEFINER helpers to PUBLIC, anon and authenticated, not service_role', () => {
    for (const fn of DEFINER_HELPERS) {
      expect(sql).toContain(`'public.${fn}'`);
    }
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION %s TO service_role/);
  });

  it('makes both views run with the caller privileges', () => {
    expect(sql).toMatch(/'vcons_legacy', 'vcon_field_usage'/);
    expect(sql).toMatch(/SET \(security_invoker = true\)/);
  });

  it('takes vcon_tags_mv from PUBLIC and anon but leaves authenticated', () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.vcon_tags_mv FROM PUBLIC, anon;/);
    expect(sql).not.toMatch(/vcon_tags_mv FROM[^;]*authenticated/);
  });

  it('takes every table and function from anon, now and by default', () => {
    expect(sql).toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;/);
    expect(sql).toMatch(/REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC, anon/);
    expect(sql).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;/);
    expect(sql).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;/
    );
  });

  it('is the newest migration or is followed by migrations that grant nothing to anon or PUBLIC', () => {
    const later = readdirSync(dir)
      .filter((f) => f.endsWith('.sql') && f > LOCKDOWN)
      .sort();
    for (const f of later) {
      const body = stripComments(readFileSync(join(dir, f), 'utf8'));
      const grants = body.match(/\bGRANT\b[^;]*\bTO\b[^;]*;/gi) ?? [];
      for (const g of grants) {
        expect(g, `${f}: ${g}`).not.toMatch(/\bTO\b[^;]*\b(anon|PUBLIC)\b/i);
      }
    }
  });
});

describe('bootstrap-schema.sh grants', () => {
  const script = readFileSync(join(root, 'scripts', 'bootstrap-schema.sh'), 'utf8');
  const grants = script.split('\n').filter((l) => /^\s*(GRANT|ALTER DEFAULT PRIVILEGES)\b/.test(l));

  it('grants nothing to anon in a cloned schema', () => {
    expect(grants.length).toBeGreaterThan(0);
    for (const line of grants) {
      expect(line).not.toMatch(/\banon\b/);
    }
  });

  it('removes the PUBLIC execute grant and closes the definer helpers to authenticated', () => {
    expect(script).toMatch(/REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA "\$SCHEMA" FROM PUBLIC;/);
    for (const fn of DEFINER_HELPERS) {
      expect(script).toContain(`'${fn}'`);
    }
    expect(script).toMatch(/REVOKE EXECUTE ON FUNCTION %s FROM authenticated/);
  });
});
