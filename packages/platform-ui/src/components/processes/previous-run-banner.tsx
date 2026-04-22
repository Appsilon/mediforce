'use client';

import * as React from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';

/**
 * Audit surface for the previous-run-outputs carry-over. Shown when the
 * current run's WorkflowDefinition declares `inputForNextRun` (i.e. the
 * `previousRun` field is set — either to a populated object or `{}`).
 */
export function PreviousRunBanner({
  values,
  sourceId,
  sourceHref,
}: {
  values: Record<string, unknown>;
  sourceId?: string;
  sourceHref?: string;
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const hasValues = Object.keys(values).length > 0;

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 text-blue-900 dark:text-blue-200">
        <History className="h-4 w-4 shrink-0" />
        <div className="flex-1 min-w-0">
          {hasValues ? (
            <span>
              Continued from previous run
              {sourceId !== undefined && (
                <>
                  {' — '}
                  {sourceHref ? (
                    <Link
                      href={sourceHref}
                      className="underline font-mono text-xs hover:text-blue-700 dark:hover:text-blue-100"
                    >
                      {sourceId.slice(0, 8)}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{sourceId.slice(0, 8)}</span>
                  )}
                </>
              )}
            </span>
          ) : (
            <span>
              No previous run to continue from — starting with an empty snapshot.
            </span>
          )}
        </div>
        {hasValues && (
          <button
            type="button"
            className="text-xs text-blue-700 dark:text-blue-300 hover:underline shrink-0"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Hide' : 'Show'} values
          </button>
        )}
      </div>
      {expanded && hasValues && (
        <pre className="mt-2 text-xs font-mono whitespace-pre-wrap break-all text-blue-900 dark:text-blue-100 bg-blue-100/50 dark:bg-blue-900/40 rounded p-2">
          {JSON.stringify(values, null, 2)}
        </pre>
      )}
    </div>
  );
}
