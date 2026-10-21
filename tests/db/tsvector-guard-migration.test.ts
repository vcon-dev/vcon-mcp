import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// CON-957: to_tsvector() on a huge base64url body fails with
// "string is too long for tsvector". The latest definition of each
// body_tsvector trigger function must skip base64url and truncate.
const dir = join(__dirname, '..', '..', 'supabase', 'migrations');

function latestDefinition(fn: string): string {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let found = '';
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    const re = new RegExp(
      `CREATE OR REPLACE FUNCTION ${fn}\\(\\)[\\s\\S]*?\\$\\$ LANGUAGE plpgsql;`,
      'gi'
    );
    const matches = sql.match(re);
    if (matches) found = matches[matches.length - 1];
  }
  return found;
}

describe('tsvector guard migrations', () => {
  for (const fn of ['update_dialog_body_tsvector', 'update_analysis_body_tsvector']) {
    it(`${fn} skips base64url and truncates with left()`, () => {
      const body = latestDefinition(fn);
      expect(body).not.toBe('');
      expect(body).toMatch(/encoding\s*=\s*'base64url'/);
      expect(body).toMatch(/to_tsvector\([^)]*left\(/i);
      expect(body).toMatch(/program_limit_exceeded/);
    });
  }
});
