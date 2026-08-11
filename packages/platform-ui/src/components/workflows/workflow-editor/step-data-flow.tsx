'use client';

import React from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CornerDownRight } from 'lucide-react';
import type { WorkflowStep } from '@mediforce/platform-core';
import { useStepSampleIo } from '@/hooks/use-step-sample-io';

interface StepIo {
  input: string;
  output: string;
  /** Path suffix downstream steps read, after `${steps.<id>.` */
  readPath: string;
}

/** Used when the step's plugin is not in the registry — or has none at all,
 *  as human, action and cowork steps do. Plugin-backed steps prefer the
 *  plugin's own declared contract so this never drifts from the runtime. */
function fallbackIo(step: WorkflowStep): StepIo {
  switch (step.executor) {
    case 'script':
      if (step.plugin === 'databricks-job') {
        return {
          input: 'The job id and parameters below, with ${...} placeholders resolved.',
          output: 'The JSON object the notebook exits with (dbutils.notebook.exit).',
          readPath: '<field>',
        };
      }
      return {
        input: 'Previous step outputs, written as JSON to /output/input.json. The working directory is /workspace.',
        output: 'The JSON object your code writes to /output/result.json. Without that file, raw stdout is used instead.',
        readPath: '<field>',
      };
    case 'agent':
      return {
        input: 'The prompt below plus previous step outputs, as JSON context.',
        output: 'The structured JSON the agent returns.',
        readPath: '<field>',
      };
    case 'cowork':
      return {
        input: 'The conversation with the assignee, steered by the system prompt.',
        output: 'The artifact extracted from the session, shaped by the output schema.',
        readPath: '<field>',
      };
    case 'action':
      switch (step.action?.kind) {
        case 'http':
          return {
            input: 'The URL, headers and body below, with ${...} placeholders resolved.',
            output: 'The response as { status, headers, body } — a non-2xx response is output, not a failure.',
            readPath: 'body.<field>',
          };
        case 'reshape':
          return {
            input: 'The values below, with ${...} placeholders resolved.',
            output: 'Those same resolved values.',
            readPath: '<key>',
          };
        case 'email':
          return {
            input: 'The recipients, subject and body below, with ${...} placeholders resolved.',
            output: 'The resolved to and subject.',
            readPath: '<field>',
          };
        default:
          return {
            input: 'The action config below, with ${...} placeholders resolved.',
            output: 'What the action returns.',
            readPath: '<field>',
          };
      }
    case 'human':
    default:
      return {
        input: 'The task form the assignee fills in — built from the Parameters below.',
        output: 'The submitted parameter values, each at the top level.',
        readPath: '<parameter name>',
      };
  }
}

function Row({ icon: Icon, label, children }: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/50" strokeWidth={2} />
      <p className="text-[11px] leading-relaxed text-muted-foreground min-w-0">
        <span className="font-semibold text-foreground/70">{label}</span>{' '}{children}
      </p>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[10.5px] rounded bg-muted px-1 py-0.5 text-foreground/80 break-all">
      {children}
    </code>
  );
}

/** Real JSON from the step's last attempt, shown under the matching In/Out
 *  row. Renders nothing for an empty or unavailable sample — the prose
 *  description above already covers that case. */
