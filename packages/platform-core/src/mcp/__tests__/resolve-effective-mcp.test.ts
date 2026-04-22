import { describe, it, expect } from 'vitest';
import {
  CatalogEntryNotFoundError,
  resolveEffectiveMcp,
} from '../resolve-effective-mcp.js';
import type {
  AgentMcpBindingMap,
  StepMcpRestriction,
  ToolCatalogEntry,
} from '../../schemas/agent-mcp-binding.js';
import type { AgentDefinition } from '../../schemas/agent-definition.js';
import type { WorkflowStep } from '../../schemas/workflow-definition.js';

function makeAgent(mcpServers?: AgentMcpBindingMap): AgentDefinition {
  return {
    id: 'agent-1',
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
  return {
    id: 'step-1',
    name: 'Step 1',
    type: 'creation',
    executor: 'agent',
    mcpRestrictions,
  } as WorkflowStep;
}

function makeCatalog(entries: ToolCatalogEntry[]): Map<string, ToolCatalogEntry> {
  return new Map(entries.map(entry => [entry.id, entry]));
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
      expect(result.servers.cdisc).toBeDefined();
      expect(result.servers.cdisc?.type).toBe('stdio');
      expect(result.servers.cdisc?.command).toBe('npx');
      expect(result.servers.cdisc?.args).toEqual(['-y', '@cdisc/mcp-server']);
      expect(result.servers.cdisc?.env).toEqual({ API_KEY: '{{SECRET:cdisc_key}}' });
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
      expect(result.servers.remote?.type).toBe('http');
      expect(result.servers.remote?.url).toBe('https://mcp.example.com/v1');
      expect(result.servers.remote?.auth?.headers?.Authorization).toBe(
        'Bearer {{SECRET:tok}}',
      );
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
      expect(result.servers.alpha?.command).toBe('cmd-a');
      expect(result.servers.beta?.command).toBe('cmd-b');
      expect(result.servers.gamma?.url).toBe('https://example.com');
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
      expect(result.servers.github?.allowedTools).toEqual(['search_code', 'get_file']);
      expect(result.servers.github?.deniedTools).toBeUndefined();
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
      expect(result.servers.github?.allowedTools).toEqual(['search_code', 'get_file']);
      expect(result.servers.github?.deniedTools).toBeUndefined();
    });

    it('ignores denyTools that reference tools not in binding.allowedTools', () => {
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
      // search_code removed; delete_repo ignored silently (not in allowlist)
      expect(result.servers.github?.allowedTools).toEqual([]);
    });

    it('carries denyTools forward as deniedTools when binding has no allowedTools', () => {
      // Convention: binding.allowedTools=undefined means "all tools from server".
      // With only denyTools available here, the resolver cannot materialize an
      // explicit allowlist (doesn't know the full tool set). It emits
      // allowedTools=undefined and deniedTools=[...] so the runtime layer can
      // apply a second-stage subtractive filter.
      const catalog = makeCatalog([{ id: 'gh', command: 'gh-mcp' }]);
      const agent = makeAgent({
        github: { type: 'stdio', catalogId: 'gh' },
      });
      const step = makeStep({ github: { denyTools: ['delete_repo'] } });
      const result = resolveEffectiveMcp(agent, step, catalog);
      expect(result.servers.github?.allowedTools).toBeUndefined();
      expect(result.servers.github?.deniedTools).toEqual(['delete_repo']);
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
      expect(result.servers.remote?.allowedTools).toEqual(['fetch']);
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
