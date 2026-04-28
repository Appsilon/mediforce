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
      '@mediforce/platform-api/contract': path.resolve(
        __dirname,
        '../platform-api/src/contract/index.ts',
      ),
      '@mediforce/platform-api/client': path.resolve(
        __dirname,
        '../platform-api/src/client/index.ts',
      ),
      '@mediforce/platform-api': path.resolve(
        __dirname,
        '../platform-api/src/index.ts',
      ),
    },
  },
});
