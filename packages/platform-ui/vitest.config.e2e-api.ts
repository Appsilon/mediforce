import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Vitest config for Tier 2 API E2E tests — opt-in only, gated behind
 * `pnpm test:mcp-real`. These tests hit real external services (LLM
 * providers, spawned MCP subprocesses) and are excluded from the default
 * `pnpm test` suite used on CI.
 */
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
      '@mediforce/container-worker': resolve(__dirname, '../container-worker/src/index.ts'),
      '@mediforce/platform-infra': resolve(__dirname, '../platform-infra/src/index.ts'),
      '@mediforce/mcp-client': resolve(__dirname, '../mcp-client/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['e2e/api/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
