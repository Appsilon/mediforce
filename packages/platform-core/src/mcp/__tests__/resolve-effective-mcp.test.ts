import { describe, it, expect } from 'vitest';
import {
  CatalogEntryNotFoundError,
  DenyToolsWithoutAllowedToolsError,
  UnknownRestrictionTargetError,
  resolveEffectiveMcp,
  type ResolvedMcpServer,
  type ResolvedStdioMcpServer,
  type ResolvedHttpMcpServer,
} from '../resolve-effective-mcp.js';
import type {
  AgentMcpBindingMap,
  StepMcpRestriction,
  ToolCatalogEntry,
} from '../../schemas/agent-mcp-binding.js';
import type { AgentDefinition } from '../../schemas/agent-definition.js';
import {
  WorkflowStepSchema,
  type WorkflowStep,
} from '../../schemas/workflow-definition.js';

function makeAgent(mcpServers?: AgentMcpBindingMap): AgentDefinition {
  return {
    id: 'agent-1',
    kind: 'plugin',
    name: 'Test Agent',
    iconName: 'bot',
    description: '',
    foundationModel: 'sonnet',
    systemPrompt: '',
    inputDescription: '',
    outputDescription: '',
    skillFileNames: [],
    mcpServers,
    createdAt: '2026-04-22T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
  };
}

function makeStep(mcpRestrictions?: StepMcpRestriction): WorkflowStep {
  return WorkflowStepSchema.parse({
    id: 'step-1',
    name: 'Step 1',
    type: 'creation',
    executor: 'agent',
    mcpRestrictions,
  });
}

function makeCatalog(entries: ToolCatalogEntry[]): Map<string, ToolCatalogEntry> {
  return new Map(entries.map(entry => [entry.id, entry]));
}

function asStdio(server: ResolvedMcpServer | undefined): ResolvedStdioMcpServer {
  if (server?.type !== 'stdio') {
    throw new Error(`expected stdio server, got ${server?.type ?? 'undefined'}`);
  }
  return server;
}

function asHttp(server: ResolvedMcpServer | undefined): ResolvedHttpMcpServer {
  if (server?.type !== 'http') {
    throw new Error(`expected http server, got ${server?.type ?? 'undefined'}`);
  }
  return server;
}

