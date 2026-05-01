import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    conditions: ['@mediforce/source'],
    alias: {
      '@mediforce/platform-core/testing': path.resolve(
        __dirname,
        '../platform-core/src/testing/index.ts',
      ),
      '@mediforce/platform-core': path.resolve(
        __dirname,
        '../platform-core/src/index.ts',
      ),
      '@mediforce/agent-runtime': path.resolve(__dirname, './src/index.ts'),
      '@mediforce/container-worker': path.resolve(
        __dirname,
        '../container-worker/src/index.ts',
      ),
    },
  },
});
