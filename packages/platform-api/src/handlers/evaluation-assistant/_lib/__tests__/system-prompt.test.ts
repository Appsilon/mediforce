import { describe, it, expect } from 'vitest';
import { EVALUATION_ASSISTANT_SYSTEM_PROMPT, briefMessage } from '../system-prompt';

describe('Evaluation Assistant prompt', () => {
  it('states the authority tiers of ADR-0023 D15', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Never approve a code check\'s source, label outputs for calibration, or sign anything');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('start_eval_run is refused without the person\'s confirmation');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('run it with preview_evaluator on real outputs');
  });

  it('covers phase 2: the plan, the cheapest reliable check, labels only the person gives, negative cases', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('call propose_evaluation_plan');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Choose the cheapest reliable kind');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('The person labels them pass or fail on the card, never you.');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('say in notes what the output must NOT do');
  });

  it('carries the step\'s Brief every turn, or asks for one', () => {
    expect(briefMessage({
      namespace: 'n', workflowName: 'w', stepId: 's', version: 3, text: 'A missed grade 5 is critical.',
      origin: 'user', createdBy: 'u', createdAt: '2026-09-23T08:00:00.000Z',
    })).toBe("The step's Evaluation Brief (v3), its context of use:\nA missed grade 5 is critical.");
    expect(briefMessage(null)).toContain('offer to draft a Brief with propose_brief');
  });
});
