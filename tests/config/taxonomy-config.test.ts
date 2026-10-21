import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const warn = vi.fn();
vi.mock('../../src/observability/logger.js', () => ({
  createLogger: () => ({ warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

const ENV_KEYS = ['VCON_TAXONOMY_CONFIG', 'VCON_TAXONOMY_DATASET', 'VCON_DEALER_ATTACHMENT_TYPE'] as const;

describe('getTaxonomyConfig', () => {
  let saved: Record<string, string | undefined>;
  let getTaxonomyConfig: typeof import('../../src/config/taxonomy-config.js').getTaxonomyConfig;

  beforeEach(async () => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    ENV_KEYS.forEach((k) => delete process.env[k]);
    warn.mockClear();
    vi.resetModules();
    ({ getTaxonomyConfig } = await import('../../src/config/taxonomy-config.js'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it('returns neutral defaults with no configuration', () => {
    expect(getTaxonomyConfig()).toMatchObject({ dataset: null, dealerAttachmentType: 'dealer' });
    expect(getTaxonomyConfig().portalValues).toBeUndefined();
  });

  it('falls back to defaults with one warning when the file is missing, and does not re-read it', () => {
    process.env.VCON_TAXONOMY_CONFIG = join(tmpdir(), 'vcon-taxonomy-does-not-exist.json');
    process.env.VCON_DEALER_ATTACHMENT_TYPE = 'example_dealer';

    const first = getTaxonomyConfig();
    const second = getTaxonomyConfig();

    expect(first).toMatchObject({ dataset: null, dealerAttachmentType: 'example_dealer' });
    expect(second.portalValues).toBeUndefined();
    // One warning across two calls: a re-read would warn again.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid JSON', '{ not json'],
    ['a non-object', '[1, 2]'],
    ['a non-array section', JSON.stringify({ dataset: 'x', portal_values: 'oops' })],
  ])('falls back to defaults with one warning for %s', (_label, content) => {
    const dir = mkdtempSync(join(tmpdir(), 'vcon-taxonomy-bad-'));
    const file = join(dir, 'taxonomy.json');
    writeFileSync(file, content);
    process.env.VCON_TAXONOMY_CONFIG = file;

    expect(() => getTaxonomyConfig()).not.toThrow();
    const config = getTaxonomyConfig();
    expect(config.dataset).toBeNull();
    expect(config.portalValues).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
