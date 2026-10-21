import type { TaskCompletionRequirement } from '../schemas/evaluation-assistant-tools';

/** The fixed name and rule of a step's task-completion Evaluator (epic #1516 F1). */
export const TASK_COMPLETION_EVALUATOR_NAME = 'task-completion';
export const TASK_COMPLETION_EVALUATOR_RULE = 'The output fulfils every requirement of the step\'s instructions and omits nothing required.';

const REQUIREMENT_SOURCE_LABEL: Record<TaskCompletionRequirement['source'], string> = {
  preamble: 'preamble',
  prompt: 'prompt',
  output_schema: 'output schema',
  skill: 'skill',
  brief: 'brief',
};

/**
 * Renders a task-completion judge's rubric from its requirements: one
 * numbered, sourced line per requirement, in a fixed template so every
 * task-completion Evaluator reads the same way (issue #1527).
 */
export function taskCompletionRubric(requirements: readonly TaskCompletionRequirement[]): string {
  const tags = requirements.map((requirement, index) => `R${index + 1} (${REQUIREMENT_SOURCE_LABEL[requirement.source]})`);
  const width = Math.max(...tags.map((tag) => tag.length)) + 2;
  const lines = requirements.map((requirement, index) => {
    const note = requirement.priority === 'high' ? ' A miss here matters most.' : '';
    return `${tags[index]!.padEnd(width)}${requirement.text}${note}`;
  });
  return [
    'The step was instructed to do the following. Each requirement is one thing the output must do.',
    '',
    ...lines,
    '',
    'Pass only if every requirement is met. Fail if any is unmet, partly met, or missing.',
    `In the rationale, go through R1…R${requirements.length} one by one: met or not, citing the output and the log entries that decide it.`,
  ].join('\n');
}
