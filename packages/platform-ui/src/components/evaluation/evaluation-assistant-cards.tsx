'use client';

import * as React from 'react';
import { Check, Eye, X } from 'lucide-react';
import {
  describeAcceptanceCriteria,
  type EvalCaseExpectation,
  type EvalCaseInput,
  type EvaluationSubject,
} from '@mediforce/platform-core';
import type { EvaluatorSelfTest, GetAgentRunIoOutput, ProposalView } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useAgentRunIo, useStepEvaluationMutation, useStepEvaluators } from '@/hooks/use-step-evaluation';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { ControlModeBadge } from '@/components/ui/control-mode-badge';
import { MarkdownPresentation } from '@/components/tasks/markdown-presentation';
import { CaseDialog, CaseForm, outputText, type CaseFormResult } from './step-evaluation-sections';

export type ProposalStatus = 'open' | 'accepted' | 'rejected';

type Proposal<Tool extends ProposalView['tool']> = Extract<ProposalView, { tool: Tool }>;

/**
 * The proposals a person accepts or rejects as they stand. A plan is worked
 * through instead; a routing recommendation is applied in the workflow editor.
 */
type DecidableProposal = Exclude<ProposalView, { tool: 'propose_evaluation_plan' | 'propose_control_settings' | 'propose_diagnosis' }>;

export function isDecidable(proposal: ProposalView): proposal is DecidableProposal {
  return proposal.tool !== 'propose_evaluation_plan'
    && proposal.tool !== 'propose_control_settings'
    && proposal.tool !== 'propose_diagnosis';
}

const buttonClass = 'inline-flex items-center gap-1 rounded border px-2 py-0.5 disabled:opacity-50 disabled:pointer-events-none';
const primaryButtonClass = 'inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-primary-foreground disabled:opacity-50 disabled:pointer-events-none';

const TITLES: Record<DecidableProposal['tool'], string> = {
  propose_evaluator: 'Evaluator',
  propose_evaluator_version: 'Evaluator version',
  propose_eval_case: 'Eval Case',
  propose_perturbed_case: 'Eval Case',
  propose_brief: 'Evaluation Brief',
  propose_acceptance_criteria: 'Acceptance Criteria',
};

