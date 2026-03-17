import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    conditions: ['@mediforce/source'],
    alias: {
      '@mediforce/platform-core': path.resolve(__dirname, '../platform-core/src/index.ts'),
      '@mediforce/agent-runtime': path.resolve(__dirname, '../agent-runtime/src/index.ts'),
      '@mediforce/agent-queue': path.resolve(__dirname, '../agent-queue/src/index.ts'),
    },
  },
});
