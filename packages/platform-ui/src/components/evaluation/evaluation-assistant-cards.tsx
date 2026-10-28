'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';
import {
  TASK_COMPLETION_SOURCE_LABELS,
  describeAcceptanceCriteria,
  taskCompletionEvaluator,
  type EvaluationSubject,
  type EvaluatorCheck,
  type TaskCompletionEvaluator,
} from '@mediforce/platform-core';
import type { EvaluatorSelfTest, ProposalView } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useStepEvaluationMutation, useStepEvaluators } from '@/hooks/use-step-evaluation';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { ControlModeBadge } from '@/components/ui/control-mode-badge';
import { MarkdownPresentation } from '@/components/tasks/markdown-presentation';

export type ProposalStatus = 'open' | 'accepted' | 'rejected';

type Proposal<Tool extends ProposalView['tool']> = Extract<ProposalView, { tool: Tool }>;

/**
 * The proposals a person accepts or rejects as they stand. A plan is worked
 * through instead; a routing recommendation is applied in the workflow
 * editor; drafted task-completion Evaluators get their own card (F1).
 */
type DecidableProposal = Exclude<ProposalView, { tool: 'propose_evaluation_plan' | 'propose_control_settings' | 'propose_diagnosis' | 'propose_task_completion_evaluators' }>;

