import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

// A home-directory path in a tracked file is somebody's machine. Only these
// placeholders and well-known service accounts may appear (compared in lower case).
const ALLOWED = new Set(['you', 'yourname', 'your_username', 'username', 'user', 'runner', 'kong']);

const PATTERNS: RegExp[] = [
  // macOS and Linux: /Users/<name>, /home/<name>, any case
  /\/(?:users|home)\/([A-Za-z0-9._-]+)/gi,
  // Windows: C:\Users\<name>\ (either slash)
  /[A-Za-z]:[\\/]users[\\/]([A-Za-z0-9._-]+)/gi,
  // ~<name>/ with the trailing slash, so semver ranges such as ~1.2.3 do not match
  /(?<![\w.~/-])~([A-Za-z0-9._-]+)\//g,
];

export function personalPaths(line: string): string[] {
  const names: string[] = [];
  for (const re of PATTERNS) {
    for (const m of line.matchAll(re)) {
      if (!ALLOWED.has(m[1].toLowerCase())) names.push(m[1]);
    }
  }
  return [...new Set(names)];
}

describe('personalPaths', () => {
  it.each([
    ['macOS', 'cd /Users/alice/code'],
    ['macOS lower case', 'cd /users/alice/code'],
    ['Linux', 'cd /home/alice/code'],
    ['Linux upper case', 'cd /HOME/alice/code'],
    ['Windows backslash', 'cd C:\\Users\\alice\\code'],
    ['Windows lower-case drive and forward slash', 'cd d:/Users/alice/code'],
    ['tilde user', 'cd ~alice/code'],
  ])('flags %s', (_label, line) => {
    expect(personalPaths(line)).toEqual(['alice']);
  });

  it.each([
    'cd /Users/you/code',
    'cd /Users/yourname/code',
    'cd /Users/YOUR_USERNAME/code',
    'cd /home/runner/work',
    'cd /home/kong/data',
    'cd C:\\Users\\username\\code',
    'cd ~/code',
    '"semver": "~1.2.3"',
    '"semver": "^1.2.3 || ~2.0.1"',
  ])('allows %s', (line) => {
    expect(personalPaths(line)).toEqual([]);
  });
});

describe('tracked files', () => {
  it('hold no personal home-directory path', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter((f) => f && f !== 'tests/no-local-paths.test.ts' && !/\.(png|jpg|jpeg|gif|pdf|ico|woff2?|tgz|zip)$/i.test(f));
    const hits: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      text.split('\n').forEach((line, i) => {
        if (personalPaths(line).length) hits.push(`${file}:${i + 1}`);
      });
    }
    expect(hits, 'replace with /path/to/vcon-mcp or a /Users/YOUR_USERNAME placeholder').toEqual([]);
  });
});
