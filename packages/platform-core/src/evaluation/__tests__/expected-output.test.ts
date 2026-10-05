import { describe, expect, it } from 'vitest';
import { evaluatorAppliesToCase, outputDifferences } from '../expected-output';

const JUDGE = { evaluatorId: '00000000-0000-4000-8000-000000000001', kind: 'llm_judge' as const };
const EXPECTED = { evaluatorId: '00000000-0000-4000-8000-000000000002', kind: 'expected_output' as const };

describe('evaluatorAppliesToCase', () => {
  it('lets every Evaluator grade a case that selects none', () => {
    expect(evaluatorAppliesToCase(JUDGE, { evaluatorIds: null, expectedOutput: null })).toBe(true);
  });

  it('lets only the selected Evaluators grade a case', () => {
    const evalCase = { evaluatorIds: [EXPECTED.evaluatorId], expectedOutput: { grade: 5 } };
    expect(evaluatorAppliesToCase(JUDGE, evalCase)).toBe(false);
    expect(evaluatorAppliesToCase(EXPECTED, evalCase)).toBe(true);
  });

  it('does not let an expected-output check grade a case without an expected output', () => {
    expect(evaluatorAppliesToCase(EXPECTED, { evaluatorIds: null, expectedOutput: null })).toBe(false);
    expect(evaluatorAppliesToCase(EXPECTED, { evaluatorIds: [EXPECTED.evaluatorId], expectedOutput: null })).toBe(false);
  });
});

describe('outputDifferences', () => {
  it('finds none in equal outputs whatever their key order', () => {
    expect(outputDifferences({ grade: 5, events: [{ term: 'sepsis', fatal: true }] }, { events: [{ fatal: true, term: 'sepsis' }], grade: 5 })).toEqual([]);
  });

  it('names each changed, missing and unexpected field by its path', () => {
    expect(outputDifferences(
      { events: [{ term: 'sepsis', grade: 5 }], summary: 'one event' },
      { events: [{ term: 'sepsis', grade: 4 }], extra: true },
    )).toEqual([
      'events.0.grade: expected 5, got 4',
      'extra: not expected',
      'summary: missing',
    ]);
  });

  it('reports an array of another length as one difference', () => {
    expect(outputDifferences({ events: [1, 2] }, { events: [1] })).toEqual(['events: expected [1,2], got [1]']);
  });

  it('stops at the limit', () => {
    expect(outputDifferences({ a: 1, b: 2, c: 3 }, { a: 0, b: 0, c: 0 }, 2)).toHaveLength(2);
  });
});
