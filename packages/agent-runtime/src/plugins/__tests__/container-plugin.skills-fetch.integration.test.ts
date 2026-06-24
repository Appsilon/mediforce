import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContainerPlugin } from '../container-plugin';
import type { AgentContext, WorkflowAgentContext, EmitFn } from '../../interfaces/step-executor-plugin';
import type { PluginCapabilityMetadata } from '@mediforce/platform-core';

class TestPlugin extends ContainerPlugin {
  readonly metadata = { name: 'test-plugin' } as PluginCapabilityMetadata;
  async initialize(): Promise<void> {}
  async run(_emit: EmitFn): Promise<void> {}
  setContext(context: AgentContext | WorkflowAgentContext): void {
    this.context = context;
  }
  populate(skillsDir: string, repoUrl: string, commit: string): Promise<void> {
    return this.fetchSkillsFromRepo(skillsDir, repoUrl, commit);
  }
  resolve(skillsDir: string, resolveProjectPath: (p: string) => string): string {
    return this.resolveSkillsDir(skillsDir, resolveProjectPath);
  }
}

function git(cwd: string, cmd: string): string {
  return execSync(`git ${cmd}`, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' },
  })
    .toString()
    .trim();
}

const SKILL_BODY = '# Renovate review\nstub skill content';

describe('fetchSkillsFromRepo + resolveSkillsDir [integration, real git]', () => {
  let repoDir: string;
  let commit: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'mediforce-skills-src-'));
    git(repoDir, 'init -q');
    // Let `git fetch origin <sha>` work over the local transport.
    git(repoDir, 'config uploadpack.allowAnySHA1InWant true');
    git(repoDir, 'config uploadpack.allowReachableSHA1InWant true');
    const skillDir = join(repoDir, 'skills', 'renovate-review');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), SKILL_BODY);
    git(repoDir, 'add -A');
    git(repoDir, 'commit -q -m seed');
    commit = git(repoDir, 'rev-parse HEAD');
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('[DATA] populates the cache from a real clone and resolveSkillsDir points at the populated dir', async () => {
    const plugin = new TestPlugin();
    const gitUrl = repoDir;

    await plugin.populate('skills', gitUrl, commit);

    plugin.setContext({
      workflowDefinition: { externalSkillsRepo: { url: repoDir, commit } },
      step: { id: 's1' },
    } as unknown as WorkflowAgentContext);

    const resolved = plugin.resolve('skills', (p) => join('/should-not-be-used', p));

    // The resolved dir is the on-disk cache that fetch just populated.
    const skillFile = join(resolved, 'renovate-review', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, 'utf-8')).toBe(SKILL_BODY);
  });

  it('[DATA] after a repo-mode populate, a disk-mode step on the same instance resolves to disk', async () => {
    const plugin = new TestPlugin();
    const gitUrl = repoDir;

    // Step 1: repo-mode — clone + populate cache.
    await plugin.populate('skills', gitUrl, commit);
    plugin.setContext({
      workflowDefinition: { externalSkillsRepo: { url: repoDir, commit } },
      step: { id: 's1' },
    } as unknown as WorkflowAgentContext);
    const repoResolved = plugin.resolve('skills', (p) => join('/project', p));
    expect(existsSync(join(repoResolved, 'renovate-review', 'SKILL.md'))).toBe(true);

    // Step 2: disk-mode — MUST NOT inherit step 1's cache dir.
    plugin.setContext({
      workflowDefinition: {},
      step: { id: 's2' },
    } as unknown as WorkflowAgentContext);
    const diskResolved = plugin.resolve('skills', (p) => join('/project', p));
    expect(diskResolved).toBe(join('/project', 'skills'));
    expect(diskResolved).not.toBe(repoResolved);
  });
});
