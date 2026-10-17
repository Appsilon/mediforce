'use client';

import * as React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import type { AgentResultSource, AgentSummary } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';

/** What an agent step's result is called: `result.json` only when the agent wrote one (#1551). */
export function resultLabel(source: AgentResultSource | null | undefined): string {
  switch (source) {
    case 'result_json':
      return 'result.json';
    case 'final_message':
      return 'Result (from closing message)';
    case 'output_files':
      return 'Result (from /output files)';
    default:
      return 'Result';
  }
}

/** The closing message as the agent wrote it: its JSON pretty-printed when it parsed, else the text. */
export function AgentSummaryView({ summary, className }: { summary: AgentSummary; className?: string }) {
  return (
    <pre
      className={cn('rounded-md bg-muted p-4 text-xs overflow-auto max-h-[600px] whitespace-pre-wrap break-words', className)}
      data-testid="agent-summary"
    >
      {summary.json === undefined ? summary.text : JSON.stringify(summary.json, null, 2)}
    </pre>
  );
}

const triggerClass = cn(
  'px-2.5 py-1 text-xs font-medium font-mono rounded-md text-muted-foreground transition-colors',
  'data-[state=active]:bg-muted data-[state=active]:text-foreground',
);

/**
 * An agent step's two outputs, one at a time: its result and its closing
 * message (agent_summary.json). Neither replaces the other (#1551). A run
 * with no closing message shows its result alone.
 */
export function AgentOutputSwitch({
  result,
  resultSource,
  agentSummary,
  summaryClassName,
}: {
  result: React.ReactNode;
  resultSource: AgentResultSource | null | undefined;
  agentSummary: AgentSummary | null | undefined;
  summaryClassName?: string;
}) {
  if (agentSummary === null || agentSummary === undefined) return <>{result}</>;

  return (
    <Tabs.Root defaultValue="result">
      <Tabs.List className="mb-2 flex gap-1" aria-label="Agent output">
        <Tabs.Trigger value="result" className={triggerClass}>{resultLabel(resultSource)}</Tabs.Trigger>
        <Tabs.Trigger value="agent-summary" className={triggerClass}>agent_summary.json</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="result">{result}</Tabs.Content>
      <Tabs.Content value="agent-summary">
        <AgentSummaryView summary={agentSummary} className={summaryClassName} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
