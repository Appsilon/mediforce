import {
  WORKFLOW_ARTIFACT_MAX_BYTES,
  allowedRepoHosts,
  repoHost,
  stepContainerConfig,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { ForbiddenError, NotFoundError, ValidationError } from '../../errors';
import type {
  BrowseDraftRepoInput,
  BrowseDraftRepoOutput,
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
export function assertClonableRepo(repo: string): void {
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
 * Browse the repository a step builds from, at the commit it is pinned to.
 * Read-only in the strict sense: the definition is untouched and nothing is
 * copied into the workflow, so reading a repo never starts Mediforce owning it.
 *
 * Listing costs the commit's trees; a file's contents are fetched only when
 * somebody opens that file, and a read is abandoned once it passes what a
 * workflow artifact may be rather than completed and then rejected.
 *
 * The token named by `repoAuth` is resolved here and handed to the clone only —
 * it is never part of the output.
 */
/**
 * Browse a repository named directly rather than through a saved workflow.
 *
 * The draft on somebody's canvas has a repo and a commit before it has a name,
 * and wiring a step to a repository is exactly when you want to look inside it.
 * Authorization is membership of the namespace the reader names, which is the
 * same thing the saved path checks — a saved definition adds an audit record,
 * not a boundary, since anyone may save a workflow naming any repository.
 *
 * The clone is anonymous. `repoAuth` names a workflow secret a nameless
 * workflow has none of, and the deployment's own deploy key is deliberately not
 * substituted: `repo` is caller-supplied and unrelated to the namespace they
 * name, so spending the platform key here would let any member have any private
 * repository that key reaches read out to them, with no saved definition
 * recording that they asked. That is the audit gap this whole feature exists to
 * close. A private repository is read after saving, through the step that names
 * it.
 */
export async function browseDraftRepo(
  input: BrowseDraftRepoInput,
  scope: CallerScope,
): Promise<BrowseDraftRepoOutput> {
  if (scope.caller.isSystemActor === false && scope.caller.namespaces.has(input.namespace) === false) {
    throw new ForbiddenError(`You are not a member of '${input.namespace}'.`);
  }
  assertClonableRepo(input.repo);

  const { repo, commit } = input;
  if (input.path === undefined) {
    const entries = await scope.system.repoFileReader.list({ repo, commit, anonymousOnly: true });
    return { repo, commit, entries };
  }

  const file = await scope.system.repoFileReader.open({
    repo,
    commit,
    path: input.path,
    maxBytes: WORKFLOW_ARTIFACT_MAX_BYTES,
    anonymousOnly: true,
  });
  if (file === null) {
    throw new NotFoundError(`'${input.path}' is not in ${repo} at ${commit.slice(0, 8)}`);
  }
  return { repo, commit, entries: [], file };
}

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

  const authKey = config.repoAuth ?? definition.externalSkillsRepo?.auth;
  let token: string | undefined;
  if (authKey !== undefined) {
    const secrets = await scope.workflowSecrets.getSecrets(namespace, input.name);
    token = secrets[authKey];
  }

  const auth = token === undefined ? {} : { token };
  // Listing is the expensive half of a read, so it happens only when the tree
  // is what was asked for.
  if (input.path === undefined) {
    const entries = await scope.system.repoFileReader.list({ repo, commit, ...auth });
    return { repo, commit, usedAuthKey: authKey, entries };
  }

  const file = await scope.system.repoFileReader.open({
    repo,
    commit,
    path: input.path,
    ...auth,
    maxBytes: WORKFLOW_ARTIFACT_MAX_BYTES,
  });
  if (file === null) {
    throw new NotFoundError(`'${input.path}' is not in ${repo} at ${commit.slice(0, 8)}`);
  }
  return { repo, commit, usedAuthKey: authKey, entries: [], file };
}
