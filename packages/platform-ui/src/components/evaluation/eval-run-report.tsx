'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import type { EvalRunOutput } from '@mediforce/platform-api/contract';
import { cn } from '@/lib/utils';

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

/**
 * An Eval Run's report (ADR-0023 D10): per Evaluator, the pass rate with its
 * Wilson 95% interval, pass@k, pass^k and flakiness, computed from the Scores
 * its trials received. Evaluators that do not count are shown as such.
 */
export function EvalRunReport({ output }: { output: EvalRunOutput }) {
  const { evalRun, report, trials } = output;
  return (
    <div className="space-y-3" data-testid="eval-run-report">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{report.trials.scored}/{report.trials.total} trials scored</span>
        {report.trials.failed > 0 && <span>{report.trials.failed} failed</span>}
        {report.trials.skipped > 0 && <span>{report.trials.skipped} skipped</span>}
        {report.trials.inProgress > 0 && (
          <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />{report.trials.inProgress} in progress</span>
        )}
        <span>spent ${report.costUsd.toFixed(4)} of ${evalRun.budgetUsd}</span>
        {report.meanDurationMs !== null && <span>mean {(report.meanDurationMs / 1000).toFixed(1)}s</span>}
        <span>{report.inputTokens + report.outputTokens} tokens</span>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="text-left">
            <th className="py-1 font-medium">Evaluator</th>
            <th className="py-1 font-medium">Pass rate</th>
            <th className="py-1 font-medium">95% CI</th>
            <th className="py-1 font-medium">pass@{report.k}</th>
            <th className="py-1 font-medium">pass^{report.k}</th>
            <th className="py-1 font-medium">Flaky</th>
            <th className="py-1 font-medium">Errors</th>
          </tr>
        </thead>
        <tbody>
          {report.evaluators.map((evaluator) => (
            <tr key={evaluator.evaluatorId} className={cn('border-t', !evaluator.counted && 'text-muted-foreground')}>
              <td className="py-1.5">
                <span className="font-medium">{evaluator.name}</span>
                <span className="ml-1 text-xs text-muted-foreground">v{evaluator.version} · {evaluator.severity}</span>
                {!evaluator.counted && <div className="text-xs">not counted — {evaluator.reason}</div>}
              </td>
              <td className="py-1.5">{percent(evaluator.passRate)} <span className="text-xs text-muted-foreground">({evaluator.passes}/{evaluator.passes + evaluator.failures})</span></td>
              <td className="py-1.5 text-xs">{evaluator.wilsonLower === null ? '—' : `${percent(evaluator.wilsonLower)}–${percent(evaluator.wilsonUpper)}`}</td>
              <td className="py-1.5">{percent(evaluator.passAtK)}</td>
              <td className="py-1.5">{percent(evaluator.passHatK)}</td>
              <td className="py-1.5">{percent(evaluator.flakiness)}</td>
              <td className="py-1.5">{evaluator.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {trials.some((trial) => trial.error !== null) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Trial problems</summary>
          <ul className="mt-1 space-y-1">
            {trials.filter((trial) => trial.error !== null).map((trial) => (
              <li key={trial.id}><span className="font-mono">{trial.agentRunId ?? trial.id.slice(0, 8)}</span>: {trial.error}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
