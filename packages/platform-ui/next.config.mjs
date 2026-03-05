import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(__dirname, '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@mediforce/platform-core',
    '@mediforce/platform-infra',
    '@mediforce/workflow-engine',
    '@mediforce/agent-runtime',
    '@mediforce/supply-intelligence-plugins',
    '@mediforce/supply-intelligence',
  ],
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
      '@mediforce/supply-intelligence-plugins': path.join(packagesDir, 'supply-intelligence-plugins/src/index.ts'),
      '@mediforce/supply-intelligence': path.join(packagesDir, 'supply-intelligence/src/index.ts'),
    };
    return config;
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
