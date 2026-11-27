import {
  normalizeImageRef,
  pickRunnableVersion,
  type AgentDefinition,
  type ProcessInstance,
  type WorkflowDefinitionGroup,
} from '@mediforce/platform-core';
import { emitAudit } from '../../audit-helpers';
import type {
  ImagePruneKeepReason,
  PruneDockerImagesInput,
  PruneDockerImagesOutput,
} from '../../contract/docker-images';
import type { DockerImageInfo } from '../../contract/system';
import { ForbiddenError, PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import { fetchDaemonImages } from '../system/_docker';
import { stepImages } from '../workflows/_image-pins';

/**
 * The only repositories the sweep deletes from. Both hold images the runtime
 * makes itself at step start — from a repo and commit, or from files the
 * workflow carries — so a deleted one costs a rebuild, never a workflow that
 * can no longer run. An uploaded, pulled or published image, the agent images
 * and the golden image have no such source and are never candidates.
 */
export const PRUNABLE_IMAGE_REPOSITORIES: readonly string[] = ['mediforce-artifacts', 'mediforce-built'];

/** Audit key of a sweep that deleted for real; the heartbeat reads it to run once a day. */
export const IMAGE_PRUNE_AUDIT_ENTITY = { entityType: 'docker_image_prune', entityId: 'sweep' } as const;

/** Run statuses a run can still continue from. `failed` joins them while it is
 *  recent: a failed run is resumed from its current step. */
const UNFINISHED_RUN_STATUSES = ['created', 'running', 'paused'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ImagePruneFacts {
  images: readonly DockerImageInfo[];
  groups: readonly WorkflowDefinitionGroup[];
  agents: readonly AgentDefinition[];
  /** Runs that may still start a step: unfinished, or failed within the window. */
  runs: readonly ProcessInstance[];
  minAgeDays: number;
  now: Date;
  /** Narrow the sweep to these images; every candidate when absent. */
  only?: readonly string[];
}

interface PruneRow {
  image: string;
  size: string;
  createdAt?: string;
}

/**
 * What images a version names that must stay on the daemon.
 *
 * The version runs start from keeps every image it names. Any other version —
 * superseded or archived — keeps only the images it names *without* a way to
 * rebuild them: it can become the default again, and a registered version can
 * never be re-pointed. One it can rebuild costs a rebuild, the price of being
 * able to reclaim anything at all from a workflow's history.
 */
function workflowReferences(groups: readonly WorkflowDefinitionGroup[]): Set<string> {
  const referenced = new Set<string>();
  for (const group of groups) {
    const liveVersion = pickRunnableVersion(group.versions, group.defaultVersion)?.version;
    for (const definition of group.versions) {
      const isLive = definition.version === liveVersion;
      for (const step of stepImages(definition)) {
        if (isLive === true || step.rebuildable === false) referenced.add(normalizeImageRef(step.image));
      }
    }
  }
  return referenced;
}

/** Every image a run's own version names, whatever it could be rebuilt from:
 *  the run is about to need it, and a rebuild mid-run is a step stalled for
 *  minutes or failed on a repo that moved. */
function runReferences(
  runs: readonly ProcessInstance[],
  groups: readonly WorkflowDefinitionGroup[],
): Set<string> {
  const definitions = new Map(
    groups.flatMap((group) =>
      group.versions.map((definition) => [
        `${definition.namespace}\0${definition.name}\0${String(definition.version)}`,
        definition,
      ]),
    ),
  );
  const referenced = new Set<string>();
  for (const run of runs) {
    const definition = definitions.get(`${run.namespace ?? ''}\0${run.definitionName}\0${run.definitionVersion}`);
    if (definition === undefined) continue;
    for (const step of stepImages(definition)) referenced.add(normalizeImageRef(step.image));
  }
  return referenced;
}

/**
 * Split the daemon's prunable images into those to delete and those to keep,
 * each kept one with the first reason that holds. Pure, so every rule is
 * testable without a daemon.
 */
export function planImagePrune(facts: ImagePruneFacts): {
  pruned: PruneRow[];
  kept: (PruneRow & { reason: ImagePruneKeepReason })[];
} {
  const byWorkflow = workflowReferences(facts.groups);
  const byAgent = new Set(
    facts.agents.flatMap((agent) => (agent.image === undefined ? [] : [normalizeImageRef(agent.image)])),
  );
  const byRun = runReferences(facts.runs, facts.groups);
  const only = facts.only === undefined ? null : new Set(facts.only.map(normalizeImageRef));
  const cutoff = facts.now.getTime() - facts.minAgeDays * DAY_MS;

  const pruned: PruneRow[] = [];
  const kept: (PruneRow & { reason: ImagePruneKeepReason })[] = [];
  const seen = new Set<string>();

  for (const row of facts.images) {
    if (PRUNABLE_IMAGE_REPOSITORIES.includes(row.repository) === false || row.tag === '<none>') continue;
    const image = `${row.repository}:${row.tag}`;
    const needle = normalizeImageRef(image);
    if (seen.has(needle)) continue;
    seen.add(needle);
    if (only !== null && only.has(needle) === false) continue;

    const entry: PruneRow = { image, size: row.size, ...(row.createdAt === undefined ? {} : { createdAt: row.createdAt }) };
    const createdMs = row.createdAt === undefined ? Number.NaN : new Date(row.createdAt).getTime();
    const reason: ImagePruneKeepReason | null = byWorkflow.has(needle)
      ? 'workflow'
      : byAgent.has(needle)
        ? 'agent'
        : byRun.has(needle)
          ? 'run'
          : Number.isNaN(createdMs)
            ? 'age-unknown'
            : createdMs > cutoff
              ? 'recent'
              : null;
    if (reason === null) pruned.push(entry);
    else kept.push({ ...entry, reason });
  }

  return { pruned, kept };
}

/** Runs that may still start a step, across every workspace. */
async function liveRuns(scope: CallerScope, minAgeDays: number, now: Date): Promise<ProcessInstance[]> {
  const unfinished = await Promise.all(UNFINISHED_RUN_STATUSES.map((status) => scope.runs.getByStatus(status)));
  const cutoff = now.getTime() - minAgeDays * DAY_MS;
  const recentlyFailed = (await scope.runs.getByStatus('failed')).filter(
    (run) => new Date(run.updatedAt).getTime() > cutoff,
  );
  return [...unfinished.flat(), ...recentlyFailed];
}

/**
 * Delete the `mediforce-artifacts:*` and `mediforce-built:*` images nothing
 * needs any more (#1698): no workflow, agent or live run names them, and they
 * are older than `minAgeDays`. Run daily by the cron heartbeat, and on demand
 * by `mediforce system prune-images`.
 *
 * System actor only. The answer depends on every workspace's workflows and
 * runs, and a caller who sees fewer of them would delete what the rest need.
 * A container still using an image is the daemon's to refuse — `docker rmi`
 * without `-f` does — and the refusal lands in `failed`, not as an error.
 */
export async function pruneDockerImages(
  input: PruneDockerImagesInput,
  scope: CallerScope,
): Promise<PruneDockerImagesOutput> {
  if (scope.caller.isSystemActor === false) {
    throw new ForbiddenError('Pruning images requires system-actor credentials (X-Api-Key)');
  }
  const deleter = scope.system.dockerImages;
  if (input.dryRun === false && deleter === null) {
    throw new PreconditionFailedError('Docker image deletion is not configured in this deployment');
  }

  const daemon = await fetchDaemonImages();
  if (daemon.available === false) {
    return { available: false, dryRun: input.dryRun, pruned: [], kept: [], failed: [] };
  }

  const now = new Date();
  const plan = planImagePrune({
    images: daemon.images,
    groups: await scope.workflowDefinitions.listGroupsForImageAudit(),
    agents: await scope.agentDefinitions.listAllForImageAudit(),
    runs: await liveRuns(scope, input.minAgeDays, now),
    minAgeDays: input.minAgeDays,
    now,
    ...(input.images === undefined ? {} : { only: input.images }),
  });

  if (input.dryRun === true || deleter === null) {
    return { available: true, dryRun: true, pruned: plan.pruned, kept: plan.kept, failed: [] };
  }

  const pruned: PruneRow[] = [];
  const failed: { image: string; error: string }[] = [];
  for (const row of plan.pruned) {
    try {
      await deleter.delete(row.image);
      pruned.push(row);
    } catch (error) {
      failed.push({ image: row.image, error: error instanceof Error ? error.message : String(error) });
    }
  }

  await emitAudit(scope.system.audit, scope.caller, {
    action: 'docker_image.pruned',
    namespace: '_system',
    description: `Image prune sweep deleted ${String(pruned.length)} image(s), kept ${String(plan.kept.length)}, failed on ${String(failed.length)}`,
    ...IMAGE_PRUNE_AUDIT_ENTITY,
    basis: 'Image prune sweep: images no workflow, agent or live run names',
    inputSnapshot: { minAgeDays: input.minAgeDays, ...(input.images === undefined ? {} : { images: input.images }) },
    outputSnapshot: { pruned: pruned.map((row) => row.image), failed },
  });

  return { available: true, dryRun: false, pruned, kept: plan.kept, failed };
}
