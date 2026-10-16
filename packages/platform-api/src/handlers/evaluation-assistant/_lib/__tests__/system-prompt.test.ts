import { describe, it, expect } from 'vitest';
import { EVALUATION_ASSISTANT_SYSTEM_PROMPTS, briefMessage, unattendedBudgetMessage } from '../system-prompt';

const EVALUATION_ASSISTANT_SYSTEM_PROMPT = EVALUATION_ASSISTANT_SYSTEM_PROMPTS.step;

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
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('negative, an output it must not return');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).not.toContain('notes');
  });

  it('covers Acceptance Criteria set before a run, validation from the newest run of the version, and routing', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Propose them with propose_acceptance_criteria');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('newest finished Eval Run of its workflow version');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('it rests on that run alone');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).not.toContain('citing the Brief');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Propose the recommendation with propose_control_settings');
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

  it('answers a non-technical person briefly, in the Evaluation tab\'s terms, without its own internals', () => {
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('the one next step the person can take');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Output schema, Code, LLM judge and Expected output');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('never "test case", "metric" or "grader"; never "threshold" for Acceptance Criteria');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('Never show the person tool names');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('"7 of 10 trials passed"');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('"Waiting for human approval"');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).toContain('"CM4 — Autonomous agent');
    expect(EVALUATION_ASSISTANT_SYSTEM_PROMPT).not.toMatch(/saved Dataset|Control Mode 4/);
  });

  it('says whether the request carries an unattended budget', () => {
    expect(unattendedBudgetMessage(undefined, 'step')).toContain('start_eval_run is refused');
    expect(unattendedBudgetMessage(5, 'step')).toContain('unattended budget of $5');
  });

  it('carries the step\'s Brief every turn, or asks for one', () => {
    expect(briefMessage({
      namespace: 'n', workflowName: 'w', stepId: 's', agentId: null, version: 3, text: 'A missed grade 5 is critical.',
      origin: 'user', createdBy: 'u', createdAt: '2026-09-23T08:00:00.000Z',
    }, 'step')).toBe("The step's Evaluation Brief (v3), its context of use:\nA missed grade 5 is critical.");
    expect(briefMessage(null, 'step')).toContain('offer to draft a Brief with propose_brief');
  });

  describe('for an Agent evaluated on its own (ADR-0029)', () => {
    const prompt = EVALUATION_ASSISTANT_SYSTEM_PROMPTS.agent;

    it('shares the Step\'s core: checks, criteria, diagnosis and how to answer', () => {
      for (const shared of ['Choose the cheapest reliable kind', 'Propose them with propose_acceptance_criteria', 'get_failures gives the run\'s failing trials', 'Never show the person tool names', 'You do not set up variants']) {
        expect(prompt).toContain(shared);
      }
    });

    it('names the Agent\'s reads and none of the Step\'s own', () => {
      expect(prompt).toContain('Read before you plan: get_agent');
      expect(prompt).toContain('list_agent_production_runs gives the steps that use the agent');
      expect(prompt).toContain('Set containsProductionData to true');
      for (const stepOnly of ['get_step', 'list_step_runs', 'propose_perturbed_case', 'propose_control_settings', 'list_workspace_files', 'workflow editor', 'with runInProduction true']) {
        expect(prompt).not.toContain(stepOnly);
      }
    });

    it('speaks of the agent in its Brief and budget messages', () => {
      expect(briefMessage(null, 'agent')).toContain('This agent has no Evaluation Brief yet');
      expect(unattendedBudgetMessage(5, 'agent')).toContain('prepared runs of this agent');
    });
  });
});
