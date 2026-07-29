import { validatePayload } from '@mediforce/platform-core';
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
  let version = input.definitionVersion;
  if (!version) {
    const resolved = await scope.workflowDefinitions.getLatestVersion(
      requestNamespace,
      input.definitionName,
    );
    if (resolved === 0) {
      throw new NotFoundError(
        `No workflow definition found for '${input.definitionName}'`,
      );
    }
    version = resolved;
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

  if (!scope.caller.isSystemActor && definition.visibility !== 'public') {
    if (!scope.caller.namespaces.has(definition.namespace)) {
      throw new ForbiddenError();
    }
  }

  const payload = input.payload ?? {};

  // Unconditional (ADR-0012): `triggerInput` is the workflow's *total* input
  // contract, so an empty contract means "this workflow takes no input" and a
  // caller passing fields anyway is rejected — the same rule the webhook and
  // cron paths now apply. The old `length > 0` guard made an empty contract mean
  // "anything goes", which is what let each trigger invent its own payload shape.
  const validation = validatePayload(payload, definition.triggerInput ?? []);
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
      payload,
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
