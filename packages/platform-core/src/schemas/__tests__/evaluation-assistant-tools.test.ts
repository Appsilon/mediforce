import { describe, it, expect } from 'vitest';
import {
  EVALUATION_ASSISTANT_PLATFORM_TOOLS,
  EVALUATION_ASSISTANT_PROPOSAL_TOOLS,
  EvaluationAssistantProposalSchema,
  FailureRootCauseSchema,
  FixKindSchema,
  ProposeDiagnosisToolSchema,
  ProposeEvaluatorToolSchema,
  ProposeFixToolSchema,
} from '../evaluation-assistant-tools';

const RUN = '0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const TRIAL = '1e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';

describe('Evaluation Assistant fix-loop tools (ADR-0023 D14)', () => {
  const cluster = {
    rootCause: 'ambiguous_instruction',
    summary: 'The prompt does not say what grade 5 is.',
    trialIds: [TRIAL],
    evidence: 'Three trajectories grade the death as grade 4.',
    fix: { kind: 'instruction', description: 'State that a fatal outcome is grade 5.' },
  };

  it('names the root causes and fix kinds', () => {
    expect(FailureRootCauseSchema.options).toEqual(['ambiguous_instruction', 'missing_context', 'tool_problem', 'model_capability', 'evaluator_wrong']);
    expect(FixKindSchema.options).toEqual(['instruction', 'examples', 'guardrail', 'model', 'tools', 'preprocessing_step', 'control_mode', 'evaluator']);
  });

  it('accepts a diagnosis of one to eight clusters, each with a trial', () => {
    expect(ProposeDiagnosisToolSchema.safeParse({ evalRunId: RUN, variantId: 'champion', clusters: [cluster] }).success).toBe(true);
    expect(ProposeDiagnosisToolSchema.safeParse({ evalRunId: RUN, variantId: 'champion', clusters: [] }).success).toBe(false);
    expect(ProposeDiagnosisToolSchema.safeParse({ evalRunId: RUN, variantId: 'champion', clusters: Array(9).fill(cluster) }).success).toBe(false);
    expect(ProposeDiagnosisToolSchema.safeParse({ evalRunId: RUN, variantId: 'champion', clusters: [{ ...cluster, trialIds: [] }] }).success).toBe(false);
    expect(ProposeDiagnosisToolSchema.safeParse({ evalRunId: RUN, variantId: 'champion', clusters: [{ ...cluster, rootCause: 'bad_luck' }] }).success).toBe(false);
  });

  const fix = { evalRunId: RUN, kind: 'instruction', label: 'Grade 5 is death', patch: { prompt: 'Fatal is grade 5.' }, addresses: 'cluster 1', rationale: 'It removes the ambiguity.' };

  it('accepts a fix whose patch matches its kind', () => {
    expect(ProposeFixToolSchema.safeParse(fix).success).toBe(true);
    expect(ProposeFixToolSchema.safeParse({ ...fix, kind: 'model', patch: { model: 'openai/gpt-5' } }).success).toBe(true);
    expect(ProposeFixToolSchema.safeParse({ ...fix, kind: 'tools', patch: { allowedTools: ['WebFetch'] } }).success).toBe(true);
    expect(ProposeFixToolSchema.safeParse({ ...fix, kind: 'examples', patch: { examples: [{ input: 'i', output: 'o' }] } }).success).toBe(true);
  });

  it('refuses a fix with an empty patch, a patch of another kind, or a kind no patch expresses', () => {
    expect(ProposeFixToolSchema.safeParse({ ...fix, patch: {} }).success).toBe(false);
    expect(ProposeFixToolSchema.safeParse({ ...fix, kind: 'model' }).success).toBe(false);
    expect(ProposeFixToolSchema.safeParse({ ...fix, patch: { prompt: 'x', model: 'm' } }).success).toBe(false);
    for (const kind of ['guardrail', 'control_mode', 'evaluator', 'preprocessing_step']) {
      expect(ProposeFixToolSchema.safeParse({ ...fix, kind }).success).toBe(false);
    }
  });

  it('lets a proposed Evaluator ask to run in production, and keeps that in the card', () => {
    const evaluator = { name: 'grade-in-range', rule: 'Grades are 1-5.', severity: 'critical', check: { kind: 'schema', schema: { required: ['findings'] } } };
    expect(ProposeEvaluatorToolSchema.parse({ ...evaluator, runInProduction: true }).runInProduction).toBe(true);
    expect(ProposeEvaluatorToolSchema.parse(evaluator).runInProduction).toBeUndefined();
    expect(EvaluationAssistantProposalSchema.parse({ tool: 'propose_evaluator', arguments: { ...evaluator, runInProduction: true } }))
      .toMatchObject({ arguments: { runInProduction: true } });
  });

  it('registers the tools, and shows each proposal as a card', () => {
    expect(Object.keys(EVALUATION_ASSISTANT_PROPOSAL_TOOLS)).toEqual(expect.arrayContaining(['propose_diagnosis', 'propose_fix']));
    expect(EVALUATION_ASSISTANT_PLATFORM_TOOLS.get_failures.safeParse({ evalRunId: RUN }).success).toBe(true);
    expect(EVALUATION_ASSISTANT_PLATFORM_TOOLS.get_failures.safeParse({ evalRunId: 'nope' }).success).toBe(false);
    expect(EvaluationAssistantProposalSchema.parse({ tool: 'propose_fix', arguments: fix })).toMatchObject({ tool: 'propose_fix' });
    expect(EvaluationAssistantProposalSchema.parse({ tool: 'propose_diagnosis', arguments: { evalRunId: RUN, variantId: 'champion', clusters: [cluster] } })).toMatchObject({ tool: 'propose_diagnosis' });
  });
});
