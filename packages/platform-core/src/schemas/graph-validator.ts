import type { ProcessDefinition } from './process-definition';
import type { WorkflowDefinition } from './workflow-definition';
import { toProcessDefinition, validateStepReferences, type ReferenceIssue } from './workflow-graph';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates the structural correctness of a process definition's step graph.
 *
 * Checks:
 * 1. All transition `from` fields reference existing step IDs
 * 2. All transition `to` fields reference existing step IDs
 * 3. All verdict targets reference existing step IDs
 * 4. At least one terminal step exists
 * 5. Every non-terminal step has at least one outgoing transition or verdict
 * 6. All steps are reachable from the entry point (step[0])
 *
 * Intentional cycles (e.g., review loops) are NOT rejected.
 */
type ProcessStep = ProcessDefinition['steps'][number];

// The engine's StepExecutor only routes via verdict targets on review/decision
// steps; verdicts on any other step type are never followed at runtime, so the
// graph checks must not treat them as outgoing routing.
function routesViaVerdicts(step: ProcessStep | undefined): boolean {
  return (
    (step?.type === 'review' || step?.type === 'decision') &&
    step.verdicts !== undefined &&
    Object.keys(step.verdicts).length > 0
  );
}

export function validateStepGraph(definition: ProcessDefinition): ValidationResult {
  const errors: string[] = [];
  const stepIds = new Set(definition.steps.map((s) => s.id));

  // 1. All transition `from` fields reference existing step IDs
  for (const transition of definition.transitions) {
    if (!stepIds.has(transition.from)) {
      errors.push(
        `Transition references nonexistent source step "${transition.from}"`,
      );
    }
  }

  // 2. All transition `to` fields reference existing step IDs
  for (const transition of definition.transitions) {
    if (!stepIds.has(transition.to)) {
      errors.push(
        `Transition references nonexistent target step "${transition.to}"`,
      );
    }
  }

  // 3. All verdict targets reference existing step IDs
  for (const step of definition.steps) {
    if (step.verdicts) {
      for (const [verdictName, verdict] of Object.entries(step.verdicts)) {
        if (!stepIds.has(verdict.target)) {
          errors.push(
            `Step "${step.id}" verdict "${verdictName}" targets nonexistent step "${verdict.target}"`,
          );
        }
      }
    }
  }

  // 3b. Verdicts are only valid routing on review/decision steps
  for (const step of definition.steps) {
    if (
      step.verdicts &&
      Object.keys(step.verdicts).length > 0 &&
      step.type !== 'review' &&
      step.type !== 'decision'
    ) {
      errors.push(
        `Step "${step.id}" has verdicts but is type "${step.type}" — verdicts are only valid on review/decision steps`,
      );
    }
  }

  // 4. When-expression validation: if multiple transitions from same step, all must have `when`
  const transitionsBySource = new Map<string, typeof definition.transitions>();
  for (const transition of definition.transitions) {
    const existing = transitionsBySource.get(transition.from) ?? [];
    existing.push(transition);
    transitionsBySource.set(transition.from, existing);
  }
  for (const [stepId, transitions] of transitionsBySource) {
    if (transitions.length > 1) {
      // Review/decision steps with verdicts route via verdict targets — their
      // transitions are informational (for graph visualization) and don't need
      // `when`. Verdicts on other step types don't route, so no exemption.
      const step = definition.steps.find((s) => s.id === stepId);
      if (!routesViaVerdicts(step)) {
        const missingWhen = transitions.filter((t) => !t.when);
        if (missingWhen.length > 0) {
          errors.push(
            `Step "${stepId}" has multiple outgoing transitions but not all have 'when' conditions. ` +
              `Missing on transitions to: ${missingWhen.map((t) => t.to).join(', ')}`,
          );
        }
      }
    }
  }

  // 5. Selection constraints: only on review steps, min <= max
  for (const step of definition.steps) {
    if (step.selection !== undefined) {
      if (step.type !== 'review') {
        errors.push(
          `Step "${step.id}" has 'selection' but is type "${step.type}" — selection is only allowed on review steps`,
        );
      }
      if (typeof step.selection === 'object') {
        if (step.selection.min > step.selection.max) {
          errors.push(
            `Step "${step.id}" selection min (${step.selection.min}) exceeds max (${step.selection.max})`,
          );
        }
      }
    }
  }

  // 6. At least one terminal step exists
  const terminalSteps = definition.steps.filter((s) => s.type === 'terminal');
  if (terminalSteps.length === 0) {
    errors.push('Process definition has no terminal step');
  }

  // 7. Every non-terminal step has at least one outgoing transition or verdict
  for (const step of definition.steps) {
    if (step.type === 'terminal') continue;

    const hasOutgoingTransition = definition.transitions.some(
      (t) => t.from === step.id,
    );

    if (!hasOutgoingTransition && !routesViaVerdicts(step)) {
      errors.push(
        `Non-terminal step "${step.id}" has no outgoing transitions or verdicts`,
      );
    }
  }

  // 8. Reachability: BFS from step[0] (entry point)
  if (definition.steps.length > 0) {
    const reachable = new Set<string>();
    const queue: string[] = [definition.steps[0].id];
    reachable.add(definition.steps[0].id);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Follow outgoing transitions
      for (const transition of definition.transitions) {
        if (transition.from === current && !reachable.has(transition.to)) {
          reachable.add(transition.to);
          queue.push(transition.to);
        }
      }

      // Follow verdict targets (only review/decision steps route via verdicts)
      const step = definition.steps.find((s) => s.id === current);
      if (routesViaVerdicts(step) && step?.verdicts) {
        for (const verdict of Object.values(step.verdicts)) {
          if (!reachable.has(verdict.target)) {
            reachable.add(verdict.target);
            queue.push(verdict.target);
          }
        }
      }
    }

    for (const step of definition.steps) {
      if (!reachable.has(step.id)) {
        errors.push(`Step "${step.id}" is unreachable from the entry point`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface WorkflowGraphValidation {
  /** Human-readable error strings ready to display or throw. Empty = valid. */
  errors: string[];
  /** All reference issues (incl. warnings) so callers can surface warnings separately. */
  referenceIssues: ReferenceIssue[];
}

/**
 * Run the two gates a caller needs before persisting or applying a workflow
 * definition: structural graph validation and step-reference validation. Graph
 * errors short-circuit reference errors (matching the historical check order),
 * and `referenceIssues` is always returned so callers can report warnings even
 * when there are no errors.
 */
export function validateWorkflowGraphAndReferences(
  definition: WorkflowDefinition,
): WorkflowGraphValidation {
  const referenceIssues = validateStepReferences(definition.steps, definition.transitions);
  const graphResult = validateStepGraph(toProcessDefinition(definition));
  if (!graphResult.valid) {
    return {
      errors: [`Workflow graph is incomplete: ${graphResult.errors.join('; ')}`],
      referenceIssues,
    };
  }
  const referenceErrors = referenceIssues.filter((issue) => issue.severity === 'error');
  if (referenceErrors.length > 0) {
    return {
      errors: [`Broken step references: ${referenceErrors.map((issue) => issue.message).join(' ')}`],
      referenceIssues,
    };
  }
  return { errors: [], referenceIssues };
}
