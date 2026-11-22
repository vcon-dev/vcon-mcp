/**
 * The SDK has to start before the application's imports for auto-instrumentation to patch anything.
 * Runs a child process with the preload and checks an HTTP request produced a SERVER span at a collector.
 */

import { spawn, spawnSync } from 'child_process';
import http from 'http';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRELOAD = './dist/instrumentation.js';
const FIXTURES = 'tests/observability/fixtures';

interface Received {
  path: string;
  body: any;
}

let collector: http.Server;
let received: Received[] = [];
let endpoint = '';

beforeAll(async () => {
  // The children run the built output with plain node, as production does. A .ts preload cannot load
  // on every supported Node, and the built files are what the Dockerfile and npm start use.
  const build = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')], { cwd: ROOT, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`tsc failed:\n${build.stdout}${build.stderr}`);

  collector = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        received.push({ path: req.url || '', body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch {
        received.push({ path: req.url || '', body: null });
      }
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  await new Promise<void>((r) => collector.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${(collector.address() as import('net').AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await new Promise((r) => collector.close(r));
});

function runChild(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ENV_FILE: '/nonexistent', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timed out:\n${output}`)); }, 30_000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
}

function spans(): any[] {
  return received
    .filter((r) => r.path === '/v1/traces' && r.body)
    .flatMap((r) => r.body.resourceSpans ?? [])
    .flatMap((rs: any) => (rs.scopeSpans ?? []).flatMap((ss: any) => ss.spans.map((s: any) => ({ ...s, resource: rs.resource }))));
}

const OTEL_ENV = {
  OTEL_ENABLED: 'true',
  OTEL_EXPORTER_TYPE: 'otlp',
  OTEL_LOG_LEVEL: 'none',
  OTEL_SERVICE_NAME: 'vcon-mcp-test-instance',
};

describe('startup order', () => {
  it('records an HTTP server span when the SDK is loaded with node --import', async () => {
    received = [];
    const { code, output } = await runChild(
      ['--import', PRELOAD, `${FIXTURES}/http-server.mjs`],
      { ...OTEL_ENV, OTEL_EXPORTER_OTLP_ENDPOINT: endpoint }
    );
    expect(code, output).toBe(0);

    const all = spans();
    // SpanKind.SERVER is 2 in OTLP JSON
    const server = all.filter((s) => s.kind === 2);
    expect(server.length, JSON.stringify(all.map((s) => [s.name, s.kind]))).toBeGreaterThan(0);

    // No query string or personal data reaches the collector, in any span name or attribute.
    const exported = JSON.stringify(all.map((s) => [s.name, s.attributes]));
    for (const leak of ['secret=1', 'mailto', 'ilike', 'person%40example', 'person@example', '15551234567']) {
      expect(exported, leak).not.toContain(leak);
    }
    // The outbound call was traced (a client span), so the absence above is not an empty result.
    // (Node 18's bundled fetch does not publish the channel the undici instrumentation listens on.)
    if (Number(process.versions.node.split('.')[0]) >= 20) {
      expect(all.filter((s) => s.kind === 3 && JSON.stringify(s.attributes).includes('/rest/v1/vcons')).length).toBeGreaterThan(0);
    }

    // OTEL_SERVICE_NAME is honored per instance
    const names = server[0].resource.attributes.filter((a: any) => a.key === 'service.name').map((a: any) => a.value.stringValue);
    expect(names).toEqual(['vcon-mcp-test-instance']);
  }, 40_000);

  it('records no server span when the app starts the SDK itself after its imports (the old order)', async () => {
    received = [];
    const { code, output } = await runChild(
      [`${FIXTURES}/http-server-late.mjs`],
      { ...OTEL_ENV, OTEL_EXPORTER_OTLP_ENDPOINT: endpoint }
    );
    expect(code, output).toBe(0);
    expect(spans().filter((s) => s.kind === 2)).toEqual([]);
  }, 40_000);

  it('falls back to OTEL_ENDPOINT when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    received = [];
    const { code, output } = await runChild(
      ['--import', PRELOAD, `${FIXTURES}/http-server.mjs`],
      { ...OTEL_ENV, OTEL_ENDPOINT: endpoint }
    );
    expect(code, output).toBe(0);
    expect(spans().filter((s) => s.kind === 2).length).toBeGreaterThan(0);
  }, 40_000);
});
