import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

// A /Users/<name>/ path in a tracked file is somebody's home directory. Only these
// placeholders may appear.
const PLACEHOLDERS = new Set(['you', 'yourname', 'YOUR_USERNAME', 'username', 'user']);
const PATTERN = /\/Users\/([A-Za-z0-9._-]+)/g;

describe('tracked files', () => {
  it('hold no personal home-directory path', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter((f) => f && !/\.(png|jpg|jpeg|gif|pdf|ico|woff2?|tgz|zip)$/i.test(f));
    const hits: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(PATTERN)) {
          if (!PLACEHOLDERS.has(m[1])) hits.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(hits, 'replace with /path/to/vcon-mcp or a /Users/YOUR_USERNAME placeholder').toEqual([]);
  });
});
