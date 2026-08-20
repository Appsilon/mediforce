import {
  parseWorkflowTemplate,
  validateWorkflowGraphAndReferences,
  SERVER_MANAGED_WORKFLOW_FIELDS,
  type WorkflowDefinition,
} from '@mediforce/platform-core';
import type {
  ValidateWorkflowInput,
  ValidateWorkflowOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';

/**
 * Dry run of the canonical WorkflowDefinition validation, without persisting.
 *
 * Runs the same two gates `register` runs, in the same order:
 *
 * 1. `parseWorkflowTemplate` — the Zod schema + cross-field refinements
 *    (verdict targets, executor/plugin rules, transition validity, trigger
 *    config, `inputForNextRun`/`triggerInput`) that
 *    `parseWorkflowDefinitionForCreation` applies at register time.
 * 2. `validateWorkflowGraphAndReferences` — structural graph validation
 *    (reachability, terminal steps, dangling transitions) plus step-reference
 *    validation (`${steps.<id>.<field>}`). Without this a definition could pass
 *    `validate` and then fail `register`.
 *
 * This keeps the two handlers in agreement. Errors are returned as data
 * (`{ valid: false, errors }`), never thrown, so callers can route on `valid`
 * and surface the issues.
 */
export async function validateWorkflow(
  input: ValidateWorkflowInput,
  _scope: CallerScope,
): Promise<ValidateWorkflowOutput> {
  // Strip the platform-managed fields so an edit-mode candidate (a full
  // registered definition, which carries `namespace`/`version`/`createdAt`)
  // validates as a template rather than tripping `parseWorkflowTemplate`'s
  // namespace guard.
  const candidate: Record<string, unknown> = { ...input };
  for (const key of Object.keys(SERVER_MANAGED_WORKFLOW_FIELDS)) {
    delete candidate[key];
  }

  const parsed = parseWorkflowTemplate(candidate);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  // The graph gate operates on a full WorkflowDefinition. A template lacks the
  // server-managed fields, but graph/reference validation ignores them — fill
  // placeholders so the shared gate can run on the parsed candidate.
  const definition: WorkflowDefinition = {
    ...parsed.data,
    namespace: 'validate',
    version: 1,
    createdAt: new Date().toISOString(),
  };

  const { errors: graphErrors } = validateWorkflowGraphAndReferences(definition);
  if (graphErrors.length > 0) {
    return {
      valid: false,
      errors: graphErrors.map((message) => ({ path: 'graph', message })),
    };
  }

  return { valid: true, errors: [] };
}
