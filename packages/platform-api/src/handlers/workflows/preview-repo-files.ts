import {
  WORKFLOW_ARTIFACT_MAX_BYTES,
  allowedRepoHosts,
  repoBackedPaths,
  repoHost,
  stepContainerConfig,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import type {
  PreviewRepoFilesInput,
  PreviewRepoFilesOutput,
} from '../../contract/workflows';

/**
 * Refuse any repository this deployment will not clone on a caller's behalf.
 *
 * Two distinct dangers, both closed here:
 *
 *  - A reference beginning `/` or `.` is cloned from the local filesystem by
 *    `resolveRepoCloneTargets`, which would make this endpoint a reader for the
 *    API server's own disk.
 *  - Any other host receives `repoAuth` as basic auth in the clone URL. Since a
 *    workflow author may write a secret but never read one, an unrestricted
 *    host is a way to exfiltrate one: point `repo` at a machine you control and
 *    read the token out of your own logs.
 */
function assertClonableRepo(repo: string): void {
  if (repo.startsWith('/') || repo.startsWith('.')) {
    throw new ValidationError(
      `Repository '${repo}' is a local filesystem path. Only a remote repository can be previewed.`,
    );
  }
  const host = repoHost(repo);
  const allowed = allowedRepoHosts(process.env.MEDIFORCE_REPO_HOSTS);
  if (host === null || allowed.includes(host) === false) {
    throw new ValidationError(
      `Repository '${repo}' is not on a host this deployment previews from (${allowed.join(', ')}).`,
    );
  }
}

/**
 * Read back the files a step builds from but does not carry, at the commit it
 * is pinned to. Nothing is written: the definition is untouched, so a person
 * can read a Dockerfile or a skill that lives in a repository without the
 * workflow starting to own it.
 *
 * The token named by `repoAuth` is resolved here and handed to the clone only —
 * it is never part of the output.
 */
export async function previewRepoFiles(
  input: PreviewRepoFilesInput,
  scope: CallerScope,
): Promise<PreviewRepoFilesOutput> {
  const namespace = input.namespace ?? '';

  const version = input.version
    ?? await scope.workflowDefinitions.getLatestVersion(namespace, input.name);
  if (version === 0) throw new NotFoundError(`Workflow '${input.name}' not found`);

  const definition = await scope.workflowDefinitions.get(namespace, input.name, version);
  if (definition === null) throw new NotFoundError(`Workflow '${input.name}' not found`);
  if (input.namespace !== undefined && definition.namespace !== input.namespace) {
    throw new NotFoundError(`Workflow '${input.name}' not found`);
  }

  // Reading a *public* definition from another workspace is allowed; cloning
  // its repository on the caller's behalf is not. The clone runs with the
  // platform's own deploy key, so honouring it here would let any authenticated
  // user read private repositories that key can reach, through someone else's
  // public workflow.
  if (scope.caller.isSystemActor === false && scope.caller.namespaces.has(definition.namespace) === false) {
    throw new ForbiddenError(
      `Workflow '${input.name}' belongs to another workspace, so its repository cannot be read from here.`,
    );
  }

  const step = definition.steps.find((candidate) => candidate.id === input.stepId);
  if (step === undefined) {
    throw new NotFoundError(`Step '${input.stepId}' not found in workflow '${input.name}'`);
  }

  const config = stepContainerConfig(step);
  const repo = config.repo ?? definition.externalSkillsRepo?.url;
  const commit = config.commit ?? definition.externalSkillsRepo?.commit;
  if (repo === undefined || commit === undefined) {
    throw new ValidationError(
      `Step '${input.stepId}' does not build from a repository, so it carries nothing to preview.`,
    );
  }
  assertClonableRepo(repo);

  const paths = repoBackedPaths(step);
  if (paths.length === 0) {
    throw new ValidationError(
      `Step '${input.stepId}' names no files in '${repo}', so there is nothing to read.`,
    );
  }

  const authKey = config.repoAuth ?? definition.externalSkillsRepo?.auth;
  let token: string | undefined;
  if (authKey !== undefined) {
    const secrets = await scope.workflowSecrets.getSecrets(namespace, input.name);
    token = secrets[authKey];
  }

  const files = await scope.system.repoFileReader.read({
    repo,
    commit,
    paths,
    ...(token === undefined ? {} : { token }),
    maxBytes: WORKFLOW_ARTIFACT_MAX_BYTES,
  });

  return { repo, commit, usedAuthKey: authKey, files };
}
