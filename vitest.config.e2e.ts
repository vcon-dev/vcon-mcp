import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['dotenv/config'],
    include: ['tests/e2e/**/*.test.ts'],
    // E2E tests need longer timeouts for server startup and network calls
    testTimeout: 30000,
    hookTimeout: 60000,
    // Run tests sequentially to avoid conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Retry flaky tests once
    retry: 1,
  },
});
