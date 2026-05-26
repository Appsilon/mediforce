import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    conditions: ['@mediforce/source'],
    alias: {
      '@mediforce/platform-core': resolve(__dirname, '../../packages/platform-core/src/index.ts'),
      '@mediforce/platform-api': resolve(__dirname, '../../packages/platform-api/src/index.ts'),
      '@mediforce/platform-infra': resolve(__dirname, '../../packages/platform-infra/src/index.ts'),
      '@mediforce/workflow-engine': resolve(__dirname, '../../packages/workflow-engine/src/index.ts'),
    },
  },
});
