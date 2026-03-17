import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['@mediforce/source'],
    alias: {
      '@': resolve(__dirname, './src'),
      '@mediforce/platform-core/testing': resolve(__dirname, '../platform-core/src/testing/index.ts'),
      '@mediforce/platform-core': resolve(__dirname, '../platform-core/src/index.ts'),
      '@mediforce/workflow-engine': resolve(__dirname, '../workflow-engine/src/index.ts'),
      '@mediforce/agent-runtime': resolve(__dirname, '../agent-runtime/src/index.ts'),
      '@mediforce/agent-queue': resolve(__dirname, '../agent-queue/src/index.ts'),
      '@mediforce/platform-infra': resolve(__dirname, '../platform-infra/src/index.ts'),
      '@mediforce/supply-intelligence-plugins': resolve(__dirname, '../supply-intelligence-plugins/src/index.ts'),
      '@mediforce/supply-intelligence': resolve(__dirname, '../supply-intelligence/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
