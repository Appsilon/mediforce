import { stepContainerConfig, type WorkflowStep } from '@mediforce/platform-core';

/** A repository a workflow builds from, at one pinned commit. */
export interface RepoSource {
  repo: string;
  commit: string;
  /** Any step pinned here — the read is authorized through one. */
  stepId: string;
  /** Every step building from this commit, so the explorer can say who. */
  stepNames: string[];
  /**
   * Workflow secret the clone authenticates with, when the step names one.
   * A draft cannot resolve it, so its presence is what lets the explorer warn
   * before a private repository fails rather than after.
   */
  authKey?: string;
}

/**
 * The distinct repositories behind a workflow's steps.
 *
 * Keyed on `repo@commit` rather than on the step: several steps commonly build
 * from one commit, and listing that repository once per step would fetch the
 * same tree three times and offer the reader three identical explorers.
 */
export function repoSources(steps: WorkflowStep[]): RepoSource[] {
  const byCommit = new Map<string, RepoSource>();
  for (const step of steps) {
    const { repo, commit, repoAuth } = stepContainerConfig(step);
    if (repo === undefined || commit === undefined) continue;
    const name = step.name ?? step.id;
    const key = `${repo}@${commit}`;
    const seen = byCommit.get(key);
    if (seen === undefined) {
      byCommit.set(key, {
        repo,
        commit,
        stepId: step.id,
        stepNames: [name],
        ...(repoAuth === undefined ? {} : { authKey: repoAuth }),
      });
    } else if (seen.stepNames.includes(name) === false) {
      seen.stepNames.push(name);
    }
  }
  return [...byCommit.values()];
}

/**
 * Paths a step names inside its repository, so the explorer can mark the files
 * that actually drive the workflow among everything else in the repo.
 *
 * Only what the definition states outright: the Dockerfile it builds from and
 * the skill it runs. A step's `command` is a path inside the built image, not
 * inside the repository, so guessing a repository path from it would mark the
 * wrong file more often than the right one.
 */
export function referencedPaths(steps: WorkflowStep[], source: Pick<RepoSource, 'repo' | 'commit'>): Set<string> {
  const paths = new Set<string>();
  for (const step of steps) {
    const config = stepContainerConfig(step);
    if (config.repo !== source.repo || config.commit !== source.commit) continue;
    if (config.dockerfile !== undefined) paths.add(config.dockerfile);
    const { skillsDir, skill } = step.agent ?? {};
    if (skillsDir !== undefined && skill !== undefined) paths.add(`${skillsDir}/${skill}/SKILL.md`);
  }
  return paths;
}

/** A directory-shaped view of flat repository paths. */
export interface RepoTreeNode {
  name: string;
  path: string;
  isFile: boolean;
  children: RepoTreeNode[];
}

/**
 * Fold `src/run.py` and `src/lib/util.py` into nested directories. A flat list
 * is unreadable for the repositories this exists for — a container folder and a
 * fixtures folder are exactly what people cannot see today.
 */
export function buildRepoTree(entries: readonly { path: string }[]): RepoTreeNode[] {
  const root: RepoTreeNode = { name: '', path: '', isFile: false, children: [] };

  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = entry.path.split('/').filter((part) => part !== '');
    let node = root;
    for (const [index, part] of parts.entries()) {
      const isFile = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join('/');
      let next = node.children.find((child) => child.name === part);
      if (next === undefined) {
        next = { name: part, path, isFile, children: [] };
        node.children.push(next);
      }
      node = next;
    }
  }

  const sortNode = (node: RepoTreeNode): void => {
    node.children.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root.children;
}
