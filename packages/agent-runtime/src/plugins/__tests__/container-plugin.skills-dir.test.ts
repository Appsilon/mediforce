import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContainerPlugin, skillsCacheDir } from '../container-plugin';
import { artifactsDir, materializeArtifacts } from '../workflow-artifacts';
import type { AgentContext, WorkflowAgentContext, EmitFn } from '../../interfaces/step-executor-plugin';
import type { PluginCapabilityMetadata, Skill } from '@mediforce/platform-core';

/** Minimal concrete subclass to exercise the protected resolveSkillsDir. */
class TestPlugin extends ContainerPlugin {
  readonly metadata = { name: 'test-plugin' } as PluginCapabilityMetadata;
  async initialize(context: AgentContext | WorkflowAgentContext): Promise<void> {
    this.context = context;
  }
  async run(_emit: EmitFn): Promise<void> {}
  exposeResolveSkillsDir(skillsDir: string, resolveProjectPath: (p: string) => string): string {
    return this.resolveSkillsDir(skillsDir, resolveProjectPath);
  }
  setContext(context: AgentContext | WorkflowAgentContext): void {
    this.context = context;
  }
  exposeResolvePluginDir(skillsDir: string | undefined, resolveProjectPath: (p: string) => string): Promise<string | undefined> {
    return this.resolvePluginDir(skillsDir, resolveProjectPath);
  }
}

/** A plugin whose CLI loads an agent's Skills, as Claude Code does. */
class SkillLoadingTestPlugin extends TestPlugin {
  protected override readonly loadsAgentSkills = true;
}

const PROJECT = (p: string): string => join('/project', p);

function repoContext(url: string, commit: string): WorkflowAgentContext {
  return {
    workflowDefinition: { externalSkillsRepo: { url, commit } },
    step: { id: 's1' },
  } as unknown as WorkflowAgentContext;
}

function artifactsContext(
  artifacts: { path: string; contents: string }[],
  externalSkillsRepo?: { url: string; commit: string },
): WorkflowAgentContext {
  return {
    workflowDefinition: { artifacts, ...(externalSkillsRepo ? { externalSkillsRepo } : {}) },
    step: { id: 's3' },
  } as unknown as WorkflowAgentContext;
}

function diskContext(): WorkflowAgentContext {
  return {
    workflowDefinition: {},
    step: { id: 's2' },
  } as unknown as WorkflowAgentContext;
}

describe('skillsCacheDir', () => {
  it('[DATA] is deterministic and lives under the skills cache root', () => {
    const a = skillsCacheDir('git@github.com:org/repo.git', 'abc123', 'skills');
    const b = skillsCacheDir('git@github.com:org/repo.git', 'abc123', 'skills');
    expect(a).toBe(b);
    expect(a.startsWith(join(tmpdir(), 'mediforce-skills-cache'))).toBe(true);
  });

  it('[DATA] differs by repo, commit, and skillsDir', () => {
    const base = skillsCacheDir('git@github.com:org/a.git', 'c1', 'skills');
    expect(skillsCacheDir('git@github.com:org/b.git', 'c1', 'skills')).not.toBe(base);
    expect(skillsCacheDir('git@github.com:org/a.git', 'c2', 'skills')).not.toBe(base);
    expect(skillsCacheDir('git@github.com:org/a.git', 'c1', 'other')).not.toBe(base);
  });
});

