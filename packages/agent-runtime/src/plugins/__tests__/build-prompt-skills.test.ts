import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkflowAgentContext, EmitFn, EmitPayload } from '../../interfaces/agent-plugin.js';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import { OpenCodeAgentPlugin } from '../opencode-agent-plugin.js';
import { ClaudeCodeAgentPlugin } from '../claude-code-agent-plugin.js';
import { createFakeWorkspaceManager } from './helpers/fake-workspace-manager.js';

// Phase 0 RED — pins the multi-skill prompt-index contract for OpenCode and
// the no-index-when-Claude-Code rule. Today buildPrompt has no awareness of
// `agentPluginDir`; these assertions fail.

const SDTM_SKILL = `---
name: sdtmig-reference
description: SDTMIG variable conformance lookup with CSV references
---

# SDTMIG Reference

Use lookup.py to query.
`;

const STYLE_SKILL = `---
name: style-guide
description: Workspace style guide for output formatting
---

# Style Guide

Conventions...
`;

interface PluginDirHandle {
  pluginDir: string;
  cleanup: () => void;
}

function makePluginDir(): PluginDirHandle {
  const root = mkdtempSync(join(tmpdir(), 'mediforce-plugindir-'));
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'agent-skills' }));
  mkdirSync(join(root, 'skills', 'sdtmig-reference', 'references'), { recursive: true });
  writeFileSync(join(root, 'skills', 'sdtmig-reference', 'SKILL.md'), SDTM_SKILL);
  writeFileSync(join(root, 'skills', 'sdtmig-reference', 'references', 'data.csv'), 'a,b\n1,2\n');
  mkdirSync(join(root, 'skills', 'style-guide'), { recursive: true });
  writeFileSync(join(root, 'skills', 'style-guide', 'SKILL.md'), STYLE_SKILL);
  return { pluginDir: root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function buildWorkflowAgentContext(
  step: WorkflowStep,
  overrides: Partial<WorkflowAgentContext> = {},
): WorkflowAgentContext {
  const workflowDefinition: WorkflowDefinition = {
    name: 'test-wf',
    version: 1,
    steps: [step],
    transitions: [],
    triggers: [],
  } as unknown as WorkflowDefinition;
  const ctx: WorkflowAgentContext = {
    stepId: step.id,
    processInstanceId: 'pi-001',
    definitionVersion: '1',
    stepInput: { docs: ['/data/protocol.pdf'] },
    autonomyLevel: 'L2',
    workflowDefinition,
    step,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  return ctx;
}

function buildEmitSpy(): { emit: EmitFn; events: EmitPayload[] } {
  const events: EmitPayload[] = [];
  const emit: EmitFn = vi.fn(async (event: EmitPayload) => {
    events.push(event);
  });
  return { emit, events };
}

interface SpawnTarget {
  spawnDockerContainer: (prompt: string, options?: Record<string, unknown>) => Promise<{
    cliOutput: string;
    gitMetadata: null;
    presentation: null;
    outputDir: string;
    injectedEnvVars: string[];
  }>;
}

function mockSpawn(plugin: unknown) {
  return vi.spyOn(plugin as SpawnTarget, 'spawnDockerContainer').mockResolvedValue({
    cliOutput: JSON.stringify({ result: '"done"' }),
    gitMetadata: null,
    presentation: null,
    outputDir: '/tmp/mock',
    injectedEnvVars: [],
  });
}

describe('buildPrompt — multi-skill index for OpenCode (Phase 0 RED, target Phase 2)', () => {
  let pluginDirHandle: PluginDirHandle;

  beforeEach(() => {
    pluginDirHandle = makePluginDir();
    process.env.ALLOW_LOCAL_AGENTS = 'true';
  });

  afterEach(() => {
    pluginDirHandle.cleanup();
    delete process.env.ALLOW_LOCAL_AGENTS;
  });

  it('[DATA] OpenCode: prompt contains "## Available Skills" block with each skill name + frontmatter description', async () => {
    const step = {
      id: 'extract',
      name: 'Extract',
      type: 'creation',
      executor: 'agent',
      plugin: 'opencode-agent',
      agentId: 'agent-1',
      agent: { image: 'mediforce-agent:opencode' },
    } as unknown as WorkflowStep;

    const ctx = buildWorkflowAgentContext(step, {
      agentPluginDir: pluginDirHandle.pluginDir,
    } as unknown as Partial<WorkflowAgentContext>);

    const plugin = new OpenCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() });
    await plugin.initialize(ctx);

    const { emit, events } = buildEmitSpy();
    mockSpawn(plugin);

    await plugin.run(emit);

    const promptEvent = events.find((e) => e.type === 'prompt');
    expect(promptEvent).toBeDefined();
    const prompt = promptEvent!.payload as string;

    expect(prompt).toContain('## Available Skills');
    expect(prompt).toContain('/plugin/skills/');
    expect(prompt).toContain('sdtmig-reference');
    expect(prompt).toContain('SDTMIG variable conformance lookup');
    expect(prompt).toContain('style-guide');
    expect(prompt).toContain('Workspace style guide');
  });

  it('[DATA] Claude Code: prompt does NOT contain the index — CC uses --plugin-dir natively', async () => {
    const step = {
      id: 'extract',
      name: 'Extract',
      type: 'creation',
      executor: 'agent',
      plugin: 'claude-code-agent',
      agentId: 'agent-1',
      agent: { image: 'mediforce-agent:cc' },
    } as unknown as WorkflowStep;

    const ctx = buildWorkflowAgentContext(step, {
      agentPluginDir: pluginDirHandle.pluginDir,
    } as unknown as Partial<WorkflowAgentContext>);

    const plugin = new ClaudeCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() });
    await plugin.initialize(ctx);

    const { emit, events } = buildEmitSpy();
    mockSpawn(plugin);

    await plugin.run(emit);

    const promptEvent = events.find((e) => e.type === 'prompt');
    expect(promptEvent).toBeDefined();
    const prompt = promptEvent!.payload as string;

    expect(prompt).not.toContain('## Available Skills');
  });

  it('[DATA] Claude Code: spawn options.pluginDir uses agentPluginDir when set (overrides workflow skillsDir)', async () => {
    const step = {
      id: 'extract',
      name: 'Extract',
      type: 'creation',
      executor: 'agent',
      plugin: 'claude-code-agent',
      agentId: 'agent-1',
      agent: { image: 'mediforce-agent:cc', skillsDir: 'apps/foo/plugins/foo/skills' },
    } as unknown as WorkflowStep;

    const ctx = buildWorkflowAgentContext(step, {
      agentPluginDir: pluginDirHandle.pluginDir,
    } as unknown as Partial<WorkflowAgentContext>);

    const plugin = new ClaudeCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() });
    await plugin.initialize(ctx);

    const { emit } = buildEmitSpy();
    const spy = mockSpawn(plugin);

    await plugin.run(emit);

    expect(spy).toHaveBeenCalledOnce();
    const opts = spy.mock.calls[0][1] as Record<string, unknown> | undefined;
    expect(opts?.pluginDir).toBe(pluginDirHandle.pluginDir);
  });

  it('[DATA] step.agent.skill override still inlines SKILL.md content — deterministic single-skill paste path preserved', async () => {
    // Set up a workflow-skillsDir style skill on disk so readSkillFile can resolve.
    const wfSkillsRoot = mkdtempSync(join(tmpdir(), 'mediforce-wf-skills-'));
    try {
      mkdirSync(join(wfSkillsRoot, 'extractor'), { recursive: true });
      writeFileSync(
        join(wfSkillsRoot, 'extractor', 'SKILL.md'),
        '---\nname: extractor\n---\n\n# Extractor Override\n\nDeterministic single-skill paste.',
      );
      const step = {
        id: 'extract',
        name: 'Extract',
        type: 'creation',
        executor: 'agent',
        plugin: 'opencode-agent',
        agent: { skill: 'extractor', skillsDir: wfSkillsRoot, image: 'mediforce-agent:opencode' },
      } as unknown as WorkflowStep;
      const ctx = buildWorkflowAgentContext(step);

      const plugin = new OpenCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() });
      await plugin.initialize(ctx);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin);

      await plugin.run(emit);

      const prompt = events.find((e) => e.type === 'prompt')!.payload as string;
      expect(prompt).toContain('Extractor Override');
      expect(prompt).toContain('Deterministic single-skill paste.');
    } finally {
      rmSync(wfSkillsRoot, { recursive: true, force: true });
    }
  });
});
