'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';
import {
  JUDGE_MIN_AGREEMENT,
  JUDGE_MIN_FAILURE_LABELS,
  JUDGE_MIN_LABELS,
  describeAcceptanceCriteria,
  type AgentOutputSchema,
  type EvaluatedStep,
} from '@mediforce/platform-core';
import type { EvaluatorSelfTest, ProposalView } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useEvaluatorLabels, useStepEvaluationMutation, useStepEvaluators } from '@/hooks/use-step-evaluation';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { ControlModeBadge } from '@/components/ui/control-mode-badge';
import { MarkdownPresentation } from '@/components/tasks/markdown-presentation';
import { CalibrateAction, LabelOutputRow, labelsBySubject } from './judge-calibration';
import { DraftedOutput } from './written-output-form';

export type ProposalStatus = 'open' | 'accepted' | 'rejected';

type Proposal<Tool extends ProposalView['tool']> = Extract<ProposalView, { tool: Tool }>;

/**
 * The proposals a person accepts or rejects as they stand. A plan and a
 * labelling queue are worked through instead; a routing recommendation is
 * applied in the workflow editor.
 */
type DecidableProposal = Exclude<ProposalView, { tool: 'propose_evaluation_plan' | 'propose_outputs_to_label' | 'propose_written_outputs' | 'propose_control_settings' | 'propose_diagnosis' }>;

export function isDecidable(proposal: ProposalView): proposal is DecidableProposal {
  return proposal.tool !== 'propose_evaluation_plan'
    && proposal.tool !== 'propose_outputs_to_label'
    && proposal.tool !== 'propose_written_outputs'
    && proposal.tool !== 'propose_control_settings'
    && proposal.tool !== 'propose_diagnosis';
}

const buttonClass = 'inline-flex items-center gap-1 rounded border px-2 py-0.5 disabled:opacity-50 disabled:pointer-events-none';
const primaryButtonClass = 'inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-50 disabled:pointer-events-none';

const TITLES: Record<DecidableProposal['tool'], string> = {
  propose_evaluator: 'Evaluator',
  propose_evaluator_version: 'Evaluator version',
  propose_eval_case: 'Eval Case',
  propose_perturbed_case: 'synthesized Eval Case',
  propose_brief: 'Evaluation Brief',
  propose_acceptance_criteria: 'Acceptance Criteria',
};

/** Accepting a proposal is the same write a person's own form makes, marked as the assistant's. */
async function acceptProposal(step: EvaluatedStep, proposal: DecidableProposal): Promise<unknown> {
  switch (proposal.tool) {
    case 'propose_evaluator': {
      const { rationale: _rationale, ...evaluator } = proposal.arguments;
      return mediforce.evaluation.createEvaluator({ ...step, ...evaluator, origin: 'assistant' });
    }
    case 'propose_evaluator_version': {
      const { rationale: _rationale, ...version } = proposal.arguments;
      return mediforce.evaluation.addEvaluatorVersion({ ...version, origin: 'assistant' });
    }
    case 'propose_eval_case': {
      const { agentRunId, input, name, notes, split } = proposal.arguments;
      return agentRunId !== undefined
        ? mediforce.evaluation.createCaseFromAgentRun({ agentRunId, step, name, notes, split, origin: 'assistant' })
        : mediforce.evaluation.createCase({ ...step, name, input: input!, notes: notes ?? null, split, origin: 'assistant' });
    }
    case 'propose_perturbed_case': {
      const { rationale: _rationale, ...synthesized } = proposal.arguments;
      return mediforce.evaluation.createPerturbedCase({ ...step, ...synthesized, origin: 'assistant' });
    }
    case 'propose_brief':
      return mediforce.evaluation.setBrief({ ...step, text: proposal.arguments.text, origin: 'assistant' });
    case 'propose_acceptance_criteria':
      return mediforce.evaluation.setAcceptanceCriteria({ ...step, criteria: proposal.arguments.criteria, origin: 'assistant' });
  }
}

