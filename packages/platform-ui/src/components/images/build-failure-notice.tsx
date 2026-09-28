'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { BuildFailure } from './build-error';

/** A failed build: the cause first, BuildKit's output behind a disclosure. */
export function BuildFailureNotice({ failure }: { failure: BuildFailure }) {
  const [showFullError, setShowFullError] = useState(false);
  return (
    <div className="space-y-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <p className={failure.explained ? '' : 'break-all font-mono text-xs'}>{failure.summary}</p>
      <button
        type="button"
        onClick={() => setShowFullError((current) => !current)}
        aria-expanded={showFullError}
        className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
      >
        {showFullError ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {showFullError ? 'Hide full error' : 'Show full error'}
      </button>
      {showFullError && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
          {failure.detail}
        </pre>
      )}
    </div>
  );
}
