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
      '@mediforce/workflow-engine': path.resolve(
        __dirname,
        '../workflow-engine/src/index.ts',
      ),
      '@mediforce/agent-runtime': path.resolve(
        __dirname,
        '../agent-runtime/src/index.ts',
      ),
      '@mediforce/platform-infra': path.resolve(
        __dirname,
        '../platform-infra/src/index.ts',
      ),
    },
  },
});
