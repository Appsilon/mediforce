'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Archive, Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OriginalDefinitionPanelProps {
  original: Record<string, unknown>;
}

/** The version's steps and skills repository as they were before the migration; read-only, to compare with the editor below. */
export function OriginalDefinitionPanel({ original }: OriginalDefinitionPanelProps) {
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(searchParams.get('view') === 'original');
  const [copied, setCopied] = React.useState(false);
  const json = React.useMemo(() => JSON.stringify(original, null, 2), [original]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.warn('[OriginalDefinitionPanel] Clipboard write failed');
    }
  }

  return (
    <div className="border-b bg-amber-50/50 dark:bg-amber-950/20 px-6 py-2" data-testid="original-definition-panel">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200">
          <Archive className="h-4 w-4 shrink-0" />
          <span>
            This version was migrated off workflow-file skills and `externalSkillsRepo`. The editor below shows the
            migrated steps; the original steps are kept for comparison.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {open && (
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                copied
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/30',
              )}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((previous) => !previous)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? 'Hide original definition' : 'View original definition'}
          </button>
        </div>
      </div>
      {open && (
        <pre
          className="mt-2 max-h-96 overflow-auto rounded-md border bg-background p-3 text-xs font-mono"
          data-testid="original-definition-json"
        >
          {json}
        </pre>
      )}
    </div>
  );
}
