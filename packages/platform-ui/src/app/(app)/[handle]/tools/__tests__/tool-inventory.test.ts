import { describe, it, expect } from 'vitest';
import type { AgentDefinition } from '@mediforce/platform-core';
import { collectHttpBindings, countStdioUsage, hasSecretTemplate } from '../tool-inventory';

function agent(partial: Partial<AgentDefinition> & { id: string; name: string }): AgentDefinition {
  return {
    id: partial.id,
    name: partial.name,
    description: partial.description ?? '',
    kind: partial.kind ?? 'cowork',
    runtimeId: partial.runtimeId ?? 'claude-code',
    modelId: partial.modelId ?? 'claude-sonnet-4-6',
    mcpServers: partial.mcpServers,
    namespace: partial.namespace,
    skills: partial.skills,
    inputDescription: partial.inputDescription,
    outputDescription: partial.outputDescription,
    prompt: partial.prompt,
    status: partial.status,
  } as AgentDefinition;
}

describe('hasSecretTemplate', () => {
  it('returns false for undefined input', () => {
    expect(hasSecretTemplate(undefined)).toBe(false);
  });

  it('returns false when no value contains the template marker', () => {
    expect(hasSecretTemplate({ region: 'eu', debug: 'true' })).toBe(false);
  });

  it('returns true when any value contains {{', () => {
    expect(hasSecretTemplate({ DATABASE_URL: '{{SECRET:DATABASE_URL}}' })).toBe(true);
  });

  it('detects the marker even if only one of many values has it', () => {
    expect(
      hasSecretTemplate({ region: 'eu', TOKEN: 'Bearer {{SECRET:GH_TOKEN}}' }),
    ).toBe(true);
  });
});

describe('collectHttpBindings', () => {
  it('returns an empty list when no agents have HTTP bindings', () => {
    const result = collectHttpBindings([
      agent({ id: 'a1', name: 'A1', mcpServers: { fs: { type: 'stdio', catalogId: 'filesystem' } } }),
    ]);
    expect(result).toEqual([]);
  });

  it('flattens HTTP bindings across multiple agents with stable keys', () => {
    const result = collectHttpBindings([
      agent({
        id: 'a1',
        name: 'Reviewer',
        mcpServers: {
          github: { type: 'http', url: 'https://api.github.com/mcp' },
          fs: { type: 'stdio', catalogId: 'filesystem' },
        },
      }),
      agent({
        id: 'a2',
        name: 'Scout',
        mcpServers: {
          github: { type: 'http', url: 'https://api.github.com/mcp', allowedTools: ['repo.read'] },
        },
      }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      key: 'a1::github',
      name: 'github',
      url: 'https://api.github.com/mcp',
      agentId: 'a1',
      agentName: 'Reviewer',
      allowedTools: undefined,
      hasSecretHeaders: false,
      authKind: 'none',
      oauthProvider: undefined,
    });
    expect(result[1]).toMatchObject({
      key: 'a2::github',
      agentName: 'Scout',
      allowedTools: ['repo.read'],
    });
  });

  it('flags bindings whose auth.headers use {{SECRET:…}} templating', () => {
    const result = collectHttpBindings([
      agent({
        id: 'a1',
        name: 'Reviewer',
        mcpServers: {
          github: {
            type: 'http',
            url: 'https://api.github.com/mcp',
            auth: { type: 'headers', headers: { Authorization: 'Bearer {{SECRET:GH_TOKEN}}' } },
          },
        },
      }),
    ]);
    expect(result[0]!.hasSecretHeaders).toBe(true);
    expect(result[0]!.authKind).toBe('headers');
  });

  it('surfaces oauth bindings with provider reference', () => {
    const result = collectHttpBindings([
      agent({
        id: 'a1',
        name: 'Reviewer',
        mcpServers: {
          github: {
            type: 'http',
            url: 'https://api.github.com/mcp',
            auth: { type: 'oauth', provider: 'github' },
          },
        },
      }),
    ]);
    expect(result[0]!.authKind).toBe('oauth');
    expect(result[0]!.oauthProvider).toBe('github');
    // OAuth bindings never flag as having raw secret templates
    expect(result[0]!.hasSecretHeaders).toBe(false);
  });

  it('skips agents with no mcpServers map at all', () => {
    const result = collectHttpBindings([agent({ id: 'a1', name: 'A1' })]);
    expect(result).toEqual([]);
  });
});

describe('countStdioUsage', () => {
  it('returns total: 0 and withAllowlist: false when no agent references the catalog entry', () => {
    const result = countStdioUsage(
      [agent({ id: 'a1', name: 'A1', mcpServers: { fs: { type: 'stdio', catalogId: 'filesystem' } } })],
      'postgres',
    );
    expect(result).toEqual({ total: 0, withAllowlist: false });
  });

  it('counts every binding that points at the catalog entry', () => {
    const result = countStdioUsage(
      [
        agent({ id: 'a1', name: 'A1', mcpServers: { fs: { type: 'stdio', catalogId: 'filesystem' } } }),
        agent({ id: 'a2', name: 'A2', mcpServers: { files: { type: 'stdio', catalogId: 'filesystem' } } }),
        agent({ id: 'a3', name: 'A3', mcpServers: { db: { type: 'stdio', catalogId: 'postgres' } } }),
      ],
      'filesystem',
    );
    expect(result.total).toBe(2);
    expect(result.withAllowlist).toBe(false);
  });

  it('sets withAllowlist: true as soon as one binding has a non-empty allowedTools', () => {
    const result = countStdioUsage(
      [
        agent({ id: 'a1', name: 'A1', mcpServers: { fs: { type: 'stdio', catalogId: 'filesystem' } } }),
        agent({
          id: 'a2',
          name: 'A2',
          mcpServers: { fs: { type: 'stdio', catalogId: 'filesystem', allowedTools: ['read'] } },
        }),
      ],
      'filesystem',
    );
    expect(result).toEqual({ total: 2, withAllowlist: true });
  });

  it('ignores HTTP bindings — they live in a separate dimension', () => {
    const result = countStdioUsage(
      [
        agent({
          id: 'a1',
          name: 'A1',
          mcpServers: { gh: { type: 'http', url: 'https://api.github.com/mcp' } },
        }),
      ],
      'filesystem',
    );
    expect(result).toEqual({ total: 0, withAllowlist: false });
  });

  it('treats an empty allowedTools array as no-allowlist (schema forbids it but defend in depth)', () => {
    const result = countStdioUsage(
      [
        agent({
          id: 'a1',
          name: 'A1',
          mcpServers: { fs: { type: 'stdio', catalogId: 'filesystem', allowedTools: [] } },
        }),
      ],
      'filesystem',
    );
    expect(result).toEqual({ total: 1, withAllowlist: false });
  });
});