/** Accepting a proposal is the same write a person's own form makes, marked as the assistant's. */
async function acceptProposal(step: EvaluationSubject, proposal: DecidableProposal): Promise<unknown> {
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
      const { agentRunId, input, containsProductionData, rationale: _rationale, ...written } = proposal.arguments;
      return agentRunId !== undefined
        ? mediforce.evaluation.createCaseFromAgentRun({ agentRunId, ...(step.kind === 'step' ? { step } : {}), ...written, origin: 'assistant' })
        : mediforce.evaluation.createCase({ ...step, ...written, input: input!, ...(containsProductionData === undefined ? {} : { containsProductionData }), origin: 'assistant' });
    }
    case 'propose_perturbed_case': {
      const { rationale: _rationale, ...synthesized } = proposal.arguments;
      // The assistant proposes no perturbed case for an Agent, which has no production run to perturb (ADR-0029).
      if (step.kind === 'agent') throw new Error('An agent evaluated on its own has no production run to perturb');
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

/** How a case's output is held to its expected output, e.g. "Must match, exactly". */
function expectationPhrase(proposal: { expectation?: string; comparison?: string }): string {
  const how = proposal.comparison === 'agreement' ? 'by agreement score' : 'exactly';
  return `${proposal.expectation === 'negative' ? 'Must not match' : 'Must match'}, ${how}`;
}

type CaseProposal = Extract<DecidableProposal, { tool: 'propose_eval_case' | 'propose_perturbed_case' }>;

interface ProposedCaseContent {
  input: EvalCaseInput;
  /** Null: no expected output, only the Evaluators grade the case. */
  expectedOutput: unknown;
  expectation: EvalCaseExpectation;
}

/**
 * The input and expected output a proposed case is stored with — for a case
 * from a run, the run's input and, once a person reviewed it, its output, as
 * creating the case from the run takes them; for one synthesized from a run,
 * the input its changes make of the run's. Null while the run loads.
 */
function proposedCaseContent(proposal: CaseProposal, sourceRun: GetAgentRunIoOutput | undefined): ProposedCaseContent | null {
  if (proposal.tool === 'propose_perturbed_case') {
    const { expectedOutput, expectation } = proposal.arguments;
    return proposal.caseInput === undefined ? null : { input: proposal.caseInput, expectedOutput: expectedOutput ?? null, expectation };
  }
  const args = proposal.arguments;
  if (args.agentRunId === undefined) {
    return { input: args.input!, expectedOutput: args.expectedOutput ?? null, expectation: args.expectation ?? 'positive' };
  }
  if (sourceRun === undefined) return null;
  const fromRun = args.expectedOutput === undefined;
  return {
    input: args.input ?? sourceRun.caseInput,
    expectedOutput: fromRun ? (sourceRun.verdictExpectation === null ? null : sourceRun.result ?? null) : args.expectedOutput,
    expectation: args.expectation ?? (fromRun ? sourceRun.verdictExpectation : null) ?? 'positive',
  };
}

/** JSON cut to a few lines, fading out where it runs on; Review shows it whole. */
function JsonPreview({ value, testId }: { value: unknown; testId: string }) {
  const ref = React.useRef<HTMLPreElement>(null);
  const [overflows, setOverflows] = React.useState(false);
  const text = JSON.stringify(value, null, 2);
  React.useLayoutEffect(() => {
    if (ref.current !== null) setOverflows(ref.current.scrollHeight > ref.current.clientHeight);
  }, [text]);
  return (
    <pre
      ref={ref}
      data-testid={testId}
      className={cn(
        'max-h-28 overflow-hidden whitespace-pre-wrap break-all rounded bg-muted/50 p-1.5 font-mono text-[11px]',
        overflows && '[mask-image:linear-gradient(to_bottom,black_65%,transparent)]',
      )}
    >{text}</pre>
  );
}

/** A proposed Eval Case as it would be stored: where it comes from, why, its input and its expected output. */
function ProposedCaseBody({ proposal, content, loadError }: {
  proposal: CaseProposal;
  content: ProposedCaseContent | null;
  /** Why the case's input could not be shown. */
  loadError: string | null;
}) {
  const { arguments: args } = proposal;
  const tags = proposal.tool === 'propose_perturbed_case'
    ? [`Edge case of run ${proposal.arguments.baseAgentRunId.slice(0, 8)}`, proposal.arguments.perturbation.kind.replace(/_/g, ' ')]
    : [proposal.arguments.agentRunId === undefined ? 'Written input' : `From run ${proposal.arguments.agentRunId.slice(0, 8)}`];
  const notes = [proposal.tool === 'propose_perturbed_case' ? proposal.arguments.perturbation.description : undefined, args.rationale]
    .filter((note) => note !== undefined);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{args.name}</span>
        {[...tags, ...(args.split === undefined ? [] : [args.split])].map((tag) => (
          <span key={tag} className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{tag}</span>
        ))}
      </div>
      {notes.map((note) => <p key={note} className="whitespace-pre-wrap text-muted-foreground">{note}</p>)}
      {content === null ? (
        loadError === null
          ? <p className="text-muted-foreground">Loading the run&apos;s input and output…</p>
          : <p className="text-destructive" data-testid="proposed-case-load-error">{loadError}</p>
      ) : (
        <>
          <div className="space-y-0.5">
            <div className="font-medium">Input</div>
            <JsonPreview value={content.input} testId="proposed-case-input" />
          </div>
          <div className="space-y-0.5">
            <div className="font-medium">
              Expected output
              {content.expectedOutput !== null && <span className="font-normal text-muted-foreground"> · {expectationPhrase({ ...args, expectation: content.expectation })}</span>}
            </div>
            {content.expectedOutput === null
              ? <p className="text-muted-foreground" data-testid="proposed-case-output">None — only the Evaluators grade it</p>
              : <JsonPreview value={content.expectedOutput} testId="proposed-case-output" />}
          </div>
        </>
      )}
    </div>
  );
}

/** Adds a proposed case as a person edited it on Review, still the assistant's; a synthesized one keeps its file changes. */
function createReviewedCase(step: EvaluationSubject, proposal: CaseProposal, values: CaseFormResult): Promise<unknown> {
  if (proposal.tool === 'propose_perturbed_case') {
    const { rationale: _rationale, ...synthesized } = proposal.arguments;
    if (step.kind === 'agent') throw new Error('An agent evaluated on its own has no production run to perturb');
    return mediforce.evaluation.createPerturbedCase({ ...step, ...synthesized, ...values, origin: 'assistant' });
  }
  const { agentRunId, containsProductionData } = proposal.arguments;
  return agentRunId !== undefined
    ? mediforce.evaluation.createCaseFromAgentRun({ agentRunId, ...(step.kind === 'step' ? { step } : {}), ...values, origin: 'assistant' })
    : mediforce.evaluation.createCase({
      ...step,
      ...values,
      ...(containsProductionData === undefined ? {} : { containsProductionData }),
      origin: 'assistant',
    });
}

function reviewInputHelp(proposal: CaseProposal): string {
  if (proposal.tool === 'propose_perturbed_case') return 'The run\'s input with the assistant\'s changes.';
  return proposal.arguments.agentRunId === undefined ? 'The input the assistant wrote.' : 'What the step received in this run.';
}

