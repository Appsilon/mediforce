import { describe, expect, it } from 'vitest';
import type { AgentMcpBindingMap, ToolCatalogEntry } from '@mediforce/platform-core';
import { missingCommandWarnings, stdioServerCommands } from '../mcp-command-warnings';

const CATALOG: ToolCatalogEntry[] = [
  { id: 'biomcp', command: 'uvx', args: ['--from', 'biomcp-cli', 'biomcp', 'serve'] },
  { id: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
];

describe('stdioServerCommands', () => {
  it('names the command each stdio binding runs, by binding name', () => {
    const bindings: AgentMcpBindingMap = {
      bio: { type: 'stdio', catalogId: 'biomcp' },
      gh: { type: 'stdio', catalogId: 'github' },
    };

    expect(stdioServerCommands(bindings, CATALOG)).toEqual([
      { server: 'bio', command: 'uvx' },
      { server: 'gh', command: 'npx' },
    ]);
  });

  it('skips http bindings, which run nothing in the image', () => {
    const bindings: AgentMcpBindingMap = {
      remote: { type: 'http', url: 'https://example.com/mcp' },
    };

    expect(stdioServerCommands(bindings, CATALOG)).toEqual([]);
  });

  it('skips a binding whose catalog entry is not loaded (yet) rather than guessing', () => {
    const bindings: AgentMcpBindingMap = { gone: { type: 'stdio', catalogId: 'deleted' } };

    expect(stdioServerCommands(bindings, CATALOG)).toEqual([]);
  });

  it('skips a server the step disables, or empties with denyTools — neither is started', () => {
    const bindings: AgentMcpBindingMap = {
      off: { type: 'stdio', catalogId: 'biomcp' },
      emptied: { type: 'stdio', catalogId: 'github', allowedTools: ['search'] },
      kept: { type: 'stdio', catalogId: 'github', allowedTools: ['search', 'read'] },
    };

    expect(
      stdioServerCommands(bindings, CATALOG, {
        off: { disable: true },
        emptied: { denyTools: ['search'] },
        kept: { denyTools: ['search'] },
      }),
    ).toEqual([{ server: 'kept', command: 'npx' }]);
  });
});

describe('missingCommandWarnings', () => {
  const servers = [
    { server: 'bio', command: 'uvx' },
    { server: 'bio-2', command: 'uvx' },
    { server: 'gh', command: 'npx' },
  ];

  it('groups the servers behind one missing command, and warns only on a known absence', () => {
    const warnings = missingCommandWarnings(servers, {
      uvx: { status: 'known', available: false },
      npx: { status: 'known', available: true, path: '/usr/bin/npx' },
    });

    expect(warnings).toEqual([{ command: 'uvx', servers: ['bio', 'bio-2'] }]);
  });

  it('says nothing for an unknown or not-yet-answered command', () => {
    expect(
      missingCommandWarnings(servers, { uvx: { status: 'unknown' } }),
    ).toEqual([]);
  });
});