describe('resolveEffectiveMcp', () => {
  describe('passthrough (no step restrictions)', () => {
    it('returns empty servers when agent has no mcpServers', () => {
      const result = resolveEffectiveMcp(makeAgent(), makeStep(), new Map());
      expect(result.servers).toEqual({});
    });

    it('resolves stdio bindings from catalog', () => {
      const catalog = makeCatalog([
        {
          id: 'cdisc-library',
          command: 'npx',
          args: ['-y', '@cdisc/mcp-server'],
          env: { API_KEY: '{{SECRET:cdisc_key}}' },
          description: 'CDISC',
        },
      ]);
      const agent = makeAgent({
        cdisc: { type: 'stdio', catalogId: 'cdisc-library' },
      });
      const result = resolveEffectiveMcp(agent, makeStep(), catalog);
      const cdisc = asStdio(result.servers.cdisc);
      expect(cdisc.command).toBe('npx');
      expect(cdisc.args).toEqual(['-y', '@cdisc/mcp-server']);
      expect(cdisc.env).toEqual({ API_KEY: '{{SECRET:cdisc_key}}' });
    });

    it('resolves http bindings without catalog lookup', () => {
      const agent = makeAgent({
        remote: {
          type: 'http',
          url: 'https://mcp.example.com/v1',
          auth: { headers: { Authorization: 'Bearer {{SECRET:tok}}' } },
        },
      });
      const result = resolveEffectiveMcp(agent, makeStep(), new Map());
      const remote = asHttp(result.servers.remote);
      expect(remote.url).toBe('https://mcp.example.com/v1');
      expect(remote.auth?.headers?.Authorization).toBe('Bearer {{SECRET:tok}}');
    });

    it('resolves a mix of 2 stdio + 1 http servers', () => {
      const catalog = makeCatalog([
        { id: 'a', command: 'cmd-a' },
        { id: 'b', command: 'cmd-b' },
      ]);
      const agent = makeAgent({
        alpha: { type: 'stdio', catalogId: 'a' },
        beta: { type: 'stdio', catalogId: 'b' },
        gamma: { type: 'http', url: 'https://example.com' },
      });
      const result = resolveEffectiveMcp(agent, makeStep(), catalog);
      expect(Object.keys(result.servers)).toHaveLength(3);
      expect(asStdio(result.servers.alpha).command).toBe('cmd-a');
      expect(asStdio(result.servers.beta).command).toBe('cmd-b');
      expect(asHttp(result.servers.gamma).url).toBe('https://example.com');
    });

    it('carries binding.allowedTools through when no step restriction', () => {
      const catalog = makeCatalog([{ id: 'gh', command: 'gh-mcp' }]);
      const agent = makeAgent({
        github: {
          type: 'stdio',
          catalogId: 'gh',
          allowedTools: ['search_code', 'get_file'],
        },
      });
      const result = resolveEffectiveMcp(agent, makeStep(), catalog);
      const github = asStdio(result.servers.github);
      expect(github.allowedTools).toEqual(['search_code', 'get_file']);
    });
  });

  describe('step-level disable', () => {
    it('omits a server disabled by step restriction', () => {
      const catalog = makeCatalog([
        { id: 'a', command: 'cmd-a' },
        { id: 'b', command: 'cmd-b' },
      ]);
      const agent = makeAgent({
        alpha: { type: 'stdio', catalogId: 'a' },
        beta: { type: 'stdio', catalogId: 'b' },
      });
      const step = makeStep({ beta: { disable: true } });
      const result = resolveEffectiveMcp(agent, step, catalog);
      expect(Object.keys(result.servers)).toEqual(['alpha']);
      expect(result.servers.beta).toBeUndefined();
    });

    it('treats disable: false as a noop', () => {
      const catalog = makeCatalog([{ id: 'a', command: 'cmd-a' }]);
      const agent = makeAgent({ alpha: { type: 'stdio', catalogId: 'a' } });
      const step = makeStep({ alpha: { disable: false } });
      const result = resolveEffectiveMcp(agent, step, catalog);
      expect(result.servers.alpha).toBeDefined();
    });
  });

  describe('step-level denyTools (subtractive)', () => {
    it('subtracts denyTools from binding.allowedTools', () => {
      const catalog = makeCatalog([{ id: 'gh', command: 'gh-mcp' }]);
      const agent = makeAgent({
        github: {
          type: 'stdio',
          catalogId: 'gh',
          allowedTools: ['search_code', 'get_file', 'create_pr'],
        },
      });
      const step = makeStep({ github: { denyTools: ['create_pr'] } });
      const result = resolveEffectiveMcp(agent, step, catalog);
      const github = asStdio(result.servers.github);
      expect(github.allowedTools).toEqual(['search_code', 'get_file']);
    });

    it('drops server entirely when denyTools empties the allowlist', () => {
      const catalog = makeCatalog([{ id: 'gh', command: 'gh-mcp' }]);
      const agent = makeAgent({
        github: {
          type: 'stdio',
          catalogId: 'gh',
          allowedTools: ['search_code'],
        },
      });
      const step = makeStep({ github: { denyTools: ['delete_repo', 'search_code'] } });
      const result = resolveEffectiveMcp(agent, step, catalog);
      // search_code removed → allowlist becomes empty → server dropped entirely.
      // delete_repo is ignored silently (not in allowlist).
      expect(result.servers.github).toBeUndefined();
    });

    it('drops only the emptied server, keeps siblings intact', () => {
      const catalog = makeCatalog([
        { id: 'gh', command: 'gh-mcp' },
        { id: 'pg', command: 'pg-mcp' },
      ]);
      const agent = makeAgent({
        github: { type: 'stdio', catalogId: 'gh', allowedTools: ['search'] },
        postgres: { type: 'stdio', catalogId: 'pg', allowedTools: ['query'] },
      });
      const step = makeStep({ github: { denyTools: ['search'] } });
      const result = resolveEffectiveMcp(agent, step, catalog);
      expect(result.servers.github).toBeUndefined();
      expect(Object.keys(result.servers)).toEqual(['postgres']);
    });

    it('applies denyTools to http bindings the same way', () => {
      const agent = makeAgent({
        remote: {
          type: 'http',
          url: 'https://example.com',
          allowedTools: ['fetch', 'push'],
        },
      });
      const step = makeStep({ remote: { denyTools: ['push'] } });
      const result = resolveEffectiveMcp(agent, step, new Map());
      expect(asHttp(result.servers.remote).allowedTools).toEqual(['fetch']);
    });

    it('denyTools without binding allowedTools throws DenyToolsWithoutAllowedToolsError', () => {
      // Binding has no allowedTools → the resolver cannot materialize an
      // explicit allowlist to subtract from, and the downstream serializers
      // (mcp-config.json / McpServerConfig) have no way to express the
      // "all-minus-X" state. Rejecting at resolution time forces the author
      // to either add allowedTools to the binding or use disable: true.
      const catalog = makeCatalog([{ id: 'gh', command: 'gh-mcp' }]);
      const agent = makeAgent({
        github: { type: 'stdio', catalogId: 'gh' },
      });
      const step = makeStep({ github: { denyTools: ['delete_repo'] } });
      expect(() => resolveEffectiveMcp(agent, step, catalog)).toThrow(
        DenyToolsWithoutAllowedToolsError,
      );
    });

    it('DenyToolsWithoutAllowedToolsError exposes serverName and denyTools', () => {
      const catalog = makeCatalog([{ id: 'gh', command: 'gh-mcp' }]);
      const agent = makeAgent({
        github: { type: 'stdio', catalogId: 'gh' },
      });
      const step = makeStep({ github: { denyTools: ['delete_repo', 'admin_purge'] } });
      try {
        resolveEffectiveMcp(agent, step, catalog);
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(DenyToolsWithoutAllowedToolsError);
        if (err instanceof DenyToolsWithoutAllowedToolsError) {
          expect(err.serverName).toBe('github');
          expect(err.denyTools).toEqual(['delete_repo', 'admin_purge']);
        }
      }
    });

    it('does not throw when denyTools is empty on a binding without allowedTools', () => {
      // denyTools=[] is a no-op — no authorization gap, nothing to reject.
      const catalog = makeCatalog([{ id: 'gh', command: 'gh-mcp' }]);
      const agent = makeAgent({
        github: { type: 'stdio', catalogId: 'gh' },
      });
      const step = makeStep({ github: { denyTools: [] } });
      expect(() => resolveEffectiveMcp(agent, step, catalog)).not.toThrow();
    });

    it('does not throw when denyTools accompanies disable:true on a binding without allowedTools', () => {
      // disable short-circuits the server — denyTools is moot, so no error.
      const catalog = makeCatalog([{ id: 'gh', command: 'gh-mcp' }]);
      const agent = makeAgent({
        github: { type: 'stdio', catalogId: 'gh' },
      });
      const step = makeStep({ github: { disable: true, denyTools: ['delete_repo'] } });
      const result = resolveEffectiveMcp(agent, step, catalog);
      expect(result.servers.github).toBeUndefined();
    });
  });

  describe('catalog lookup errors', () => {
    it('throws CatalogEntryNotFoundError when stdio catalogId is missing', () => {
      const agent = makeAgent({
        ghost: { type: 'stdio', catalogId: 'not-in-catalog' },
      });
      expect(() => resolveEffectiveMcp(agent, makeStep(), new Map())).toThrow(
        CatalogEntryNotFoundError,
      );
    });

    it('CatalogEntryNotFoundError exposes serverName and catalogId', () => {
      const agent = makeAgent({
        ghost: { type: 'stdio', catalogId: 'not-in-catalog' },
      });
      try {
        resolveEffectiveMcp(agent, makeStep(), new Map());
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CatalogEntryNotFoundError);
        if (err instanceof CatalogEntryNotFoundError) {
          expect(err.serverName).toBe('ghost');
          expect(err.catalogId).toBe('not-in-catalog');
        }
      }
    });

    it('does not throw when a disabled server has a missing catalogId', () => {
      // Disabled servers are skipped before catalog lookup — no RCE surface.
      const agent = makeAgent({
        ghost: { type: 'stdio', catalogId: 'not-in-catalog' },
      });
      const step = makeStep({ ghost: { disable: true } });
      expect(() => resolveEffectiveMcp(agent, step, new Map())).not.toThrow();
    });
  });

  describe('unknown restriction targets', () => {
    it('throws UnknownRestrictionTargetError when restriction references unknown server', () => {
      const catalog = makeCatalog([{ id: 'gh', command: 'gh-mcp' }]);
      const agent = makeAgent({ github: { type: 'stdio', catalogId: 'gh' } });
      const step = makeStep({ githuub: { disable: true } });
      expect(() => resolveEffectiveMcp(agent, step, catalog)).toThrow(
        UnknownRestrictionTargetError,
      );
    });

    it('UnknownRestrictionTargetError exposes serverName and knownServerNames', () => {
      const catalog = makeCatalog([
        { id: 'gh', command: 'gh-mcp' },
        { id: 'pg', command: 'pg-mcp' },
      ]);
      const agent = makeAgent({
        github: { type: 'stdio', catalogId: 'gh' },
        postgres: { type: 'stdio', catalogId: 'pg' },
      });
      const step = makeStep({ githuub: { denyTools: ['x'] } });
      try {
        resolveEffectiveMcp(agent, step, catalog);
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(UnknownRestrictionTargetError);
        if (err instanceof UnknownRestrictionTargetError) {
          expect(err.serverName).toBe('githuub');
          expect(err.knownServerNames).toEqual(['github', 'postgres']);
        }
      }
    });

    it('throws even when the agent has no mcpServers at all', () => {
      const step = makeStep({ github: { disable: true } });
      expect(() => resolveEffectiveMcp(makeAgent(), step, new Map())).toThrow(
        UnknownRestrictionTargetError,
      );
    });

    it('throws before any catalog lookup', () => {
      // Typo check runs first — unknown restriction target wins over a valid
      // server with a bad catalogId, so callers see the actionable error.
      const agent = makeAgent({
        ghost: { type: 'stdio', catalogId: 'not-in-catalog' },
      });
      const step = makeStep({ typo: { disable: true } });
      expect(() => resolveEffectiveMcp(agent, step, new Map())).toThrow(
        UnknownRestrictionTargetError,
      );
    });
  });

  describe('purity', () => {
    it('does not mutate the input agent.mcpServers', () => {
      const catalog = makeCatalog([{ id: 'gh', command: 'gh-mcp' }]);
      const mcpServers: AgentMcpBindingMap = {
        github: {
          type: 'stdio',
          catalogId: 'gh',
          allowedTools: ['a', 'b', 'c'],
        },
      };
      const agent = makeAgent(mcpServers);
      const step = makeStep({ github: { denyTools: ['b'] } });
      resolveEffectiveMcp(agent, step, catalog);
      const github = mcpServers.github;
      expect(github?.type === 'stdio' && github.allowedTools).toEqual(['a', 'b', 'c']);
    });
  });
});