/** The proposed case in the form a person adds cases with; accepting it there adds it as edited, still the assistant's. */
function ReviewProposedCase({ step, proposal, content, mayEdit, onAccepted, onClose }: {
  step: EvaluationSubject;
  proposal: CaseProposal;
  content: ProposedCaseContent;
  mayEdit: boolean;
  onAccepted: () => void;
  onClose: () => void;
}) {
  const evaluators = useStepEvaluators(step).data?.evaluators ?? [];
  const accept = useStepEvaluationMutation(step, (values: CaseFormResult) => createReviewedCase(step, proposal, values));
  const { arguments: args } = proposal;
  return (
    <CaseDialog title="Review the proposed Eval Case" description="Edit it if it needs it; Accept adds it as it stands here." onClose={onClose}>
      <CaseForm
        initial={{
          name: args.name,
          split: args.split ?? 'dev',
          input: JSON.stringify(content.input, null, 2),
          expectedOutput: outputText(content.expectedOutput),
          expectation: content.expectation,
          comparison: args.comparison ?? 'exact',
          agreementInstructions: args.agreementInstructions ?? '',
          evaluatorIds: null,
        }}
        inputHelp={reviewInputHelp(proposal)}
        evaluators={evaluators}
        sourceAgentRunId={proposal.tool === 'propose_eval_case' ? proposal.arguments.agentRunId ?? null : null}
        submitLabel="Accept"
        pending={mayEdit === false || accept.isPending}
        error={accept.error?.message ?? null}
        onSubmit={(values) => accept.mutate(values, { onSuccess: onAccepted })}
        onCancel={onClose}
      />
    </CaseDialog>
  );
}

function ProposalSummary({ step, proposal }: { step: EvaluationSubject; proposal: DecidableProposal }) {
  const evaluators = useStepEvaluators(step);
  switch (proposal.tool) {
    case 'propose_brief':
      return <>{proposal.arguments.text}</>;
    case 'propose_evaluator':
      return (
        <>
          {proposal.arguments.name} ({proposal.arguments.check.kind}) — {proposal.arguments.rule}
          {proposal.arguments.runInProduction === true && '\nAlso runs in production once trusted.'}
        </>
      );
    case 'propose_evaluator_version': {
      const { evaluatorId, rule, check, rationale } = proposal.arguments;
      const evaluator = evaluators.data?.evaluators.find((candidate) => candidate.id === evaluatorId);
      const changes = [rule !== undefined && `rule: ${rule}`, check !== undefined && `a new ${check.kind} check`]
        .filter((change) => change !== false);
      return (
        <>
          {evaluator === undefined ? evaluatorId.slice(0, 8) : `${evaluator.name} v${evaluator.latest.version + 1}`} — {changes.join('; ')}
          {rationale !== undefined && `\n${rationale}`}
        </>
      );
    }
    case 'propose_acceptance_criteria':
      return <>{describeAcceptanceCriteria(proposal.arguments.criteria)}{`\n${proposal.arguments.rationale}`}</>;
  }
}

function isCaseProposal(proposal: DecidableProposal): proposal is CaseProposal {
  return proposal.tool === 'propose_eval_case' || proposal.tool === 'propose_perturbed_case';
}

function caseLoadError(proposal: CaseProposal, sourceRun: { isError: boolean; error: unknown }): string | null {
  if (proposal.tool === 'propose_perturbed_case') return proposal.caseInput === undefined ? 'The input its changes make could not be worked out.' : null;
  if (sourceRun.isError === false) return null;
  return sourceRun.error instanceof Error ? sourceRun.error.message : 'The run\'s input and output could not be loaded.';
}

const CASE_LABELS = [
  { id: 'positive', label: 'Positive' },
  { id: 'negative', label: 'Negative' },
  { id: 'none', label: 'No expected output' },
] as const;
type CaseLabel = (typeof CASE_LABELS)[number]['id'];

/** The proposal as the person labelled it: its expected output to match, to avoid, or dropped; null leaves it as proposed. */
function relabelled(proposal: DecidableProposal, label: CaseLabel | null): DecidableProposal {
  if (label === null) return proposal;
  if (proposal.tool === 'propose_perturbed_case') {
    return { ...proposal, arguments: label === 'none' ? { ...proposal.arguments, expectedOutput: null } : { ...proposal.arguments, expectation: label } };
  }
  if (proposal.tool !== 'propose_eval_case') return proposal;
  const { expectation: _expectation, ...args } = proposal.arguments;
  return { ...proposal, arguments: label === 'none' ? { ...args, expectedOutput: null } : { ...args, expectation: label } };
}

