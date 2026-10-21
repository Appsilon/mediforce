import { describe, expect, it } from 'vitest';
import { taskCompletionRubric } from '../task-completion-rubric';

describe('taskCompletionRubric', () => {
  it('numbers, sources, aligns and flags each requirement, closing with the pass/fail instruction', () => {
    const rubric = taskCompletionRubric([
      { text: 'Every adverse event in the input appears in the output.', source: 'prompt' },
      { text: '`events` and `summary` are present and filled.', source: 'output_schema' },
      { text: 'Grade ≥3 events are flagged for medical review.', source: 'brief', priority: 'high' },
    ]);
    const lines = rubric.split('\n');

    expect(lines[0]).toBe('The step was instructed to do the following. Each requirement is one thing the output must do.');
    expect(lines[1]).toBe('');
    const [r1, r2, r3] = lines.slice(2, 5);
    expect(r1).toMatch(/^R1 \(prompt\) {2,}Every adverse event in the input appears in the output\.$/);
    expect(r2).toMatch(/^R2 \(output schema\) {2,}`events` and `summary` are present and filled\.$/);
    expect(r3).toMatch(/^R3 \(brief\) {2,}Grade ≥3 events are flagged for medical review\. A miss here matters most\.$/);
    // Every requirement's text starts at the same column, the longest tag plus two spaces.
    const textColumn = (line: string) => line.search(/ {2,}\S/) + line.match(/ {2,}/)![0].length;
    expect(textColumn(r1!)).toBe(textColumn(r2!));
    expect(textColumn(r2!)).toBe(textColumn(r3!));

    expect(lines[5]).toBe('');
    expect(lines[6]).toBe('Pass only if every requirement is met. Fail if any is unmet, partly met, or missing.');
    expect(lines[7]).toBe('In the rationale, go through R1…R3 one by one: met or not, citing the output and the log entries that decide it.');
  });

  it('renders a single requirement without misaligned padding', () => {
    const rubric = taskCompletionRubric([{ text: 'Say hello.', source: 'preamble' }]);
    expect(rubric).toMatch(/^R1 \(preamble\) {2,}Say hello\.$/m);
    expect(rubric).toContain('R1…R1');
  });
});
