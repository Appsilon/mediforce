import type { ContainerConfig, WorkflowArtifact } from '../schemas/index';

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
  if (definition?.artifacts?.some((artifact) => artifact.path === dockerfile) === true) return true;
  const skillsRepo = definition?.externalSkillsRepo;
  return typeof skillsRepo?.url === 'string' && skillsRepo.url.length > 0 &&
    typeof skillsRepo.commit === 'string' && skillsRepo.commit.length > 0;
}
