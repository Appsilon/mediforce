import { parseWorkflowDefinitionForCreation } from '@mediforce/platform-core';
import type {
  RegisterWorkflowInput,
  RegisterWorkflowOutput,
  RegistrationWarning,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import {
  ConflictError,
  ForbiddenError,
  HandlerError,
  ValidationError,
} from '../../errors';
import { actorFromCaller } from '../_helpers';
import { checkRetiredModels } from './retired-model-check';
import { isLocalAgentMode, fetchFromContainerWorker, fetchFromLocalDocker } from '../system/_docker';

interface RegisterScopedInput extends RegisterWorkflowInput {
  namespace: string;
}

export async function registerWorkflow(
  input: RegisterScopedInput,
  scope: CallerScope,
): Promise<RegisterWorkflowOutput> {
  if (typeof input.namespace !== 'string' || input.namespace.length === 0) {
    throw new ForbiddenError('Missing required query parameter: namespace');
  }

  const isDeleted = await scope.workflowDefinitions.isNameDeleted(input.namespace, input.name);
  if (isDeleted) {
    throw new ValidationError(
      `The name "${input.name}" was previously used by a deleted workflow. Please choose a different name.`,
    );
  }

  const parsed = parseWorkflowDefinitionForCreation({ ...input, namespace: input.namespace });
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => i.message).join(', '),
      parsed.error.issues,
    );
  }

  const allModels = await scope.models.list();
  const retired = checkRetiredModels(parsed.data, allModels);
  if (retired !== null) {
    throw new ValidationError(retired.message.replace('Cannot run', 'Cannot save'));
  }

  if (!isLocalAgentMode()) {
    const missingImage = parsed.data.steps
      .filter((s) => s.executor === 'agent')
      .filter((s) => {
        const cfg = s.agent;
        if (typeof cfg?.image === 'string' && cfg.image.length > 0) return false;
        if (typeof cfg?.repo === 'string' && cfg.repo.length > 0
          && typeof cfg?.commit === 'string' && cfg.commit.length > 0) return false;
        return true;
      });
    if (missingImage.length > 0) {
      const names = missingImage.map((s) => `'${s.name}'`).join(', ');
      throw new ValidationError(
        `Agent step(s) ${names} missing Docker image. Set agent.image or configure agent.repo + agent.commit for auto-build.`,
      );
    }
  }

  const latestVersion = await scope.workflowDefinitions.getLatestVersion(
    input.namespace,
    parsed.data.name,
  );
  const nextVersion = latestVersion + 1;

  const definition = {
    ...parsed.data,
    version: nextVersion,
    createdAt: new Date().toISOString(),
  };

  try {
    await scope.workflowDefinitions.save(definition);
  } catch (err) {
    if (err instanceof HandlerError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (/already exists/i.test(message)) {
      throw new ConflictError('Version conflict — please retry.');
    }
    throw err;
  }

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: nextVersion === 1 ? 'workflow.created' : 'workflow.version_added',
    description: `Workflow '${definition.name}' v${nextVersion} registered in '${input.namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace: input.namespace, name: definition.name },
    outputSnapshot: { version: nextVersion },
    basis: 'Workflow definition registered via API',
    entityType: 'workflow_definition',
    entityId: definition.name,
    namespace: input.namespace,
  });

  const warnings: RegistrationWarning[] = [];

  try {
    const dockerInfo = isLocalAgentMode()
      ? await fetchFromLocalDocker()
      : await fetchFromContainerWorker();
    if (dockerInfo.available) {
      for (const step of definition.steps) {
        if (step.executor !== 'agent' && step.executor !== 'script') continue;
        const cfg = step.executor === 'script' ? step.script : step.agent;
        const image = cfg?.image;
        if (typeof image !== 'string' || image.length === 0) continue;
        const hasBuildSource = typeof cfg?.repo === 'string' && cfg.repo.length > 0
          && typeof cfg?.commit === 'string' && cfg.commit.length > 0;
        if (hasBuildSource) continue;
        const [repo, tag = 'latest'] = image.split(':');
        const found = dockerInfo.images.some(
          (img) => img.repository === repo && img.tag === tag,
        );
        if (!found) {
          warnings.push({
            code: 'image-not-found',
            message: `Image '${image}' not found on platform (step '${step.name}'). The workflow will fail at runtime unless this image is built or pushed before starting a run.`,
            stepName: step.name,
          });
        }
      }
    }
  } catch (err) {
    console.error('[register-workflow] Docker image check failed:', err);
  }

  return {
    success: true as const,
    name: definition.name,
    version: definition.version,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