export function ProposalCard({ step, state, mayEdit, editReason, onDecided }: {
  step: EvaluationSubject;
  state: { proposal: DecidableProposal; status: ProposalStatus };
  mayEdit: boolean;
  editReason: string | undefined;
  onDecided: (status: ProposalStatus) => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const accept = useStepEvaluationMutation(step, (proposal: DecidableProposal) => acceptProposal(step, proposal));
  const [caseLabel, setCaseLabel] = React.useState<CaseLabel | null>(null);
  const [reviewing, setReviewing] = React.useState(false);
  const proposal = relabelled(state.proposal, caseLabel);
  const sourceRun = useAgentRunIo(state.proposal.tool === 'propose_eval_case' ? state.proposal.arguments.agentRunId ?? null : null);
  const proposedCase = isCaseProposal(state.proposal) ? proposedCaseContent(state.proposal, sourceRun.data) : null;
  const caseContent = isCaseProposal(proposal) ? proposedCaseContent(proposal, sourceRun.data) : null;
  const proposedLabel = proposedCase === null || proposedCase.expectedOutput === null ? null : proposedCase.expectation;
  const shownLabel = caseLabel ?? proposedLabel;

  const onAccept = () => {
    setError(null);
    accept.mutate(proposal, {
      onSuccess: () => onDecided('accepted'),
      onError: (err) => setError(err.message),
    });
  };

  return (
    <div className="rounded-md border bg-background p-2.5 text-xs" data-testid="proposal-card">
      <div className="mb-1 font-medium">Proposed {TITLES[proposal.tool]}</div>
      {proposal.tool === 'propose_brief' && <MarkdownPresentation content={proposal.arguments.text} />}
      {isCaseProposal(proposal) && <ProposedCaseBody
          proposal={proposal}
          content={caseContent}
          loadError={caseLoadError(proposal, sourceRun)}
        />}
      {proposal.tool !== 'propose_brief' && isCaseProposal(proposal) === false && (
        <p className="whitespace-pre-wrap text-muted-foreground"><ProposalSummary step={step} proposal={proposal} /></p>
      )}
      {proposal.selfTest !== undefined && <SelfTestSummary selfTest={proposal.selfTest} />}
      {proposedLabel !== null && state.status === 'open' && (
        <div role="group" aria-label="Expected output" className="mt-2 inline-flex overflow-hidden rounded border">
          {CASE_LABELS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={shownLabel === option.id}
              className={cn('px-2 py-0.5', shownLabel === option.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
              onClick={() => setCaseLabel(option.id)}
            >{option.label}</button>
          ))}
        </div>
      )}
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
          {isCaseProposal(proposal) && caseContent !== null && (
            <button type="button" className={buttonClass} onClick={() => setReviewing(true)}>
              <Eye className="h-3 w-3" />Review
            </button>
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
      {reviewing && isCaseProposal(proposal) && caseContent !== null && (
        <ReviewProposedCase
          step={step}
          proposal={proposal}
          content={caseContent}
          mayEdit={mayEdit}
          onAccepted={() => {
            setReviewing(false);
            onDecided('accepted');
          }}
          onClose={() => setReviewing(false)}
        />
      )}
    </div>
  );
}

/**
 * An evaluation plan, its risks highest first. It creates nothing: the person
 * picks a risk and the assistant drafts, previews and proposes its check.
 */
export function PlanCard({ step, plan, onDraft, busy, mayEdit, editReason }: {
  step: EvaluationSubject;
  plan: Proposal<'propose_evaluation_plan'>['arguments'];
  onDraft: (message: string) => void;
  busy: boolean;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const adopt = useStepEvaluationMutation(step, () => mediforce.evaluation.setAcceptanceCriteria({
    ...step,
    criteria: { minPassRate: plan.minPassRate },
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
              onClick={() => onDraft(`Draft and preview the check for risk ${index + 1} of the plan — "${risk.failure}", as a ${risk.check.kind} check: ${risk.check.rule}`)}
            >Draft this check</button>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-muted-foreground">
        Suggested Acceptance Criteria — every counted Evaluator passes at least {plan.minPassRate} of its graded trials.
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
 * The assistant's routing recommendation after an Eval Run: a Control Mode.
 * The person applies it in the workflow editor; it is not part of the Step
 * Fingerprint, so applying it keeps a qualification.
 */
export function ControlSettingsCard({ proposal }: { proposal: Proposal<'propose_control_settings'>['arguments'] }) {
  return (
    <div className="rounded-md border bg-background p-2.5 text-xs" data-testid="control-settings-card">
      <div className="mb-1 font-medium">
        Recommended routing: <ControlModeBadge executor="agent" autonomyLevel={proposal.autonomyLevel} showNumber />
      </div>
      <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{proposal.rationale}</p>
      <p className="mt-1 text-muted-foreground">
        From Eval Run <span className="font-mono">{proposal.evalRunId.slice(0, 8)}</span>. Apply it in the workflow editor;
        Control Mode is not part of the Step Fingerprint, so a qualification stays valid.
      </p>
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
        Diagnosis of Eval Run <span className="font-mono">{diagnosis.evalRunId.slice(0, 8)}</span>
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
