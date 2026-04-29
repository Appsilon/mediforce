import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(__dirname, '..');

const isVercel = process.env.VERCEL === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isVercel ? {} : { output: 'standalone', outputFileTracingRoot: path.resolve(__dirname, '../..') }),
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Trust loopback hostnames for HMR. Browsers that hit the dev server via
  // `127.0.0.1` (e.g. after a CLI command prints that form) otherwise fail
  // the cross-origin check on `/_next/webpack-hmr` and the page hangs in
  // "loading" because HMR can't connect.
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  transpilePackages: [
    '@mediforce/platform-core',
    '@mediforce/platform-infra',
    '@mediforce/platform-api',
    '@mediforce/workflow-engine',
    '@mediforce/agent-runtime',
    '@mediforce/agent-queue',
    '@mediforce/mcp-client',
    '@mediforce/core-actions',
    // @hookform/resolvers/zod imports `zod/v4/core` without declaring zod
    // as a peer dep. In pnpm's isolated layout, webpack on Vercel can't
    // walk out of the resolver's .pnpm dir to find zod — transpiling it
    // here forces Next.js to resolve zod against platform-ui's own
    // node_modules, where the symlink exists.
    '@hookform/resolvers',
  ],
  serverExternalPackages: ['bullmq', 'ioredis'],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      '@mediforce/platform-core': path.join(packagesDir, 'platform-core/src/index.ts'),
      '@mediforce/platform-infra': path.join(packagesDir, 'platform-infra/src/index.ts'),
      '@mediforce/platform-api/contract': path.join(packagesDir, 'platform-api/src/contract/index.ts'),
      '@mediforce/platform-api/handlers': path.join(packagesDir, 'platform-api/src/handlers/index.ts'),
      '@mediforce/platform-api/services': path.join(packagesDir, 'platform-api/src/services/index.ts'),
      '@mediforce/platform-api/client': path.join(packagesDir, 'platform-api/src/client/index.ts'),
      '@mediforce/platform-api': path.join(packagesDir, 'platform-api/src/index.ts'),
      '@mediforce/workflow-engine': path.join(packagesDir, 'workflow-engine/src/index.ts'),
      '@mediforce/agent-runtime': path.join(packagesDir, 'agent-runtime/src/index.ts'),
      '@mediforce/agent-queue': path.join(packagesDir, 'agent-queue/src/index.ts'),
      '@mediforce/mcp-client': path.join(packagesDir, 'mcp-client/src/index.ts'),
      '@mediforce/core-actions': path.join(packagesDir, 'core-actions/src/index.ts'),
      // Pin zod to platform-ui's own copy so `@hookform/resolvers/zod` (which
      // imports `zod/v4/core` without declaring zod as a peer dep) resolves
      // on Vercel. Without this, webpack walks up from the resolver's .pnpm
      // dir and fails — pnpm's `.pnpm/node_modules` hoist isn't reliably on
      // Vercel's resolve path. Subpaths like `zod/v4/core` map through this
      // alias automatically.
      zod: path.join(__dirname, 'node_modules/zod'),
    };
    return config;
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  devIndicators: {
    position: 'bottom-right',
  },
};

export default nextConfig;
