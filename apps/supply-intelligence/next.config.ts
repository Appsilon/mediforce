import type { NextConfig } from 'next';
import path from 'path';

const packagesDir = path.resolve(__dirname, '..', '..', 'packages');

const nextConfig: NextConfig = {
  output: 'standalone',
  webpack: (config) => {
    // TypeScript ESM sources use .js extensions in imports -- map them to .ts
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      '@mediforce/supply-intelligence': path.join(packagesDir, 'supply-intelligence/src/index.ts'),
    };
    return config;
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  transpilePackages: ['@mediforce/supply-intelligence'],
};

export default nextConfig;
