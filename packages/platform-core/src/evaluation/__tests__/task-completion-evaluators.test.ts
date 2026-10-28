import { describe, expect, it } from 'vitest';
import { DEFAULT_JUDGE_MIN_CONFIDENCE } from '../../schemas/evaluation';
import { FALLBACK_PINNED_MODEL } from '../../schemas/model-registry';
import { isTaskCompletionEvaluatorName, taskCompletionEvaluator } from '../task-completion-evaluators';

describe('taskCompletionEvaluator', () => {
  it('keeps a schema or code check as drafted, prefixing the name and taking the requirement as the rule', () => {
    const schema = { kind: 'schema' as const, schema: { required: ['findings'] } };
    expect(taskCompletionEvaluator({ name: 'findings-present', requirement: '`findings` is present.', source: 'output_schema', check: schema }))
      .toEqual({ name: 'task-completion-findings-present', rule: '`findings` is present.', check: schema });

    const code = { kind: 'code' as const, runtime: 'python' as const, source: 'print(1)' };
    expect(taskCompletionEvaluator({ name: 'ids-in-input', requirement: 'Every id is in the input.', source: 'prompt', check: code }).check).toBe(code);
  });

  it('renders a judge\'s rubric from its one requirement, on the pinned model and default confidence floor', () => {
    const { check } = taskCompletionEvaluator({
      name: 'grade-3-flagged',
      requirement: 'Grade ≥3 events are flagged for medical review.',
      source: 'brief',
      priority: 'high',
      check: { kind: 'llm_judge' },
    });
    expect(check).toEqual({ kind: 'llm_judge', model: FALLBACK_PINNED_MODEL, minConfidence: DEFAULT_JUDGE_MIN_CONFIDENCE, rubric: expect.any(String) });
    expect(check.kind === 'llm_judge' && check.rubric.split('\n')).toEqual([
      'The step was instructed to do the following (from its brief):',
      '',
      'Grade ≥3 events are flagged for medical review. A miss here matters most.',
      '',
      'Judge this one requirement only. Pass only if the output fully meets it. Fail if it is unmet, partly met, or missing.',
      'In the rationale, say whether it is met, citing the output and the log entries that decide it.',
    ]);
  });

  it('does not double a prefix the model already wrote, and stays within an Evaluator name\'s 63 characters', () => {
    const judge = { requirement: 'Say hello.', source: 'prompt' as const, check: { kind: 'llm_judge' as const } };
    expect(taskCompletionEvaluator({ ...judge, name: 'task-completion-says-hello' }).name).toBe('task-completion-says-hello');
    const long = taskCompletionEvaluator({ ...judge, name: `${'a'.repeat(46)}-${'b'.repeat(10)}` }).name;
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long).toMatch(/^task-completion-a+$/);
  });

  it('recognises the suite\'s Evaluators by name', () => {
    expect(isTaskCompletionEvaluatorName('task-completion-findings-present')).toBe(true);
    expect(isTaskCompletionEvaluatorName('findings-present')).toBe(false);
  });
});
