import { describe, it, expect } from 'vitest';
import { buildRepoTree, referencedPaths, repoSources } from '@/lib/repo-sources';
import type { WorkflowStep } from '@mediforce/platform-core';

const step = (
  id: string,
  script?: { repo?: string; commit?: string; repoAuth?: string; dockerfile?: string },
): WorkflowStep =>
  ({ id, name: id, type: 'creation', executor: 'script', ...(script ? { script } : {}) }) as WorkflowStep;

describe('repoSources', () => {
  it('lists one repository per commit, not one per step', () => {
    const sources = repoSources([
      step('build', { repo: 'org/repo', commit: 'abc123' }),
      step('check', { repo: 'org/repo', commit: 'abc123' }),
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0]!.stepNames).toEqual(['build', 'check']);
  });

  it('keeps two commits of one repository apart', () => {
    const sources = repoSources([
      step('a', { repo: 'org/repo', commit: 'aaa' }),
      step('b', { repo: 'org/repo', commit: 'bbb' }),
    ]);
    expect(sources.map((source) => source.commit)).toEqual(['aaa', 'bbb']);
  });

  it('carries the auth key, so a draft can warn before a private clone fails', () => {
    const [source] = repoSources([
      step('build', { repo: 'org/repo', commit: 'abc', repoAuth: 'GITHUB_TOKEN' }),
    ]);
    expect(source!.authKey).toBe('GITHUB_TOKEN');
    expect(repoSources([step('open', { repo: 'org/repo', commit: 'abc' })])[0]!.authKey)
      .toBeUndefined();
  });

  it('ignores a step that carries its files rather than building from a repo', () => {
    expect(repoSources([step('carried'), step('half', { repo: 'org/repo' })])).toEqual([]);
  });
});

describe('referencedPaths', () => {
  const source = { repo: 'org/repo', commit: 'abc' };

  it('marks the Dockerfile a step builds from', () => {
    const steps = [step('build', { repo: 'org/repo', commit: 'abc', dockerfile: 'container/Dockerfile' })];
    expect([...referencedPaths(steps, source)]).toEqual(['container/Dockerfile']);
  });

  it('marks the skill an agent step runs', () => {
    const steps = [{
      id: 'plan',
      name: 'plan',
      type: 'creation',
      executor: 'agent',
      agent: { repo: 'org/repo', commit: 'abc', skillsDir: 'plugins/x/skills', skill: 'build-config' },
    }] as never as WorkflowStep[];
    expect([...referencedPaths(steps, source)]).toEqual(['plugins/x/skills/build-config/SKILL.md']);
  });

  it('ignores a step pinned to a different commit of the same repository', () => {
    const steps = [step('other', { repo: 'org/repo', commit: 'zzz', dockerfile: 'Dockerfile' })];
    expect([...referencedPaths(steps, source)]).toEqual([]);
  });
});

describe('buildRepoTree', () => {
  it('nests paths into directories', () => {
    const tree = buildRepoTree([
      { path: 'src/lib/util.py' },
      { path: 'src/run.py' },
      { path: 'Dockerfile' },
    ]);

    expect(tree.map((node) => node.name)).toEqual(['src', 'Dockerfile']);
    const src = tree[0]!;
    expect(src.isFile).toBe(false);
    expect(src.children.map((node) => node.name)).toEqual(['lib', 'run.py']);
    expect(src.children[1]!.isFile).toBe(true);
  });

  it('puts directories before files and sorts each alphabetically', () => {
    const tree = buildRepoTree([
      { path: 'z.txt' },
      { path: 'a.txt' },
      { path: 'b/one.txt' },
    ]);
    expect(tree.map((node) => node.name)).toEqual(['b', 'a.txt', 'z.txt']);
  });
});
