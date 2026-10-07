'use client';

import * as React from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { EvalCase, EvaluatedStep, EvaluatorCheck, JudgeVerdict, StoredAgentTrajectoryEntry } from '@mediforce/platform-core';
import type { EvalTrialEvaluator, GetEvalTrialOutput } from '@mediforce/platform-api/contract';
import { routes } from '@/lib/routes';
import { formatCostUsd, formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { secondaryButtonClass } from '@/components/ui/button-styles';
import { useEvalRun, useEvalTrial } from '@/hooks/use-step-evaluation';
import { useWorkflowEditGate } from '@/hooks/use-workflow-access';
import { OutcomeChip, TrialResultBadge, TrialStatusBadge } from './eval-run-badges';
import { JudgeVerdictRow } from './judge-verdicts';
import { CHECK_KINDS, CheckDetails } from './evaluator-check-editor';
import { citationParts, citedEntries } from './judge-citations';

const preClass = 'max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-xs';

function json(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function Section({ id, title, children }: { id: string; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2 className="text-base font-semibold">{title}</h2>
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

/** A judge's text with every number in an `[n]` or `[n, m]` that names an entry of the agent's log turned into a link to it. */
function withCitations(text: string, entries: ReadonlySet<number>): React.ReactNode[] {
  return citationParts(text, entries).map((part, index) => ('text' in part ? part.text : (
    <a key={index} href={`#log-entry-${part.seq}`} className="rounded bg-amber-500/15 px-0.5 font-mono text-amber-800 hover:underline dark:text-amber-300">
      {part.seq}
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
      return 'The judge model reads the step\'s input, the agent\'s whole log, the output and the agent\'s own summary — exactly the messages in its Evaluator logs — and answers this question.';
    case 'expected_output':
      return evalCase?.comparison === 'agreement'
        ? 'A model compares the output with the case\'s expected output, with the instructions below, and scores how far they agree.'
        : 'Code compares the output with the case\'s expected output field by field, with no model; any difference fails it.';
  }
}

interface EvaluatorLogEntry {
  readonly kind: string;
  readonly detail: string | null;
  readonly body: string;
}

/** A model-run check's log: the messages its model was sent, then each answer it gave. */
function evaluatorLogEntries(entry: EvalTrialEvaluator): EvaluatorLogEntry[] {
  const sent = (entry.judgePrompt ?? []).map((message) => ({ kind: message.role, detail: null, body: message.content }));
  const answered = (entry.judgeCalls ?? []).map((call) => ({
    kind: 'assistant',
    detail: `${call.model} · ${call.promptTokens} in / ${call.completionTokens} out tokens · ${formatDuration(call.durationMs)}`,
    body: call.response,
  }));
  return [...sent, ...answered];
}

/** One log entry: a header line, then its text. */
function LogRow({ id, className, body, children }: { id?: string; className?: string; body: string; children: React.ReactNode }) {
  return (
    <li id={id} className={cn('rounded-md border px-3 py-2', className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">{children}</div>
      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{body}</pre>
    </li>
  );
}

function EvaluatorLog({ entry }: { entry: EvalTrialEvaluator }) {
  const [open, setOpen] = React.useState(false);
  const entries = evaluatorLogEntries(entry);
  return (
    <div className="space-y-2 text-xs" data-testid="evaluator-log">
      <button type="button" className={secondaryButtonClass} aria-expanded={open} onClick={() => setOpen((current) => current === false)}>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Evaluator logs ({entries.length})
      </button>
      {open && (
        <>
          <p className="text-muted-foreground">
            What the model was sent — rebuilt from the Evaluator version frozen into this run and this trial&apos;s input, log and output, by the same code that sent it — then what it answered.
            {entry.judgeCalls === null && entry.outcome !== null && ' No answer was kept for this trial.'}
          </p>
          <ol className="space-y-1.5">
            {entries.map((logEntry, index) => (
              <LogRow key={index} body={logEntry.body}>
                <span className="font-medium">{logEntry.kind}</span>
                {logEntry.detail !== null && <span className="text-muted-foreground">{logEntry.detail}</span>}
              </LogRow>
            ))}
          </ol>
        </>
      )}
    </div>
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
        <span className="text-xs text-muted-foreground">v{evaluator.version} · {CHECK_KINDS[evaluator.kind].label}</span>
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
          <div className="mt-2"><CheckDetails check={check} evalCase={context.output.evalCase} /></div>
        </details>
      )}
      {(entry.judgePrompt !== null || entry.judgeCalls !== null) && <EvaluatorLog entry={entry} />}
    </div>
  );
}

function entryBody(entry: StoredAgentTrajectoryEntry): string {
  if (entry.text !== undefined) return entry.text;
  if (entry.input !== undefined) return json(entry.input);
  if (typeof entry.content === 'string') return entry.content;
  return json(entry.content);
}

const LOG_ENTRY_HASH = '#log-entry-';

/** The agent's log as the judges and code checks read it, numbered as a judge cites it; cited entries are marked. */
function AgentLog({ entries, citedBy }: { entries: readonly StoredAgentTrajectoryEntry[]; citedBy: ReadonlyMap<number, string[]> }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No log was recorded for this trial.</p>;
  return (
    <ol className="space-y-1.5" data-testid="trial-agent-log">
      {entries.map((entry) => {
        const citers = citedBy.get(entry.seq) ?? [];
        const tool = entry.tool ?? entry.tool_name;
        return (
          <LogRow
            key={entry.seq}
            id={`log-entry-${entry.seq}`}
            className={cn('scroll-mt-6 target:ring-2 target:ring-primary', citers.length > 0 && 'border-amber-500/60 bg-amber-500/5')}
            body={entryBody(entry)}
          >
            <span className="font-mono text-muted-foreground">[{entry.seq}]</span>
            <span className="font-medium">{[entry.type, entry.subtype].filter((part) => part !== undefined).join(' / ')}</span>
            {tool !== undefined && <span className="font-mono">{tool}</span>}
            {citers.length > 0 && <span className="ml-auto text-amber-800 dark:text-amber-300">cited by {citers.join(', ')}</span>}
          </LogRow>
        );
      })}
    </ol>
  );
}

/**
 * One trial of an Eval Run (ADR-0023), with everything its step and its
 * Evaluators read and gave: the Eval Case's input and expected output and the
 * output; per Evaluator what it looks for and reads, its verdict and
 * rationale — log entries a judge cites link to the log — a model's Evaluator
 * logs: what it was sent and answered, and a person's review; and the agent's
 * whole log, as the judges read it, collapsed until opened or cited.
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
  const [logOpen, setLogOpen] = React.useState(false);

  // A link to a log entry — a judge's citation, or a shared URL — opens the log first, so the entry is there to scroll to.
  React.useEffect(() => {
    if (window.location.hash.startsWith(LOG_ENTRY_HASH) === false) return;
    flushSync(() => setLogOpen(true));
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, []);
  const openLogOnCitation = (event: React.MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    if (link?.getAttribute('href')?.startsWith(LOG_ENTRY_HASH) === true) flushSync(() => setLogOpen(true));
  };

  const failed = trial.error ?? run.error;
  if (failed instanceof Error) return <p className="p-6 text-sm text-destructive">{failed.message}</p>;
  if (trial.data === undefined || run.data === undefined) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  const output = trial.data;
  const { trial: evalTrial, evalCase, evaluators } = output;
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
    <div className="space-y-8 p-6" data-testid="eval-trial-detail" onClickCapture={openLogOnCitation}>
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
          {[
            evalTrial.costUsd === null ? null : formatCostUsd(evalTrial.costUsd),
            evalTrial.durationMs === null ? null : formatDuration(evalTrial.durationMs),
            evalTrial.inputTokens === null ? null : `${evalTrial.inputTokens + (evalTrial.outputTokens ?? 0)} tokens`,
          ].filter((part) => part !== null).join(' · ')}
        </p>
        {evalTrial.error !== null && <p className="whitespace-pre-wrap text-xs text-amber-700 dark:text-amber-300">{evalTrial.error}</p>}
      </div>

      <Section id="trial-io" title="Input and output">
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Input">
            <pre className={preClass} data-testid="trial-input">{json(output.stepInput)}</pre>
          </Panel>
          <Panel title={evalCase === null ? 'Expected output' : negative ? 'Output it must not return' : 'Expected output'}>
            {evalCase?.expectedOutput === null || evalCase === null ? (
              <p className="text-xs text-muted-foreground">{evalCase === null ? 'The case no longer exists.' : 'The case expects no particular output.'}</p>
            ) : (
              <pre className={preClass} data-testid="trial-expected-output">{json(evalCase.expectedOutput)}</pre>
            )}
          </Panel>
          <Panel title="Output">
            <pre className={preClass} data-testid="trial-output">{json(output.result)}</pre>
          </Panel>
        </div>
      </Section>

      <Section id="trial-evaluators" title="Evaluators">
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

      <Section
        id="trial-log"
        title={(
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button type="button" className="inline-flex items-center gap-1" aria-expanded={logOpen} onClick={() => setLogOpen((current) => current === false)}>
              {logOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Agent log ({output.trajectory.length})
            </button>
            {instanceId !== null && (
              <span className="flex flex-wrap gap-x-4 text-xs font-normal">
                <Link href={routes.workflowRunStep(handle, workflowName, instanceId, evalRun.stepId)} className="inline-flex items-center gap-1 text-primary hover:underline">
                  Step execution and full agent log <ExternalLink className="h-3 w-3" />
                </Link>
                <Link href={routes.workflowRun(handle, workflowName, instanceId)} className="inline-flex items-center gap-1 text-primary hover:underline">
                  Trial&apos;s workflow run <ExternalLink className="h-3 w-3" />
                </Link>
              </span>
            )}
          </div>
        )}
      >
        {logOpen && <AgentLog entries={output.trajectory} citedBy={citedBy} />}
      </Section>
    </div>
  );
}
