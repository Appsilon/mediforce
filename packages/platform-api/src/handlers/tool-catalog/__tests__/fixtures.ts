import type { ToolCatalogEntry } from '@mediforce/platform-core';

export const sampleEntry: ToolCatalogEntry = {
  id: 'tealflow-mcp',
  command: 'npx',
  args: ['-y', 'tealflow-mcp'],
  description: 'TealFlow deployment MCP',
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