describe('resolveSkillsDir — no shared mutable state across steps', () => {
  it('[DATA] a repo-mode step does not leak its cache dir into a later disk-mode step', () => {
    const plugin = new TestPlugin();

    // Step 1: workflow WITH externalSkillsRepo → resolves to the content-addressed cache dir.
    plugin.setContext(repoContext('git@github.com:org/skills-repo.git', 'deadbeef'));
    const repoResolved = plugin.exposeResolveSkillsDir('skills', PROJECT);
    const expectedCache = skillsCacheDir('git@github.com:org/skills-repo.git', 'deadbeef', 'skills');
    expect(repoResolved).toBe(expectedCache);

    // Step 2 on the SAME plugin instance: workflow WITHOUT externalSkillsRepo →
    // MUST resolve from disk, not inherit step 1's cache dir.
    plugin.setContext(diskContext());
    const diskResolved = plugin.exposeResolveSkillsDir('skills', PROJECT);
    expect(diskResolved).toBe(PROJECT('skills'));
    expect(diskResolved).not.toBe(expectedCache);
  });

  it('[DATA] two interleaved repo-mode contexts resolve independently — no clobber', () => {
    const plugin = new TestPlugin();

    plugin.setContext(repoContext('git@github.com:org/a.git', 'aaa'));
    const a = plugin.exposeResolveSkillsDir('skills', PROJECT);

    plugin.setContext(repoContext('git@github.com:org/b.git', 'bbb'));
    const b = plugin.exposeResolveSkillsDir('skills', PROJECT);

    expect(a).not.toBe(b);
    expect(a).toBe(skillsCacheDir('git@github.com:org/a.git', 'aaa', 'skills'));
    expect(b).toBe(skillsCacheDir('git@github.com:org/b.git', 'bbb', 'skills'));
  });
});

describe('resolveSkillsDir — skills the workflow carries itself', () => {
  const skills = [
    { path: 'skills/data-validator/SKILL.md', contents: '# Data validator\n' },
  ];

  it('[DATA] resolves into the artifact directory, so no repository is needed', () => {
    const plugin = new TestPlugin();
    plugin.setContext(artifactsContext(skills));
    expect(plugin.exposeResolveSkillsDir('skills', PROJECT))
      .toBe(join(artifactsDir(skills), 'skills'));
  });

  it('[DATA] takes the carried skills over a declared repository', () => {
    // The definition holding the files is the most specific answer available,
    // and it is the one an author edited in the app.
    const plugin = new TestPlugin();
    plugin.setContext(artifactsContext(skills, { url: 'git@github.com:org/a.git', commit: 'aaa' }));
    expect(plugin.exposeResolveSkillsDir('skills', PROJECT))
      .toBe(join(artifactsDir(skills), 'skills'));
  });

  it('[DATA] leaves a repository alone when the artifacts hold no skills', () => {
    // A workflow may carry a Dockerfile and still take its skills from a repo,
    // so artifacts only answer for the directory they actually contain.
    const dockerfileOnly = [{ path: 'Dockerfile', contents: 'FROM python:3.12-slim\n' }];
    const plugin = new TestPlugin();
    plugin.setContext(artifactsContext(dockerfileOnly, { url: 'git@github.com:org/a.git', commit: 'aaa' }));
    expect(plugin.exposeResolveSkillsDir('skills', PROJECT))
      .toBe(skillsCacheDir('git@github.com:org/a.git', 'aaa', 'skills'));
  });

  it('[DATA] falls back to disk when neither the artifacts nor a repo hold them', () => {
    const plugin = new TestPlugin();
    plugin.setContext(artifactsContext([{ path: 'Dockerfile', contents: 'FROM scratch\n' }]));
    expect(plugin.exposeResolveSkillsDir('skills', PROJECT)).toBe(PROJECT('skills'));
  });

  it('[DATA] matches on a directory boundary, not a string prefix', () => {
    // `skills-archive/...` is not inside `skills`, and resolving it there would
    // hand the agent an empty directory instead of the repo it asked for.
    const nearMiss = [{ path: 'skills-archive/old/SKILL.md', contents: '# Old\n' }];
    const plugin = new TestPlugin();
    plugin.setContext(artifactsContext(nearMiss, { url: 'git@github.com:org/a.git', commit: 'aaa' }));
    expect(plugin.exposeResolveSkillsDir('skills', PROJECT))
      .toBe(skillsCacheDir('git@github.com:org/a.git', 'aaa', 'skills'));
  });
});

