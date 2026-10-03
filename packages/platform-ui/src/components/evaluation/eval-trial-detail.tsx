'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import type { EvalCase, EvaluatedStep, EvaluatorCheck, JudgeVerdict, StoredAgentTrajectoryEntry } from '@mediforce/platform-core';
import type { EvalTrialEvaluator, GetEvalTrialOutput } from '@mediforce/platform-api/contract';
import { routes } from '@/lib/routes';
import { formatCostUsd, formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEvalRun, useEvalTrial } from '@/hooks/use-step-evaluation';
import { useWorkflowEditGate } from '@/hooks/use-workflow-access';
import { OutcomeChip, TrialResultBadge, TrialStatusBadge } from './eval-run-badges';
import { describePatch } from './eval-run-report';
import { JudgeVerdictRow } from './judge-verdicts';
import { CHECK_KINDS, CheckDetails } from './evaluator-check-editor';
import { citationParts, citedEntries } from './judge-citations';

const preClass = 'max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-xs';

function json(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function Section({ id, title, description, children }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description !== undefined && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Panel({ title, children, className }: { title: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

/** A judge's text with every `[n]` that names an entry of the agent's log turned into a link to it. */
function withCitations(text: string, entries: ReadonlySet<number>): React.ReactNode[] {
  return citationParts(text, entries).map((part, index) => ('text' in part ? part.text : (
    <a key={index} href={`#log-entry-${part.seq}`} className="rounded bg-amber-500/15 px-0.5 font-mono text-amber-800 hover:underline dark:text-amber-300">
      [{part.seq}]
    </a>
  )));
}

/** What a check reads to decide, in words — every part of it is on this page. */
function readsOf(check: EvaluatorCheck, evalCase: EvalCase | null): string {
  switch (check.kind) {
    case 'schema':
      return 'Reads only the output, against the JSON Schema below.';
    case 'code':
      return 'Its script reads the output, the step\'s input, the agent\'s log and the Eval Case.';
    case 'llm_judge':
      return 'The judge model reads the step\'s input, the agent\'s whole log, the output and the agent\'s own summary — exactly the messages below — and answers this question.';
    case 'expected_output':
      return evalCase?.comparison === 'agreement'
        ? 'A model compares the output with the case\'s expected output, with the instructions below, and scores how far they agree.'
        : 'Compares the output with the case\'s expected output field by field; any difference fails it.';
  }
}

function JudgePrompt({ messages }: { messages: NonNullable<EvalTrialEvaluator['judgePrompt']> }) {
  return (
    <details className="text-xs" data-testid="judge-prompt">
      <summary className="cursor-pointer text-muted-foreground">What the model was sent ({messages.length} messages)</summary>
      <p className="mt-1 text-muted-foreground">
        Rebuilt from the Evaluator version frozen into this run and this trial&apos;s input, log and output, by the same code that sent it.
      </p>
      <div className="mt-2 space-y-2">
        {messages.map((message, index) => (
          <div key={index}>
            <p className="font-mono text-[11px] uppercase text-muted-foreground">{message.role}</p>
            <pre className={preClass}>{message.content}</pre>
          </div>
        ))}
      </div>
    </details>
  );
}

/** One Evaluator on this trial: what it looks for and reads, its verdict and why, and a person's review of a model's verdict. */
function EvaluatorResult({ entry, context }: {
  entry: EvalTrialEvaluator;
  context: {
    step: EvaluatedStep;
    evalRunId: string;
    output: GetEvalTrialOutput;
    verdicts: readonly JudgeVerdict[];
    logEntries: ReadonlySet<number>;
    mayEdit: boolean;
    editReason: string | undefined;
  };
}) {
  const { evaluator, check, score, outcome } = entry;
  const verdict = context.verdicts.find((candidate) => candidate.evaluatorId === evaluator.evaluatorId);
  const said = score?.comment ?? null;
  // Only a judge reads the numbered log; `[0]` in a check's comment is not a citation.
  const rendered = said === null || evaluator.kind !== 'llm_judge' ? said : withCitations(said, context.logEntries);
  return (
    <div className="space-y-3 rounded-md border p-4" id={`evaluator-${evaluator.evaluatorId}`} data-testid="trial-evaluator">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-sm font-medium">{evaluator.name}</span>
        <span className="text-xs text-muted-foreground">v{evaluator.version} · {evaluator.severity} · {CHECK_KINDS[evaluator.kind].label}</span>
        {evaluator.counted === false && <span className="text-xs text-amber-700 dark:text-amber-300">not counted — {evaluator.reason}</span>}
        <span className="ml-auto">{outcome === null ? <span className="text-xs text-muted-foreground">not graded yet</span> : <OutcomeChip outcome={outcome} />}</span>
      </div>

      <div className="space-y-1 rounded-md border-l-4 border-primary/50 bg-primary/5 px-3 py-2 text-sm" data-testid="evaluator-looks-for">
        <p className="text-xs font-medium text-muted-foreground">Looking for</p>
        <p>{check?.kind === 'llm_judge' ? check.rubric : entry.rule ?? 'This Evaluator version is gone.'}</p>
        {check !== null && <p className="text-xs text-muted-foreground">{readsOf(check, context.output.evalCase)}</p>}
      </div>

      {entry.error !== null && (
        <p className="text-xs text-amber-700 dark:text-amber-300">Could not grade this trial: {entry.error}</p>
      )}
      {score !== null && (
        verdict === undefined ? (
          <div className="space-y-1 text-xs">
            <p className="font-medium text-muted-foreground">Verdict</p>
            <p className="whitespace-pre-wrap" data-testid="evaluator-comment">{rendered ?? 'The check gave no comment.'}</p>
          </div>
        ) : (
          <ul className="text-xs">
            <JudgeVerdictRow
              step={context.step}
              evalRunId={context.evalRunId}
              verdict={verdict}
              mayEdit={context.mayEdit}
              editReason={context.editReason}
              rationale={rendered}
            />
          </ul>
        )
      )}

      {check !== null && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">How it checks</summary>
          <div className="mt-2"><CheckDetails check={check} /></div>
        </details>
      )}
      {entry.judgePrompt !== null && <JudgePrompt messages={entry.judgePrompt} />}
    </div>
  );
}

function entryBody(entry: StoredAgentTrajectoryEntry): string {
  if (entry.text !== undefined) return entry.text;
  if (entry.input !== undefined) return json(entry.input);
  if (typeof entry.content === 'string') return entry.content;
  return json(entry.content);
}

/** The agent's log as the judges and code checks read it, numbered as a judge cites it; cited entries are marked. */
function AgentLog({ entries, citedBy }: { entries: readonly StoredAgentTrajectoryEntry[]; citedBy: ReadonlyMap<number, string[]> }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No log was recorded for this trial.</p>;
  return (
    <ol className="space-y-1.5" data-testid="trial-agent-log">
      {entries.map((entry) => {
        const citers = citedBy.get(entry.seq) ?? [];
        const tool = entry.tool ?? entry.tool_name;
        return (
          <li
            key={entry.seq}
            id={`log-entry-${entry.seq}`}
            className={cn(
              'scroll-mt-6 rounded-md border px-3 py-2 target:ring-2 target:ring-primary',
              citers.length > 0 && 'border-amber-500/60 bg-amber-500/5',
            )}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="font-mono text-muted-foreground">[{entry.seq}]</span>
              <span className="font-medium">{[entry.type, entry.subtype].filter((part) => part !== undefined).join(' / ')}</span>
              {tool !== undefined && <span className="font-mono">{tool}</span>}
              {citers.length > 0 && <span className="ml-auto text-amber-800 dark:text-amber-300">cited by {citers.join(', ')}</span>}
            </div>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{entryBody(entry)}</pre>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One trial of an Eval Run (ADR-0023), with everything its step and its
 * Evaluators read and gave: the Eval Case's input and expected output, the
 * output and the agent's own summary; per Evaluator what it looks for and
 * reads, its verdict and rationale — log entries a judge cites link to the
 * log — the exact messages a model judge was sent, and a person's review; and
 * the agent's whole log, as the judges read it.
 */
export function EvalTrialDetail({ handle, workflowName, evalRunId, trialId }: {
  handle: string;
  workflowName: string;
  evalRunId: string;
  trialId: string;
}) {
  const trial = useEvalTrial(evalRunId, trialId);
  const run = useEvalRun(evalRunId);
  const { mayEdit, reason: editReason } = useWorkflowEditGate(handle, workflowName);

  const failed = trial.error ?? run.error;
  if (failed instanceof Error) return <p className="p-6 text-sm text-destructive">{failed.message}</p>;
  if (trial.data === undefined || run.data === undefined) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  const output = trial.data;
  const { trial: evalTrial, variant, evalCase, evaluators } = output;
  const { evalRun, report } = run.data;
  const step: EvaluatedStep = { namespace: evalRun.namespace, workflowName: evalRun.workflowName, stepId: evalRun.stepId };
  const passed = report.trialResults.find((result) => result.trialId === evalTrial.id)?.passed ?? null;
  const verdicts = report.judgeVerdicts.filter((verdict) => verdict.trialId === evalTrial.id);
  const logEntries = new Set(output.trajectory.map((entry) => entry.seq));
  const citedBy = new Map<number, string[]>();
  for (const entry of evaluators) {
    if (entry.evaluator.kind !== 'llm_judge') continue;
    for (const seq of new Set(citedEntries(entry.score?.comment ?? null))) {
      citedBy.set(seq, [...(citedBy.get(seq) ?? []), entry.evaluator.name]);
    }
  }
  const negative = evalCase?.expectation === 'negative';
  const instanceId = evalTrial.processInstanceId;

  return (
    <div className="space-y-8 p-6" data-testid="eval-trial-detail">
      <div className="space-y-3">
        <Link href={`${routes.workflowEvalRun(handle, workflowName, evalRunId)}?tab=trials`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Eval Run {evalRunId.slice(0, 8)}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold">{evalCase?.name ?? evalTrial.caseId.slice(0, 8)} · trial {evalTrial.trialIndex + 1}</h1>
          <TrialStatusBadge status={evalTrial.status} />
          <TrialResultBadge passed={passed} />
        </div>
        <p className="text-xs text-muted-foreground">
          {variant.label} — {describePatch(variant.patch)}
          {evalTrial.costUsd !== null && ` · ${formatCostUsd(evalTrial.costUsd)}`}
          {evalTrial.durationMs !== null && ` · ${formatDuration(evalTrial.durationMs)}`}
          {evalTrial.inputTokens !== null && ` · ${evalTrial.inputTokens + (evalTrial.outputTokens ?? 0)} tokens`}
        </p>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <a href="#trial-io" className="text-primary hover:underline">Input and output</a>
          <a href="#trial-evaluators" className="text-primary hover:underline">Evaluators ({evaluators.length})</a>
          <a href="#trial-log" className="text-primary hover:underline">Agent log ({output.trajectory.length})</a>
          {instanceId !== null && (
            <>
              <Link href={routes.workflowRunStep(handle, workflowName, instanceId, evalRun.stepId)} className="inline-flex items-center gap-1 text-primary hover:underline">
                Step execution and full agent log <ExternalLink className="h-3 w-3" />
              </Link>
              <Link href={routes.workflowRun(handle, workflowName, instanceId)} className="inline-flex items-center gap-1 text-primary hover:underline">
                Trial&apos;s workflow run <ExternalLink className="h-3 w-3" />
              </Link>
            </>
          )}
        </nav>
        {evalTrial.error !== null && <p className="whitespace-pre-wrap text-xs text-amber-700 dark:text-amber-300">{evalTrial.error}</p>}
      </div>

      <Section id="trial-io" title="Input and output" description="What the step was given, what the case expects of it, and what the agent returned.">
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Input">
            <pre className={preClass} data-testid="trial-input">{json(output.stepInput)}</pre>
          </Panel>
          <Panel title={evalCase === null ? 'Expected output' : negative ? 'Output it must not return' : 'Expected output'}>
            {evalCase?.expectedOutput === null || evalCase === null ? (
              <p className="text-xs text-muted-foreground">{evalCase === null ? 'The case no longer exists.' : 'The case expects no particular output.'}</p>
            ) : (
              <>
                <pre className={preClass} data-testid="trial-expected-output">{json(evalCase.expectedOutput)}</pre>
                <p className="text-xs text-muted-foreground">
                  Compared {evalCase.comparison === 'exact' ? 'exactly' : 'by agreement'}
                  {evalCase.agreementInstructions !== null && ` — ${evalCase.agreementInstructions}`}
                </p>
              </>
            )}
          </Panel>
          <Panel title="Output">
            <pre className={preClass} data-testid="trial-output">{json(output.result)}</pre>
            {evalTrial.confidence !== null && <p className="text-xs text-muted-foreground">The agent said it was {Math.round(evalTrial.confidence * 100)}% confident.</p>}
          </Panel>
        </div>
        {output.reasoningSummary !== null && output.reasoningSummary !== '' && (
          <Panel title="The agent's own summary">
            <p className="whitespace-pre-wrap text-sm">{output.reasoningSummary}</p>
          </Panel>
        )}
      </Section>

      <Section
        id="trial-evaluators"
        title="Evaluators"
        description="Each Evaluator the case selects: what it looks for, what it reads, its verdict and why. A model's verdict shows the exact messages it was sent; log entries it cites are linked and marked in the log below."
      >
        {evaluators.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Evaluator grades this case.</p>
        ) : (
          <div className="space-y-3">
            {evaluators.map((entry) => (
              <EvaluatorResult key={entry.evaluator.evaluatorId} entry={entry} context={{ step, evalRunId, output, verdicts, logEntries, mayEdit, editReason }} />
            ))}
          </div>
        )}
      </Section>

      <Section id="trial-log" title="Agent log" description="Everything the agent did — reasoning, tool calls and their results — numbered as the judges read and cite it.">
        <AgentLog entries={output.trajectory} citedBy={citedBy} />
      </Section>
    </div>
  );
}
