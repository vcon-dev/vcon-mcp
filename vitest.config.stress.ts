/**
 * Stress tests: simulated MCP clients against a built server (dist/index.js).
 *
 * Requires: npm run build, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * See scripts/README.md (Stress tests section).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['dotenv/config'],
    include: ['tests/stress/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    retry: 0,
  },
});
