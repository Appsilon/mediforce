'use client';

import * as React from 'react';
import { useAgentRunIo } from '@/hooks/use-step-evaluation';

function JsonPane({ title, value, testId }: { title: string; value: unknown; testId: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="text-muted-foreground">{title}</div>
      <pre className="mt-0.5 max-h-60 overflow-auto rounded bg-muted p-1.5 whitespace-pre-wrap break-words">
        {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/** One Agent Run as the pair a case or a label is about: what its step was given, beside what it returned. */
export function RunInputOutput({ agentRunId, outputTitle = 'Output it returned' }: { agentRunId: string; outputTitle?: string }) {
  const io = useAgentRunIo(agentRunId);
  if (io.isError) return <p className="text-xs text-destructive">{io.error instanceof Error ? io.error.message : 'The run\'s input and output could not be loaded.'}</p>;
  if (io.data === undefined) return <p className="text-xs text-muted-foreground">Loading input and output…</p>;
  return (
    <div className="grid gap-2 text-xs md:grid-cols-2" data-testid="run-input-output">
      <JsonPane title="Input the step was given" value={io.data.stepInput} testId="run-input" />
      <JsonPane title={outputTitle} value={io.data.result} testId="run-output" />
    </div>
  );
}

/** A collapsed input/output pair, fetched the first time it is opened. */
export function RunInputOutputDetails({ agentRunId, summary = 'Input and output' }: { agentRunId: string; summary?: string }) {
  const [opened, setOpened] = React.useState(false);
  return (
    <details className="mt-1 text-xs" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
      <summary className="cursor-pointer text-muted-foreground">{summary}</summary>
      {opened && <div className="mt-1"><RunInputOutput agentRunId={agentRunId} /></div>}
    </details>
  );
}
