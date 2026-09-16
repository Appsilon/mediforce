import { carriedBuildPaths, type ContainerConfig, type WorkflowDefinition } from '@mediforce/platform-core';

/**
 * Where a step's container image comes from, as an author picks it.
 *
 * Not a field on the definition. The three modes are a reading of the
 * precedence `resolveImageBuild` already applies at run time, so the editor
 * cannot offer a combination the runtime resolves differently — which is what
 * made a step naming an `image`, a `dockerfile`, a `context` and a `repo` at
 * once impossible to reason about.
 */
export type ImageSourceMode = 'ready' | 'carried' | 'repo';

/** The part of a definition that decides a step's mode. */
export type ImageSourceDefinition = Pick<WorkflowDefinition, 'artifacts'> & {
  /** Which names the Image Catalog owns, so a build tag that would replace one
   *  reads as ignored rather than as the tag the build uses. */
  namespace?: string;
  externalSkillsRepo?: { url?: string; commit?: string };
};

function isSet(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * The mode a stored step reads as, by the runtime's own order of precedence:
 * an explicit repo and commit, then a Dockerfile the workflow carries, then the
 * workflow's `externalSkillsRepo` behind a Dockerfile that names neither.
 *
 * A `dockerfile` with nothing at all to build it from still reads as `repo`,
 * which is where the missing repository can be supplied — preflight separately
 * says the step builds nothing as it stands.
 */
export function deriveImageSourceMode(
  config: ContainerConfig | undefined,
  definition: ImageSourceDefinition | undefined,
): ImageSourceMode {
  if (config === undefined) return 'ready';
  if (isSet(config.repo) && isSet(config.commit)) return 'repo';
  if (carriedBuildPaths(config, definition?.artifacts) !== null) return 'carried';
  return isSet(config.dockerfile) ? 'repo' : 'ready';
}

/**
 * The fields to clear when an author switches mode.
 *
 * `image` goes whenever a build mode is entered or left, because it means two
 * different things either side: the image to run, or the tag to build under.
 * Carrying the value across would silently re-interpret it — the confusion this
 * control exists to remove.
 */
export function clearForMode(mode: ImageSourceMode): Partial<ContainerConfig> {
  if (mode === 'ready') {
    return {
      image: undefined,
      dockerfile: undefined,
      context: undefined,
      repo: undefined,
      commit: undefined,
      repoAuth: undefined,
    };
  }
  if (mode === 'carried') {
    return { image: undefined, repo: undefined, commit: undefined, repoAuth: undefined };
  }
  // A repo build keeps the Dockerfile and context it already names: the path is
  // usually the same one inside the repository.
  return { image: undefined };
}

/**
 * Fields the step sets that its own mode ignores, as `<prefix>.<field>` labels.
 *
 * Shown rather than cleared on open: a stored step is somebody's work, and the
 * editor must not drop a value merely because it was looked at. Clearing is an
 * explicit act — the notice offers it.
 */
export function unusedFieldsForMode(
  mode: ImageSourceMode,
  config: ContainerConfig | undefined,
  definition: ImageSourceDefinition | undefined,
): string[] {
  if (config === undefined) return [];
  const unused: string[] = [];
  if (mode === 'ready') {
    for (const field of ['dockerfile', 'context', 'repo', 'commit', 'repoAuth'] as const) {
      if (isSet(config[field])) unused.push(field);
    }
    return unused;
  }
  if (mode === 'carried') {
    for (const field of ['repo', 'commit', 'repoAuth'] as const) {
      if (isSet(config[field])) unused.push(field);
    }
  }
  // A build never lands on a name this workspace's catalog owns (ADR-0022), so
  // an `image` of that shape is not even the tag the build uses.
  const namespace = definition?.namespace;
  if (isSet(config.image) && isSet(namespace) && config.image.startsWith(`${namespace}/`)) {
    unused.push('image');
  }
  return unused;
}

/** Whether a carried file is plausibly a Dockerfile, by the name Docker itself
 *  looks for: `Dockerfile`, `Dockerfile.gpu`, `container/Dockerfile`. */
function looksLikeDockerfile(path: string): boolean {
  return (path.split('/').at(-1) ?? path).startsWith('Dockerfile');
}

/**
 * The carried Dockerfiles a step may build from, plus whatever it already
 * names. A stored path that no longer matches a carried file is still offered,
 * so opening the editor never silently re-points the step.
 */
export function carriedDockerfileOptions(
  definition: ImageSourceDefinition | undefined,
  current: string | undefined,
): string[] {
  const carried = (definition?.artifacts ?? [])
    .map((artifact) => artifact.path)
    .filter(looksLikeDockerfile);
  return isSet(current) && carried.includes(current) === false ? [current, ...carried] : carried;
}
