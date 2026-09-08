import type { ContainerConfig, WorkflowArtifact } from '../schemas/index';

/**
 * Whether a step brings its own image build, and so must not be handed a
 * default image or warned about a missing one.
 *
 * Two sources: a git repo pinned to a commit, or a Dockerfile the workflow
 * carries as an artifact. Shared by the register handler (which fills in the
 * golden image), the preflight checks (which warn about an image the instance
 * lacks) and anything else asking the same yes-or-no question — the runtime's
 * `resolveImageBuild` answers the fuller "build it how?" question and is the
 * one place that needs the details.
 *
 * Getting this wrong is not cosmetic: a step with a carried Dockerfile that was
 * handed the golden image would build its own image under the golden tag,
 * replacing the shared one on that host.
 */
export function stepHasBuildSource(
  config: ContainerConfig | undefined,
  artifacts: WorkflowArtifact[] | undefined,
): boolean {
  if (config === undefined) return false;
  const hasRepo =
    typeof config.repo === 'string' && config.repo.length > 0 &&
    typeof config.commit === 'string' && config.commit.length > 0;
  if (hasRepo) return true;
  const dockerfile = config.dockerfile;
  if (typeof dockerfile !== 'string' || dockerfile.length === 0) return false;
  return artifacts?.some((artifact) => artifact.path === dockerfile) === true;
}
