import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import { resolveImageBuild } from './container-plugin';
import { getDockerSpawnStrategy, type ImageBuildMeta } from './docker-spawn-strategy';
import { materializeArtifacts } from './workflow-artifacts';

/**
 * Build the image a step would run in, without running it.
 *
 * A dry run mocks every agent and script step, which is what makes it safe and
 * fast — and also what makes it silent about the one part that takes minutes
 * and fails: whether the workflow's image actually compiles. This closes that
 * gap. Execution stays mocked; the build is real.
 *
 * Returns what was built, or null when the step has nothing to build — an image
 * that is pulled or already on the host is not this workflow's to compile.
 */
export async function ensureStepImageBuilt(
  step: WorkflowStep,
  workflowDefinition: WorkflowDefinition,
  resolvedEnv?: Record<string, string>,
): Promise<ImageBuildMeta | null> {
  if (step.executor !== 'agent' && step.executor !== 'script') return null;
  const config = step.executor === 'script' ? step.script : step.agent;
  if (config === undefined) return null;

  // The build context for a carried Dockerfile is the directory the files are
  // materialized into, so they have to be on disk before the build reads them.
  await materializeArtifacts(workflowDefinition.artifacts);

  const build = resolveImageBuild(
    config.image,
    config,
    { workflowDefinition, step } as Parameters<typeof resolveImageBuild>[2],
    resolvedEnv,
  );
  if (build === undefined) return null;

  await getDockerSpawnStrategy().ensureImage(build);
  return build;
}
