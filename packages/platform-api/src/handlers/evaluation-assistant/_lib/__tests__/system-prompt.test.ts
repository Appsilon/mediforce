import { describe, it, expect } from 'vitest';
import { EVALUATION_ASSISTANT_SYSTEM_PROMPT, briefMessage, unattendedBudgetMessage } from '../system-prompt';

describe('Evaluation Assistant prompt', () => {
  it('states the authority tiers of ADR-0023 D15', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Never approve a code check\'s source, accept or deny a judge\'s verdict, or sign a Step Qualification');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('start_eval_run is refused without the person\'s confirmation');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('run it with preview_evaluator on real outputs');
  });

  it('covers the plan, the cheapest reliable check, judge verdicts and case expectations only the person reviews', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('call propose_evaluation_plan');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Choose the cheapest reliable kind');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('minConfidence');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).not.toMatch(/get_calibration|propose_outputs_to_label|propose_written_outputs/);
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Cases are not labelled positive or negative.');
  });

  it('covers Acceptance Criteria set before a run, validation from the newest run of the version, and routing', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Propose them with propose_acceptance_criteria');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('newest finished Eval Run of its workflow version');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('it rests on that run alone');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).not.toContain('citing the Brief');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Propose it with propose_control_settings');
  });

  it('covers diagnosis: failures, root causes, fixes by what expresses them', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('get_failures gives the run\'s failing trials');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('propose_diagnosis');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('ambiguous_instruction');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('propose_evaluator with runInProduction true');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('A lower Control Mode is propose_control_settings');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('A wrong Evaluator is propose_evaluator_version');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('A preprocessing step is advice in the diagnosis');
  });

  it('leaves variants, optimisation and built-in checks out of what it offers', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('You do not set up variants');
    for (const gone of ['propose_fix', 'start_optimisation', 'get_optimisation', 'compare_variants', 'propose_case_suite', 'builtin', 'challenger']) {
      expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).not.toContain(gone);
    }
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
