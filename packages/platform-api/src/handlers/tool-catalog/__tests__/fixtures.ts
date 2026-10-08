import type { HttpToolCatalogEntry, StdioToolCatalogEntry } from '@mediforce/platform-core';

export const sampleEntry: StdioToolCatalogEntry = {
  id: 'tealflow-mcp',
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'tealflow-mcp'],
  description: 'TealFlow deployment MCP',
};

export const sampleHttpEntry: HttpToolCatalogEntry = {
  id: 'github',
  type: 'http',
  url: 'https://api.githubcopilot.com/mcp/',
  auth: { type: 'headers', headers: { Authorization: 'Bearer {{SECRET:github_token}}' } },
};

export const adminRoles = new Map<string, 'owner' | 'admin' | 'member'>([
  ['alpha', 'admin'],
]);

export const ownerRoles = new Map<string, 'owner' | 'admin' | 'member'>([
  ['alpha', 'owner'],
]);

export const memberRoles = new Map<string, 'owner' | 'admin' | 'member'>([
  ['alpha', 'member'],
]);
