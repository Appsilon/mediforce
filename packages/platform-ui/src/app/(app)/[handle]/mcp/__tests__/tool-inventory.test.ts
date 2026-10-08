import { describe, it, expect } from 'vitest';
import type { AgentDefinition, AgentMcpBindingMap, ToolCatalogEntry } from '@mediforce/platform-core';
import { findCatalogUsage, hasSecretTemplate, securityLevel } from '../tool-inventory';

function agent(id: string, mcpServers?: AgentMcpBindingMap): AgentDefinition {
  return { id, name: `Agent ${id}`, mcpServers } as AgentDefinition;
}

const stdioEntry: ToolCatalogEntry = { id: 'filesystem', type: 'stdio', command: 'npx' };
const httpEntry: ToolCatalogEntry = { id: 'github', type: 'http', url: 'https://api.githubcopilot.com/mcp/' };

describe('hasSecretTemplate', () => {
  it('returns false for undefined input', () => {
    expect(hasSecretTemplate(undefined)).toBe(false);
  });

  it('returns false when no value contains the template marker', () => {
    expect(hasSecretTemplate({ region: 'eu', debug: 'true' })).toBe(false);
  });

  it('detects the marker even if only one of many values has it', () => {
    expect(hasSecretTemplate({ region: 'eu', TOKEN: 'Bearer {{SECRET:GH_TOKEN}}' })).toBe(true);
  });
});

describe('findCatalogUsage', () => {
  it('lists every binding of either transport that points at the entry', () => {
    const agents = [
      agent('a1', {
        gh: { type: 'http', catalogId: 'github', allowedTools: ['search'] },
        fs: { type: 'stdio', catalogId: 'filesystem' },
      }),
      agent('a2', { github: { type: 'http', catalogId: 'github' } }),
      agent('a3'),
    ];

    expect(findCatalogUsage(agents, 'github')).toEqual([
      { agentId: 'a1', agentName: 'Agent a1', bindingName: 'gh', allowedTools: ['search'] },
      { agentId: 'a2', agentName: 'Agent a2', bindingName: 'github', allowedTools: undefined },
    ]);
    expect(findCatalogUsage(agents, 'missing')).toEqual([]);
  });
});

describe('securityLevel', () => {
  const allowlisted = [{ agentId: 'a', agentName: 'A', bindingName: 'x', allowedTools: ['t'] }];

  it('is open when nothing narrows or guards the server', () => {
    expect(securityLevel(stdioEntry, [])).toBe('open');
    expect(securityLevel(httpEntry, [])).toBe('open');
  });

  it('counts secret templates in stdio env and in http headers', () => {
    expect(securityLevel({ ...stdioEntry, env: { TOKEN: '{{SECRET:t}}' } }, [])).toBe('secrets');
    expect(
      securityLevel({ ...httpEntry, auth: { type: 'headers', headers: { Authorization: 'Bearer {{SECRET:t}}' } } }, []),
    ).toBe('secrets');
  });

  it('marks oauth-authenticated http servers', () => {
    expect(
      securityLevel(
        { ...httpEntry, auth: { type: 'oauth', provider: 'github', headerName: 'Authorization', headerValueTemplate: 'Bearer {token}' } },
        [],
      ),
    ).toBe('oauth');
  });

  it('prefers the allowlist when a binding narrows the tools', () => {
    expect(securityLevel(httpEntry, allowlisted)).toBe('allowlist');
    expect(securityLevel({ ...stdioEntry, env: { TOKEN: '{{SECRET:t}}' } }, allowlisted)).toBe('allowlist-and-secrets');
  });
});
