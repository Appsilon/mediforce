import { PreconditionFailedError } from '../../errors';
import { actorFromCaller, loadOr404 } from '../_helpers';
import type { CallerScope } from '../../repositories/index';
import type {
  FinalizeCoworkSessionInput,
  FinalizeCoworkSessionOutput,
} from '../../contract/cowork';
import { validateOutputSchema } from '@mediforce/agent-runtime';
import type { OutputSchemaShape } from '@mediforce/platform-core';

/**
 * Finalize a cowork session and resume its parent process instance.
 *
 * Sequence (best-effort, non-transactional — see issue #516 for the
 * transactional version pending Postgres migration):
 *   1. `coworkSessions.finalize` (status='finalized', persist artifact)
 *   2. audit `cowork.session.finalized`
 *   3. `runs.update` (paused → running, clear pauseReason)
 *   4. `engine.advanceStep` (workflow advances with artifact as step output)
 *   5. `runKicker.kick` (fire-and-forget self-fetch — runner picks up next step)
 */
export async function finalizeCoworkSession(
  input: FinalizeCoworkSessionInput,
  scope: CallerScope,
): Promise<FinalizeCoworkSessionOutput> {
  const session = await loadOr404(
    scope.coworkSessions.getById(input.sessionId),
    `Cowork session '${input.sessionId}' not found`,
  );

  if (session.status !== 'active') {
    throw new PreconditionFailedError(
      `Cannot finalize a ${session.status} session`,
      { sessionId: input.sessionId, status: session.status },
    );
  }

  const instance = await loadOr404(
    scope.runs.getById(session.processInstanceId),
    `Process instance '${session.processInstanceId}' not found`,
  );

  if (instance.status !== 'paused') {
    throw new PreconditionFailedError(
      `Process instance is '${instance.status}', expected 'paused'`,
      { instanceId: session.processInstanceId, status: instance.status },
    );
  }

  const actor = actorFromCaller(scope);
  const now = new Date().toISOString();

  if (session.outputSchema) {
    const error = validateOutputSchema(
      input.artifact,
      session.outputSchema as OutputSchemaShape,
    );
    if (error !== null) {
      throw new PreconditionFailedError(
        `Artifact validation failed: ${error}`,
        { sessionId: input.sessionId, error },
      );
    }
  }

  await scope.coworkSessions.finalize(input.sessionId, input.artifact);

  await scope.system.audit.append({
    ...actor,
    action: 'cowork.session.finalized',
    description: `Cowork session '${input.sessionId}' finalized for step '${session.stepId}'`,
    timestamp: now,
    inputSnapshot: { sessionId: input.sessionId, stepId: session.stepId },
    outputSnapshot: { artifactKeys: Object.keys(input.artifact) },
    basis: 'Cowork session finalized via API',
    entityType: 'coworkSession',
    entityId: input.sessionId,
    processInstanceId: session.processInstanceId,
    processDefinitionVersion: instance.definitionVersion,
  });

  await scope.runs.update(session.processInstanceId, {
    status: 'running',
    pauseReason: null,
    updatedAt: now,
  });

  await scope.system.engine.advanceStep(session.processInstanceId, input.artifact, {
    id: actor.actorId,
    role: 'human',
  });

  await scope.system.runKicker.kick(session.processInstanceId, {
    triggeredBy: actor.actorId,
  });

  const updatedInstance = await scope.runs.getById(session.processInstanceId);

  return {
    sessionId: input.sessionId,
    resolvedStepId: session.stepId,
    processInstanceId: session.processInstanceId,
    nextStepId: updatedInstance?.currentStepId ?? null,
    status: updatedInstance?.status ?? 'unknown',
  };
}
