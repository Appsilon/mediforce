import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ContainerPlugin } from '../container-plugin';
import type { AgentContext, WorkflowAgentContext, EmitFn } from '../../interfaces/step-executor-plugin';
import type { PluginCapabilityMetadata, Skill } from '@mediforce/platform-core';

/** Minimal concrete subclass to exercise the protected resolvePluginDir. */
class TestPlugin extends ContainerPlugin {
  readonly metadata = { name: 'test-plugin' } as PluginCapabilityMetadata;
  async initialize(context: AgentContext | WorkflowAgentContext): Promise<void> {
    this.context = context;
  }
  async run(_emit: EmitFn): Promise<void> {}
  setContext(context: AgentContext | WorkflowAgentContext): void {
    this.context = context;
  }
  exposeResolvePluginDir(): Promise<string | undefined> {
    return this.resolvePluginDir();
  }
}

/** A plugin whose CLI loads Skills, as Claude Code does. */
class SkillLoadingTestPlugin extends TestPlugin {
  protected override readonly loadsAgentSkills = true;
}

describe('resolvePluginDir — the step\'s catalog Skills as one plugin folder', () => {
  const skillMd = (id: string, body: string) => `---\nname: ${id}\ndescription: ${id} skill\n---\n${body}`;
  const skill = (id: string, body: string): Skill => ({
    namespace: 'alpha',
    id,
    name: id,
    description: `${id} skill`,
    visibility: 'private',
    contentHash: randomUUID(),
    files: [
      { path: 'SKILL.md', contents: skillMd(id, body) },
      { path: 'references/notes.md', contents: `${id} notes\n` },
    ],
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  });
  const context = (agentSkills: Skill[] | undefined): WorkflowAgentContext =>
    ({ workflowDefinition: {}, step: { id: 's1' }, stepId: 's1', agentSkills }) as unknown as WorkflowAgentContext;

  it('[DATA] mounts one folder holding every skill the step offers', async () => {
    const plugin = new SkillLoadingTestPlugin();
    plugin.setContext(context([skill('sdtm-mapping', 'mapping\n'), skill('meddra-coding', 'coding\n')]));

    const pluginDir = await plugin.exposeResolvePluginDir();

    expect(pluginDir).toBeDefined();
    expect((await readdir(join(pluginDir!, 'skills'))).sort()).toEqual(['meddra-coding', 'sdtm-mapping']);
    expect(await readFile(join(pluginDir!, 'skills', 'meddra-coding', 'references', 'notes.md'), 'utf-8')).toBe('meddra-coding notes\n');
    expect(existsSync(join(pluginDir!, '.claude-plugin', 'plugin.json'))).toBe(true);
  });

  it('[DATA] mounts nothing when the step offers no skills', async () => {
    const plugin = new SkillLoadingTestPlugin();
    plugin.setContext(context([]));
    expect(await plugin.exposeResolvePluginDir()).toBeUndefined();
    plugin.setContext(context(undefined));
    expect(await plugin.exposeResolvePluginDir()).toBeUndefined();
  });

  it('[DATA] mounts nothing for a runtime that does not load skills, and says so', async () => {
    const plugin = new TestPlugin();
    plugin.setContext(context([skill('meddra-coding', 'coding\n')]));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(await plugin.exposeResolvePluginDir()).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('runs without its skills (meddra-coding)'));
    log.mockRestore();
  });
});
