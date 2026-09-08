import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContainerPlugin, skillsCacheDir } from '../container-plugin';
import { artifactsDir } from '../workflow-artifacts';
import type { AgentContext, WorkflowAgentContext, EmitFn } from '../../interfaces/step-executor-plugin';
import type { PluginCapabilityMetadata } from '@mediforce/platform-core';

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
