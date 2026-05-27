import type { CallerScope } from '../../repositories/index.js';
import type {
  GetWorkflowSecretsFullInput,
  GetWorkflowSecretsFullOutput,
} from '../../contract/secrets.js';
import { assertNamespaceAccess } from '../../auth.js';

/**
 * Value-revealing read of workflow-scoped secrets. Used by the secrets-management
 * UI when the operator opens the editor. Unlike `listSecretKeys`, this returns
 * the plaintext values — so it cannot soft-fail to `{}` for non-members the way
 * `scope.workflowSecrets.getSecrets` does. We gate explicitly with
 * `assertNamespaceAccess` (ForbiddenError on miss) and emit an audit event
 * recording the reveal so unusual access patterns surface in the audit log.
 */
export async function getWorkflowSecretsFull(
  input: GetWorkflowSecretsFullInput,
  scope: CallerScope,
): Promise<GetWorkflowSecretsFullOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);

  const secrets = await scope.workflowSecrets.getSecrets(input.namespace, input.workflow);

  const isUser = scope.caller.kind === 'user';
  await scope.system.audit.append({
    actorId: isUser ? scope.caller.uid : 'api',
    actorType: isUser ? 'user' : 'system',
    actorRole: 'operator',
    action: 'workflow_secret.values_revealed',
    description: `Workflow secret values revealed for workflow '${input.workflow}' in namespace '${input.namespace}' (${Object.keys(secrets).length} key(s))`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace: input.namespace, workflow: input.workflow },
    outputSnapshot: { revealedKeys: Object.keys(secrets) },
    basis: 'Operator opened workflow secrets editor',
    entityType: 'workflowSecret',
    entityId: `${input.namespace}/${input.workflow}`,
  });

  return { secrets };
}
