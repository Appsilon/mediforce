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

/** Default Docker image for agent steps that specify neither `image` nor `repo`+`commit`. */
const DEFAULT_AGENT_IMAGE = 'mediforce-golden-image';

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
    for (const step of parsed.data.steps) {
      if (step.executor !== 'agent') continue;
      const cfg = step.agent;
      const hasImage = typeof cfg?.image === 'string' && cfg.image.length > 0;
      const hasBuildSource = typeof cfg?.repo === 'string' && cfg.repo.length > 0
        && typeof cfg?.commit === 'string' && cfg.commit.length > 0;
      if (hasImage || hasBuildSource) continue;
      step.agent = { ...cfg, image: DEFAULT_AGENT_IMAGE };
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

  const hasDockerSteps = definition.steps.some(
    (s) => s.executor === 'agent' || s.executor === 'script',
  );

  if (hasDockerSteps) {
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
    } catch {
      warnings.push({
        code: 'image-check-unavailable',
        message: 'Could not verify Docker images — the container runtime is unreachable. Image availability will be checked again at run start.',
        stepName: '',
      });
    }
  }

  return {
    success: true as const,
    name: definition.name,
    version: definition.version,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
