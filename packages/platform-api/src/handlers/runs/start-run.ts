import { validatePayload } from '@mediforce/platform-core';
import type { StartRunInput, StartRunOutput } from '../../contract/runs.js';
import type { CallerScope } from '../../repositories/index.js';
import { ForbiddenError, NotFoundError, HandlerError } from '../../errors.js';

/**
 * `POST /api/processes`.
 *
 * Fires a manual trigger to create + start a new run for the named WD. The
 * engine emits `instance.created` (inside `createInstance`) and
 * `instance.started` (inside `startInstance`) — both via `manualTrigger.fireWorkflow`,
 * so the handler does NOT double-emit. After creation, the auto-runner is
 * kicked so the first step executes.
 *
 * Response is entity echo `{ run }` per ADR-0005 §5 — replaces the
 * pre-Phase-3 `{ instanceId, status }` shape (UI + CLI callers updated in
 * the same PR).
 */
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

  // Cross-check workspace membership for non-public definitions (mirrors
  // the pre-migration `requireNamespaceAccess` gate).
  if (!scope.caller.isSystemActor && definition.visibility !== 'public') {
    if (!scope.caller.namespaces.has(definition.namespace)) {
      throw new ForbiddenError();
    }
  }

  const payload = input.payload ?? {};

  if (definition.triggerInput && definition.triggerInput.length > 0) {
    const validation = validatePayload(payload, definition.triggerInput);
    if (!validation.valid) {
      throw new HandlerError('validation', 'Invalid payload', validation.errors);
    }
  }

  const result = await scope.system.manualTrigger.fireWorkflow({
    namespace: definition.namespace,
    definitionName: input.definitionName,
    definitionVersion: version,
    triggerName: input.triggerName,
    triggeredBy: input.triggeredBy,
    payload,
  });

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
