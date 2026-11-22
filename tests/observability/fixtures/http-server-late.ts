/**
 * Child process for startup-order.test.ts: the old order, with the SDK started by the application after
 * its static imports have loaded http. Documents why the preload exists.
 */
import http from 'http';
import { initializeObservability, shutdownObservability } from '../../../src/observability/config.js';

await initializeObservability();

const server = http.createServer((_req, res) => {
  res.end('ok');
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address() as import('net').AddressInfo;
  http.get(`http://127.0.0.1:${port}/ping`, (res) => {
    res.resume();
    res.on('end', async () => {
      server.close();
      await shutdownObservability();
      process.exit(0);
    });
  });
});
