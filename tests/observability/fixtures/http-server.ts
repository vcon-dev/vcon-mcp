/**
 * Child process for startup-order.test.ts. Started with `--import ./src/instrumentation.ts`, so the SDK
 * is already running when this file's static imports are evaluated. Serves one request to itself, then
 * flushes telemetry and exits.
 */
import http from 'http';
import { shutdownObservability } from '../../../src/observability/config.js';

const server = http.createServer((_req, res) => {
  res.end('ok');
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address() as import('net').AddressInfo;
  http.get(`http://127.0.0.1:${port}/ping?secret=1`, (res) => {
    res.resume();
    res.on('end', async () => {
      // An outbound undici call shaped like the store's search filters: email and phone in the query.
      await fetch(`http://127.0.0.1:${port}/rest/v1/vcons?mailto=ilike.%25person%40example.test%25&tel=ilike.%25%2B15551234567%25`)
        .then((r) => r.text())
        .catch(() => undefined);
      server.close();
      await shutdownObservability();
      process.exit(0);
    });
  });
});
