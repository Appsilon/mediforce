import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isVercel = process.env.VERCEL === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isVercel
    ? {}
    : {
        output: 'standalone',
        outputFileTracingRoot: path.resolve(__dirname, '../..'),
      }),
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
    '@mediforce/container-worker',
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
  turbopack: {
    resolveAlias: {
      // Pin zod to platform-ui's own copy so `@hookform/resolvers/zod`
      // (which imports `zod/v4/core` without declaring zod as a peer dep)
      // resolves on Vercel. Without this, the bundler walks up from the
      // resolver's .pnpm dir and fails — pnpm's `.pnpm/node_modules` hoist
      // isn't reliably on Vercel's resolve path. Subpaths like `zod/v4/core`
      // map through this alias automatically.
      //
      // Note: relative path (not absolute). Turbopack's resolveAlias does
      // not accept absolute filesystem paths — only relative paths from the
      // project root or module names.
      zod: './node_modules/zod',
    },
  },
  experimental: {
    // Eagerly compile every route at dev-server boot so per-route cold compile
    // cost is paid once at startup, not on each first-hit. Default `true` in
    // Next 16.2; set explicitly to guard against future default flips.
    preloadEntriesOnStart: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  devIndicators: {
    position: 'bottom-right',
  },
};

export default nextConfig;
