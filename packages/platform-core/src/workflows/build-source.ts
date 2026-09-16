import type { ContainerConfig, WorkflowArtifact } from '../schemas/index';
import { resolveCarriedBuildPaths, type DockerBuildPaths } from '../utils/docker-build-paths';

/**
 * Where a step builds from when its Dockerfile is one the workflow carries:
 * the Dockerfile and the context directory, both from the root of the carried
 * files (`resolveCarriedBuildPaths`). `null` when the step builds from anything
 * else — an explicit step-level `repo` + `commit` said something more specific
 * and wins.
 */
export function carriedBuildPaths(
  config: ContainerConfig | undefined,
  artifacts: readonly WorkflowArtifact[] | undefined,
): DockerBuildPaths | null {
  if (config === undefined || artifacts === undefined) return null;
  const namesRepoAndCommit =
    typeof config.repo === 'string' && config.repo.length > 0 &&
    typeof config.commit === 'string' && config.commit.length > 0;
  if (namesRepoAndCommit) return null;
  if (typeof config.dockerfile !== 'string' || config.dockerfile.length === 0) return null;
  const paths = resolveCarriedBuildPaths(config.dockerfile, config.context);
  if (paths === null) return null;
  return artifacts.some((artifact) => artifact.path === paths.dockerfile) ? paths : null;
}

/** The carried files a build sends to Docker: those inside the context, with
 *  paths from the context root. */
export function carriedContextFiles(
  artifacts: readonly WorkflowArtifact[],
  paths: DockerBuildPaths,
): WorkflowArtifact[] {
  if (paths.context === '') return [...artifacts];
  const prefix = `${paths.context}/`;
  return artifacts
    .filter((artifact) => artifact.path.startsWith(prefix))
    .map((artifact) => ({ ...artifact, path: artifact.path.slice(prefix.length) }));
}

/**
 * Whether a step brings its own image build, and so must not be handed a
 * default image or warned about a missing one.
 *
 * Three sources, as the runtime resolves them: a git repo pinned to a commit, a
 * Dockerfile the workflow carries as an artifact, or a Dockerfile read from the
 * workflow's `externalSkillsRepo`. Shared by the register handler (which fills in the
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
  definition: {
    artifacts?: WorkflowArtifact[];
    externalSkillsRepo?: { url?: string; commit?: string };
  } | undefined,
): boolean {
  if (config === undefined) return false;
  const hasRepo =
    typeof config.repo === 'string' && config.repo.length > 0 &&
    typeof config.commit === 'string' && config.commit.length > 0;
  if (hasRepo) return true;
  const dockerfile = config.dockerfile;
  if (typeof dockerfile !== 'string' || dockerfile.length === 0) return false;
  if (carriedBuildPaths(config, definition?.artifacts) !== null) return true;
  const skillsRepo = definition?.externalSkillsRepo;
  return typeof skillsRepo?.url === 'string' && skillsRepo.url.length > 0 &&
    typeof skillsRepo.commit === 'string' && skillsRepo.commit.length > 0;
}
