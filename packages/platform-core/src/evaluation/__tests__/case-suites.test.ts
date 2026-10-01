import { describe, it, expect } from 'vitest';
import { caseSuiteTargets, caseSuiteVariants } from '../case-suites';

const INPUT = {
  triggerPayload: { narrative: 'Subject reports nausea.', subjectId: '106-007', labCount: 4 },
  previousStepOutputs: {
    'prepare-case': { narrative: 'Subject reports nausea.', labs: { alt: 30, ast: 25 }, flags: [], visit: { week: 12 } },
  },
};
const naming = { newCanary: () => 'CANARY-TEST', source: 'the run' };

describe('caseSuiteTargets', () => {
  it('lists the text fields an injection can go into, earlier steps\' outputs first', () => {
    const targets = caseSuiteTargets(INPUT, 'prompt_injection');
    expect(targets.map((target) => [target.part, target.path.join('.')])).toEqual([
      ['previousStepOutputs', 'prepare-case.narrative'],
      ['triggerPayload', 'narrative'],
      ['triggerPayload', 'subjectId'],
    ]);
  });

  it('adds the objects robustness can reorder, and skips one-key objects and numbers', () => {
    const targets = caseSuiteTargets(INPUT, 'robustness');
    expect(targets.map((target) => `${target.kind} ${target.part}.${target.path.join('.')}`)).toEqual([
      'object previousStepOutputs.prepare-case',
      'text previousStepOutputs.prepare-case.narrative',
      'object previousStepOutputs.prepare-case.labs',
      'text triggerPayload.narrative',
      'text triggerPayload.subjectId',
    ]);
  });
});

describe('caseSuiteVariants', () => {
  it('appends each built-in injection with the canary it is given', () => {
    const written = caseSuiteVariants(INPUT, 'prompt_injection', { part: 'triggerPayload', path: ['narrative'] }, naming);
    if ('error' in written) throw new Error(written.error);
    expect(written.variants.map((variant) => variant.name)).toEqual(['direct override', 'sponsor authority', 'delimiter escape']);
    for (const variant of written.variants) {
      expect(variant.value).toMatch(/^Subject reports nausea\./);
      expect(variant.value).toContain('CANARY-TEST');
    }
  });

  it('says why a field takes no case', () => {
    expect(caseSuiteVariants(INPUT, 'prompt_injection', { part: 'triggerPayload', path: ['missing'] }, naming))
      .toEqual({ error: "'triggerPayload.missing' is not in the input of the run" });
    expect(caseSuiteVariants(INPUT, 'robustness', { part: 'triggerPayload', path: ['labCount'] }, naming))
      .toEqual({ error: "'triggerPayload.labCount' is neither text nor an object, so there is no change that keeps its meaning" });
  });
});