export function isDecidable(proposal: ProposalView): proposal is DecidableProposal {
  return proposal.tool !== 'propose_evaluation_plan'
    && proposal.tool !== 'propose_control_settings'
    && proposal.tool !== 'propose_diagnosis'
    && proposal.tool !== 'propose_task_completion_evaluators';
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

/** What a proposed case expects of the output, in a line; null when it gives no expected output. */
function expectedOutputSummary(proposal: { expectedOutput?: unknown; expectation?: string; comparison?: string }): string | null {
  if (proposal.expectedOutput === undefined || proposal.expectedOutput === null) return null;
  const how = proposal.comparison === 'agreement' ? 'by agreement score' : 'exactly';
  return `${proposal.expectation === 'negative' ? 'Must not match' : 'Must match'}, ${how}: ${JSON.stringify(proposal.expectedOutput)}`;
}

function perturbedCaseSummary(proposal: Proposal<'propose_perturbed_case'>['arguments']): string {
  const changes = [
    ...(proposal.inputChanges ?? []).map((change) => `${change.op} ${[change.part, ...change.path].join('.')}`),
    ...(proposal.fileChanges ?? []).map((change) => `${change.op} ${change.path}`),
  ];
  return [
    `${proposal.name} — ${proposal.perturbation.kind.replace(/_/g, ' ')}: ${proposal.perturbation.description}`,
    `From run ${proposal.baseAgentRunId.slice(0, 8)}: ${changes.join('; ')}`,
    ...[expectedOutputSummary(proposal)].filter((line) => line !== null),
  ].join('\n');
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
    case 'propose_eval_case':
      return <>{[proposal.arguments.name, expectedOutputSummary(proposal.arguments)].filter((line) => line !== null).join('\n')}</>;
    case 'propose_perturbed_case':
      return <>{perturbedCaseSummary(proposal.arguments)}</>;
    case 'propose_acceptance_criteria':
      return <>{describeAcceptanceCriteria(proposal.arguments.criteria)}{`\n${proposal.arguments.rationale}`}</>;
  }
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
  const { proposal } = state;

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
      {proposal.tool === 'propose_brief'
        ? <MarkdownPresentation content={proposal.arguments.text} />
        : <p className="whitespace-pre-wrap text-muted-foreground"><ProposalSummary step={step} proposal={proposal} /></p>}
      {proposal.selfTest !== undefined && <SelfTestSummary selfTest={proposal.selfTest} />}
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

const CHECK_KIND_LABELS: Record<TaskCompletionEvaluator['check']['kind'], string> = {
  schema: 'schema',
  code: 'code',
  llm_judge: 'LLM judge',
};

function checkDetail(check: EvaluatorCheck): string {
  switch (check.kind) {
    case 'schema': return JSON.stringify(check.schema, null, 2);
    case 'code': return check.source;
    case 'llm_judge': return check.rubric;
    case 'expected_output': return check.instructions ?? '';
  }
}

/** One drafted task-completion Evaluator: its requirement, its check, what its self-test showed, and its own decision. */
function TaskCompletionEvaluatorRow({ step, drafted, selfTest, status, open, mayEdit, editReason, onDecided }: {
  step: EvaluationSubject;
  drafted: TaskCompletionEvaluator;
  selfTest: EvaluatorSelfTest | undefined;
  status: ProposalStatus;
  open: boolean;
  mayEdit: boolean;
  editReason: string | undefined;
  onDecided: (status: ProposalStatus) => void;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const evaluator = taskCompletionEvaluator(drafted);
  const accept = useStepEvaluationMutation(step, () => mediforce.evaluation.createEvaluator({ ...step, ...evaluator, origin: 'assistant' }));

  const onAccept = () => {
    setError(null);
    accept.mutate(undefined, { onSuccess: () => onDecided('accepted'), onError: (err) => setError(err.message) });
  };

  return (
    <li className="border-t pt-1.5 first:border-t-0 first:pt-0" data-testid="task-completion-evaluator">
      <div className="flex flex-wrap items-baseline gap-1">
        <span className="font-mono">{evaluator.name}</span>
        <span className="rounded bg-muted px-1 text-muted-foreground">{CHECK_KIND_LABELS[drafted.check.kind]}</span>
        <span className="text-muted-foreground">from the {TASK_COMPLETION_SOURCE_LABELS[drafted.source]}</span>
        {drafted.priority === 'high' && <span className="text-amber-700 dark:text-amber-300">— matters most</span>}
      </div>
      <p className="mt-0.5">{drafted.requirement}</p>
      <details className="mt-0.5">
        <summary className="cursor-pointer text-muted-foreground">{drafted.check.kind === 'llm_judge' ? 'Rubric' : 'Check'}</summary>
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted p-2 font-mono whitespace-pre-wrap">{checkDetail(evaluator.check)}</pre>
      </details>
      {drafted.check.kind === 'code' && <p className="mt-0.5 text-muted-foreground">Counts only once a person approves its source.</p>}
      {selfTest !== undefined && <SelfTestSummary selfTest={selfTest} />}
      {error !== null && <p className="mt-1 text-destructive">{error}</p>}
      {status === 'open' && open ? (
        <div className="mt-1 flex gap-1.5">
          <InstantTooltip label={editReason}>
            <span className="inline-flex">
              <button type="button" data-testid="proposal-accept" className={primaryButtonClass} disabled={mayEdit === false || accept.isPending} onClick={onAccept}>
                <Check className="h-3 w-3" />Accept
              </button>
            </span>
          </InstantTooltip>
          <button type="button" className={buttonClass} onClick={() => onDecided('rejected')}>
            <X className="h-3 w-3" />Reject
          </button>
        </div>
      ) : status !== 'open' && (
        <p className={cn('mt-1 font-medium', status === 'accepted' ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>
          {status === 'accepted' ? 'Accepted' : 'Rejected'}
        </p>
      )}
    </li>
  );
}

/**
 * The step's drafted task-completion Evaluators (epic #1516 F1): one per
 * requirement the assistant read off the step's instructions, each of its own
 * kind, so a failure names the requirement missed — plus any instruction it
 * could not turn into a testable rule. Each is accepted or rejected on its
 * own; accepting creates that Evaluator with production left opt-in.
 */
export function TaskCompletionEvaluatorsCard({ step, state, mayEdit, editReason, onDecided }: {
  step: EvaluationSubject;
  state: { proposal: Proposal<'propose_task_completion_evaluators'>; status: ProposalStatus };
  mayEdit: boolean;
  editReason: string | undefined;
  onDecided: (status: ProposalStatus) => void;
}) {
  const { proposal } = state;
  const { evaluators, vagueInstructions, rationale } = proposal.arguments;
  const [statuses, setStatuses] = React.useState<ProposalStatus[]>(() => evaluators.map(() => 'open'));

  // An accept resolves after other rows may have been decided, so each decision updates the latest statuses.
  const decideOne = (index: number, status: ProposalStatus) => {
    setStatuses((previous) => previous.map((current, position) => (position === index ? status : current)));
  };
  const allDecided = statuses.every((status) => status !== 'open');
  const anyAccepted = statuses.includes('accepted');
  React.useEffect(() => {
    if (allDecided && state.status === 'open') onDecided(anyAccepted ? 'accepted' : 'rejected');
  }, [allDecided, anyAccepted, state.status, onDecided]);

  return (
    <div className="rounded-md border bg-background p-2.5 text-xs" data-testid="task-completion-evaluators-card">
      <div className="mb-1 font-medium">Proposed task-completion Evaluators ({evaluators.length})</div>
      {rationale !== undefined && <p className="text-muted-foreground">{rationale}</p>}
      <ol className="mt-1.5 space-y-1.5">
        {evaluators.map((drafted, index) => (
          <TaskCompletionEvaluatorRow
            key={drafted.name}
            step={step}
            drafted={drafted}
            selfTest={proposal.selfTests?.[index]}
            status={statuses[index]!}
            open={state.status === 'open'}
            mayEdit={mayEdit}
            editReason={editReason}
            onDecided={(status) => decideOne(index, status)}
          />
        ))}
      </ol>
      {vagueInstructions.length > 0 && (
        <div className="mt-1.5 rounded bg-amber-500/10 p-1.5 text-amber-700 dark:text-amber-300" data-testid="task-completion-vague-instructions">
          No check can decide these consistently — sharpen the step&apos;s instructions:
          <ul className="mt-0.5 list-disc pl-4">
            {vagueInstructions.map((vague, index) => <li key={index}>&ldquo;{vague.quote}&rdquo; — {vague.why}</li>)}
          </ul>
        </div>
      )}
      {state.status !== 'open' && statuses.every((status) => status === 'open') && (
        <p className={cn('mt-1.5 font-medium', state.status === 'accepted' ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>
          {state.status === 'accepted' ? 'Accepted' : 'Rejected'}
        </p>
      )}
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
