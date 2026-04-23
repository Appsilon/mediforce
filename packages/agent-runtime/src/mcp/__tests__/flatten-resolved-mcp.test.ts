import { describe, it, expect } from 'vitest';
import { McpServerConfigSchema } from '@mediforce/platform-core';
import { flattenResolvedMcpToLegacy } from '../flatten-resolved-mcp.js';

describe('flattenResolvedMcpToLegacy', () => {
  it('returns empty array for empty resolved config', () => {
    expect(flattenResolvedMcpToLegacy({ servers: {} })).toEqual([]);
  });

  it('emits each entry with map key promoted to name', () => {
    const result = flattenResolvedMcpToLegacy({
      servers: {
        tealflow: { type: 'stdio', command: 'tealflow-mcp' },
        github: { type: 'stdio', command: 'github-mcp', args: ['--stdio'] },
      },
    });
    expect(result).toHaveLength(2);
    expect(result.find((s) => s.name === 'tealflow')).toEqual({
      name: 'tealflow',
      command: 'tealflow-mcp',
      args: [],
    });
    expect(result.find((s) => s.name === 'github')).toEqual({
      name: 'github',
      command: 'github-mcp',
      args: ['--stdio'],
    });
  });

  it('carries allowedTools and env on stdio servers', () => {
    const [entry] = flattenResolvedMcpToLegacy({
      servers: {
        github: {
          type: 'stdio',
          command: 'github-mcp',
          env: { TOKEN: '{{GH}}' },
          allowedTools: ['search_code'],
        },
      },
    });
    expect(entry.env).toEqual({ TOKEN: '{{GH}}' });
    expect(entry.allowedTools).toEqual(['search_code']);
  });

  it('produces url-only entries for http servers', () => {
    const [entry] = flattenResolvedMcpToLegacy({
      servers: {
        remote: {
          type: 'http',
          url: 'https://mcp.example.com/v1',
          allowedTools: ['search'],
        },
      },
    });
    expect(entry.name).toBe('remote');
    expect(entry.url).toBe('https://mcp.example.com/v1');
    expect(entry.command).toBeUndefined();
    expect(entry.allowedTools).toEqual(['search']);
  });

  it('output entries satisfy McpServerConfigSchema', () => {
    const flattened = flattenResolvedMcpToLegacy({
      servers: {
        tealflow: { type: 'stdio', command: 'tealflow-mcp' },
        remote: { type: 'http', url: 'https://mcp.example.com/v1' },
      },
    });
    for (const entry of flattened) {
      expect(() => McpServerConfigSchema.parse(entry)).not.toThrow();
    }
  });
});
