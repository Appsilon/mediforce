import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(__dirname, '..');

const isVercel = process.env.VERCEL === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isVercel ? {} : { output: 'standalone', outputFileTracingRoot: path.resolve(__dirname, '../..') }),
  transpilePackages: [
    '@mediforce/platform-core',
    '@mediforce/platform-infra',
    '@mediforce/workflow-engine',
    '@mediforce/agent-runtime',
    '@mediforce/agent-queue',
    '@mediforce/supply-intelligence-plugins',
    '@mediforce/supply-intelligence',
    '@mediforce/mcp-client',
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
      '@mediforce/workflow-engine': path.join(packagesDir, 'workflow-engine/src/index.ts'),
      '@mediforce/agent-runtime': path.join(packagesDir, 'agent-runtime/src/index.ts'),
      '@mediforce/agent-queue': path.join(packagesDir, 'agent-queue/src/index.ts'),
      '@mediforce/supply-intelligence-plugins': path.join(packagesDir, 'supply-intelligence-plugins/src/index.ts'),
      '@mediforce/supply-intelligence': path.join(packagesDir, 'supply-intelligence/src/index.ts'),
      '@mediforce/mcp-client': path.join(packagesDir, 'mcp-client/src/index.ts'),
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
