import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const script = join(process.cwd(), 'scripts/check-release-tag.sh');

function run(ref: string, name: string, version = '1.12.0') {
  const dir = mkdtempSync(join(tmpdir(), 'tag-guard-'));
  const file = join(dir, 'package.json');
  writeFileSync(file, JSON.stringify({ version }));
  return spawnSync('bash', [script], {
    env: { PATH: process.env.PATH, GITHUB_REF: ref, GITHUB_REF_NAME: name, PACKAGE_JSON: file },
    encoding: 'utf8',
  });
}

describe('release tag guard', () => {
  it('passes for the tag that matches package.json', () => {
    expect(run('refs/tags/v1.12.0', 'v1.12.0').status).toBe(0);
  });
  it('fails for a tag that differs from package.json', () => {
    const r = run('refs/tags/v1.13.0', 'v1.13.0');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('does not match');
  });
  it('fails for a dispatch-shaped run from a branch', () => {
    const r = run('refs/heads/main', 'main');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('needs a v* tag');
  });
  it('is wired into publish.yml with no manual trigger', () => {
    const wf = readFileSync(join(process.cwd(), '.github/workflows/publish.yml'), 'utf8');
    expect(wf).toContain('scripts/check-release-tag.sh');
    expect(wf).not.toContain('workflow_dispatch');
  });
});
