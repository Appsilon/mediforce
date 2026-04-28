import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Vitest config for action-flow e2e — drives webhook/cron triggers → http +
 * reshape actions → polling round-trip end-to-end through the real handlers
 * plus a local echo server. Off the default `pnpm test` suite to keep its
 * boot footprint (no Firebase emulators required, but spawns a Node http
 * server).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['@mediforce/source'],
    alias: {
      '@': resolve(__dirname, './src'),
      '@mediforce/platform-core/testing': resolve(__dirname, '../platform-core/src/testing/index.ts'),
      '@mediforce/platform-core': resolve(__dirname, '../platform-core/src/index.ts'),
      '@mediforce/platform-api/services': resolve(__dirname, '../platform-api/src/services/index.ts'),
      '@mediforce/platform-api/contract': resolve(__dirname, '../platform-api/src/contract/index.ts'),
      '@mediforce/platform-api/handlers': resolve(__dirname, '../platform-api/src/handlers/index.ts'),
      '@mediforce/platform-api/client': resolve(__dirname, '../platform-api/src/client/index.ts'),
      '@mediforce/platform-api': resolve(__dirname, '../platform-api/src/index.ts'),
      '@mediforce/workflow-engine': resolve(__dirname, '../workflow-engine/src/index.ts'),
      '@mediforce/agent-runtime': resolve(__dirname, '../agent-runtime/src/index.ts'),
      '@mediforce/agent-queue': resolve(__dirname, '../agent-queue/src/index.ts'),
      '@mediforce/platform-infra': resolve(__dirname, '../platform-infra/src/index.ts'),
      '@mediforce/core-actions': resolve(__dirname, '../core-actions/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: [
      'e2e/execution-summaries-api.e2e.ts',
      'e2e/food-log-proxy.e2e.ts',
      'e2e/daily-weather.e2e.ts',
    ],
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
