import { resolveRunnableVersion, validatePayload } from '@mediforce/platform-core';
import { ManualTriggerNotDeclaredError } from '@mediforce/workflow-engine';
import type { StartRunInput, StartRunOutput } from '../../contract/runs';
import type { CallerScope } from '../../repositories/index';
import { ConflictError, ForbiddenError, NotFoundError, HandlerError } from '../../errors';

// Engine's createInstance + startInstance emit instance.created /
// instance.started; handler does NOT double-emit.
export async function startRun(
  input: StartRunInput,
  scope: CallerScope,
): Promise<StartRunOutput> {
  const requestNamespace = input.namespace ?? '';
  // An unpinned start resolves through the one shared policy (ADR-0011), the
  // same one the cron heartbeat and spawn use: a manual firing and a cron firing
  // of the same workflow must land on the same version, or ADR-0012's single
  // `triggerInput` contract splits in two. `getLatestVersion` used here before
  // was archived-inclusive, so a workflow whose head is archived started on a
  // version nothing else would fire. An explicit `definitionVersion` still wins
  // outright — pinning an archived version is a deliberate act.
  let version = input.definitionVersion;
  if (version === undefined) {
    const resolution = await resolveRunnableVersion(
      scope.workflowDefinitions,
      requestNamespace,
      input.definitionName,
    );
    if (!resolution.ok) {
      throw new NotFoundError(
        `No runnable workflow definition found for '${input.definitionName}': ${resolution.reason}`,
      );
    }
    version = resolution.def.version;
  }

  const definition = await scope.workflowDefinitions.get(
    requestNamespace,
    input.definitionName,
    version,
  );
  if (!definition) {
    throw new NotFoundError(
      `Workflow definition '${input.definitionName}' v${version} not found`,
    );
  }

  if (!scope.caller.isSystemActor && !scope.caller.namespaces.has(definition.namespace)) {
    throw new ForbiddenError();
  }

  // Unconditional (ADR-0012): `triggerInput` is the workflow's *total* input
  // contract, so an empty contract means "this workflow takes no input" and a
  // caller passing fields anyway is rejected — the same rule the webhook and
  // cron paths now apply. The old `length > 0` guard made an empty contract mean
  // "anything goes", which is what let each trigger invent its own payload shape.
  const validation = validatePayload(input.payload ?? {}, definition.triggerInput ?? []);
  if (!validation.valid) {
    throw new HandlerError('validation', 'Invalid payload', validation.errors);
  }

  let result;
  try {
    result = await scope.system.manualTrigger.fireWorkflow({
      namespace: definition.namespace,
      definitionName: input.definitionName,
      definitionVersion: version,
      triggerName: input.triggerName,
      triggeredBy: input.triggeredBy,
      payload: validation.payload,
      ...(input.dryRun ? { dryRun: true } : {}),
    });
  } catch (err) {
    // The workflow has no enabled `manual` trigger row (ADR-0011). This is an
    // expected client-facing rejection, not a server fault — surface it as 409
    // rather than letting the plain Error fall through to a 500.
    if (err instanceof ManualTriggerNotDeclaredError) {
      throw new ConflictError(err.message);
    }
    throw err;
  }

  await scope.system.runKicker.kick(result.instanceId, {
    triggeredBy: input.triggeredBy,
  });

  const created = await scope.runs.getById(result.instanceId);
  if (!created) {
    throw new HandlerError(
      'internal',
      `Run '${result.instanceId}' not readable after creation`,
    );
  }
  return { run: created };
}
