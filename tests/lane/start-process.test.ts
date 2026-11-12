/**
 * TENANT_MODE=lane start, through the real entry point in a child process: what refuses to start, and
 * that a lane with a valid env starts, serves health and stops on SIGTERM.
 */

import { spawn } from 'child_process';
import net from 'net';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const LANE_ENV: NodeJS.ProcessEnv = {
  ENV_FILE: join(ROOT, 'tests', 'lane', 'no-such-env-file'),
  TENANT_MODE: 'lane',
  MCP_TRANSPORT: 'http',
  MCP_HTTP_STATELESS: 'true',
  MCP_HTTP_HOST: '127.0.0.1',
  SUPABASE_URL: 'http://127.0.0.1:9',
};

/** Runs src/index.ts with only `env` (plus PATH and HOME). Resolves when it exits or `whileRunning` is done. */
function runServer(
  env: NodeJS.ProcessEnv,
  whileRunning?: (output: () => string) => Promise<void>
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX, 'src/index.ts'], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timed out:\n${output}`)); }, 20_000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, output }); });
    if (whileRunning) {
      whileRunning(() => output).then(() => child.kill('SIGTERM'), (e) => { child.kill('SIGKILL'); reject(e); });
    }
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

describe('TENANT_MODE=lane start', () => {
  it('refuses to start with a service key, without printing it', async () => {
    const { code, output } = await runServer({ ...LANE_ENV, SUPABASE_SERVICE_ROLE_KEY: 'canary-service-key-9e2f' });
    expect(code).toBe(1);
    expect(output).toContain('SUPABASE_SERVICE_ROLE_KEY is set');
    expect(output).not.toContain('canary-service-key-9e2f');
    expect(output).not.toContain('Tenant lane started');
  }, 30_000);

  it('refuses to start on stdio', async () => {
    const { MCP_TRANSPORT: _t, ...stdio } = LANE_ENV;
    const { code, output } = await runServer(stdio);
    expect(code).toBe(1);
    expect(output).toContain('MCP_TRANSPORT must be http');
  }, 30_000);

  it('refuses to start without stateless HTTP', async () => {
    const { code, output } = await runServer({ ...LANE_ENV, MCP_HTTP_STATELESS: 'false' });
    expect(code).toBe(1);
    expect(output).toContain('MCP_HTTP_STATELESS must be true');
  }, 30_000);

  it('refuses an unknown TENANT_MODE', async () => {
    const { code, output } = await runServer({ ...LANE_ENV, TENANT_MODE: 'lanes' });
    expect(code).toBe(1);
    expect(output).toContain('TENANT_MODE must be one of off, writer, lane');
  }, 30_000);

  it('starts with a valid env, serves health without a store, refuses no bearer, and stops on SIGTERM', async () => {
    const port = await freePort();
    const { code, output } = await runServer(
      { ...LANE_ENV, MCP_HTTP_PORT: String(port), REDIS_URL: 'redis://127.0.0.1:1' },
      async (out) => {
        for (let i = 0; i < 100 && !out().includes('Tenant lane started'); i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
        const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
        expect(health.status).toBe(200);
        expect(await health.json()).toMatchObject({ tenant_mode: 'lane' });
        const mcp = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });
        expect(mcp.status).toBe(401);
      }
    );
    expect(output).toContain('TENANT_MODE=lane ignores these settings');
    expect(output).not.toContain('Redis cache connected');
    expect(code).toBe(0);
  }, 30_000);
});

describe('TENANT_MODE unset (off)', () => {
  it('starts as it always has, with a service key and the full server', async () => {
    const port = await freePort();
    const { TENANT_MODE: _m, ...offEnv } = LANE_ENV;
    const { code, output } = await runServer(
      { ...offEnv, MCP_HTTP_PORT: String(port), SUPABASE_SERVICE_ROLE_KEY: 'canary-service-key-off', API_AUTH_REQUIRED: 'false' },
      async (out) => {
        for (let i = 0; i < 100 && !out().includes('HTTP MCP server started'); i++) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    );
    expect(output).toContain('HTTP MCP server started');
    expect(output).toContain('"key_type":"service_role"');
    expect(output).not.toContain('Tenant lane');
    expect(code).toBe(0);
  }, 30_000);
});
