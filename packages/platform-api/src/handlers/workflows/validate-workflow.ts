import {
  parseWorkflowTemplate,
  SERVER_MANAGED_WORKFLOW_FIELDS,
} from '@mediforce/platform-core';
import type {
  ValidateWorkflowInput,
  ValidateWorkflowOutput,
} from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';

/**
 * Dry run of the canonical WorkflowDefinition validation, without persisting.
 *
 * Runs `parseWorkflowTemplate` — the same Zod schema + cross-field refinements
 * (verdict targets, executor/plugin rules, transition validity, trigger config,
 * `inputForNextRun`/`triggerInput`) that `parseWorkflowDefinitionForCreation`
 * applies at register time. This is the single source of truth: callers that
 * previously hand-reimplemented a partial copy of these checks delegate here so
 * the validation can never drift from the schema.
 *
 * Errors are returned as data (`{ valid: false, errors }`), never thrown, so
 * callers can route on `valid` and surface the issues.
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
  if (parsed.success) return { valid: true, errors: [] };

  return {
    valid: false,
    errors: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
