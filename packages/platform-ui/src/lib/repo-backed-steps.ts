import { repoBackedPaths, stepContainerConfig, type WorkflowArtifact, type WorkflowStep } from '@mediforce/platform-core';

export interface RepoBackedStep {
  stepId: string;
  stepName: string;
  repo: string;
  commit: string;
  /** Paths the step names in that repository. */
  paths: string[];
}

/**
 * Steps that build from a repository rather than from files the workflow
 * carries. These are the ones nobody can read from the editor, which is the
 * whole reason for offering a preview.
 */
export function repoBackedSteps(steps: WorkflowStep[]): RepoBackedStep[] {
  const found: RepoBackedStep[] = [];
  for (const step of steps) {
    const { repo, commit } = stepContainerConfig(step);
    if (repo === undefined || commit === undefined) continue;
    const paths = repoBackedPaths(step);
    if (paths.length === 0) continue;
    found.push({ stepId: step.id, stepName: step.name ?? step.id, repo, commit, paths });
  }
  return found;
}

export interface RepoBackedFile {
  repo: string;
  commit: string;
  path: string;
  /** The step the read is made through; any step naming it would do. */
  stepId: string;
  /** Every step that builds from this file, for the tooltip. */
  stepNames: string[];
}

/**
 * The distinct files behind a set of steps. Several steps commonly build from
 * one Dockerfile in one repository, and listing that file once per step would
 * show the same file three times and read it three times.
 */
export function repoBackedFiles(steps: WorkflowStep[]): RepoBackedFile[] {
  const byFile = new Map<string, RepoBackedFile>();
  for (const step of repoBackedSteps(steps)) {
    for (const path of step.paths) {
      const key = `${step.repo}@${step.commit}:${path}`;
      const seen = byFile.get(key);
      if (seen === undefined) {
        byFile.set(key, {
          repo: step.repo,
          commit: step.commit,
          path,
          stepId: step.stepId,
          stepNames: [step.stepName],
        });
      } else if (seen.stepNames.includes(step.stepName) === false) {
        seen.stepNames.push(step.stepName);
      }
    }
  }
  return [...byFile.values()];
}

/**
 * Whether the workflow already carries a file at this path. The runtime
 * resolves a carried file ahead of the repository, so a path in both is already
 * being taken from the definition and the repository copy is not what runs.
 */
export function isAlreadyCarried(artifacts: WorkflowArtifact[], path: string): boolean {
  return artifacts.some((artifact) => artifact.path === path);
}

/**
 * Fold previewed files into the carried set, replacing any file already at the
 * same path so a second takeover refreshes rather than duplicates.
 */
export function takeOverFiles(
  artifacts: WorkflowArtifact[],
  files: { path: string; contents: string }[],
): WorkflowArtifact[] {
  const incoming = new Map(files.map((file) => [file.path, file.contents]));
  const merged = artifacts.map((artifact) => {
    const replacement = incoming.get(artifact.path);
    if (replacement === undefined) return artifact;
    incoming.delete(artifact.path);
    return { ...artifact, contents: replacement };
  });
  for (const [path, contents] of incoming) merged.push({ path, contents });
  return merged;
}
