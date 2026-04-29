import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    conditions: ['@mediforce/source'],
    alias: {
      '@mediforce/platform-core': resolve(__dirname, '../../packages/platform-core/src/index.ts'),
    },
  },
});