function SamplePreview({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  if (value === null || Object.keys(value).length === 0) return null;
  return (
    <div className="ml-5 rounded-md border border-border/40 bg-background/60 px-2 py-1.5">
      <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/50 mb-0.5">{label}</p>
      <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/** Minimal read-`/output/input.json`/write-`/output/result.json` boilerplate
 *  per runtime — shown on a script step until a real output sample exists,
 *  so the answer is "copy this shape" rather than another trip to the docs. */
const RUNTIME_TIPS: Record<string, string> = {
  python:
    'import json\n\n' +
    'with open("/output/input.json") as f:\n' +
    '    data = json.load(f)\n\n' +
    '# ... your logic ...\n\n' +
    'with open("/output/result.json", "w") as f:\n' +
    '    json.dump({"result": "ok"}, f)',
  javascript:
    'import { readFileSync, writeFileSync } from "node:fs";\n\n' +
    'const data = JSON.parse(readFileSync("/output/input.json", "utf-8"));\n\n' +
    '// ... your logic ...\n\n' +
    'writeFileSync("/output/result.json", JSON.stringify({ result: "ok" }));',
  r:
    'library(jsonlite)\n' +
    'data <- fromJSON("/output/input.json")\n\n' +
    '# ... your logic ...\n\n' +
    'write(toJSON(list(result = "ok"), auto_unbox = TRUE), "/output/result.json")',
  bash:
    '#!/bin/sh\nset -eu\n' +
    'input=$(cat /output/input.json)\n\n' +
    '# ... your logic ...\n\n' +
    'printf \'{"result":"ok"}\' > /output/result.json',
};

/**
 * Runtime-appropriate read/write example for a scriptable step, shown
 * whenever there's no real output sample to point to instead — a brand new
 * step (nothing has run yet), a dry-run-only step (output is a fake mock
 * envelope, not a real example — explained explicitly so it doesn't read as
 * "nothing happened"), or a step whose last real attempt failed (in which
 * case the error is shown alongside it). Renders nothing for a runtime with
 * no known snippet, or once a real output sample exists — at that point the
 * JSON above already answers "what shape does this take".
 */
function ScriptTip({ runtime, error, fromDryRun }: { runtime?: string; error: string | null; fromDryRun: boolean }) {
  const tip = runtime !== undefined ? RUNTIME_TIPS[runtime] : undefined;
  if (tip === undefined) return null;

  const failed = error !== null;
  const guidance = failed
    ? <>Make sure your script reads <Code>/output/input.json</Code> and writes <Code>/output/result.json</Code>:</>
    : fromDryRun
      ? <>Dry runs don&apos;t execute your script — this step ran a mock instead, so there&apos;s no real output to show yet. It should read <Code>/output/input.json</Code> and write <Code>/output/result.json</Code>:</>
      : <>Your script should read <Code>/output/input.json</Code> and write <Code>/output/result.json</Code>:</>;

  return (
    <div
      className={
        failed
          ? 'ml-5 rounded-md border border-red-300/60 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-2 py-1.5 space-y-1.5'
          : 'ml-5 rounded-md border border-border/40 bg-background/60 px-2 py-1.5 space-y-1.5'
      }
    >
      {failed && (
        <>
          <p className="text-[9px] font-medium uppercase tracking-wider text-red-600/70 dark:text-red-400/70">Last run failed</p>
          <pre className="text-[10px] font-mono text-red-700 dark:text-red-400 whitespace-pre-wrap break-all max-h-20 overflow-y-auto">
            {error}
          </pre>
        </>
      )}
      <p className="text-[10px] text-muted-foreground">{guidance}</p>
      <pre className="text-[10px] font-mono text-foreground/70 bg-muted rounded px-1.5 py-1 overflow-x-auto">
        {tip}
      </pre>
    </div>
  );
}

/**
 * How data enters and leaves this step, and the reference later steps use to
 * read it. Answers issue #1029: the `/output/result.json` contract and the
 * `${steps.<id>.<field>}` reference were only discoverable from the docs.
 */
export function StepDataFlow({ step, pluginIo, namespace, workflowName }: {
  step: WorkflowStep;
  pluginIo?: { inputDescription: string; outputDescription: string };
  namespace?: string;
  workflowName?: string;
}) {
  const fallback = fallbackIo(step);
  const io: StepIo = pluginIo
    ? { input: pluginIo.inputDescription, output: pluginIo.outputDescription, readPath: fallback.readPath }
    : fallback;

  const hasVerdicts = step.type === 'review' || step.type === 'decision';
  const sample = useStepSampleIo(namespace, workflowName, step.id);

  return (
    <div
      data-testid="step-data-flow"
      className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 space-y-1.5"
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Data flow</p>
      <Row icon={ArrowDownToLine} label="In">{io.input}</Row>
      <SamplePreview
        label={sample.fromDryRun ? "Last run's input (dry run)" : "Last run's input"}
        value={sample.input}
      />
      <Row icon={ArrowUpFromLine} label="Out">{io.output}</Row>
      <SamplePreview label="Last run's output" value={sample.output} />
      {sample.output === null && (
        <ScriptTip runtime={step.script?.runtime} error={sample.error} fromDryRun={sample.fromDryRun} />
      )}
      <Row icon={CornerDownRight} label="Next">
        Later steps read it as <Code>{`\${steps.${step.id}.${io.readPath}}`}</Code>
        {hasVerdicts && <> — and route on the verdict with <Code>verdict == &quot;…&quot;</Code> in a transition.</>}
      </Row>
    </div>
  );
}