/** What trying a proposed check on the step's real outputs showed. */
function SelfTestSummary({ selfTest }: { selfTest: EvaluatorSelfTest }) {
  if ('unavailable' in selfTest) {
    return <p className="mt-1 text-amber-700 dark:text-amber-300">Not tried on real outputs — {selfTest.unavailable}</p>;
  }
  const { results } = selfTest;
  if (results.length === 0) return <p className="mt-1 text-muted-foreground">No production outputs yet to try it on.</p>;
  const count = (passed: boolean | null) => results.filter((outcome) => outcome.passed === passed).length;
  return (
    <details className="mt-1" data-testid="proposal-self-test">
      <summary className="cursor-pointer text-muted-foreground">
        Tried on {results.length} recent output(s): {count(true)} pass · {count(false)} fail · {count(null)} error
      </summary>
      <ul className="mt-1 space-y-0.5">
        {results.map((outcome) => (
          <li key={outcome.agentRunId}>
            <span className="font-mono">{outcome.agentRunId.slice(0, 8)}</span>{' '}
            <span className={cn(outcome.passed === true ? 'text-green-700 dark:text-green-400' : outcome.passed === false ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-300')}>
              {outcome.passed === null ? 'error' : outcome.passed ? 'pass' : 'fail'}
            </span>
            {(outcome.error ?? outcome.comment) !== null && <span className="text-muted-foreground"> — {outcome.error ?? outcome.comment}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function perturbedCaseSummary(proposal: Proposal<'propose_perturbed_case'>['arguments']): string {
  const changes = [
    ...(proposal.inputChanges ?? []).map((change) => `${change.op} ${[change.part, ...change.path].join('.')}`),
    ...(proposal.fileChanges ?? []).map((change) => `${change.op} ${change.path}`),
  ];
  return [
    `${proposal.name} — ${proposal.perturbation.kind.replace(/_/g, ' ')}: ${proposal.perturbation.description}`,
    `From run ${proposal.baseAgentRunId.slice(0, 8)}: ${changes.join('; ')}`,
    proposal.notes,
  ].join('\n');
}

function ProposalSummary({ step, proposal }: { step: EvaluatedStep; proposal: DecidableProposal }) {
  const evaluators = useStepEvaluators(step);
  switch (proposal.tool) {
    case 'propose_brief':
      return <>{proposal.arguments.text}</>;
    case 'propose_evaluator':
      return (
        <>
          {proposal.arguments.name} ({proposal.arguments.check.kind}, {proposal.arguments.severity}) — {proposal.arguments.rule}
          {proposal.arguments.runInProduction === true && '\nAlso runs in production once trusted.'}
        </>
      );
    case 'propose_evaluator_version': {
      const { evaluatorId, rule, severity, check, rationale } = proposal.arguments;
      const evaluator = evaluators.data?.evaluators.find((candidate) => candidate.id === evaluatorId);
      const changes = [rule !== undefined && `rule: ${rule}`, severity !== undefined && `severity: ${severity}`, check !== undefined && `a new ${check.kind} check`]
        .filter((change) => change !== false);
      return (
        <>
          {evaluator === undefined ? evaluatorId.slice(0, 8) : `${evaluator.name} v${evaluator.latest.version + 1}`} — {changes.join('; ')}
          {rationale !== undefined && `\n${rationale}`}
        </>
      );
    }
    case 'propose_eval_case':
      return <>{proposal.arguments.name}{proposal.arguments.notes === undefined || proposal.arguments.notes === null ? '' : ` — ${proposal.arguments.notes}`}</>;
    case 'propose_perturbed_case':
      return <>{perturbedCaseSummary(proposal.arguments)}</>;
    case 'propose_acceptance_criteria':
      return <>{describeAcceptanceCriteria(proposal.arguments.criteria)}{`\n${proposal.arguments.rationale}`}</>;
  }
}

export function ProposalCard({ step, state, mayEdit, editReason, onDecided }: {
  step: EvaluatedStep;
  state: { proposal: DecidableProposal; status: ProposalStatus };
  mayEdit: boolean;
  editReason: string | undefined;
  onDecided: (status: ProposalStatus) => void;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const accept = useStepEvaluationMutation(step, (proposal: DecidableProposal) => acceptProposal(step, proposal));
  const { proposal } = state;

  const onAccept = () => {
    let decided = proposal;
    if (editing !== null) {
      try {
        decided = { tool: proposal.tool, arguments: JSON.parse(editing) } as DecidableProposal;
      } catch {
        setError('Not valid JSON.');
        return;
      }
    }
    setError(null);
    accept.mutate(decided, {
      onSuccess: () => onDecided('accepted'),
      onError: (err) => setError(err.message),
    });
  };

  return (
    <div className="rounded-md border bg-background p-2.5 text-xs" data-testid="proposal-card">
      <div className="mb-1 font-medium">Proposed {TITLES[proposal.tool]}</div>
      {editing === null ? (
        proposal.tool === 'propose_brief'
          ? <MarkdownPresentation content={proposal.arguments.text} />
          : <p className="whitespace-pre-wrap text-muted-foreground"><ProposalSummary step={step} proposal={proposal} /></p>
      ) : (
        <textarea className="w-full min-h-32 rounded border bg-background p-1.5 font-mono" value={editing} onChange={(event) => setEditing(event.target.value)} />
      )}
      {proposal.selfTest !== undefined && (editing === null || editing === JSON.stringify(proposal.arguments, null, 2)) && <SelfTestSummary selfTest={proposal.selfTest} />}
      {error !== null && <p className="mt-1 text-destructive">{error}</p>}
      {state.status === 'open' ? (
        <div className="mt-2 flex gap-1.5">
          <InstantTooltip label={editReason}>
            <span className="inline-flex">
              <button type="button" data-testid="proposal-accept" className={primaryButtonClass} disabled={mayEdit === false || accept.isPending} onClick={onAccept}>
                <Check className="h-3 w-3" />Accept
              </button>
            </span>
          </InstantTooltip>
          {mayEdit && editing === null && (
            <button type="button" className={buttonClass} onClick={() => setEditing(JSON.stringify(proposal.arguments, null, 2))}>Edit</button>
          )}
          <button type="button" className={buttonClass} onClick={() => onDecided('rejected')}>
            <X className="h-3 w-3" />Reject
          </button>
        </div>
      ) : (
        <p className={cn('mt-1.5 font-medium', state.status === 'accepted' ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>
          {state.status === 'accepted' ? 'Accepted' : 'Rejected'}
        </p>
      )}
    </div>
  );
}

const SEVERITY_CLASSES = {
  critical: 'bg-red-500/10 text-red-700 dark:text-red-400',
  major: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  minor: 'bg-muted text-muted-foreground',
} as const;

/**
 * An evaluation plan, its risks highest first. It creates nothing: the person
 * picks a risk and the assistant drafts, previews and proposes its check.
 */
export function PlanCard({ step, plan, onDraft, busy, mayEdit, editReason }: {
  step: EvaluatedStep;
  plan: Proposal<'propose_evaluation_plan'>['arguments'];
  onDraft: (message: string) => void;
  busy: boolean;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const { acceptanceCriteria: criteria } = plan;
  const adopt = useStepEvaluationMutation(step, () => mediforce.evaluation.setAcceptanceCriteria({
    ...step,
    criteria: { critical: { minPassRate: criteria.critical }, major: { minPassRate: criteria.major }, minor: { minPassRate: criteria.minor } },
    origin: 'assistant',
  }));
  return (
    <div className="rounded-md border bg-background p-2.5 text-xs" data-testid="plan-card">
      <div className="mb-1 font-medium">Evaluation plan</div>
      <p className="whitespace-pre-wrap text-muted-foreground">{plan.summary}</p>
      <ol className="mt-2 space-y-2">
        {plan.risks.map((risk, index) => (
          <li key={index} className="border-t pt-2 first:border-t-0 first:pt-0" data-testid="plan-risk">
            <div className="flex items-start gap-1.5">
              <span className="font-medium">{index + 1}.</span>
              <span className={cn('rounded px-1.5 text-[11px]', SEVERITY_CLASSES[risk.severity])}>{risk.severity}</span>
              <span className="font-medium">{risk.failure}</span>
            </div>
            <p className="mt-0.5 text-muted-foreground">{risk.why}</p>
            <p className="mt-0.5"><span className="text-muted-foreground">Check ({risk.check.kind}):</span> {risk.check.rule}</p>
            {risk.cases !== undefined && risk.cases.length > 0 && (
              <ul className="mt-0.5 list-disc pl-4 text-muted-foreground">{risk.cases.map((evalCase) => <li key={evalCase}>{evalCase}</li>)}</ul>
            )}
            <button
              type="button"
              className={cn(buttonClass, 'mt-1')}
              disabled={busy}
              onClick={() => onDraft(`Draft and preview the check for risk ${index + 1} of the plan — "${risk.failure}" (${risk.severity}), as a ${risk.check.kind} check: ${risk.check.rule}`)}
            >Draft this check</button>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-muted-foreground">
        Suggested Acceptance Criteria — minimum pass rate on its Wilson 95% lower bound: critical {criteria.critical}, major {criteria.major}, minor {criteria.minor}.
        The next Eval Run prepared is judged against the criteria set then.
      </p>
      <div className="mt-1 flex items-center gap-1.5">
        <InstantTooltip label={editReason}>
          <span className="inline-flex">
            <button type="button" className={buttonClass} disabled={mayEdit === false || adopt.isPending || adopt.isSuccess} onClick={() => adopt.mutate(undefined)}>
              {adopt.isSuccess ? 'Criteria set' : 'Use as Acceptance Criteria'}
            </button>
          </span>
        </InstantTooltip>
        {adopt.error !== null && <span className="text-destructive">{adopt.error.message}</span>}
      </div>
    </div>
  );
}

/**
 * The assistant's routing recommendation after an Eval Run: a Control Mode
 * and, for Control Mode 4, the confidence below which the step's fallback takes over.
 * The person applies it in the workflow editor; neither setting is part of
 * the Step Fingerprint, so applying it keeps a qualification.
 */
export function ControlSettingsCard({ proposal }: { proposal: Proposal<'propose_control_settings'>['arguments'] }) {
  return (
    <div className="rounded-md border bg-background p-2.5 text-xs" data-testid="control-settings-card">
      <div className="mb-1 font-medium">
        Recommended routing: <ControlModeBadge executor="agent" autonomyLevel={proposal.autonomyLevel} showNumber />
      </div>
      {proposal.confidenceThreshold !== undefined && (
        <p>Confidence threshold {proposal.confidenceThreshold}: below it, the step&apos;s fallbackBehavior applies.</p>
      )}
      <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{proposal.rationale}</p>
      <p className="mt-1 text-muted-foreground">
        From Eval Run <span className="font-mono">{proposal.evalRunId.slice(0, 8)}</span>, variant {proposal.variantId}. Apply it in the workflow editor;
        Control Mode and confidence threshold are not part of the Step Fingerprint, so a qualification stays valid.
      </p>
    </div>
  );
}

/**
 * Calibration help (ADR-0023 D9, EvalGen): the outputs the assistant picked
 * for the person to label. The person labels — the assistant never does —
 * refines the rule as the labels show what it should mean, calibrates a judge
 * against the labels, and can keep the labelled outputs as Eval Cases.
 */
export function LabellingCard({ step, proposal, mayEdit, editReason }: {
  step: EvaluatedStep;
  proposal: Proposal<'propose_outputs_to_label'>['arguments'];
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const evaluators = useStepEvaluators(step);
  const labels = useEvaluatorLabels(step, proposal.evaluatorId);
  const evaluator = evaluators.data?.evaluators.find((candidate) => candidate.id === proposal.evaluatorId);
  const [refining, setRefining] = React.useState<{ rule: string; rubric: string } | null>(null);
  const refine = useStepEvaluationMutation(step, (draft: { rule: string; rubric: string }) => {
    if (evaluator === undefined) throw new Error('That Evaluator is no longer live.');
    const check = evaluator.latest.check;
    return mediforce.evaluation.addEvaluatorVersion({
      evaluatorId: proposal.evaluatorId,
      rule: draft.rule,
      ...(check.kind === 'llm_judge' && draft.rubric !== check.rubric ? { check: { ...check, rubric: draft.rubric } } : {}),
    });
  });
  const seed = useStepEvaluationMutation(step, () => mediforce.evaluation.createCasesFromLabels({ evaluatorId: proposal.evaluatorId }));

  if (evaluator === undefined) {
    return <div className="rounded-md border bg-background p-2.5 text-xs text-muted-foreground">{evaluators.isLoading ? 'Loading…' : 'That Evaluator is no longer live.'}</div>;
  }
  const byRun = labelsBySubject(labels.data?.labels ?? []);
  const all = [...byRun.values()];
  const failures = all.filter((label) => label.passed === false).length;
  const check = evaluator.latest.check;
  const actionError = seed.error;
  const refinedUnchanged = refining !== null
    && refining.rule.trim() === evaluator.latest.rule
    && (check.kind !== 'llm_judge' || refining.rubric === check.rubric);

  return (
    <div className="rounded-md border bg-background p-2.5 text-xs" data-testid="labelling-card">
      <div className="mb-1 font-medium">Label outputs for {evaluator.name} v{evaluator.latest.version}</div>
      {refining === null ? (
        <div className="space-y-0.5">
          <p>{evaluator.latest.rule}</p>
          {check.kind === 'llm_judge' && <p className="whitespace-pre-wrap text-muted-foreground">Question for the judge: {check.rubric}</p>}
          {mayEdit && (
            <button type="button" className={buttonClass} onClick={() => setRefining({ rule: evaluator.latest.rule, rubric: check.kind === 'llm_judge' ? check.rubric : '' })}>
              Refine the rule
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <textarea aria-label="Rule" className="w-full min-h-12 rounded border bg-background p-1.5" value={refining.rule} onChange={(event) => setRefining({ ...refining, rule: event.target.value })} />
          {check.kind === 'llm_judge' && (
            <textarea aria-label="Question for the judge" className="w-full min-h-20 rounded border bg-background p-1.5" value={refining.rubric} onChange={(event) => setRefining({ ...refining, rubric: event.target.value })} />
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={refining.rule.trim() === '' || refinedUnchanged || refine.isPending}
              onClick={() => refine.mutate(refining, { onSuccess: () => setRefining(null) })}
            >Save as v{evaluator.latest.version + 1}</button>
            <button type="button" className={buttonClass} onClick={() => setRefining(null)}>Cancel</button>
          </div>
          {refine.error !== null && <p className="text-destructive">{refine.error.message}</p>}
        </div>
      )}
      <ul className="mt-2 space-y-2">
        {proposal.outputs.map((output) => (
          <LabelOutputRow key={output.agentRunId} step={step} evaluatorId={proposal.evaluatorId} agentRunId={output.agentRunId} note={output.why} label={byRun.get(output.agentRunId)} mayEdit={mayEdit} />
        ))}
      </ul>
      <p className="mt-2 text-muted-foreground" data-testid="label-counts">
        {all.length} output(s) labelled, {failures} fail{check.kind === 'llm_judge'
          ? ` — a judge counts after ${JUDGE_MIN_LABELS} labels, ${JUDGE_MIN_FAILURE_LABELS} of them failures, at agreement ${JUDGE_MIN_AGREEMENT} or better`
          : ''}.
      </p>
      {seed.data !== undefined && (
        <div className="mt-0.5 text-muted-foreground" data-testid="cases-from-labels-result">
          <p>{seed.data.cases.length} Eval Case(s) added{seed.data.skipped.length > 0 ? `, ${seed.data.skipped.length} skipped:` : '.'}</p>
          {seed.data.skipped.length > 0 && (
            <ul className="list-disc pl-4">
              {seed.data.skipped.map((skipped) => <li key={skipped.agentRunId}><span className="font-mono">{skipped.agentRunId.slice(0, 8)}</span> — {skipped.reason}</li>)}
            </ul>
          )}
        </div>
      )}
      {actionError !== null && <p className="mt-0.5 text-destructive">{actionError.message}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {check.kind === 'llm_judge' && <CalibrateAction step={step} evaluator={evaluator} labelCount={all.length} mayEdit={mayEdit} editReason={editReason} />}
        <InstantTooltip label={editReason}>
          <span className="inline-flex">
            <button type="button" className={buttonClass} disabled={mayEdit === false || all.length === 0 || seed.isPending} onClick={() => seed.mutate(undefined)}>
              Add labelled outputs as Eval Cases
            </button>
          </span>
        </InstantTooltip>
      </div>
    </div>
  );
}

/**
 * Outputs the assistant drafted for a judge (ADR-0023 D9) — real runs' results
 * changed to break the rule, where production has too few failures. The
 * person labels each one pass or fail, which saves it as a written output;
 * the assistant never labels.
 */
export function DraftedOutputsCard({ step, proposal, stepOutputSchema, mayEdit }: {
  step: EvaluatedStep;
  proposal: Proposal<'propose_written_outputs'>['arguments'];
  stepOutputSchema: AgentOutputSchema | undefined;
  mayEdit: boolean;
}) {
  const evaluators = useStepEvaluators(step);
  const evaluator = evaluators.data?.evaluators.find((candidate) => candidate.id === proposal.evaluatorId);
  return (
    <div className="rounded-md border bg-background p-2.5 text-xs" data-testid="drafted-outputs-card">
      <div className="mb-1 font-medium">Draft outputs to label{evaluator === undefined ? '' : ` for ${evaluator.name}`}</div>
      <p className="text-muted-foreground">
        Changed from real runs to break the rule. Label each one yourself: it is saved as a written example and counts toward calibrating the judge. Open &ldquo;Edit the output&rdquo; to adjust a draft first.
      </p>
      <ul className="mt-2 space-y-2">
        {proposal.outputs.map((draft, index) => (
          <DraftedOutput key={index} step={step} evaluatorId={proposal.evaluatorId} draft={draft} stepOutputSchema={stepOutputSchema} mayEdit={mayEdit} />
        ))}
      </ul>
    </div>
  );
}

const ROOT_CAUSE_LABELS = {
  ambiguous_instruction: 'Ambiguous instruction',
  missing_context: 'Missing context',
  tool_problem: 'Tool problem',
  model_capability: 'Model capability',
  evaluator_wrong: 'The Evaluator is wrong',
} as const;

const FIX_KIND_LABELS = {
  instruction: 'Change the instruction',
  examples: 'Add examples',
  guardrail: 'Add a guardrail',
  model: 'Change the model',
  tools: 'Change the tools',
  preprocessing_step: 'Add a preprocessing step',
  control_mode: 'Change the Control Mode',
  evaluator: 'Fix the Evaluator',
} as const;

/**
 * Failures of an Eval Run clustered by root cause (ADR-0023 D12). Nothing to
 * accept: each cluster names its fix in words.
 */
export function DiagnosisCard({ diagnosis }: { diagnosis: Proposal<'propose_diagnosis'>['arguments'] }) {
  return (
    <div className="rounded-md border bg-background p-2.5 text-xs" data-testid="diagnosis-card">
      <div className="mb-1 font-medium">
        Diagnosis of Eval Run <span className="font-mono">{diagnosis.evalRunId.slice(0, 8)}</span>, variant {diagnosis.variantId}
      </div>
      <ol className="space-y-2">
        {diagnosis.clusters.map((cluster, index) => (
          <li key={index} className="border-t pt-2 first:border-t-0 first:pt-0" data-testid="diagnosis-cluster">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-muted px-1.5 text-[11px]">{ROOT_CAUSE_LABELS[cluster.rootCause]}</span>
              <span className="font-medium">{cluster.summary}</span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{cluster.evidence}</p>
            <p className="mt-0.5 text-muted-foreground">{cluster.trialIds.length} trial(s)</p>
            <p className="mt-0.5"><span className="text-muted-foreground">{FIX_KIND_LABELS[cluster.fix.kind]}:</span> {cluster.fix.description}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
