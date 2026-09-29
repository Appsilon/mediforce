import { describe, it, expect } from 'vitest';
import { EVALUATION_ASSISTANT_SYSTEM_PROMPT, briefMessage, unattendedBudgetMessage } from '../system-prompt';

describe('Evaluation Assistant prompt', () => {
  it('states the authority tiers of ADR-0023 D15', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Never approve a code check\'s source, label outputs for calibration, or sign a Step Qualification');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('start_eval_run is refused without the person\'s confirmation');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('run it with preview_evaluator on real outputs');
  });

  it('covers the plan, the cheapest reliable check, labels only the person gives, and cases synthesized as positive', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('call propose_evaluation_plan');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Choose the cheapest reliable kind');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('The person labels them pass or fail on the card, never you.');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('most synthesized cases are positive, with notes on what the output must NOT do');
  });

  it('covers Acceptance Criteria set before a run, variant comparison without overclaiming, and routing', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Propose them with propose_acceptance_criteria');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('otherwise say there is no clear difference at this sample size');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Propose it with propose_control_settings');
  });

  it('covers the fix loop: failures, diagnosis by root cause, fixes by what expresses them, examples from dev cases only', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('get_failures gives the variant\'s failing trials');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('propose_diagnosis');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('ambiguous_instruction');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('propose_fix with the patch');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('propose_evaluator with runInProduction true');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('A lower Control Mode is propose_control_settings');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('A wrong Evaluator is propose_evaluator_version');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('A preprocessing step is advice in the diagnosis');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Few-shot examples come from dev cases only — never holdout');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Start such a run only under a granted unattended budget');
  });

  it('says whether the request carries an unattended budget', () => {
    expect(unattendedBudgetMessage(undefined)).toContain('start_eval_run is refused');
    expect(unattendedBudgetMessage(5)).toContain('unattended budget of $5');
  });

  it('carries the step\'s Brief every turn, or asks for one', () => {
    expect(briefMessage({
      namespace: 'n', workflowName: 'w', stepId: 's', version: 3, text: 'A missed grade 5 is critical.',
      origin: 'user', createdBy: 'u', createdAt: '2026-09-23T08:00:00.000Z',
    })).toBe("The step's Evaluation Brief (v3), its context of use:\nA missed grade 5 is critical.");
    expect(briefMessage(null)).toContain('offer to draft a Brief with propose_brief');
  });
});
