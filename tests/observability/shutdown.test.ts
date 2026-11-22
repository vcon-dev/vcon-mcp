/**
 * With the collector unreachable, shutdown must finish well inside Docker's stop grace so plugin
 * shutdown still runs. The "collector" accepts connections and never answers.
 */
import net from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeObservability, shutdownObservability } from '../../src/observability/config.js';
import { recordCounter, withSpan } from '../../src/observability/instrumentation.js';

let blackhole: net.Server;
const sockets: net.Socket[] = [];

beforeAll(async () => {
  blackhole = net.createServer((sock) => { sockets.push(sock); });
  await new Promise<void>((r) => blackhole.listen(0, '127.0.0.1', r));
  const { port } = blackhole.address() as net.AddressInfo;
  process.env.OTEL_ENABLED = 'true';
  process.env.OTEL_EXPORTER_TYPE = 'otlp';
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${port}`;
  process.env.OTEL_LOG_LEVEL = 'none';
});

afterAll(async () => {
  sockets.forEach((s) => s.destroy());
  await new Promise((r) => blackhole.close(r));
  delete process.env.OTEL_EXPORTER_TYPE;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
});

describe('shutdown with an unreachable collector', () => {
  it('finishes in under 4 seconds', async () => {
    await initializeObservability();
    await withSpan('o7.pending', async () => 1);
    recordCounter('o7.pending.count', 1, {}, 'pending');
    const started = Date.now();
    await shutdownObservability();
    expect(Date.now() - started).toBeLessThan(4000);
  }, 20_000);
});
