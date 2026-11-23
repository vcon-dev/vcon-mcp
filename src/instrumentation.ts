/**
 * OpenTelemetry preload.
 *
 * Load this before the application: `node --import ./dist/instrumentation.js dist/index.js`.
 * Auto-instrumentation patches modules as they load, so the SDK has to start before the app's static
 * imports (http, koa, undici and the rest) are evaluated. Starting it from inside src/index.ts runs
 * after those imports and patches nothing.
 *
 * The package is ESM, and `import http from 'http'` never goes through require, so the
 * import-in-the-middle loader hook is registered first. Without it the http, koa and pg patches
 * do not apply to ESM imports.
 *
 * Reads the same ENV_FILE as the app so OTEL_* settings in a per-instance env file take effect.
 */

import { register } from 'node:module';
import dotenv from 'dotenv';
import { shouldInstrument } from './observability/env.js';

dotenv.config({ path: process.env.ENV_FILE || '.env' });

// Only when telemetry will be exported: the hook adds a few hundred ms to startup.
if (shouldInstrument()) {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
}

// Dynamic import: the loader hook above has to be registered before the SDK modules load.
const { initializeObservability } = await import('./observability/config.js');
await initializeObservability();
