import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      exclude: ['**/testing/**', '**/index.ts', '**/*.d.ts', '**/e2e/**', '**/__tests__/**'],
    },
  },
  resolve: {
    conditions: ['@mediforce/source'],
  },
});
