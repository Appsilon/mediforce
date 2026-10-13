import type { ContainerConfig, WorkflowArtifact } from '../schemas/index';
import { normalizeRepoPath } from '../utils/docker-build-paths';

/**
 * The Dockerfile a step builds from when it is one the workflow carries, as a
 * path from the root of the carried files. The build context is always all of
 * them, so a `container/Dockerfile` can `COPY scripts/`, and a `context` the
 * step names is ignored. `null` when the step builds from anything else — an
 * explicit step-level `repo` + `commit` said something more specific and wins.
 */
export function carriedDockerfile(
  config: ContainerConfig | undefined,
  artifacts: readonly WorkflowArtifact[] | undefined,
): string | null {
  if (config === undefined || artifacts === undefined) return null;
  const namesRepoAndCommit =
    typeof config.repo === 'string' && config.repo.length > 0 &&
    typeof config.commit === 'string' && config.commit.length > 0;
  if (namesRepoAndCommit === true) return null;
  if (typeof config.dockerfile !== 'string' || config.dockerfile.length === 0) return null;
  const dockerfile = normalizeRepoPath(config.dockerfile);
  if (dockerfile === null || dockerfile === '') return null;
  return artifacts.some((artifact) => artifact.path === dockerfile) ? dockerfile : null;
}

/**
 * Whether a step brings its own image build, and so must not be handed a
 * default image or warned about a missing one.
 *
 * Two sources, as the runtime resolves them: a git repo pinned to a commit, or
 * a Dockerfile the workflow carries as an artifact. Shared by the register
 * handler (which fills in the golden image), the preflight checks (which warn about an image the instance
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
  definition: { artifacts?: WorkflowArtifact[] } | undefined,
): boolean {
  if (config === undefined) return false;
  const hasRepo =
    typeof config.repo === 'string' && config.repo.length > 0 &&
    typeof config.commit === 'string' && config.commit.length > 0;
  if (hasRepo) return true;
  const dockerfile = config.dockerfile;
  if (typeof dockerfile !== 'string' || dockerfile.length === 0) return false;
  return carriedDockerfile(config, definition?.artifacts) !== null;
}
