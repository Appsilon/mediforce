import type { ProcessDefinition } from '@mediforce/platform-core';

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

  // 4. At least one terminal step exists
  const terminalSteps = definition.steps.filter((s) => s.type === 'terminal');
  if (terminalSteps.length === 0) {
    errors.push('Process definition has no terminal step');
  }

  // 5. Every non-terminal step has at least one outgoing transition or verdict
  for (const step of definition.steps) {
    if (step.type === 'terminal') continue;

    const hasOutgoingTransition = definition.transitions.some(
      (t) => t.from === step.id,
    );
    const hasVerdicts = step.verdicts && Object.keys(step.verdicts).length > 0;

    if (!hasOutgoingTransition && !hasVerdicts) {
      errors.push(
        `Non-terminal step "${step.id}" has no outgoing transitions or verdicts`,
      );
    }
  }

  // 6. Reachability: BFS from step[0] (entry point)
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

      // Follow verdict targets
      const step = definition.steps.find((s) => s.id === current);
      if (step?.verdicts) {
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
