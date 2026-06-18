import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    // Environment is set per-file using // @vitest-environment directive
    // Default is 'node' for crypto tests; content tests use 'jsdom'
  },
});
