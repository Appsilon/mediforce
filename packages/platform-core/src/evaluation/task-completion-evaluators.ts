import { DEFAULT_JUDGE_MIN_CONFIDENCE, type EvaluatorCheck } from '../schemas/evaluation';
import { FALLBACK_PINNED_MODEL } from '../schemas/model-registry';
import type { TaskCompletionEvaluator } from '../schemas/evaluation-assistant-tools';

/** Every task-completion Evaluator's name starts with this, so a step's suite is found by name (epic #1516 F1). */
export const TASK_COMPLETION_EVALUATOR_PREFIX = 'task-completion-';

const MAX_EVALUATOR_NAME_LENGTH = 63;

export const TASK_COMPLETION_SOURCE_LABELS: Record<TaskCompletionEvaluator['source'], string> = {
  preamble: 'preamble',
  prompt: 'prompt',
  output_schema: 'output schema',
  skill: 'skill',
  brief: 'brief',
};

export function isTaskCompletionEvaluatorName(name: string): boolean {
  return name.startsWith(TASK_COMPLETION_EVALUATOR_PREFIX);
}

/**
 * A task-completion judge's rubric, from its one requirement, in a fixed
 * template so every task-completion judge reads the same way (issue #1527).
 */
function taskCompletionRubric(evaluator: TaskCompletionEvaluator): string {
  const note = evaluator.priority === 'high' ? ' A miss here matters most.' : '';
  return [
    `The step was instructed to do the following (from its ${TASK_COMPLETION_SOURCE_LABELS[evaluator.source]}):`,
    '',
    `${evaluator.requirement}${note}`,
    '',
    'Judge this one requirement only. Pass only if the output fully meets it. Fail if it is unmet, partly met, or missing.',
    'In the rationale, say whether it is met, citing the output and the log entries that decide it.',
  ].join('\n');
}

/**
 * The Evaluator one drafted task-completion requirement becomes: its name
 * prefixed, the requirement as its rule, and its check as drafted — or, for a
 * judge, the rendered rubric on the pinned model and default confidence floor.
 */
export function taskCompletionEvaluator(evaluator: TaskCompletionEvaluator): { name: string; rule: string; check: EvaluatorCheck } {
  const suffix = isTaskCompletionEvaluatorName(evaluator.name) ? evaluator.name.slice(TASK_COMPLETION_EVALUATOR_PREFIX.length) : evaluator.name;
  const name = `${TASK_COMPLETION_EVALUATOR_PREFIX}${suffix}`.slice(0, MAX_EVALUATOR_NAME_LENGTH).replace(/-+$/, '');
  const check: EvaluatorCheck = evaluator.check.kind === 'llm_judge'
    ? { kind: 'llm_judge', model: FALLBACK_PINNED_MODEL, rubric: taskCompletionRubric(evaluator), minConfidence: DEFAULT_JUDGE_MIN_CONFIDENCE }
    : evaluator.check;
  return { name, rule: evaluator.requirement, check };
}
