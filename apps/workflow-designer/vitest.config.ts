import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@mediforce/platform-core': resolve(__dirname, '../../packages/platform-core/src/index.ts'),
      '@mediforce/workflow-engine': resolve(__dirname, '../../packages/workflow-engine/src/index.ts'),
    },
  },
});