describe('resolvePluginDir — an agent\'s skills merged with the step\'s', () => {
  const skillMd = (id: string, body: string) => `---\nname: ${id}\ndescription: ${id} skill\n---\n${body}`;
  const agentSkill = (id: string, body: string): Skill => ({
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

  /** A workflow carrying step skills at `plugin/skills`, run by an agent holding `agentSkills`. */
  async function stepWithAgentSkills(agentSkills: Skill[]): Promise<WorkflowAgentContext> {
    const artifacts = [
      { path: 'plugin/skills/sdtm-mapping/SKILL.md', contents: skillMd('sdtm-mapping', `step version ${randomUUID()}\n`) },
      { path: 'plugin/skills/define-xml/SKILL.md', contents: skillMd('define-xml', 'step skill\n') },
    ];
    await materializeArtifacts(artifacts);
    return {
      workflowDefinition: { artifacts },
      step: { id: 's4' },
      stepId: 's4',
      agentSkills,
    } as unknown as WorkflowAgentContext;
  }

  it('[DATA] mounts one folder holding the agent\'s skills and the step\'s, the step winning the clash', async () => {
    const plugin = new SkillLoadingTestPlugin();
    plugin.setContext(await stepWithAgentSkills([agentSkill('sdtm-mapping', 'agent version\n'), agentSkill('meddra-coding', 'agent skill\n')]));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const pluginDir = await plugin.exposeResolvePluginDir('plugin/skills', PROJECT);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("the step's skill 'sdtm-mapping' replaces the agent's skill of the same name"));
    warn.mockRestore();

    expect(pluginDir).toBeDefined();
    expect((await readdir(join(pluginDir!, 'skills'))).sort()).toEqual(['define-xml', 'meddra-coding', 'sdtm-mapping']);
    expect(await readFile(join(pluginDir!, 'skills', 'sdtm-mapping', 'SKILL.md'), 'utf-8')).toContain('step version');
    expect(await readFile(join(pluginDir!, 'skills', 'meddra-coding', 'references', 'notes.md'), 'utf-8')).toBe('meddra-coding notes\n');
    expect(existsSync(join(pluginDir!, '.claude-plugin', 'plugin.json'))).toBe(true);
  });

  it('[DATA] mounts the agent\'s skills alone when the step has no skillsDir', async () => {
    const plugin = new SkillLoadingTestPlugin();
    plugin.setContext({ workflowDefinition: {}, step: { id: 's5' }, stepId: 's5', agentSkills: [agentSkill('meddra-coding', 'agent skill\n')] } as unknown as WorkflowAgentContext);

    const pluginDir = await plugin.exposeResolvePluginDir(undefined, PROJECT);

    expect(await readdir(join(pluginDir!, 'skills'))).toEqual(['meddra-coding']);
  });

  it('[DATA] keeps today\'s plugin root when the agent holds no skills', async () => {
    const context = await stepWithAgentSkills([]);
    const plugin = new SkillLoadingTestPlugin();
    plugin.setContext(context);

    const artifacts = context.workflowDefinition.artifacts ?? [];
    expect(await plugin.exposeResolvePluginDir('plugin/skills', PROJECT)).toBe(dirname(join(artifactsDir(artifacts), 'plugin/skills')));
    expect(await plugin.exposeResolvePluginDir(undefined, PROJECT)).toBeUndefined();
  });

  it('[DATA] a runtime that does not load agent skills keeps the step plugin root', async () => {
    const context = await stepWithAgentSkills([agentSkill('meddra-coding', 'agent skill\n')]);
    const plugin = new TestPlugin();
    plugin.setContext(context);

    const artifacts = context.workflowDefinition.artifacts ?? [];
    expect(await plugin.exposeResolvePluginDir('plugin/skills', PROJECT)).toBe(dirname(join(artifactsDir(artifacts), 'plugin/skills')));
  });
});
