'use client';

import React from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CornerDownRight } from 'lucide-react';
import type { WorkflowStep } from '@mediforce/platform-core';

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

/**
 * How data enters and leaves this step, and the reference later steps use to
 * read it. Answers issue #1029: the `/output/result.json` contract and the
 * `${steps.<id>.<field>}` reference were only discoverable from the docs.
 */
export function StepDataFlow({ step, pluginIo }: {
  step: WorkflowStep;
  pluginIo?: { inputDescription: string; outputDescription: string };
}) {
  const fallback = fallbackIo(step);
  const io: StepIo = pluginIo
    ? { input: pluginIo.inputDescription, output: pluginIo.outputDescription, readPath: fallback.readPath }
    : fallback;

  const hasVerdicts = step.type === 'review' || step.type === 'decision';

  return (
    <div
      data-testid="step-data-flow"
      className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 space-y-1.5"
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Data flow</p>
      <Row icon={ArrowDownToLine} label="In">{io.input}</Row>
      <Row icon={ArrowUpFromLine} label="Out">{io.output}</Row>
      <Row icon={CornerDownRight} label="Next">
        Later steps read it as <Code>{`\${steps.${step.id}.${io.readPath}}`}</Code>
        {hasVerdicts && <> — and route on the verdict with <Code>verdict == &quot;…&quot;</Code> in a transition.</>}
      </Row>
    </div>
  );
}
